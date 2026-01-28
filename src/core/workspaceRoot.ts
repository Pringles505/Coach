import * as fs from 'fs';
import * as path from 'path';

const MARKER_FILES = ['.coachrc.json', '.agentreviewrc.json'];
const MARKER_DIRS = ['.coach', '.git'];

function existsDir(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function existsFile(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

/**
 * Resolve the most likely workspace root for a path by searching upwards
 * for a `.coachrc.json`, `.agentreviewrc.json`, `.coach/`, or `.git/`.
 *
 * If none are found, returns the input path.
 */
export function resolveWorkspaceRoot(startPath: string): string {
    let cur = path.resolve(startPath);

    while (true) {
        for (const file of MARKER_FILES) {
            const p = path.join(cur, file);
            if (existsFile(p)) return cur;
        }
        for (const dir of MARKER_DIRS) {
            const p = path.join(cur, dir);
            if (existsDir(p)) return cur;
        }

        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
    }

    return path.resolve(startPath);
}

