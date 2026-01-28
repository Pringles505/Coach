import { describe, expect, it } from 'vitest';

import { formatJson } from '../../src/core/formatters/json';
import { formatMarkdown } from '../../src/core/formatters/md';
import { formatSarif } from '../../src/core/formatters/sarif';

import type { RunResult } from '../../src/core/model';

const sample: RunResult = {
  summary: 'Analyzed 1 file(s). Found 1 finding(s) (0 error, 1 warning, 0 info).',
  findings: [{
    file: 'src/a.ts',
    severity: 'warning',
    category: 'code_smell',
    title: 'Example',
    message: 'Something is off',
    ruleId: 'code_smell',
    range: { start: { line: 1 }, end: { line: 1 } },
  }],
  meta: {
    rootPath: '/repo',
    startedAt: new Date(0).toISOString(),
    endedAt: new Date(1).toISOString(),
    durationMs: 1,
    filesAnalyzed: 1,
    tool: { name: 'coach', version: '0.0.0' },
    selection: { mode: 'path', targetPath: '/repo' },
  },
};

describe('formatters', () => {
  it('json is parseable and has stable keys', () => {
    const out = formatJson(sample);
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty('findings');
    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('meta');
  });

  it('sarif is parseable and contains results', () => {
    const out = formatSarif(sample);
    const parsed = JSON.parse(out);
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.runs[0].results.length).toBe(1);
  });

  it('markdown includes a table', () => {
    const out = formatMarkdown(sample);
    expect(out).toContain('| Severity | File | Line | Title |');
  });
});
