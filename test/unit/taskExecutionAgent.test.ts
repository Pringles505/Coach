import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '../../src/types';
import { createTaskExecutionAgent } from '../../src/core/agentExecution/taskExecutionAgent';
import { defaultWorkspaceAgentsConfig } from '../../src/core/agentExecution/workspaceConfig';
import type { AgentCommandResult, AgentExecutionHost } from '../../src/core/agentExecution/types';

class MemoryHost implements AgentExecutionHost {
  rootPath = '/mem';
  private files = new Map<string, string>();
  public commands: string[] = [];

  constructor(seed?: Record<string, string>) {
    for (const [k, v] of Object.entries(seed || {})) this.files.set(k, v);
  }

  async readTextFile(relPath: string): Promise<string> {
    const v = this.files.get(relPath);
    if (v == null) throw new Error('ENOENT');
    return v;
  }
  async writeTextFile(relPath: string, content: string): Promise<void> {
    this.files.set(relPath, content);
  }
  async fileExists(relPath: string): Promise<boolean> {
    return this.files.has(relPath);
  }
  async glob(_pattern: string, _limit: number): Promise<string[]> {
    return Array.from(this.files.keys());
  }
  async runCommand(command: string): Promise<AgentCommandResult> {
    this.commands.push(command);
    const res: AgentCommandResult = { exitCode: 0, stdout: 'ok', stderr: '' };
    return res;
  }

  getFile(relPath: string): string | undefined {
    return this.files.get(relPath);
  }
}

describe('task execution agent', () => {
  it('edits files and respects command approvals', async () => {
    const cfg = defaultWorkspaceAgentsConfig();
    cfg.execution.policy = 'conservative';
    cfg.execution.allowedCommands = [];

    const host = new MemoryHost({ 'src/app.jsx': 'a\nb\nc\n' });

    let called = 0;
    const provider = {
      name: 'Mock',
      async chat(_messages: AgentMessage[]) {
        called++;
        // One-shot: write + try a command (should require approval) + finish.
        return JSON.stringify({
          actions: [
            { type: 'replaceLines', path: 'src/app.jsx', startLine: 2, endLine: 2, newText: 'B' },
            { type: 'runCommand', command: 'npm test' },
            { type: 'finish', summary: 'done' }
          ]
        });
      }
    };

    const agent = createTaskExecutionAgent({
      provider: provider as any,
      host,
      config: cfg,
      callbacks: {
        approveCommand: async () => 'deny'
      }
    });

    const res = await agent.execute({ title: 't', description: 'd' });
    expect(res.ok).toBe(true);
    expect(res.filesChanged).toContain('src/app.jsx');
    expect(host.getFile('src/app.jsx')).toBe('a\nB\nc\n');
    expect(host.commands.length).toBe(0);
    expect(res.commandsRun.length).toBe(0);
    expect(called).toBe(1);
  });
});

