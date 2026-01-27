import type { RunResult, Severity } from '../model';

function sevIcon(sev: Severity): string {
    switch (sev) {
        case 'error': return '✖';
        case 'warning': return '⚠';
        case 'info': return 'ℹ';
    }
}

export function formatPretty(result: RunResult): string {
    const lines: string[] = [];
    lines.push(result.summary);

    if (result.findings.length === 0) {
        lines.push('');
        return lines.join('\n') + '\n';
    }

    for (const f of result.findings) {
        const loc = f.range ? `:${f.range.start.line}${f.range.start.column ? `:${f.range.start.column}` : ''}` : '';
        lines.push(`${sevIcon(f.severity)} ${f.severity.toUpperCase()} ${f.file}${loc} ${f.title}`);
        if (f.message) lines.push(`  ${f.message}`);
        if (f.suggestion) lines.push(`  Suggestion: ${f.suggestion}`);
    }

    lines.push('');
    return lines.join('\n') + '\n';
}

