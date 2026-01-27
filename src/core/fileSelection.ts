import * as fs from 'fs';
import * as path from 'path';

import fg from 'fast-glob';

import { AgentReviewError } from './errors';

export interface SelectFilesOptions {
    rootPath: string;
    targetPath?: string;
    include: string[];
    exclude: string[];
    maxFiles: number;
}

function isPathInsideRoot(rootPath: string, filePath: string): boolean {
    const rel = path.relative(rootPath, filePath);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function shouldSkipByExtension(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const allowed = new Set([
        '.ts', '.tsx', '.js', '.jsx',
        '.py', '.java', '.cs', '.go', '.rs',
        '.cpp', '.c', '.rb', '.php', '.swift', '.kt'
    ]);
    return ext ? !allowed.has(ext) : true;
}

export function selectFiles(opts: SelectFilesOptions): string[] {
    const rootPath = path.resolve(opts.rootPath);
    const targetAbs = opts.targetPath ? path.resolve(rootPath, opts.targetPath) : rootPath;

    if (!fs.existsSync(targetAbs)) {
        throw new AgentReviewError(`Path not found: ${targetAbs}`, 'CONFIG');
    }

    const stat = fs.statSync(targetAbs);
    if (stat.isFile()) {
        if (!isPathInsideRoot(rootPath, targetAbs) && targetAbs !== rootPath) {
            // Allow analyzing a single file outside root if explicitly requested.
            return [targetAbs];
        }
        return [targetAbs];
    }

    if (!stat.isDirectory()) {
        throw new AgentReviewError(`Unsupported path type: ${targetAbs}`, 'CONFIG');
    }

    const includeGlobs = opts.include.length > 0 ? opts.include : ['**/*'];
    const ignore = opts.exclude;

    const entries = fg.sync(includeGlobs, {
        cwd: targetAbs,
        absolute: true,
        dot: true,
        onlyFiles: true,
        unique: true,
        ignore,
        followSymbolicLinks: false
    });

    const filtered = entries
        .filter(p => !shouldSkipByExtension(p))
        .slice(0, opts.maxFiles);

    return filtered;
}

export function isLikelyBinary(buffer: Buffer): boolean {
    const max = Math.min(buffer.length, 8000);
    let suspicious = 0;
    for (let i = 0; i < max; i++) {
        const byte = buffer[i];
        if (byte === 0) return true;
        // control chars except common whitespace
        if (byte < 9 || (byte > 13 && byte < 32)) suspicious++;
    }
    return suspicious / Math.max(1, max) > 0.3;
}

export function readTextFileSafe(filePath: string, maxBytes: number): string | undefined {
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes) return undefined;

    const buf = fs.readFileSync(filePath);
    if (isLikelyBinary(buf)) return undefined;
    return buf.toString('utf8');
}

