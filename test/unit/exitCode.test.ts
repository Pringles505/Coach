import { describe, expect, it } from 'vitest';

import { shouldFail } from '../../src/core/model';
import type { Finding } from '../../src/core/model';

describe('exit code logic', () => {
  it('fails when finding meets threshold', () => {
    const findings: Finding[] = [{
      file: 'a.ts',
      severity: 'warning',
      category: 'code_smell',
      title: 't',
      message: 'm',
    }];
    expect(shouldFail('warning', findings)).toBe(true);
    expect(shouldFail('error', findings)).toBe(false);
    expect(shouldFail('none', findings)).toBe(false);
  });
});

