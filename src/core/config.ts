import * as fs from 'fs';
import * as path from 'path';

import { AgentReviewError } from './errors';
import type { FailOn, Severity } from './model';

export const DEFAULT_CONFIG_FILE = '.coachrc.json';
export const LEGACY_CONFIG_FILE = '.agentreviewrc.json';

export interface ProviderConfig {
    provider: 'anthropic' | 'openai' | 'azure' | 'ollama' | 'custom';
    apiKey?: string;
    apiEndpoint?: string;
    model?: string;
}

export interface AgentReviewConfig {
    provider: ProviderConfig;
    include: string[];
    exclude: string[];
    analysisDepth: 'light' | 'moderate' | 'deep';
    maxFiles: number;
    maxFileSizeBytes: number;
    failOn: FailOn;
    maxFindings: number;
}

export interface LoadedConfig {
    config: AgentReviewConfig;
    configFile?: string;
}

export const DEFAULTS: AgentReviewConfig = {
    provider: { provider: 'anthropic' },
    include: ['**/*.{ts,tsx,js,jsx,py,java,cs,go,rs,cpp,c,rb,php,swift,kt}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**', '**/out/**', '**/build/**'],
    analysisDepth: 'moderate',
    maxFiles: 200,
    maxFileSizeBytes: 1024 * 1024,
    failOn: 'warning',
    maxFindings: 200
};

export interface CliOverrides {
    provider?: ProviderConfig;
    include?: string[];
    exclude?: string[];
    analysisDepth?: AgentReviewConfig['analysisDepth'];
    maxFiles?: number;
    maxFileSizeBytes?: number;
    failOn?: FailOn;
    maxFindings?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeConfig(base: AgentReviewConfig, next: Partial<AgentReviewConfig>): AgentReviewConfig {
    const merged: AgentReviewConfig = { ...base, ...next } as AgentReviewConfig;
    merged.provider = { ...base.provider, ...(next.provider || {}) };
    merged.include = next.include ?? base.include;
    merged.exclude = next.exclude ?? base.exclude;
    return merged;
}

function configFromEnv(env: NodeJS.ProcessEnv): Partial<AgentReviewConfig> {
    const provider = env.AGENTREVIEW_PROVIDER as ProviderConfig['provider'] | undefined;
    const model = env.AGENTREVIEW_MODEL;
    const apiKey = env.AGENTREVIEW_API_KEY;
    const apiEndpoint = env.AGENTREVIEW_API_ENDPOINT;

    const failOn = env.AGENTREVIEW_FAIL_ON as FailOn | undefined;
    const maxFindings = env.AGENTREVIEW_MAX_FINDINGS ? Number(env.AGENTREVIEW_MAX_FINDINGS) : undefined;
    const analysisDepth = env.AGENTREVIEW_DEPTH as AgentReviewConfig['analysisDepth'] | undefined;

    const partial: Partial<AgentReviewConfig> = {};

    if (provider || apiKey || apiEndpoint || model) {
        partial.provider = {
            provider: provider || 'anthropic',
            apiKey,
            apiEndpoint,
            model
        };
    }
    if (failOn) partial.failOn = failOn;
    if (Number.isFinite(maxFindings)) partial.maxFindings = maxFindings!;
    if (analysisDepth) partial.analysisDepth = analysisDepth;

    return partial;
}

export function findConfigFile(rootPath: string): string | undefined {
    let cur = path.resolve(rootPath);
    while (true) {
        const preferred = path.join(cur, DEFAULT_CONFIG_FILE);
        if (fs.existsSync(preferred)) return preferred;

        const legacy = path.join(cur, LEGACY_CONFIG_FILE);
        if (fs.existsSync(legacy)) return legacy;

        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
    }

    return undefined;
}

export function loadConfig(rootPath: string, overrides: CliOverrides = {}, env: NodeJS.ProcessEnv = process.env): LoadedConfig {
    let config: AgentReviewConfig = { ...DEFAULTS, provider: { ...DEFAULTS.provider } };

    config = mergeConfig(config, configFromEnv(env));

    const configFile = findConfigFile(rootPath);
    if (configFile) {
        try {
            const raw = fs.readFileSync(configFile, 'utf8');
            const parsed = JSON.parse(raw) as Partial<AgentReviewConfig>;
            if (!isPlainObject(parsed)) {
                throw new Error('Config root must be a JSON object');
            }
            config = mergeConfig(config, parsed);
        } catch (error) {
            throw new AgentReviewError(`Failed to load config at ${configFile}: ${(error as Error).message}`, 'CONFIG', error);
        }
    }

    config = mergeConfig(config, overrides);

    // Normalize
    if (!config.provider?.provider) {
        config.provider = { provider: 'anthropic' };
    }
    config.maxFiles = Number.isFinite(config.maxFiles) ? Math.max(1, config.maxFiles) : DEFAULTS.maxFiles;
    config.maxFindings = Number.isFinite(config.maxFindings) ? Math.max(1, config.maxFindings) : DEFAULTS.maxFindings;
    config.maxFileSizeBytes = Number.isFinite(config.maxFileSizeBytes) ? Math.max(1024, config.maxFileSizeBytes) : DEFAULTS.maxFileSizeBytes;
    if (!['light', 'moderate', 'deep'].includes(config.analysisDepth)) config.analysisDepth = DEFAULTS.analysisDepth;
    if (!['none', 'info', 'warning', 'error'].includes(config.failOn)) config.failOn = DEFAULTS.failOn;

    return { config, configFile };
}

export function defaultConfigJson(): string {
    return JSON.stringify(DEFAULTS, null, 2) + '\n';
}

export function writeDefaultConfig(rootPath: string, force = false): string {
    const filePath = path.join(rootPath, DEFAULT_CONFIG_FILE);
    if (!force && fs.existsSync(filePath)) {
        throw new AgentReviewError(`Config file already exists at ${filePath}`, 'CONFIG');
    }
    fs.writeFileSync(filePath, defaultConfigJson(), 'utf8');
    return filePath;
}

export function writeConfig(rootPath: string, config: AgentReviewConfig, force = false): string {
    const filePath = path.join(rootPath, DEFAULT_CONFIG_FILE);
    if (!force && fs.existsSync(filePath)) {
        throw new AgentReviewError(`Config file already exists at ${filePath}`, 'CONFIG');
    }
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    return filePath;
}

export function severityToSarifLevel(sev: Severity): 'note' | 'warning' | 'error' {
    if (sev === 'info') return 'note';
    if (sev === 'warning') return 'warning';
    return 'error';
}
