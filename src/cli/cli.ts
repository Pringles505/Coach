import { runCli } from './runCli';

// Package metadata is injected at build time by esbuild define().
declare const __PKG_NAME__: string;
declare const __PKG_VERSION__: string;

async function main(): Promise<void> {
    const exitCode = await runCli(process.argv, {
        tool: { name: __PKG_NAME__, version: __PKG_VERSION__ },
        io: process,
        env: process.env
    });
    process.exitCode = exitCode;
}

void main();

