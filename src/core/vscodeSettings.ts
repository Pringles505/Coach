import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parse as parseJsonc } from 'jsonc-parser';

import type { AgentReviewConfig, ProviderConfig } from './config';

export interface VscodeReviewerSettings {
    provider?: ProviderConfig;
    analysisDepth?: AgentReviewConfig['analysisDepth'];
    exclude?: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseVscodeSettingsJson(jsonText: string): VscodeReviewerSettings {
    const parsed = parseJsonc(jsonText) as unknown;
    if (!isPlainObject(parsed)) return {};

    const get = (key: string): unknown => (parsed as any)[key];
    const aiProvider = get('codeReviewer.aiProvider');
    const apiKey = get('codeReviewer.apiKey');
    const apiEndpoint = get('codeReviewer.apiEndpoint');
    const model = get('codeReviewer.model');
    const analysisDepth = get('codeReviewer.analysisDepth');
    const excludePatterns = get('codeReviewer.excludePatterns');

    const provider: ProviderConfig | undefined =
        typeof aiProvider === 'string'
            ? {
                  provider: aiProvider as ProviderConfig['provider'],
                  apiKey: typeof apiKey === 'string' ? apiKey : undefined,
                  apiEndpoint: typeof apiEndpoint === 'string' ? apiEndpoint : undefined,
                  model: typeof model === 'string' ? model : undefined
              }
            : undefined;

    return {
        provider,
        analysisDepth: analysisDepth === 'light' || analysisDepth === 'moderate' || analysisDepth === 'deep'
            ? analysisDepth
            : undefined,
        exclude: Array.isArray(excludePatterns) ? excludePatterns.filter(s => typeof s === 'string') : undefined
    };
}

export function findVscodeSettingsFile(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const platform = os.platform();

    const candidates: string[] = [];

    if (platform === 'win32') {
        const appData = env.APPDATA || path.join(env.USERPROFILE || '', 'AppData', 'Roaming');
        candidates.push(
            path.join(appData, 'Code', 'User', 'settings.json'),
            path.join(appData, 'Code - Insiders', 'User', 'settings.json'),
            path.join(appData, 'VSCodium', 'User', 'settings.json'),
            path.join(appData, 'Cursor', 'User', 'settings.json')
        );
    } else if (platform === 'darwin') {
        const home = env.HOME || os.homedir();
        candidates.push(
            path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
            path.join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'settings.json'),
            path.join(home, 'Library', 'Application Support', 'VSCodium', 'User', 'settings.json'),
            path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json')
        );
    } else {
        const home = env.HOME || os.homedir();
        candidates.push(
            path.join(home, '.config', 'Code', 'User', 'settings.json'),
            path.join(home, '.config', 'Code - Insiders', 'User', 'settings.json'),
            path.join(home, '.config', 'VSCodium', 'User', 'settings.json'),
            path.join(home, '.config', 'Cursor', 'User', 'settings.json')
        );
    }

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }

    return undefined;
}

export function loadVscodeReviewerSettings(settingsPath: string): VscodeReviewerSettings {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    return parseVscodeSettingsJson(raw);
}
