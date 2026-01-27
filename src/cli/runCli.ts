import * as fs from 'fs';
import * as path from 'path';

import { Command, CommanderError } from 'commander';

import type { Logger } from '../core/document';
import { NullLogger } from '../core/document';
import type { AgentContext, FileAnalysis } from '../types';
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
import { AgentReviewError as CoreAgentReviewError } from '../core/errors';
import { findVscodeSettingsFile, loadVscodeReviewerSettings } from '../core/vscodeSettings';
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
        .name('agent-review')
        .description('Agent-based code review (CLI for CodeReviewer AI)')
        .version(deps.tool.version)
        .option('-v, --verbose', 'Enable verbose logging');
    program.exitOverride();

    program
        .command('config')
        .description('Configuration helpers')
        .command('init')
        .description('Create a default .agentreviewrc.json in the current directory')
        .option('-f, --force', 'Overwrite if it already exists')
        .option('--from-vscode', 'Seed config defaults from VS Code user settings (codeReviewer.*)')
        .action((opts: { force?: boolean }) => {
            const rootPath = process.cwd();
            if ((opts as any).fromVscode) {
                const settingsPath = findVscodeSettingsFile(env);
                if (!settingsPath) {
                    throw new CoreAgentReviewError('Could not find VS Code settings.json to seed config', 'CONFIG');
                }
                const vs = loadVscodeReviewerSettings(settingsPath);
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
        .description('Interactive shell (run multiple commands in one session)')
        .option('--no-banner', 'Hide the startup banner')
        .option('--prompt <prompt>', 'Prompt text', 'agent-review> ')
        .action(async (opts: { banner?: boolean; prompt?: string }) => {
            const exitCode = await runShell(deps, { banner: opts.banner !== false, prompt: opts.prompt });
            (program as any).__exitCode = exitCode;
        });

    program
        .command('summarize')
        .description('Summarize a file or workspace (Markdown by default)')
        .argument('[path]', 'File or root path (default: current directory)')
        .option('--no-from-vscode', 'Do not use VS Code user settings for provider/model/depth (codeReviewer.*)')
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
            const targetPath = path.resolve(argPath || process.cwd());

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
                        const vs = loadVscodeReviewerSettings(settingsPath);
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

                    const analysis = await agent.analyze(document, context);

                    if (format === 'json') {
                        output = JSON.stringify(analysis, null, 2) + '\n';
                    } else if (format === 'md' || format === 'markdown') {
                        output = agent.formatSummary(analysis);
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

                    const analyses = new Map<string, FileAnalysis>();
                    let totalIssues = 0;

                    for (let i = 0; i < filePaths.length; i++) {
                        const filePath = filePaths[i];
                        spinner?.update(`Analyzing ${i + 1}/${filePaths.length}: ${path.relative(rootPath, filePath).replace(/\\/g, '/')}`);
                        const text = readTextFileSafe(filePath, config.maxFileSizeBytes);
                        if (text == null) continue;

                        const document = {
                            uri: { fsPath: filePath },
                            languageId: languageIdFromPath(filePath),
                            getText: () => text
                        };

                        const analysis = await agent.analyze(document, context);
                        analyses.set(filePath, analysis);
                        totalIssues += analysis.issues.length;
                    }

                    spinner?.update(`Summarizing workspace (${analyses.size} file(s))...`);
                    const projectSummary = await agent.summarizeProject(analyses);

                    if (format === 'json') {
                        output = JSON.stringify({
                            rootPath,
                            filesAnalyzed: analyses.size,
                            totalIssues,
                            projectSummary
                        }, null, 2) + '\n';
                    } else if (format === 'md' || format === 'markdown') {
                        output = agent.formatProjectSummary(projectSummary, {
                            rootPath,
                            analyzedAt: new Date(),
                            filesAnalyzed: analyses.size,
                            totalIssues
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
        .option('--no-from-vscode', 'Do not use VS Code user settings for provider/model/depth (codeReviewer.*)')
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
            const rootPath = path.resolve(argPath || process.cwd());

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
                        const vs = loadVscodeReviewerSettings(settingsPath);

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
