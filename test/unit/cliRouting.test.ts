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

describe('cli routing', () => {
  it('errors on unknown command (does not start shell)', async () => {
    const cap = captureIO();

    const code = await runCli(
      ['node', 'coach', 'definitely-not-a-command'],
      {
        tool: { name: 'coach', version: '0.0.0' },
        io: cap.io,
        env: process.env,
      }
    );

    expect(code).toBe(2);
    expect(cap.out).not.toContain('░██████');
    expect(cap.err.toLowerCase()).toContain('unknown');
  });

  it('prints help and exits 0', async () => {
    const cap = captureIO();

    const code = await runCli(
      ['node', 'coach', '--help'],
      {
        tool: { name: 'coach', version: '0.0.0' },
        io: cap.io,
        env: process.env,
      }
    );

    expect(code).toBe(0);
    expect(cap.err).toBe('');
    expect(cap.out.toLowerCase()).toContain('usage');
    expect(cap.out).toContain('shell');
  });
});

