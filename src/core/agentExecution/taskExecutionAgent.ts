import type { AgentMessage } from '../../types';

import { AgentReviewError } from '../errors';
import { checkCommand, checkWritePath } from './policy';
import type {
    CommandApprovalDecision,
    ForwardTaskRequest,
    ForwardTaskResult,
    TaskExecutionAgent,
    TaskExecutionAgentDeps,
    WorkspaceAgentProfile
} from './types';

type AgentAction =
    | { type: 'glob'; pattern: string; limit?: number }
    | { type: 'readFile'; path: string; maxChars?: number }
    | { type: 'writeFile'; path: string; content: string }
    | { type: 'replaceLines'; path: string; startLine: number; endLine: number; newText: string }
    | { type: 'runCommand'; command: string; cwd?: string }
    | { type: 'finish'; summary: string };

interface AgentResponse {
    actions: AgentAction[];
}

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

function normalizeRelPath(p: string): string {
    return String(p || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

function extractJson(text: string): unknown {
    const trimmed = text.trim();
    if (!trimmed) return null;

    // Prefer fenced blocks
    const fenceMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
        return JSON.parse(fenceMatch[1]);
    }

    // Otherwise try to parse first top-level object.
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
        const slice = trimmed.slice(first, last + 1);
        return JSON.parse(slice);
    }

    return JSON.parse(trimmed);
}

function isAgentResponse(value: unknown): value is AgentResponse {
    if (!value || typeof value !== 'object') return false;
    const v = value as any;
    return Array.isArray(v.actions);
}

function resolveAgentProfile(config: TaskExecutionAgentDeps['config'], agentId?: string): WorkspaceAgentProfile {
    const id = agentId || config.defaultAgentId || 'default';
    const found = (config.agents || []).find((a) => a.id === id);
    if (found) return found;
    const fallback = (config.agents || [])[0];
    return fallback || { id: 'default', name: 'Default Agent' };
}

function formatLineNumbered(content: string, maxChars: number): string {
    const normalized = content.replace(/\r\n/g, '\n');
    const truncated = normalized.length > maxChars ? normalized.slice(0, maxChars) + '\n…(truncated)…\n' : normalized;
    const lines = truncated.split('\n');
    const width = String(lines.length).length;
    return lines
        .map((l, idx) => `${String(idx + 1).padStart(width, ' ')}| ${l}`)
        .join('\n');
}

function applyReplaceLines(content: string, startLine: number, endLine: number, newText: string): string {
    const normalized = content.replace(/\r\n/g, '\n');
    const endsWithNewline = normalized.endsWith('\n');
    const lines = normalized.split('\n');

    const start = clamp(startLine, 1, Math.max(1, lines.length));
    const end = clamp(endLine, start, Math.max(start, lines.length));

    const before = lines.slice(0, start - 1);
    const after = lines.slice(end);
    const replacementLines = newText.replace(/\r\n/g, '\n').split('\n');

    const next = [...before, ...replacementLines, ...after].join('\n');
    return endsWithNewline && !next.endsWith('\n') ? next + '\n' : next;
}

function log(cb: TaskExecutionAgentDeps['callbacks'] | undefined, s: string): void {
    cb?.onLog?.(s);
}

export class JsonToolTaskExecutionAgent implements TaskExecutionAgent {
    constructor(private deps: TaskExecutionAgentDeps) {}

    async execute(task: ForwardTaskRequest): Promise<ForwardTaskResult> {
        const { provider, host, callbacks } = this.deps;
        const agent = resolveAgentProfile(this.deps.config, this.deps.agentId);

        const execConfig = this.deps.config.execution;
        const filesChanged = new Set<string>();
        const commandsRun: Array<{ command: string; exitCode: number }> = [];

        const originals = new Map<string, string>();

        const systemPrompt = [
            `You are an autonomous coding agent running inside a real repository.`,
            `You MUST respond with a single JSON object (no extra text).`,
            ``,
            `Schema:`,
            `{`,
            `  "actions": [`,
            `    { "type": "glob", "pattern": "**/*.js", "limit": 50 },`,
            `    { "type": "readFile", "path": "src/app.jsx", "maxChars": 12000 },`,
            `    { "type": "replaceLines", "path": "src/app.jsx", "startLine": 10, "endLine": 12, "newText": "..." },`,
            `    { "type": "writeFile", "path": "src/new.txt", "content": "..." },`,
            `    { "type": "runCommand", "command": "npm test" },`,
            `    { "type": "finish", "summary": "What changed and why." }`,
            `  ]`,
            `}`,
            ``,
            `Rules:`,
            `- Only use relative paths within the workspace.`,
            `- Prefer small edits (replaceLines) over full rewrites.`,
            `- If you need file content, request it with readFile.`,
            `- After edits, run appropriate checks (tests/lint) if allowed.`,
            `- Stop by emitting a finish action.`,
            ``,
            agent.instructions ? `Extra instructions:\n${agent.instructions}` : ''
        ].filter(Boolean).join('\n');

        const userContext = [
            `Task Title: ${task.title}`,
            `Task Description: ${task.description || '(none)'}`,
            task.affectedFiles?.length ? `Affected Files:\n- ${task.affectedFiles.map((p) => normalizeRelPath(p)).join('\n- ')}` : `Affected Files: (none provided)`,
            ``,
            `Workspace root: ${host.rootPath}`,
            `Execute by iterating actions until finish.`
        ].join('\n');

        const messages: AgentMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContext }
        ];

        const maxTurns = 20;
        for (let turn = 1; turn <= maxTurns; turn++) {
            callbacks?.onProgress?.(`Agent thinking (${turn}/${maxTurns})...`);
            const raw = await provider.chat(messages, { temperature: 0.2, maxTokens: 2000 });

            let parsed: unknown;
            try {
                parsed = extractJson(raw);
            } catch (e) {
                messages.push({ role: 'assistant', content: raw });
                messages.push({ role: 'user', content: `ERROR: Response was not valid JSON. Reply again with ONLY valid JSON.\nParse error: ${(e as Error).message}` });
                continue;
            }

            if (!isAgentResponse(parsed)) {
                messages.push({ role: 'assistant', content: raw });
                messages.push({ role: 'user', content: `ERROR: JSON must have an "actions" array. Reply again with ONLY valid JSON.` });
                continue;
            }

            const toolResults: string[] = [];

            for (const action of parsed.actions) {
                if (!action || typeof action !== 'object' || typeof (action as any).type !== 'string') {
                    toolResults.push(`ERROR: Invalid action: ${JSON.stringify(action)}`);
                    continue;
                }

                switch (action.type) {
                    case 'glob': {
                        const pattern = String((action as any).pattern || '').trim();
                        const limit = clamp(Number((action as any).limit ?? 50), 1, 500);
                        if (!pattern) {
                            toolResults.push(`glob: ERROR missing pattern`);
                            break;
                        }
                        callbacks?.onProgress?.(`Listing files: ${pattern}`);
                        const matches = await host.glob(pattern, limit);
                        toolResults.push(`glob(${pattern}) -> ${matches.length} file(s)\n${matches.map((m) => `- ${m}`).join('\n')}`);
                        break;
                    }
                    case 'readFile': {
                        const relPath = normalizeRelPath((action as any).path);
                        const maxChars = clamp(Number((action as any).maxChars ?? 12000), 1000, 50000);
                        if (!relPath) {
                            toolResults.push(`readFile: ERROR missing path`);
                            break;
                        }
                        callbacks?.onProgress?.(`Reading: ${relPath}`);
                        const exists = await host.fileExists(relPath);
                        if (!exists) {
                            toolResults.push(`readFile(${relPath}): ERROR file does not exist`);
                            break;
                        }
                        const content = await host.readTextFile(relPath);
                        toolResults.push(`readFile(${relPath})\n\`\`\`\n${formatLineNumbered(content, maxChars)}\n\`\`\``);
                        break;
                    }
                    case 'writeFile': {
                        const relPath = normalizeRelPath((action as any).path);
                        const content = String((action as any).content ?? '');
                        if (!relPath) {
                            toolResults.push(`writeFile: ERROR missing path`);
                            break;
                        }
                        const pathDecision = checkWritePath(relPath, execConfig);
                        if (!pathDecision.allowed) {
                            toolResults.push(`writeFile(${relPath}): DENIED - ${pathDecision.reason}`);
                            break;
                        }

                        callbacks?.onProgress?.(`Writing: ${relPath}`);
                        if (!originals.has(relPath) && (await host.fileExists(relPath))) {
                            originals.set(relPath, await host.readTextFile(relPath));
                        }
                        await host.writeTextFile(relPath, content);
                        filesChanged.add(relPath);
                        toolResults.push(`writeFile(${relPath}): OK (${content.length} chars)`);
                        break;
                    }
                    case 'replaceLines': {
                        const relPath = normalizeRelPath((action as any).path);
                        const startLine = Number((action as any).startLine);
                        const endLine = Number((action as any).endLine);
                        const newText = String((action as any).newText ?? '');
                        if (!relPath) {
                            toolResults.push(`replaceLines: ERROR missing path`);
                            break;
                        }
                        const pathDecision = checkWritePath(relPath, execConfig);
                        if (!pathDecision.allowed) {
                            toolResults.push(`replaceLines(${relPath}): DENIED - ${pathDecision.reason}`);
                            break;
                        }
                        const exists = await host.fileExists(relPath);
                        if (!exists) {
                            toolResults.push(`replaceLines(${relPath}): ERROR file does not exist`);
                            break;
                        }
                        const content = await host.readTextFile(relPath);
                        if (!originals.has(relPath)) originals.set(relPath, content);

                        const next = applyReplaceLines(content, startLine, endLine, newText);
                        await host.writeTextFile(relPath, next);
                        filesChanged.add(relPath);
                        toolResults.push(`replaceLines(${relPath}:${startLine}-${endLine}): OK`);
                        break;
                    }
                    case 'runCommand': {
                        const command = String((action as any).command ?? '');
                        const cwd = (action as any).cwd ? normalizeRelPath(String((action as any).cwd)) : undefined;

                        const decision = checkCommand(command, execConfig);
                        if (decision.allowed) {
                            callbacks?.onProgress?.(`Running: ${command}`);
                            const res = await host.runCommand(command, cwd);
                            commandsRun.push({ command, exitCode: res.exitCode });
                            toolResults.push(`runCommand(${command}): exit ${res.exitCode}`);
                            break;
                        }

                        if (decision.requiresApproval) {
                            const approve = callbacks?.approveCommand;
                            if (!approve) {
                                toolResults.push(`runCommand(${command}): DENIED - ${decision.reason} (no approval callback)`);
                                break;
                            }

                            const approval = await approve(command, decision.reason);
                            if (approval === 'abort') {
                                throw new AgentReviewError('Aborted by user.', 'RUNTIME');
                            }
                            if (approval === 'deny') {
                                toolResults.push(`runCommand(${command}): DENIED by user.`);
                                break;
                            }

                            if (approval === 'allowAlways') {
                                const normalized = command.trim().replace(/\s+/g, ' ');
                                const next = {
                                    ...this.deps.config,
                                    execution: {
                                        ...this.deps.config.execution,
                                        allowedCommands: Array.from(new Set([...(this.deps.config.execution.allowedCommands || []), normalized]))
                                    }
                                };
                                this.deps.config = next;
                                await this.deps.saveConfig?.(next);
                            }

                            callbacks?.onProgress?.(`Running: ${command}`);
                            const res = await host.runCommand(command, cwd);
                            commandsRun.push({ command, exitCode: res.exitCode });
                            toolResults.push(`runCommand(${command}): exit ${res.exitCode}`);
                            break;
                        }

                        toolResults.push(`runCommand(${command}): DENIED - ${decision.reason}`);
                        break;
                    }
                    case 'finish': {
                        const summary = String((action as any).summary ?? '').trim() || 'Done.';
                        callbacks?.onProgress?.(`Finished.`);
                        log(callbacks, summary);
                        return {
                            ok: true,
                            summary,
                            filesChanged: Array.from(filesChanged),
                            commandsRun
                        };
                    }
                    default:
                        toolResults.push(`ERROR: Unknown action type: ${(action as any).type}`);
                }
            }

            messages.push({ role: 'assistant', content: raw });
            messages.push({ role: 'user', content: `Tool results:\n${toolResults.join('\n\n')}\n\nContinue.` });
        }

        // If agent failed to finish, revert edits for safety.
        for (const [relPath, content] of originals.entries()) {
            try {
                await host.writeTextFile(relPath, content);
            } catch {
                // best-effort
            }
        }

        return {
            ok: false,
            summary: 'Agent did not finish within the step limit; reverted changes for safety.',
            filesChanged: Array.from(filesChanged),
            commandsRun
        };
    }
}

export function createTaskExecutionAgent(deps: TaskExecutionAgentDeps): TaskExecutionAgent {
    if (!deps.provider) throw new AgentReviewError('Missing AI provider', 'CONFIG');
    if (!deps.host) throw new AgentReviewError('Missing execution host', 'CONFIG');
    if (!deps.config) throw new AgentReviewError('Missing agent config', 'CONFIG');
    return new JsonToolTaskExecutionAgent(deps);
}

