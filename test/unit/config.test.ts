import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG_FILE, loadConfig } from '../../src/core/config';

describe('config loading', () => {
  it('merges defaults < env < config < overrides', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-config-'));
    const cfgPath = path.join(dir, DEFAULT_CONFIG_FILE);

    fs.writeFileSync(cfgPath, JSON.stringify({
      analysisDepth: 'deep',
      maxFiles: 10,
      provider: { provider: 'openai', model: 'gpt-4o' },
    }), 'utf8');

    const env = {
      ...process.env,
      AGENTREVIEW_PROVIDER: 'anthropic',
      AGENTREVIEW_MODEL: 'claude-sonnet-4-20250514',
      AGENTREVIEW_FAIL_ON: 'error',
    };

    const { config, configFile } = loadConfig(dir, { failOn: 'warning' }, env);

    expect(configFile).toBe(cfgPath);
    expect(config.analysisDepth).toBe('deep'); // config file overrides env
    expect(config.maxFiles).toBe(10);
    expect(config.failOn).toBe('warning'); // overrides win
    expect(config.provider.provider).toBe('openai'); // config file overrides env
  });
});
