import type { RunResult } from '../model';

export function formatJson(result: RunResult): string {
    return JSON.stringify(result, null, 2) + '\n';
}

