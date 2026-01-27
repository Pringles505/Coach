import { describe, expect, it } from 'vitest';

import { tokenize } from '../../src/cli/tokenize';

describe('tokenize', () => {
  it('splits basic args', () => {
    expect(tokenize('review . --format json')).toEqual(['review', '.', '--format', 'json']);
  });

  it('supports quoted strings', () => {
    expect(tokenize('review "C:\\\\My Repo" --since main')).toEqual(['review', 'C:\\My Repo', '--since', 'main']);
    expect(tokenize("review 'a b'")).toEqual(['review', 'a b']);
  });

  it('supports backslash escaping', () => {
    // Backslash escaping is only supported inside quotes so Windows paths work unquoted.
    expect(tokenize('review "a\\ b"')).toEqual(['review', 'a b']);
  });
});
