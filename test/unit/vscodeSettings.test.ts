import { describe, expect, it } from 'vitest';

import { parseVscodeSettingsJson } from '../../src/core/vscodeSettings';

describe('vscode settings parsing', () => {
  it('parses codeReviewer settings from JSONC', () => {
    const jsonc = `{
      // comment
      "codeReviewer.aiProvider": "openai",
      "codeReviewer.apiKey": "sk-test",
      "codeReviewer.model": "gpt-4o",
      "codeReviewer.analysisDepth": "deep",
      "codeReviewer.excludePatterns": ["**/dist/**"]
    }`;

    const s = parseVscodeSettingsJson(jsonc);
    expect(s.provider?.provider).toBe('openai');
    expect(s.provider?.apiKey).toBe('sk-test');
    expect(s.provider?.model).toBe('gpt-4o');
    expect(s.analysisDepth).toBe('deep');
    expect(s.exclude).toEqual(['**/dist/**']);
  });
});

