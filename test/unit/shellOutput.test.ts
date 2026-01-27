import { describe, expect, it } from 'vitest';

import { defaultMarkdownFilename, formatTimestampForFilename, renderResult } from '../../src/cli/shellOutput';
import type { RunResult } from '../../src/core/model';

describe('shell output helpers', () => {
  it('formats timestamps predictably', () => {
    const d = new Date('2026-01-27T15:04:05Z');
    expect(formatTimestampForFilename(d)).toBe('20260127-150405');
    expect(defaultMarkdownFilename(d)).toBe('agent-review-20260127-150405.md');
  });

  it('renders output formats', () => {
    const rr: RunResult = {
      findings: [],
      summary: 'ok',
      meta: {
        rootPath: '/x',
        startedAt: new Date(0).toISOString(),
        endedAt: new Date(1).toISOString(),
        durationMs: 1,
        filesAnalyzed: 0,
        tool: { name: 'agent-review', version: '0.0.0' },
        selection: { mode: 'path', targetPath: '/x' },
      },
    };

    expect(renderResult('json', rr).trim().startsWith('{')).toBe(true);
    expect(renderResult('md', rr)).toContain('# Agent Review');
    expect(renderResult('pretty', rr)).toContain('ok');
  });
});

