import { describe, expect, it } from 'vitest';

import { resolveProviderConfig } from '../../src/core/ai/createProvider';

describe('resolveProviderConfig model normalization', () => {
  it('falls back to OpenAI default when a Claude model is configured for OpenAI', () => {
    const resolved = resolveProviderConfig(
      { provider: 'openai', apiKey: 'sk-test', model: 'claude-sonnet-4-20250514' },
      {}
    );

    expect(resolved.provider).toBe('openai');
    expect(resolved.model).toBe('gpt-4o');
  });

  it('falls back to Anthropic default when a GPT model is configured for Anthropic', () => {
    const resolved = resolveProviderConfig(
      { provider: 'anthropic', apiKey: 'ak-test', model: 'gpt-4o' },
      {}
    );

    expect(resolved.provider).toBe('anthropic');
    expect(resolved.model).toBe('claude-sonnet-4-20250514');
  });

  it('uses provider default when model is blank', () => {
    const resolved = resolveProviderConfig(
      { provider: 'openai', apiKey: 'sk-test', model: '' },
      {}
    );

    expect(resolved.model).toBe('gpt-4o');
  });
});

