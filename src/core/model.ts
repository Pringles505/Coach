export type Severity = 'info' | 'warning' | 'error';

export interface Range {
    start: { line: number; column?: number };
    end: { line: number; column?: number };
}

export interface Finding {
    file: string;
    range?: Range;
    severity: Severity;
    category: string;
    title: string;
    message: string;
    suggestion?: string;
    patch?: string;
    ruleId?: string;
    confidence?: number;
}

export interface RunMeta {
    rootPath: string;
    startedAt: string; // ISO
    endedAt: string; // ISO
    durationMs: number;
    filesAnalyzed: number;
    tool: { name: string; version: string };
    configFile?: string;
    selection: {
        mode: 'path' | 'changed' | 'since';
        sinceRef?: string;
        targetPath?: string;
    };
    truncated?: boolean;
}

export interface RunResult {
    findings: Finding[];
    summary: string;
    meta: RunMeta;
}

export type FailOn = 'none' | 'info' | 'warning' | 'error';

export function compareSeverity(a: Severity, b: Severity): number {
    const order: Record<Severity, number> = { info: 0, warning: 1, error: 2 };
    return order[a] - order[b];
}

export function shouldFail(failOn: FailOn, findings: Finding[]): boolean {
    if (failOn === 'none') return false;
    const threshold: Severity = failOn === 'error' ? 'error' : failOn === 'warning' ? 'warning' : 'info';
    return findings.some(f => compareSeverity(f.severity, threshold) >= 0);
}

