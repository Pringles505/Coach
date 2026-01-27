import { ConfigManager } from '../config/configManager';
import type { AIProvider } from '../types';

import { createAIProvider } from '../core/ai/createProvider';

export type { AIProvider } from '../types';

/**
 * Factory for creating AI provider instances based on VS Code extension configuration.
 *
 * NOTE: This file remains as the extension-facing adapter; core logic lives in `src/core/ai`.
 */
export class AIServiceFactory {
    static create(configManager: ConfigManager): AIProvider {
        return createAIProvider({
            provider: (configManager.get<string>('aiProvider') || 'anthropic') as any,
            apiKey: configManager.get<string>('apiKey') || '',
            apiEndpoint: configManager.get<string>('apiEndpoint') || '',
            model: configManager.get<string>('model') || undefined
        });
    }
}
