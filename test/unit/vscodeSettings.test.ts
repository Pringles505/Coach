import { describe, expect, it } from 'vitest';

import { parseVscodeSettingsJson } from '../../src/core/vscodeSettings';

describe('vscode settings parsing', () => {
  it('parses coach settings from JSONC', () => {
    const jsonc = `{
      // comment
      "coach.aiProvider": "openai",
      "coach.apiKey": "sk-test",
      "coach.model": "gpt-4o",
      "coach.analysisDepth": "deep",
      "coach.excludePatterns": ["**/dist/**"]
    }`;

    const s = parseVscodeSettingsJson(jsonc);
    expect(s.provider?.provider).toBe('openai');
    expect(s.provider?.apiKey).toBe('sk-test');
    expect(s.provider?.model).toBe('gpt-4o');
    expect(s.analysisDepth).toBe('deep');
    expect(s.exclude).toEqual(['**/dist/**']);
  });

  it('falls back to legacy codeReviewerAi settings', () => {
    const jsonc = `{
      "codeReviewerAi.aiProvider": "ollama",
      "codeReviewerAi.apiEndpoint": "http://localhost:11434",
      "codeReviewerAi.model": "llama3"
    }`;

    const s = parseVscodeSettingsJson(jsonc);
    expect(s.provider?.provider).toBe('ollama');
    expect(s.provider?.apiEndpoint).toBe('http://localhost:11434');
    expect(s.provider?.model).toBe('llama3');
  });
});
