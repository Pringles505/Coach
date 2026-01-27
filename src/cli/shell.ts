import * as path from 'path';
import * as readline from 'readline';

import type { CliDeps } from './runCli';
import { tokenize } from './tokenize';
import { runCli } from './runCli';
import type { RunResult } from '../core/model';
import * as fs from 'fs';
import { defaultMarkdownFilename, renderResult } from './shellOutput';

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

export async function runShell(deps: CliDeps, options: ShellOptions = {}): Promise<number> {
    const prompt = options.prompt ?? 'agent-review> ';
    const banner = options.banner ?? true;

    const io = deps.io;

    if (banner) {
        io.stdout.write(`Agent Review Shell (${deps.tool.name}@${deps.tool.version})\n`);
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
                io.stdout.write(`  config init [--force]\n`);
                io.stdout.write(`  cd <path>\n`);
                io.stdout.write(`  pwd\n`);
                io.stdout.write(`  exit\n\n`);
                continue;
            }

            if (trimmed === 'pwd') {
                io.stdout.write(`${process.cwd()}\n`);
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
            const cmd = args[0];

            // Interactive output prompt for commands that would otherwise print to console.
            if (cmd === 'review' && !hasFlag(args, '--output')) {
                // Determine desired display format (defaults to pretty).
                const requestedFormat = (getFlagValue(args, '--format') || 'pretty').toLowerCase();

                // Run once with JSON output so we can post-format without re-running analysis.
                const capture = { out: '', err: '' };
                const captureDeps: CliDeps = {
                    ...deps,
                    io: {
                        stdout: { write: (c: string) => { capture.out += c; } },
                        stderr: { write: (c: string) => { capture.err += c; } }
                    }
                };

                const jsonArgs = stripFlagWithValue(args, '--format')
                    .concat(['--format', 'json', '--no-spinner']);

                try {
                    lastExitCode = await runCli(['node', 'agent-review', ...jsonArgs], captureDeps);
                } catch {
                    lastExitCode = 2;
                }

                if (capture.err) io.stderr.write(capture.err);

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
            } else {
                try {
                    lastExitCode = await runCli(['node', 'agent-review', ...args], deps);
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
