import type { AIProvider } from '../../types';
import type { ProviderConfig } from '../config';

export type AgentExecutionPolicy = 'conservative' | 'standard' | 'unrestricted';

export interface WorkspaceAgentProfile {
    id: string;
    name: string;
    instructions?: string;
    provider?: Omit<ProviderConfig, 'apiKey'>;
}

export interface WorkspaceAgentExecutionConfig {
    policy: AgentExecutionPolicy;
    allowDangerous: boolean;
    allowedCommands: string[];
    allowedCommandPrefixes: string[];
    allowedPathGlobs: string[];
    deniedPathGlobs: string[];
}

export interface WorkspaceAgentsConfigV1 {
    version: 1;
    defaultAgentId: string;
    agents: WorkspaceAgentProfile[];
    execution: WorkspaceAgentExecutionConfig;
}

export interface AgentCommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface AgentExecutionHost {
    rootPath: string;
    readTextFile(relPath: string): Promise<string>;
    writeTextFile(relPath: string, content: string): Promise<void>;
    fileExists(relPath: string): Promise<boolean>;
    glob(pattern: string, limit: number): Promise<string[]>;
    runCommand(command: string, cwd?: string): Promise<AgentCommandResult>;
}

export type CommandApprovalDecision = 'allowOnce' | 'allowAlways' | 'deny' | 'abort';

export interface AgentExecutionCallbacks {
    onLog?: (line: string) => void;
    onProgress?: (message: string) => void;
    approveCommand?: (command: string, reason: string) => Promise<CommandApprovalDecision>;
}

export interface ForwardTaskRequest {
    title: string;
    description: string;
    affectedFiles?: string[];
}

export interface ForwardTaskResult {
    ok: boolean;
    summary: string;
    filesChanged: string[];
    commandsRun: Array<{ command: string; exitCode: number }>;
}

export interface TaskExecutionAgentDeps {
    provider: AIProvider;
    host: AgentExecutionHost;
    config: WorkspaceAgentsConfigV1;
    callbacks?: AgentExecutionCallbacks;
    agentId?: string;
    /**
     * Persist updated workspace agent config (e.g. after "allow always").
     * If omitted, updates are in-memory only.
     */
    saveConfig?: (next: WorkspaceAgentsConfigV1) => Promise<void>;
}

export interface TaskExecutionAgent {
    execute(task: ForwardTaskRequest): Promise<ForwardTaskResult>;
}
