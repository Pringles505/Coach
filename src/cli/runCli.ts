import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

import { Command, CommanderError } from 'commander';

import type { Logger } from '../core/document';
import { NullLogger } from '../core/document';
import type { AgentContext, PureFileSummary } from '../types';
import { DEFAULTS, loadConfig, writeConfig, writeDefaultConfig } from '../core/config';
import { formatJson } from '../core/formatters/json';
import { formatMarkdown } from '../core/formatters/md';
import { formatPretty } from '../core/formatters/pretty';
import { formatSarif } from '../core/formatters/sarif';
import { getChangedFiles, getFilesSince } from '../core/git';
import { selectFiles } from '../core/fileSelection';
import { isIncluded } from '../core/globs';
import type { FailOn } from '../core/model';
import { shouldFail } from '../core/model';
import { runReview } from '../core/reviewEngine';
import { languageIdFromPath } from '../core/reviewEngine';
import type { ReviewSelectionMeta } from '../core/reviewEngine';
import { createAIProvider } from '../core/ai/createProvider';
import { resolveProviderConfig } from '../core/ai/createProvider';
import { AgentReviewError as CoreAgentReviewError } from '../core/errors';
import { createNodeHost } from '../core/agentExecution/nodeHost';
import { createTaskExecutionAgent } from '../core/agentExecution/taskExecutionAgent';
import { ensureWorkspaceAgentsConfigFile, loadWorkspaceAgentsConfig, writeWorkspaceAgentsConfig } from '../core/agentExecution/workspaceConfig';
import { resolveWorkspaceRoot } from '../core/workspaceRoot';
import { findVscodeSettingsFile, loadVscodeReviewerAiSettings } from '../core/vscodeSettings';
import { runShell } from './shell';
import { createSpinner } from './spinner';
import { CodeAnalysisAgent } from '../agents/codeAnalysisAgent';
import { readTextFileSafe } from '../core/fileSelection';

export interface CliIO {
    stdout: { write(chunk: string): void };
    stderr: { write(chunk: string): void };
}

export interface CliDeps {
    tool: { name: string; version: string };
    io: CliIO;
    env: NodeJS.ProcessEnv;
    logger?: Logger;
    createAIProvider?: typeof createAIProvider;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
    const io = deps.io;
    const env = deps.env;
    const baseLogger = deps.logger || new NullLogger();
    const makeProvider = deps.createAIProvider || createAIProvider;

    const program = new Command();
    program
        .name(deps.tool.name || 'coach')
        .description('Coach CLI')
        .version(deps.tool.version)
        .option('-v, --verbose', 'Enable verbose logging');
    program.exitOverride();
    program.configureOutput({
        writeOut: (str) => io.stdout.write(str),
        writeErr: (str) => io.stderr.write(str),
        outputError: () => {}
    });

    program
        .command('config')
        .description('Configuration helpers')
        .command('init')
        .description('Create a default .coachrc.json in the current directory')
        .option('-f, --force', 'Overwrite if it already exists')
        .option('--from-vscode', 'Seed config defaults from VS Code user settings (coach.*; legacy: codeReviewer.*)')
        .action((opts: { force?: boolean }) => {
            const rootPath = process.cwd();
            if ((opts as any).fromVscode) {
                const settingsPath = findVscodeSettingsFile(env);
                if (!settingsPath) {
                    throw new CoreAgentReviewError('Could not find VS Code settings.json to seed config', 'CONFIG');
                }
                const vs = loadVscodeReviewerAiSettings(settingsPath);
                const seeded = {
                    ...DEFAULTS,
                    provider: vs.provider?.provider ? { ...DEFAULTS.provider, ...vs.provider } : { ...DEFAULTS.provider },
                    analysisDepth: vs.analysisDepth || DEFAULTS.analysisDepth,
                    exclude: vs.exclude || DEFAULTS.exclude
                };
                const written = writeConfig(rootPath, seeded, Boolean(opts.force));
                io.stdout.write(`Wrote config (seeded from VS Code): ${written}\n`);
                return;
            }

            const written = writeDefaultConfig(rootPath, Boolean(opts.force));
            io.stdout.write(`Wrote config: ${written}\n`);
        });

    program
        .command('shell')
        .description('Start interactive shell')
        .option('--no-banner', 'Hide the startup banner')
        .option('--prompt <prompt>', 'Prompt text', 'coach> ')
        .action(async (opts: { banner?: boolean; prompt?: string }) => {
            const exitCode = await runShell(deps, { banner: opts.banner !== false, prompt: opts.prompt });
            (program as any).__exitCode = exitCode;
        });

    program
        .command('summarize')
        .description('Summarize a file or workspace (Markdown by default)')
        .argument('[path]', 'File or root path (default: current directory)')
        .option('--no-from-vscode', 'Do not use VS Code user settings for provider/model/depth (coach.*; legacy: codeReviewer.*)')
        .option('--format <format>', 'md|json', 'md')
        .option('--output <file>', 'Write output to a file (default: stdout)')
        .option('--provider <provider>', 'anthropic|openai|azure|ollama|custom')
        .option('--api-key <key>', 'Provider API key (prefer env vars in CI)')
        .option('--api-endpoint <url>', 'Provider endpoint (azure/custom/ollama)')
        .option('--model <model>', 'Model/deployment name')
        .option('--depth <depth>', 'light|moderate|deep')
        .option('--include <glob...>', 'Include glob(s) (overrides config include)')
        .option('--exclude <glob...>', 'Exclude glob(s) (overrides config exclude)')
        .option('--max-files <n>', 'Max files to analyze (workspace mode)', (v: string) => Number(v))
        .option('--max-file-size <bytes>', 'Max file size in bytes', (v: string) => Number(v))
        .option('--no-spinner', 'Disable progress spinner (stderr)')
        .action(async (argPath: string | undefined, opts: any) => {
            const targetPath = argPath ? path.resolve(argPath) : resolveWorkspaceRoot(process.cwd());

            const verbose = Boolean(program.opts().verbose);
            const logger: Logger = verbose ? {
                debug: (m, meta) => io.stderr.write(`[debug] ${m}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`),
                info: (m, meta) => io.stderr.write(`[info] ${m}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`),
                warn: (m, meta) => io.stderr.write(`[warn] ${m}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`),
                error: (m, meta) => io.stderr.write(`[error] ${m}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`)
            } : baseLogger;

            if (!fs.existsSync(targetPath)) {
                throw new CoreAgentReviewError(`Path not found: ${targetPath}`, 'CONFIG');
            }

            const stat = fs.statSync(targetPath);
            const isFile = stat.isFile();
            const rootPath = isFile ? path.dirname(targetPath) : targetPath;

            const providerOverrides =
                opts.provider || opts.apiKey || opts.apiEndpoint || opts.model
                    ? {
                          provider: {
                              provider: opts.provider,
                              apiKey: opts.apiKey,
                              apiEndpoint: opts.apiEndpoint,
                              model: opts.model
                          }
                      }
                    : {};

            const include = Array.isArray(opts.include) ? opts.include : undefined;
            const exclude = Array.isArray(opts.exclude) ? opts.exclude : undefined;

            const overrides = {
                analysisDepth: (opts.depth === 'light' || opts.depth === 'moderate' || opts.depth === 'deep') ? opts.depth : undefined,
                include,
                exclude,
                maxFiles: Number.isFinite(opts.maxFiles) ? Number(opts.maxFiles) : undefined,
                maxFileSizeBytes: Number.isFinite(opts.maxFileSize) ? Number(opts.maxFileSize) : undefined,
                ...providerOverrides
            };

            const { config } = loadConfig(rootPath, overrides, env);

            if (opts.fromVscode !== false) {
                const settingsPath = findVscodeSettingsFile(env);
                if (settingsPath) {
                    try {
                        const vs = loadVscodeReviewerAiSettings(settingsPath);
                        const providerFlagsUsed = Boolean(opts.provider || opts.apiKey || opts.apiEndpoint || opts.model);
                        const agentReviewEnvUsed = Boolean(env.AGENTREVIEW_PROVIDER || env.AGENTREVIEW_API_KEY || env.AGENTREVIEW_API_ENDPOINT || env.AGENTREVIEW_MODEL);

                        if (vs.provider?.provider && !providerFlagsUsed && !agentReviewEnvUsed) {
                            config.provider = { ...config.provider, ...vs.provider };
                        }
                        if (vs.analysisDepth && !opts.depth && !env.AGENTREVIEW_DEPTH) {
                            config.analysisDepth = vs.analysisDepth;
                        }
                    } catch (e) {
                        logger.warn('Failed to load VS Code settings; continuing without them', { message: (e as Error).message });
                    }
                }
            }

            const provider = makeProvider(config.provider, env);
            const agent = new CodeAnalysisAgent(provider);

            const context: AgentContext = {
                workspaceRoot: rootPath,
                analysisCache: new Map(),
                existingTasks: [],
                userPreferences: {
                    workHoursStart: 9,
                    workHoursEnd: 17,
                    focusSessionDuration: 90,
                    preferredTaskTypes: [],
                    excludePatterns: config.exclude,
                    analysisDepth: config.analysisDepth
                }
            };

            const isTty = Boolean((io as any).stderr?.isTTY);
            const spinnerEnabled = Boolean(opts.spinner !== false) && isTty && !verbose;
            const spinner = spinnerEnabled ? createSpinner((s) => io.stderr.write(s)) : null;

            try {
                const format = String(opts.format || 'md').toLowerCase();
                let output = '';

                if (isFile) {
                    spinner?.update(`Summarizing file: ${path.basename(targetPath)}`);
                    const text = readTextFileSafe(targetPath, config.maxFileSizeBytes);
                    if (text == null) {
                        throw new CoreAgentReviewError(`File is too large or appears to be binary: ${targetPath}`, 'CONFIG');
                    }

                    const document = {
                        uri: { fsPath: targetPath },
                        languageId: languageIdFromPath(targetPath),
                        getText: () => text
                    };

                    const summary = await agent.summarizeOnly(document, context);

                    if (format === 'json') {
                        output = JSON.stringify(summary, null, 2) + '\n';
                    } else if (format === 'md' || format === 'markdown') {
                        output = agent.formatPureSummary(summary);
                    } else {
                        throw new CoreAgentReviewError(`Unknown format: ${format}`, 'CONFIG');
                    }
                } else {
                    const filePaths = selectFiles({
                        rootPath,
                        include: config.include,
                        exclude: config.exclude,
                        maxFiles: config.maxFiles
                    });

                    if (filePaths.length === 0) {
                        throw new CoreAgentReviewError('No files matched include/exclude for workspace summary', 'CONFIG');
                    }

                    const summaries = new Map<string, PureFileSummary>();

                    for (let i = 0; i < filePaths.length; i++) {
                        const filePath = filePaths[i];
                        spinner?.update(`Summarizing ${i + 1}/${filePaths.length}: ${path.relative(rootPath, filePath).replace(/\\/g, '/')}`);
                        const text = readTextFileSafe(filePath, config.maxFileSizeBytes);
                        if (text == null) continue;

                        const document = {
                            uri: { fsPath: filePath },
                            languageId: languageIdFromPath(filePath),
                            getText: () => text
                        };

                        const summary = await agent.summarizeOnly(document, context);
                        summaries.set(filePath, summary);
                    }

                    spinner?.update(`Summarizing workspace (${summaries.size} file(s))...`);
                    const projectSummary = await agent.summarizeProjectOnly(summaries);

                    if (format === 'json') {
                        output = JSON.stringify({
                            rootPath,
                            filesAnalyzed: summaries.size,
                            projectSummary
                        }, null, 2) + '\n';
                    } else if (format === 'md' || format === 'markdown') {
                        output = agent.formatPureProjectSummary(projectSummary, {
                            rootPath,
                            analyzedAt: new Date(),
                            filesAnalyzed: summaries.size
                        });
                    } else {
                        throw new CoreAgentReviewError(`Unknown format: ${format}`, 'CONFIG');
                    }
                }

                spinner?.stop();

                if (opts.output) {
                    const outPath = path.resolve(String(opts.output));
                    fs.mkdirSync(path.dirname(outPath), { recursive: true });
                    fs.writeFileSync(outPath, output, 'utf8');
                } else {
                    io.stdout.write(output);
                }

                (program as any).__exitCode = 0;
            } catch (e) {
                spinner?.stop();
                throw e;
            }
        });

    program
        .command('review')
        .description('Run code review')
        .argument('[path]', 'Root path (default: current directory)')
        .option('--changed', 'Review only changed files (git status)')
        .option('--since <ref>', 'Review files changed since git ref (e.g., main)')
        .option('--no-from-vscode', 'Do not use VS Code user settings for provider/model/depth (coach.*; legacy: codeReviewer.*)')
        .option('--format <format>', 'pretty|json|sarif|md', 'pretty')
        .option('--output <file>', 'Write output to a file (default: stdout)')
        .option('--fail-on <level>', 'none|info|warning|error', 'warning')
        .option('--max-findings <n>', 'Limit number of findings (default from config)', (v: string) => Number(v))
        .option('--provider <provider>', 'anthropic|openai|azure|ollama|custom')
        .option('--api-key <key>', 'Provider API key (prefer env vars in CI)')
        .option('--api-endpoint <url>', 'Provider endpoint (azure/custom/ollama)')
        .option('--model <model>', 'Model/deployment name')
        .option('--depth <depth>', 'light|moderate|deep')
        .option('--include <glob...>', 'Include glob(s) (overrides config include)')
        .option('--exclude <glob...>', 'Exclude glob(s) (overrides config exclude)')
        .option('--max-files <n>', 'Max files to analyze', (v: string) => Number(v))
        .option('--max-file-size <bytes>', 'Max file size in bytes', (v: string) => Number(v))
        .option('--no-spinner', 'Disable progress spinner (stderr)')
        .action(async (argPath: string | undefined, opts: any) => {
            const rootPath = argPath ? path.resolve(argPath) : resolveWorkspaceRoot(process.cwd());

            const verbose = Boolean(program.opts().verbose);
            const logger: Logger = verbose ? {
                debug: (m, meta) => io.stderr.write(`[debug] ${m}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`),
                info: (m, meta) => io.stderr.write(`[info] ${m}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`),
                warn: (m, meta) => io.stderr.write(`[warn] ${m}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`),
                error: (m, meta) => io.stderr.write(`[error] ${m}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`)
            } : baseLogger;

            const failOn = String(opts.failOn || 'warning') as FailOn;

            const providerOverrides =
                opts.provider || opts.apiKey || opts.apiEndpoint || opts.model
                    ? {
                          provider: {
                              provider: opts.provider,
                              apiKey: opts.apiKey,
                              apiEndpoint: opts.apiEndpoint,
                              model: opts.model
                          }
                      }
                    : {};

            const include = Array.isArray(opts.include) ? opts.include : undefined;
            const exclude = Array.isArray(opts.exclude) ? opts.exclude : undefined;

            const overrides = {
                failOn,
                maxFindings: Number.isFinite(opts.maxFindings) ? Number(opts.maxFindings) : undefined,
                analysisDepth: (opts.depth === 'light' || opts.depth === 'moderate' || opts.depth === 'deep') ? opts.depth : undefined,
                include,
                exclude,
                maxFiles: Number.isFinite(opts.maxFiles) ? Number(opts.maxFiles) : undefined,
                maxFileSizeBytes: Number.isFinite(opts.maxFileSize) ? Number(opts.maxFileSize) : undefined,
                ...providerOverrides
            };

            const { config, configFile } = loadConfig(rootPath, overrides, env);

            if (opts.fromVscode !== false) {
                const settingsPath = findVscodeSettingsFile(env);
                if (settingsPath) {
                    try {
                        const vs = loadVscodeReviewerAiSettings(settingsPath);

                        // Prefer VS Code over config/defaults for local ergonomics, but never override explicit CLI/env flags.
                        // For deterministic CI, pass --no-from-vscode.
                        if (vs.provider?.provider) {
                            const providerFlagsUsed = Boolean(opts.provider || opts.apiKey || opts.apiEndpoint || opts.model);
                            const agentReviewEnvUsed = Boolean(env.AGENTREVIEW_PROVIDER || env.AGENTREVIEW_API_KEY || env.AGENTREVIEW_API_ENDPOINT || env.AGENTREVIEW_MODEL);

                            if (!providerFlagsUsed && !agentReviewEnvUsed) {
                                // Override provider/model/key from VS Code.
                                config.provider = { ...config.provider, ...vs.provider };
                            }
                        }
                        if (vs.analysisDepth && !opts.depth && !env.AGENTREVIEW_DEPTH) {
                            config.analysisDepth = vs.analysisDepth;
                        }
                    } catch (e) {
                        logger.warn('Failed to load VS Code settings; continuing without them', { message: (e as Error).message });
                    }
                } else {
                    logger.debug('VS Code settings.json not found; continuing without it');
                }
            }

            if (opts.changed && opts.since) {
                throw new CoreAgentReviewError('Use only one of --changed or --since', 'CONFIG');
            }

            let filePaths: string[] = [];
            let selection: ReviewSelectionMeta = { mode: 'path', targetPath: rootPath };

            if (opts.changed) {
                selection = { mode: 'changed' as const, targetPath: rootPath };
                const rel = getChangedFiles(rootPath);
                filePaths = rel
                    .map((p: string) => path.join(rootPath, p))
                    .filter((abs: string) => fs.existsSync(abs))
                    .filter((abs: string) => {
                        const relPath = path.relative(rootPath, abs).replace(/\\/g, '/');
                        return isIncluded(relPath, config.include, config.exclude);
                    })
                    .slice(0, config.maxFiles);
            } else if (opts.since) {
                selection = { mode: 'since' as const, targetPath: rootPath, sinceRef: String(opts.since) };
                const rel = getFilesSince(rootPath, String(opts.since));
                filePaths = rel
                    .map((p: string) => path.join(rootPath, p))
                    .filter((abs: string) => fs.existsSync(abs))
                    .filter((abs: string) => {
                        const relPath = path.relative(rootPath, abs).replace(/\\/g, '/');
                        return isIncluded(relPath, config.include, config.exclude);
                    })
                    .slice(0, config.maxFiles);
            } else {
                filePaths = selectFiles({
                    rootPath,
                    include: config.include,
                    exclude: config.exclude,
                    maxFiles: config.maxFiles
                });
            }

            const provider = makeProvider(config.provider, env);

            const isTty = Boolean((io as any).stderr?.isTTY);
            const spinnerEnabled = Boolean(opts.spinner !== false) && isTty && !verbose;
            const spinner = spinnerEnabled ? createSpinner((s) => io.stderr.write(s)) : null;

            const rel = (p: string) => path.relative(rootPath, p).replace(/\\/g, '/');

            try {
                const result = await runReview({
                    rootPath,
                    filePaths,
                    config,
                    configFile,
                    selection,
                    aiProvider: provider,
                    tool: deps.tool,
                    logger,
                    onProgress: spinner
                        ? (e) => {
                              if (e.type === 'fileStart' && e.filePath) {
                                  spinner.update(`Reviewing ${e.index}/${e.total}: ${rel(e.filePath)}`);
                              }
                              if (e.type === 'fileSkipped' && e.filePath) {
                                  spinner.update(`Skipping ${e.index}/${e.total}: ${rel(e.filePath)}`);
                              }
                              if (e.type === 'truncated') {
                                  spinner.update(`Truncated at ${e.findings} finding(s) (maxFindings)`);
                              }
                          }
                        : undefined
                });

                spinner?.stop();

                const format = String(opts.format || 'pretty');
                let output = '';
                switch (format) {
                    case 'pretty':
                        output = formatPretty(result);
                        break;
                    case 'json':
                        output = formatJson(result);
                        break;
                    case 'sarif':
                        output = formatSarif(result);
                        break;
                    case 'md':
                    case 'markdown':
                        output = formatMarkdown(result);
                        break;
                    default:
                        throw new CoreAgentReviewError(`Unknown format: ${format}`, 'CONFIG');
                }

                if (opts.output) {
                    const outPath = path.resolve(String(opts.output));
                    fs.mkdirSync(path.dirname(outPath), { recursive: true });
                    fs.writeFileSync(outPath, output, 'utf8');
                } else {
                    io.stdout.write(output);
                }

                (program as any).__exitCode = shouldFail(failOn, result.findings) ? 1 : 0;
            } catch (e) {
                spinner?.stop();
                throw e;
            }
        });

    program
        .command('forward')
        .description('Forward a task to an execution agent (edits files + runs commands)')
        .argument('[title]', 'Task title (or omit to be prompted)')
        .option('--description <text>', 'Task description')
        .option('--file <path...>', 'Affected file(s) to prioritize (repeatable)')
        .option('--root <path>', 'Workspace root (default: current directory)')
        .option('--agent <id>', 'Agent profile id (from .coach/agents.json)', 'default')
        .option('--no-from-vscode', 'Do not use VS Code user settings for provider/model (coach.*; legacy: codeReviewer.*)')
        .option('--provider <provider>', 'anthropic|openai|azure|ollama|custom')
        .option('--api-key <key>', 'Provider API key (prefer env vars in CI)')
        .option('--api-endpoint <url>', 'Provider endpoint (azure/custom/ollama)')
        .option('--model <model>', 'Model/deployment name')
        .option('--policy <policy>', 'conservative|standard|unrestricted (override for this run)')
        .option('--allow-dangerous', 'Allow dangerous commands (override for this run)')
        .option('--allow-command <cmd...>', 'Allow exact command(s) for this run')
        .option('--allow-prefix <prefix...>', 'Allow command prefix(es) for this run')
        .option('--yes', 'Auto-approve command prompts (requires --policy unrestricted)')
        .action(async (argTitle: string | undefined, opts: any) => {
            const rootPath = opts.root ? path.resolve(String(opts.root)) : resolveWorkspaceRoot(process.cwd());

            const baseCfg = ensureWorkspaceAgentsConfigFile(rootPath);
            const agentId = String(opts.agent || baseCfg.defaultAgentId || 'default');
            const profile = (baseCfg.agents || []).find((a) => a.id === agentId) || baseCfg.agents?.[0];

            const providerFlagsUsed = Boolean(opts.provider || opts.apiKey || opts.apiEndpoint || opts.model);
            const agentReviewEnvUsed = Boolean(env.AGENTREVIEW_PROVIDER || env.AGENTREVIEW_API_KEY || env.AGENTREVIEW_API_ENDPOINT || env.AGENTREVIEW_MODEL);

            const providerOverrides =
                providerFlagsUsed
                    ? {
                          provider: {
                              provider: opts.provider,
                              apiKey: opts.apiKey,
                              apiEndpoint: opts.apiEndpoint,
                              model: opts.model
                          }
                      }
                    : {};

            // Provider resolution: start from CLI/env/config, optionally merge VS Code settings, then agent profile (unless overridden by flags).
            const { config: reviewCfg } = loadConfig(rootPath, providerOverrides, env);

            if (opts.fromVscode !== false) {
                const settingsPath = findVscodeSettingsFile(env);
                if (settingsPath) {
                    try {
                        const vs = loadVscodeReviewerAiSettings(settingsPath);
                        if (vs.provider?.provider) {
                            if (!providerFlagsUsed && !agentReviewEnvUsed) {
                                reviewCfg.provider = { ...reviewCfg.provider, ...vs.provider };
                            }
                        }
                    } catch (e) {
                        // non-fatal
                        baseLogger.warn('Failed to load VS Code settings; continuing without them', { message: (e as Error).message });
                    }
                }
            }

            const providerCfg = (!providerFlagsUsed && profile?.provider)
                ? { ...reviewCfg.provider, ...profile.provider }
                : reviewCfg.provider;
            const resolvedProvider = resolveProviderConfig(providerCfg, env);
            if (resolvedProvider.provider === 'anthropic' || resolvedProvider.provider === 'openai') {
                if (!resolvedProvider.apiKey) {
                    throw new CoreAgentReviewError(
                        `${resolvedProvider.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key not configured. Set AGENTREVIEW_API_KEY (or provider-specific env vars), or configure provider/apiKey in .coachrc.json.`,
                        'CONFIG'
                    );
                }
            }
            if (resolvedProvider.provider === 'azure') {
                if (!resolvedProvider.apiKey || !resolvedProvider.apiEndpoint) {
                    throw new CoreAgentReviewError('Azure OpenAI not configured. Set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT (or AGENTREVIEW_*).', 'CONFIG');
                }
            }
            if (resolvedProvider.provider === 'custom') {
                if (!resolvedProvider.apiEndpoint) {
                    throw new CoreAgentReviewError('Custom provider endpoint not configured. Set AGENTREVIEW_API_ENDPOINT or configure it in .coachrc.json.', 'CONFIG');
                }
            }
            const provider = makeProvider(providerCfg, env);

            const isTty = Boolean((process.stdin as any).isTTY);
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: isTty });
            const prompt = async (q: string) => await new Promise<string>((resolve) => rl.question(q, resolve));

            let title = String(argTitle || '').trim();
            let description = String(opts.description || '').trim();

            try {
                if (!title && isTty) title = (await prompt('Task title: ')).trim();
                if (!description && isTty) description = (await prompt('Task description: ')).trim();
            } finally {
                rl.close();
            }

            const affectedFiles: string[] = Array.isArray(opts.file)
                ? opts.file
                      .map((p: string) => path.relative(rootPath, path.resolve(rootPath, p)).replace(/\\/g, '/'))
                      .filter((p: string) => p && !p.startsWith('../') && p !== '..')
                : [];

            const runCfg = JSON.parse(JSON.stringify(baseCfg)) as typeof baseCfg;
            const runExec = runCfg.execution;

            if (opts.policy) {
                const p = String(opts.policy);
                if (!['conservative', 'standard', 'unrestricted'].includes(p)) {
                    throw new CoreAgentReviewError(`Unknown policy: ${p}`, 'CONFIG');
                }
                runExec.policy = p as any;
            }
            if (opts.allowDangerous) runExec.allowDangerous = true;
            if (Array.isArray(opts.allowCommand)) runExec.allowedCommands = [...(runExec.allowedCommands || []), ...opts.allowCommand.map(String)];
            if (Array.isArray(opts.allowPrefix)) runExec.allowedCommandPrefixes = [...(runExec.allowedCommandPrefixes || []), ...opts.allowPrefix.map(String)];

            if (opts.yes && String(runExec.policy) !== 'unrestricted') {
                throw new CoreAgentReviewError(`--yes requires --policy unrestricted`, 'CONFIG');
            }

            const approveCommand = async (command: string, reason: string) => {
                if (opts.yes && String(runExec.policy) !== 'unrestricted') {
                    return 'deny';
                }
                if (!isTty) {
                    return opts.yes && String(runExec.policy) === 'unrestricted' ? 'allowOnce' : 'deny';
                }

                io.stderr.write(`\nAgent wants to run:\n  ${command}\nReason: ${reason}\n`);
                io.stderr.write(`Choose: [1] allow once, [2] always allow (workspace), [3] deny, [4] abort: `);

                const answer = await new Promise<string>((resolve) => {
                    process.stdin.once('data', (d) => resolve(String(d).trim()));
                });

                if (answer === '2') return 'allowAlways';
                if (answer === '3') return 'deny';
                if (answer === '4') return 'abort';
                return 'allowOnce';
            };

            const host = createNodeHost(rootPath, (stream, chunk) => {
                if (stream === 'stdout') io.stdout.write(chunk);
                else io.stderr.write(chunk);
            });

            const agent = createTaskExecutionAgent({
                provider,
                host,
                config: runCfg,
                agentId,
                callbacks: {
                    onProgress: (m) => io.stderr.write(`${m}\n`),
                    onLog: (m) => io.stderr.write(`${m}\n`),
                    approveCommand
                },
                saveConfig: async (next) => {
                    // Persist allowlists only; don't silently persist per-run overrides.
                    const current = loadWorkspaceAgentsConfig(rootPath);
                    const merged = {
                        ...current,
                        execution: {
                            ...current.execution,
                            allowedCommands: Array.from(new Set([...(current.execution.allowedCommands || []), ...(next.execution.allowedCommands || [])])),
                            allowedCommandPrefixes: Array.from(new Set([...(current.execution.allowedCommandPrefixes || []), ...(next.execution.allowedCommandPrefixes || [])]))
                        }
                    };
                    writeWorkspaceAgentsConfig(rootPath, merged);
                }
            });

            const finalTitle = title || 'Untitled task';
            const finalDescription = description || '(none)';

            const result = await agent.execute({
                title: finalTitle,
                description: finalDescription,
                affectedFiles: affectedFiles.length ? affectedFiles : undefined
            });

            io.stdout.write(`\n${result.ok ? 'OK' : 'FAILED'}: ${result.summary}\n`);
            if (result.filesChanged.length) {
                io.stdout.write(`Changed files:\n`);
                for (const f of result.filesChanged) io.stdout.write(`- ${f}\n`);
            }
            if (result.commandsRun.length) {
                io.stdout.write(`Commands:\n`);
                for (const c of result.commandsRun) io.stdout.write(`- (exit ${c.exitCode}) ${c.command}\n`);
            }

            (program as any).__exitCode = result.ok ? 0 : 2;
        });

    try {
        await program.parseAsync(argv, { from: 'node' });
        const exitCode = (program as any).__exitCode;
        return typeof exitCode === 'number' ? exitCode : 0;
    } catch (error) {
        if (error instanceof CommanderError) {
            if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
                return 0;
            }
        }
        const e = error as Error;
        const code = (e as any)?.code;
        io.stderr.write(`${e.message}\n`);
        if (code === 'CONFIG' || code === 'RUNTIME') {
            return 2;
        }
        return 2;
    }
}
