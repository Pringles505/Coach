import { describe, expect, it } from 'vitest';

import { checkCommand, checkWritePath, isDangerousCommand } from '../../src/core/agentExecution/policy';
import { defaultWorkspaceAgentsConfig } from '../../src/core/agentExecution/workspaceConfig';

describe('agent execution policy', () => {
  it('requires approval for non-allowlisted commands in conservative mode', () => {
    const cfg = defaultWorkspaceAgentsConfig();
    cfg.execution.policy = 'conservative';
    const d = checkCommand('npm test', cfg.execution);
    expect(d.allowed).toBe(false);
    expect(d.requiresApproval).toBe(true);
  });

  it('blocks dangerous commands unless allowDangerous=true', () => {
    const cfg = defaultWorkspaceAgentsConfig();
    cfg.execution.policy = 'unrestricted';
    cfg.execution.allowDangerous = false;
    expect(isDangerousCommand('rm -rf .')).toBe(true);
    const d1 = checkCommand('rm -rf .', cfg.execution);
    expect(d1.allowed).toBe(false);
    expect(d1.requiresApproval).toBe(false);

    cfg.execution.allowDangerous = true;
    const d2 = checkCommand('rm -rf .', cfg.execution);
    expect(d2.allowed).toBe(true);
  });

  it('blocks denied path globs', () => {
    const cfg = defaultWorkspaceAgentsConfig();
    const d = checkWritePath('.env', cfg.execution);
    expect(d.allowed).toBe(false);
  });
});

