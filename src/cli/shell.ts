import * as path from 'path';
import * as readline from 'readline';

import type { CliDeps } from './runCli';
import { tokenize } from './tokenize';
import { runCli } from './runCli';
import type { RunResult } from '../core/model';
import * as fs from 'fs';
import { resolveWorkspaceRoot } from '../core/workspaceRoot';
import { defaultMarkdownFilename, defaultSummarizeFilename, renderResult, renderSummarizeResult, SummarizeResult } from './shellOutput';

export interface ShellOptions {
    prompt?: string;
    banner?: boolean;
}

function hasFlag(args: string[], flag: string): boolean {
    return args.includes(flag);
}

function getFlagValue(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    return args[idx + 1];
}

function stripFlagWithValue(args: string[], flag: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === flag) {
            i++; // skip value
            continue;
        }
        out.push(args[i]);
    }
    return out;
}

const ASCII_BANNER =
`
  ░██████                                   ░██
 ░██   ░██                                  ░██
░██         ░███████   ░██████    ░███████  ░████████
░██        ░██    ░██       ░██  ░██    ░██ ░██    ░██
░██        ░██    ░██  ░███████  ░██        ░██    ░██
 ░██   ░██ ░██    ░██ ░██   ░██  ░██    ░██ ░██    ░██
  ░██████   ░███████   ░█████░██  ░███████  ░██    ░██
`;

interface CliTask {
    id: string;
    title: string;
    description: string;
    type: string;
    status: string;
    priority: number;
    estimatedMinutes: number;
    affectedFiles: string[];
}

interface CliTaskStore {
    tasks: CliTask[];
    suggestions: CliTask[];
}

const PRIORITY_LABELS: Record<number, string> = {
    1: 'Low',
    2: 'Medium',
    3: 'High',
    4: 'Critical'
};

const PRIORITY_COLORS: Record<number, string> = {
    1: '\x1b[90m',   // Gray
    2: '\x1b[36m',   // Cyan
    3: '\x1b[33m',   // Yellow
    4: '\x1b[31m'    // Red
};

const STATUS_ICONS: Record<string, string> = {
    'pending': '○',
    'scheduled': '◐',
    'in_progress': '◑',
    'completed': '●',
    'deferred': '◌',
    'cancelled': '✗'
};

const TYPE_ICONS: Record<string, string> = {
    'refactor': '🔧',
    'test': '🧪',
    'bugfix': '🐛',
    'documentation': '📝',
    'security': '🔒',
    'performance': '⚡',
    'expand': '✨'
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function getTasksFilePath(cwd: string): string {
    const root = resolveWorkspaceRoot(cwd);
    return path.join(root, '.coach', 'tasks.json');
}

function loadTasks(cwd: string): CliTaskStore {
    const filePath = getTasksFilePath(cwd);
    if (fs.existsSync(filePath)) {
        try {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data) as CliTaskStore;
        } catch {
            return { tasks: [], suggestions: [] };
        }
    }
    return { tasks: [], suggestions: [] };
}

function saveTasks(cwd: string, store: CliTaskStore): void {
    const filePath = getTasksFilePath(cwd);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, ...store }, null, 2) + '\n', 'utf8');
}

function displayTasks(io: { stdout: { write(s: string): void }; stderr: { write(s: string): void } }, cwd: string): void {
    const store = loadTasks(cwd);
    const width = 60;
    const inner = width - 2; // content width between │ borders

    const line = (char: string) => char.repeat(inner);
    const pad = (s: string, len: number) => {
        // eslint-disable-next-line no-control-regex
        const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
        const padding = Math.max(0, len - stripped.length);
        return s + ' '.repeat(padding);
    };

    io.stdout.write('\n');

    // Current Tasks Section
    io.stdout.write(`${BOLD}╭${line('─')}╮${RESET}\n`);
    io.stdout.write(`${BOLD}│${RESET}${pad(` 📋 ${BOLD}Current Tasks${RESET}`, inner)}${BOLD}│${RESET}\n`);
    io.stdout.write(`${BOLD}├${line('─')}┤${RESET}\n`);

    const activeTasks = store.tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled');

    if (activeTasks.length === 0) {
        io.stdout.write(`${BOLD}│${RESET}${pad(`${DIM}  No active tasks${RESET}`, inner)}${BOLD}│${RESET}\n`);
    } else {
        for (const task of activeTasks) {
            const icon = STATUS_ICONS[task.status] || '○';
            const typeIcon = TYPE_ICONS[task.type] || '•';
            const prioColor = PRIORITY_COLORS[task.priority] || '';
            const prioLabel = PRIORITY_LABELS[task.priority] || 'Medium';
            const shortId = task.id.slice(0, 8);

            const titleLine = `  ${icon} ${typeIcon} ${task.title}`;
            const truncatedTitle = titleLine.length > inner - 2 ? titleLine.slice(0, inner - 5) + '...' : titleLine;
            io.stdout.write(`${BOLD}│${RESET}${pad(truncatedTitle, inner)}${BOLD}│${RESET}\n`);

            const metaLine = `      ${DIM}${shortId}${RESET} · ${prioColor}${prioLabel}${RESET} · ${task.estimatedMinutes}min · ${task.status}`;
            io.stdout.write(`${BOLD}│${RESET}${pad(metaLine, inner)}${BOLD}│${RESET}\n`);
        }
    }

    io.stdout.write(`${BOLD}╰${line('─')}╯${RESET}\n`);
    io.stdout.write('\n');

    // Suggestions Section
    io.stdout.write(`${BOLD}╭${line('─')}╮${RESET}\n`);
    io.stdout.write(`${BOLD}│${RESET}${pad(` 💡 ${BOLD}Suggested Tasks${RESET}`, inner)}${BOLD}│${RESET}\n`);
    io.stdout.write(`${BOLD}├${line('─')}┤${RESET}\n`);

    if (store.suggestions.length === 0) {
        io.stdout.write(`${BOLD}│${RESET}${pad(`${DIM}  No suggestions - run 'review' to generate${RESET}`, inner)}${BOLD}│${RESET}\n`);
    } else {
        for (const task of store.suggestions) {
            const typeIcon = TYPE_ICONS[task.type] || '•';
            const prioColor = PRIORITY_COLORS[task.priority] || '';
            const prioLabel = PRIORITY_LABELS[task.priority] || 'Medium';
            const shortId = task.id.slice(0, 8);

            const titleLine = `  ◇ ${typeIcon} ${task.title}`;
            const truncatedTitle = titleLine.length > inner - 2 ? titleLine.slice(0, inner - 5) + '...' : titleLine;
            io.stdout.write(`${BOLD}│${RESET}${pad(truncatedTitle, inner)}${BOLD}│${RESET}\n`);

            const metaLine = `      ${DIM}${shortId}${RESET} · ${prioColor}${prioLabel}${RESET} · ${task.estimatedMinutes}min`;
            io.stdout.write(`${BOLD}│${RESET}${pad(metaLine, inner)}${BOLD}│${RESET}\n`);
        }
    }

    io.stdout.write(`${BOLD}╰${line('─')}╯${RESET}\n`);
    io.stdout.write('\n');
}                        
                                                       
                                                       

export async function runShell(deps: CliDeps, options: ShellOptions = {}): Promise<number> {
    const prompt = options.prompt ?? 'coach> ';
    const banner = options.banner ?? true;

    const io = deps.io;

    if (banner) {
        io.stdout.write(ASCII_BANNER);
        io.stdout.write(`\n${deps.tool.name}@${deps.tool.version}\n`);
        io.stdout.write(`Type "help" for commands, "exit" to quit.\n\n`);
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
    });

    let lastExitCode = 0;

    const ask = async (): Promise<string | null> =>
        new Promise(resolve => {
            rl.question(prompt, answer => resolve(answer));
        });

    const askYesNo = async (question: string, defaultYes = true): Promise<boolean> => {
        const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] ';
        while (true) {
            const answer = await new Promise<string>(resolve => rl.question(question + suffix, resolve));
            const t = answer.trim().toLowerCase();
            if (!t) return defaultYes;
            if (t === 'y' || t === 'yes') return true;
            if (t === 'n' || t === 'no') return false;
            io.stdout.write('Please answer y or n.\n');
        }
    };

    try {
        while (true) {
            const line = await ask();
            if (line == null) break;

            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed === 'exit' || trimmed === 'quit' || trimmed === '.exit' || trimmed === ':q') {
                break;
            }

            if (trimmed === 'help' || trimmed === '.help') {
                io.stdout.write(`Commands:\n`);
                io.stdout.write(`  review [path] [options]\n`);
                io.stdout.write(`  summarize [path] [options]\n`);
                io.stdout.write(`  forward [title] [--description <text>] [--file <path...>] [options]\n`);
                io.stdout.write(`  config init [--force]\n`);
                io.stdout.write(`  tasks                      Show all tasks\n`);
                io.stdout.write(`  task complete <id>         Mark task as completed\n`);
                io.stdout.write(`  task delete <id>           Delete a task\n`);
                io.stdout.write(`  task accept <id>           Accept a suggestion as a task\n`);
                io.stdout.write(`  ls [path]\n`);
                io.stdout.write(`  cd <path>\n`);
                io.stdout.write(`  pwd\n`);
                io.stdout.write(`  clear\n`);
                io.stdout.write(`  exit\n\n`);
                continue;
            }

            if (trimmed === 'pwd') {
                io.stdout.write(`${process.cwd()}\n`);
                continue;
            }

            if (trimmed === 'clear' || trimmed === 'cls') {
                io.stdout.write('\x1Bc');
                io.stdout.write(ASCII_BANNER);
                io.stdout.write(`\n${deps.tool.name}@${deps.tool.version}\n\n`);
                continue;
            }

            if (trimmed === 'tasks') {
                displayTasks(io, process.cwd());
                continue;
            }

            if (trimmed.startsWith('task ')) {
                const parts = trimmed.slice(5).trim().split(/\s+/);
                const subCmd = parts[0];
                const taskId = parts[1];

                if (!subCmd) {
                    io.stderr.write('Usage: task <complete|delete|accept> <id>\n');
                    continue;
                }

                const store = loadTasks(process.cwd());

                if (subCmd === 'complete') {
                    if (!taskId) {
                        io.stderr.write('Usage: task complete <id>\n');
                        continue;
                    }
                    const task = store.tasks.find(t => t.id === taskId || t.id.startsWith(taskId));
                    if (!task) {
                        io.stderr.write(`Task not found: ${taskId}\n`);
                        continue;
                    }
                    task.status = 'completed';
                    saveTasks(process.cwd(), store);
                    io.stdout.write(`${BOLD}✓${RESET} Marked "${task.title}" as completed\n`);
                    continue;
                }

                if (subCmd === 'delete') {
                    if (!taskId) {
                        io.stderr.write('Usage: task delete <id>\n');
                        continue;
                    }
                    const idx = store.tasks.findIndex(t => t.id === taskId || t.id.startsWith(taskId));
                    if (idx === -1) {
                        io.stderr.write(`Task not found: ${taskId}\n`);
                        continue;
                    }
                    const removed = store.tasks.splice(idx, 1)[0];
                    saveTasks(process.cwd(), store);
                    io.stdout.write(`${BOLD}✗${RESET} Deleted "${removed.title}"\n`);
                    continue;
                }

                if (subCmd === 'accept') {
                    if (!taskId) {
                        io.stderr.write('Usage: task accept <id>\n');
                        continue;
                    }
                    const idx = store.suggestions.findIndex(s => s.id === taskId || s.id.startsWith(taskId));
                    if (idx === -1) {
                        io.stderr.write(`Suggestion not found: ${taskId}\n`);
                        continue;
                    }
                    const suggestion = store.suggestions.splice(idx, 1)[0];
                    suggestion.status = 'pending';
                    store.tasks.push(suggestion);
                    saveTasks(process.cwd(), store);
                    io.stdout.write(`${BOLD}✓${RESET} Accepted "${suggestion.title}" as a task\n`);
                    continue;
                }

                io.stderr.write(`Unknown task command: ${subCmd}\n`);
                io.stderr.write('Usage: task <complete|delete|accept> <id>\n');
                continue;
            }

            if (trimmed === 'ls' || trimmed.startsWith('ls ')) {
                const target = trimmed === 'ls' ? '.' : trimmed.slice(3).trim() || '.';
                const dir = path.resolve(process.cwd(), target);
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const suffix = entry.isDirectory() ? '/' : '';
                        io.stdout.write(`${entry.name}${suffix}\n`);
                    }
                } catch (err) {
                    io.stderr.write(`ls: ${(err as Error).message}\n`);
                }
                continue;
            }

            if (trimmed.startsWith('cd ')) {
                const target = trimmed.slice(3).trim();
                if (!target) continue;
                const next = path.resolve(process.cwd(), target);
                process.chdir(next);
                io.stdout.write(`${process.cwd()}\n`);
                continue;
            }

            // Execute normal CLI subcommand line.
            const args = tokenize(trimmed);
            if (args.length === 0) {
                io.stderr.write('No command.\n');
                continue;
            }
            const cmd = args[0];

            if (cmd === 'shell') {
                io.stdout.write('Already in shell.\n');
                continue;
            }

            // Interactive output prompt for commands that would otherwise print to console.
            if (cmd === 'review' && !hasFlag(args, '--output')) {
                // Determine desired display format (defaults to pretty).
                const requestedFormat = (getFlagValue(args, '--format') || 'pretty').toLowerCase();

                // Run once with JSON output so we can post-format without re-running analysis.
                const capture = { out: '' };
                const captureDeps: CliDeps = {
                    ...deps,
                    io: {
                        stdout: { write: (c: string) => { capture.out += c; } },
                        stderr: deps.io.stderr
                    }
                };

                const jsonArgs = stripFlagWithValue(args, '--format')
                    .concat(['--format', 'json']);

                try {
                    lastExitCode = await runCli(['node', 'coach', ...jsonArgs], captureDeps);
                } catch {
                    lastExitCode = 2;
                }

                if (lastExitCode === 2) {
                    // Errors already printed.
                } else {
                    let result: RunResult | null = null;
                    try {
                        result = JSON.parse(capture.out) as RunResult;
                    } catch {
                        // If parsing failed, fall back to whatever we captured.
                        io.stdout.write(capture.out);
                        result = null;
                    }

                    if (result) {
                        const toConsole = await askYesNo('Output to console?');
                        if (toConsole) {
                            io.stdout.write(renderResult(requestedFormat, result));
                        } else {
                            const fileName = defaultMarkdownFilename();
                            const filePath = path.resolve(process.cwd(), fileName);
                            fs.writeFileSync(filePath, renderResult('md', result), 'utf8');
                            io.stdout.write(`Wrote ${filePath}\n`);
                        }
                    }
                }
            } else if (cmd === 'summarize' && !hasFlag(args, '--output')) {
                // Interactive output prompt for summarize command
                const requestedFormat = (getFlagValue(args, '--format') || 'md').toLowerCase();

                // Run once with JSON output so we can post-format without re-running analysis.
                const capture = { out: '' };
                const captureDeps: CliDeps = {
                    ...deps,
                    io: {
                        stdout: { write: (c: string) => { capture.out += c; } },
                        stderr: deps.io.stderr
                    }
                };

                const jsonArgs = stripFlagWithValue(args, '--format')
                    .concat(['--format', 'json']);

                try {
                    lastExitCode = await runCli(['node', 'coach', ...jsonArgs], captureDeps);
                } catch {
                    lastExitCode = 2;
                }

                if (lastExitCode === 2) {
                    // Errors already printed.
                } else {
                    let result: SummarizeResult | null = null;
                    try {
                        const parsed = JSON.parse(capture.out);
                        // Determine if this is a file summary or project summary
                        if (parsed.filePath && parsed.summary) {
                            // File summary
                            result = {
                                type: 'file',
                                fileSummary: parsed
                            };
                        } else if (parsed.projectSummary) {
                            // Project summary
                            result = {
                                type: 'project',
                                projectSummary: parsed.projectSummary,
                                rootPath: parsed.rootPath,
                                filesAnalyzed: parsed.filesAnalyzed
                            };
                        }
                    } catch {
                        // If parsing failed, fall back to whatever we captured.
                        io.stdout.write(capture.out);
                        result = null;
                    }

                    if (result) {
                        const toConsole = await askYesNo('Output to console?');
                        if (toConsole) {
                            io.stdout.write(renderSummarizeResult(requestedFormat, result));
                        } else {
                            const fileName = defaultSummarizeFilename();
                            const filePath = path.resolve(process.cwd(), fileName);
                            fs.writeFileSync(filePath, renderSummarizeResult('md', result), 'utf8');
                            io.stdout.write(`Wrote ${filePath}\n`);
                        }
                    }
                }
            } else {
                try {
                    lastExitCode = await runCli(['node', 'coach', ...args], deps);
                } catch {
                    lastExitCode = 2;
                }
            }

            if (lastExitCode !== 0) {
                io.stderr.write(`(exit ${lastExitCode})\n`);
            }
        }
    } finally {
        rl.close();
    }

    return lastExitCode;
}
