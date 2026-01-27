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

describe('cli summarize integration', () => {
  it('summarizes a single file as markdown', async () => {
    const fixtureRoot = path.resolve(__dirname, '..', 'fixtures', 'basic');
    const filePath = path.join(fixtureRoot, 'src', 'good.ts');
    const cap = captureIO();

    const createAIProvider = () => ({
      name: 'Mock',
      chat: async () => JSON.stringify({
        issues: [],
        summary: { purpose: 'x', components: [], dependencies: [], publicApi: [], complexity: 'moderate' },
        metrics: { cognitiveComplexity: 1 },
      }),
    });

    const code = await runCli(
      ['node', 'agent-review', 'summarize', filePath, '--format', 'md', '--no-spinner'],
      {
        tool: { name: 'agent-review', version: '0.0.0' },
        io: cap.io,
        env: process.env,
        createAIProvider: createAIProvider as any,
      }
    );

    expect(code).toBe(0);
    expect(cap.err).toBe('');
    expect(cap.out).toContain('# File Summary: good.ts');
  });

  it('summarizes a workspace as markdown', async () => {
    const fixtureRoot = path.resolve(__dirname, '..', 'fixtures', 'basic');
    const cap = captureIO();

    const createAIProvider = () => ({
      name: 'Mock',
      chat: async (messages: any[]) => {
        const system = String(messages?.[0]?.content || '');
        if (system.includes('Summarize project structure and health')) {
          return JSON.stringify({
            overview: 'Project overview.',
            architecture: 'Architecture.',
            modules: [],
            recommendations: [],
          });
        }

        return JSON.stringify({
          issues: [],
          summary: { purpose: 'x', components: [], dependencies: [], publicApi: [], complexity: 'moderate' },
          metrics: { cognitiveComplexity: 1 },
        });
      },
    });

    const code = await runCli(
      ['node', 'agent-review', 'summarize', fixtureRoot, '--format', 'md', '--no-spinner'],
      {
        tool: { name: 'agent-review', version: '0.0.0' },
        io: cap.io,
        env: process.env,
        createAIProvider: createAIProvider as any,
      }
    );

    expect(code).toBe(0);
    expect(cap.err).toBe('');
    expect(cap.out).toContain('# Workspace Summary: basic');
  });
});

