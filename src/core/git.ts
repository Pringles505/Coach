import { execFileSync } from 'child_process';
import * as path from 'path';

import { AgentReviewError } from './errors';

function runGit(rootPath: string, args: string[]): string {
    try {
        return execFileSync('git', args, {
            cwd: rootPath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
    } catch (error) {
        const stderr = (error as any)?.stderr?.toString?.() || '';
        const message = stderr.trim() || (error as Error).message;
        throw new AgentReviewError(`Git command failed: git ${args.join(' ')}\n${message}`, 'RUNTIME', error);
    }
}

export function assertGitRepo(rootPath: string): void {
    try {
        runGit(rootPath, ['rev-parse', '--is-inside-work-tree']);
    } catch (error) {
        throw new AgentReviewError(`Not a git repository (needed for --changed/--since): ${path.resolve(rootPath)}`, 'RUNTIME', error);
    }
}

export function getChangedFiles(rootPath: string): string[] {
    assertGitRepo(rootPath);
    const output = runGit(rootPath, ['status', '--porcelain=v1']);
    if (!output) return [];

    const files: string[] = [];
    for (const line of output.split('\n')) {
        // Formats:
        // " M path"
        // "?? path"
        // "R  old -> new"
        const trimmed = line.trim();
        if (!trimmed) continue;
        const renameMatch = trimmed.match(/^R\d?\s+(.+?)\s+->\s+(.+)$/);
        if (renameMatch) {
            files.push(renameMatch[2]);
            continue;
        }

        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;
        files.push(parts.slice(1).join(' '));
    }
    return Array.from(new Set(files));
}

export function getFilesSince(rootPath: string, ref: string): string[] {
    assertGitRepo(rootPath);
    const output = runGit(rootPath, ['diff', '--name-only', '--diff-filter=ACMRTUXB', `${ref}...HEAD`]);
    if (!output) return [];
    return Array.from(new Set(output.split('\n').map(s => s.trim()).filter(Boolean)));
}

