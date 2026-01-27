import { formatJson } from '../core/formatters/json';
import { formatMarkdown } from '../core/formatters/md';
import { formatPretty } from '../core/formatters/pretty';
import { formatSarif } from '../core/formatters/sarif';
import type { RunResult } from '../core/model';

export type OutputFormat = 'pretty' | 'json' | 'sarif' | 'md' | 'markdown';

export function renderResult(format: string | undefined, result: RunResult): string {
    const f = (format || 'pretty').toLowerCase();
    switch (f as OutputFormat) {
        case 'pretty':
            return formatPretty(result);
        case 'json':
            return formatJson(result);
        case 'sarif':
            return formatSarif(result);
        case 'md':
        case 'markdown':
            return formatMarkdown(result);
        default:
            return formatPretty(result);
    }
}

export function formatTimestampForFilename(now = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    // Use UTC to keep filenames deterministic across machines/timezones.
    return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

export function defaultMarkdownFilename(now = new Date()): string {
    return `agent-review-${formatTimestampForFilename(now)}.md`;
}
