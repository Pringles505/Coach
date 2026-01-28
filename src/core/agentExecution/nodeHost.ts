import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

import fg from 'fast-glob';

import type { AgentCommandResult, AgentExecutionHost } from './types';

function ensureRelPath(relPath: string): string {
    const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized === '.' || normalized === './') return '';
    return normalized;
}

export function createNodeHost(rootPath: string, onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void): AgentExecutionHost {
    const absRoot = path.resolve(rootPath);

    const abs = (relPath: string) => path.join(absRoot, ensureRelPath(relPath));

    return {
        rootPath: absRoot,
        async readTextFile(relPath: string): Promise<string> {
            return await fs.readFile(abs(relPath), 'utf8');
        },
        async writeTextFile(relPath: string, content: string): Promise<void> {
            const p = abs(relPath);
            await fs.mkdir(path.dirname(p), { recursive: true });
            await fs.writeFile(p, content, 'utf8');
        },
        async fileExists(relPath: string): Promise<boolean> {
            try {
                await fs.stat(abs(relPath));
                return true;
            } catch {
                return false;
            }
        },
        async glob(pattern: string, limit: number): Promise<string[]> {
            const results = await fg(pattern, {
                cwd: absRoot,
                dot: true,
                onlyFiles: true,
                unique: true,
                followSymbolicLinks: false,
                ignore: ['**/.git/**', '**/node_modules/**', '**/dist/**', '**/out/**', '**/build/**', '**/coverage/**']
            });
            return results.slice(0, Math.max(0, limit));
        },
        async runCommand(command: string, cwd?: string): Promise<AgentCommandResult> {
            const execCwd = cwd ? abs(cwd) : absRoot;
            return await new Promise<AgentCommandResult>((resolve) => {
                const child = cp.spawn(command, {
                    cwd: execCwd,
                    shell: true,
                    windowsHide: true,
                    env: process.env
                });

                let stdout = '';
                let stderr = '';

                child.stdout.on('data', (d) => {
                    const s = String(d);
                    stdout += s;
                    onOutput?.('stdout', s);
                });
                child.stderr.on('data', (d) => {
                    const s = String(d);
                    stderr += s;
                    onOutput?.('stderr', s);
                });
                child.on('close', (code) => {
                    resolve({ exitCode: typeof code === 'number' ? code : 1, stdout, stderr });
                });
                child.on('error', (e) => {
                    stderr += (e as Error).message;
                    resolve({ exitCode: 1, stdout, stderr });
                });
            });
        }
    };
}

