import * as path from 'path';

import { describe, expect, it } from 'vitest';

import { runCli } from '../../src/cli/runCli';

function captureIO() {
  let out = '';
  let err = '';
  return {
    io: {
      stdout: { write: (c: string) => { out += c; } },
      stderr: { write: (c: string) => { err += c; } },
    },
    get out() { return out; },
    get err() { return err; },
  };
}

describe('cli integration', () => {
  it('returns exit code 1 when findings meet fail-on threshold', async () => {
    const fixtureRoot = path.resolve(__dirname, '..', 'fixtures', 'basic');
    const cap = captureIO();

    const createAIProvider = () => ({
      name: 'Mock',
      chat: async () => JSON.stringify({
        issues: [{
          startLine: 1,
          endLine: 1,
          severity: 'warning',
          category: 'code_smell',
          title: 'Mock warning',
          description: 'This is a mocked issue',
          suggestion: 'Fix it',
          effort: 'small',
          risk: 'low',
          confidence: 0.9,
        }],
        summary: { purpose: 'x', components: [], dependencies: [], publicApi: [], complexity: 'moderate' },
        metrics: { cognitiveComplexity: 1 },
      }),
    });

    const code = await runCli(
      ['node', 'coach', 'review', fixtureRoot, '--format', 'json', '--fail-on', 'warning', '--max-findings', '5'],
      {
        tool: { name: 'coach', version: '0.0.0' },
        io: cap.io,
        env: process.env,
        createAIProvider: createAIProvider as any,
      }
    );

    expect(code).toBe(1);
    expect(cap.err).toBe('');
    const parsed = JSON.parse(cap.out);
    expect(parsed.findings.length).toBeGreaterThan(0);
  });
});
