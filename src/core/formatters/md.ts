import type { RunResult } from '../model';

function esc(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function formatMarkdown(result: RunResult): string {
    const lines: string[] = [];
    lines.push(`# Coach`);
    lines.push('');
    lines.push(result.summary);
    lines.push('');

    if (result.findings.length === 0) {
        lines.push('No findings.');
        lines.push('');
        return lines.join('\n');
    }

    lines.push(`| Severity | File | Line | Title |`);
    lines.push(`|---|---|---:|---|`);
    for (const f of result.findings) {
        const line = f.range?.start.line ?? '';
        lines.push(`| ${f.severity} | ${esc(f.file)} | ${line} | ${esc(f.title)} |`);
    }
    lines.push('');

    return lines.join('\n');
}
