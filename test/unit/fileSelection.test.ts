import * as path from 'path';

import { describe, expect, it } from 'vitest';

import { selectFiles } from '../../src/core/fileSelection';
import { DEFAULTS } from '../../src/core/config';

describe('file selection', () => {
  it('respects include/exclude globs and skips node_modules by default', () => {
    const root = path.resolve(__dirname, '..', 'fixtures', 'basic');
    const files = selectFiles({
      rootPath: root,
      include: DEFAULTS.include,
      exclude: DEFAULTS.exclude,
      maxFiles: 100,
    });

    const rel = files.map(f => path.relative(root, f).replace(/\\/g, '/')).sort();
    expect(rel).toContain('src/good.ts');
    expect(rel).toContain('src/bad.ts');
    expect(rel.some(p => p.includes('node_modules'))).toBe(false);
  });
});

