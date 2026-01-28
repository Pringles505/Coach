import { runCli } from './runCli';

// Package metadata is injected at build time by esbuild define().
declare const __PKG_NAME__: string;
declare const __PKG_VERSION__: string;

async function main(): Promise<void> {
    const argv =
        process.argv.length <= 2
            ? (process.stdin.isTTY ? [...process.argv, 'shell'] : [...process.argv, '--help'])
            : process.argv;

    const exitCode = await runCli(argv, {
        tool: { name: __PKG_NAME__, version: __PKG_VERSION__ },
        io: process,
        env: process.env
    });
    process.exitCode = exitCode;
}

void main();
