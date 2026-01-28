import * as fs from 'fs';
import * as path from 'path';

import { AgentReviewError } from '../errors';
import type { WorkspaceAgentsConfigV1 } from './types';

export const COACH_DIRNAME = '.coach';
export const WORKSPACE_AGENTS_CONFIG_FILENAME = 'agents.json';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function defaultWorkspaceAgentsConfig(): WorkspaceAgentsConfigV1 {
    return {
        version: 1,
        defaultAgentId: 'default',
        agents: [
            {
                id: 'default',
                name: 'Default Agent',
                instructions:
                    'You are a careful coding agent. Make small, correct changes. Prefer minimal diffs. Run only safe commands unless explicitly allowed.'
            }
        ],
        execution: {
            policy: 'conservative',
            allowDangerous: false,
            allowedCommands: [],
            allowedCommandPrefixes: [],
            allowedPathGlobs: ['**/*'],
            deniedPathGlobs: [
                '**/.git/**',
                '**/node_modules/**',
                '**/dist/**',
                '**/out/**',
                '**/build/**',
                '**/coverage/**',
                '**/.env',
                '**/.env.*',
                '**/*.pem',
                '**/*.key',
                '**/*.p12',
                '**/.npmrc'
            ]
        }
    };
}

export function getWorkspaceAgentsConfigPath(rootPath: string): string {
    return path.join(rootPath, COACH_DIRNAME, WORKSPACE_AGENTS_CONFIG_FILENAME);
}

export function ensureCoachDir(rootPath: string): void {
    const dir = path.join(rootPath, COACH_DIRNAME);
    fs.mkdirSync(dir, { recursive: true });
}

export function loadWorkspaceAgentsConfig(rootPath: string): WorkspaceAgentsConfigV1 {
    const filePath = getWorkspaceAgentsConfigPath(rootPath);
    if (!fs.existsSync(filePath)) {
        return defaultWorkspaceAgentsConfig();
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!isPlainObject(parsed)) {
            throw new Error('agents.json root must be a JSON object');
        }

        if ((parsed as any).version !== 1) {
            throw new Error(`Unsupported agents.json version: ${String((parsed as any).version)}`);
        }

        return parsed as unknown as WorkspaceAgentsConfigV1;
    } catch (e) {
        throw new AgentReviewError(`Failed to load agent config at ${filePath}: ${(e as Error).message}`, 'CONFIG', e);
    }
}

export function writeWorkspaceAgentsConfig(rootPath: string, config: WorkspaceAgentsConfigV1): string {
    ensureCoachDir(rootPath);
    const filePath = getWorkspaceAgentsConfigPath(rootPath);
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    return filePath;
}

/**
 * Loads workspace agent config, creating a default file on disk if missing.
 * This is useful for UX so users can discover/edit it.
 */
export function ensureWorkspaceAgentsConfigFile(rootPath: string): WorkspaceAgentsConfigV1 {
    const filePath = getWorkspaceAgentsConfigPath(rootPath);
    if (fs.existsSync(filePath)) {
        return loadWorkspaceAgentsConfig(rootPath);
    }
    const cfg = defaultWorkspaceAgentsConfig();
    writeWorkspaceAgentsConfig(rootPath, cfg);
    return cfg;
}
