import * as fs from 'fs';
import * as os from 'os';
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

describe('vscode default provider', () => {
  it('prefers VS Code provider over repo config by default', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-vscode-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), 'export const x = 1;\n', 'utf8');

    // Repo config says anthropic
    fs.writeFileSync(path.join(tmp, '.coachrc.json'), JSON.stringify({
      provider: { provider: 'anthropic' },
      include: ['src/**/*.ts'],
      exclude: [],
      analysisDepth: 'light',
      maxFiles: 5,
      maxFileSizeBytes: 1048576,
      failOn: 'warning',
      maxFindings: 5,
    }), 'utf8');

    // Fake VS Code user settings under APPDATA
    const appData = path.join(tmp, 'AppData');
    const settingsPath = path.join(appData, 'Code', 'User', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, `{
      "coach.aiProvider": "openai",
      "coach.apiKey": "sk-test",
      "coach.model": "gpt-4o"
    }`, 'utf8');

    const cap = captureIO();

    const createAIProvider = (providerConfig: any) => {
      expect(providerConfig.provider).toBe('openai');
      expect(providerConfig.apiKey).toBe('sk-test');
      expect(providerConfig.model).toBe('gpt-4o');

      return {
        name: 'Mock',
        chat: async () => JSON.stringify({
          issues: [],
          summary: { purpose: 'x', components: [], dependencies: [], publicApi: [], complexity: 'moderate' },
          metrics: { cognitiveComplexity: 1 },
        }),
      };
    };

    const env = {
      ...process.env,
      APPDATA: appData,
      AGENTREVIEW_PROVIDER: undefined,
      AGENTREVIEW_API_KEY: undefined,
      AGENTREVIEW_API_ENDPOINT: undefined,
      AGENTREVIEW_MODEL: undefined,
    } as any;

    const code = await runCli(
      ['node', 'coach', 'review', tmp, '--format', 'json', '--max-findings', '1'],
      { tool: { name: 'coach', version: '0.0.0' }, io: cap.io, env, createAIProvider: createAIProvider as any }
    );

    expect(code).toBe(0);
    expect(cap.err).toBe('');
    const parsed = JSON.parse(cap.out);
    expect(parsed.meta).toBeTruthy();
  });
});
