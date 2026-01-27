import type { AgentMessage, AIRequestConfig, AIProvider } from '../../types';
import { AgentReviewError } from '../errors';
import type { ProviderConfig } from '../config';

// Default models per provider
const DEFAULT_MODELS: Record<string, string> = {
    anthropic: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
    azure: 'gpt-4o',
    ollama: 'llama3',
    custom: 'gpt-4o'
};

function normalizeModelForProvider(provider: string, rawModel: string | undefined): string {
    const model = (rawModel || '').trim();
    const fallback = DEFAULT_MODELS[provider] || 'gpt-4o';

    if (!model || model.toLowerCase() === 'auto') return fallback;

    const lower = model.toLowerCase();

    // Common misconfiguration: using an Anthropic Claude model with OpenAI(-compatible) providers.
    if ((provider === 'openai' || provider === 'custom' || provider === 'azure') && lower.includes('claude')) {
        return fallback;
    }

    // Common misconfiguration: using OpenAI model names with Anthropic provider.
    if (provider === 'anthropic' && /(^gpt-|^o\\d|^o1|chatgpt|gpt-)/i.test(lower)) {
        return fallback;
    }

    return model;
}

// Response type interfaces
interface AnthropicResponse {
    content: Array<{ text: string }>;
}

interface OpenAIResponse {
    choices: Array<{ message: { content: string } }>;
}

interface OllamaResponse {
    message: { content: string };
}

export function resolveProviderConfig(provider: ProviderConfig, env: NodeJS.ProcessEnv = process.env): Required<ProviderConfig> {
    const resolvedProvider = provider.provider || 'anthropic';

    const envApiKey =
        env.AGENTREVIEW_API_KEY ||
        (resolvedProvider === 'anthropic' ? env.ANTHROPIC_API_KEY : undefined) ||
        (resolvedProvider === 'openai' ? env.OPENAI_API_KEY : undefined) ||
        (resolvedProvider === 'azure' ? env.AZURE_OPENAI_API_KEY : undefined) ||
        (resolvedProvider === 'custom' ? env.OPENAI_API_KEY : undefined);

    const envEndpoint =
        env.AGENTREVIEW_API_ENDPOINT ||
        (resolvedProvider === 'ollama' ? env.OLLAMA_HOST : undefined) ||
        (resolvedProvider === 'azure' ? env.AZURE_OPENAI_ENDPOINT : undefined);

    const model = normalizeModelForProvider(
        resolvedProvider,
        provider.model || env.AGENTREVIEW_MODEL || DEFAULT_MODELS[resolvedProvider] || 'gpt-4o'
    );
    return {
        provider: resolvedProvider,
        apiKey: provider.apiKey || envApiKey || '',
        apiEndpoint: provider.apiEndpoint || envEndpoint || '',
        model
    };
}

/**
 * Create an AI provider instance based on configuration.
 * Throws AgentReviewError(CONFIG) when required credentials are missing.
 */
export function createAIProvider(providerConfig: ProviderConfig, env: NodeJS.ProcessEnv = process.env): AIProvider {
    const resolved = resolveProviderConfig(providerConfig, env);

    switch (resolved.provider) {
        case 'anthropic':
            return new AnthropicProvider(resolved.apiKey, resolved.model);
        case 'openai':
            return new OpenAIProvider(resolved.apiKey, resolved.model);
        case 'azure':
            return new AzureOpenAIProvider(resolved.apiKey, resolved.apiEndpoint, resolved.model);
        case 'ollama':
            return new OllamaProvider(resolved.apiEndpoint || 'http://localhost:11434', resolved.model);
        case 'custom':
            return new CustomProvider(resolved.apiEndpoint, resolved.apiKey, resolved.model);
        default:
            throw new AgentReviewError(`Unknown AI provider: ${String((resolved as any).provider)}`, 'CONFIG');
    }
}

class AnthropicProvider implements AIProvider {
    name = 'Anthropic';

    constructor(
        private apiKey: string,
        private model: string
    ) {}

    async chat(messages: AgentMessage[], config?: Partial<AIRequestConfig>): Promise<string> {
        if (!this.apiKey) {
            throw new AgentReviewError('Anthropic API key not configured (set ANTHROPIC_API_KEY or AGENTREVIEW_API_KEY).', 'CONFIG');
        }

        const anthropicMessages = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content
            }));

        const systemMessage = messages.find(m => m.role === 'system')?.content || '';

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: config?.model || this.model,
                max_tokens: config?.maxTokens || 4096,
                system: systemMessage,
                messages: anthropicMessages,
                temperature: config?.temperature ?? 0.3
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new AgentReviewError(`Anthropic API error: ${response.status} - ${error}`, 'RUNTIME');
        }

        const data = (await response.json()) as AnthropicResponse;
        return data.content[0]?.text || '';
    }
}

class OpenAIProvider implements AIProvider {
    name = 'OpenAI';
    private maxRetries = 3;

    constructor(
        private apiKey: string,
        private model: string
    ) {}

    async chat(messages: AgentMessage[], config?: Partial<AIRequestConfig>): Promise<string> {
        if (!this.apiKey) {
            throw new AgentReviewError('OpenAI API key not configured (set OPENAI_API_KEY or AGENTREVIEW_API_KEY).', 'CONFIG');
        }

        let lastError: Error | undefined;

        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    body: JSON.stringify({
                        model: config?.model || this.model,
                        max_tokens: config?.maxTokens || 4096,
                        messages: messages.map(m => ({
                            role: m.role,
                            content: m.content
                        })),
                        temperature: config?.temperature ?? 0.3
                    })
                });

                if (response.ok) {
                    const data = (await response.json()) as OpenAIResponse;
                    return data.choices[0].message.content;
                }

                const errorText = await response.text();

                if ([500, 502, 503, 429].includes(response.status) && attempt < this.maxRetries - 1) {
                    const delay = Math.pow(2, attempt) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                throw new AgentReviewError(`OpenAI API error: ${response.status} - ${errorText}`, 'RUNTIME');
            } catch (error) {
                lastError = error as Error;
                if (attempt < this.maxRetries - 1) {
                    const delay = Math.pow(2, attempt) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            }
        }

        throw lastError || new AgentReviewError('OpenAI API request failed after retries', 'RUNTIME');
    }
}

class AzureOpenAIProvider implements AIProvider {
    name = 'Azure OpenAI';

    constructor(
        private apiKey: string,
        private endpoint: string,
        private deploymentName: string
    ) {}

    async chat(messages: AgentMessage[], config?: Partial<AIRequestConfig>): Promise<string> {
        if (!this.apiKey || !this.endpoint) {
            throw new AgentReviewError('Azure OpenAI not configured (set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT).', 'CONFIG');
        }

        const url = `${this.endpoint}/openai/deployments/${this.deploymentName}/chat/completions?api-version=2024-02-01`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': this.apiKey
            },
            body: JSON.stringify({
                max_tokens: config?.maxTokens || 4096,
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.content
                })),
                temperature: config?.temperature ?? 0.3
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new AgentReviewError(`Azure OpenAI API error: ${response.status} - ${error}`, 'RUNTIME');
        }

        const data = (await response.json()) as OpenAIResponse;
        return data.choices[0].message.content;
    }
}

class OllamaProvider implements AIProvider {
    name = 'Ollama';

    constructor(
        private endpoint: string,
        private model: string
    ) {}

    async chat(messages: AgentMessage[], config?: Partial<AIRequestConfig>): Promise<string> {
        const response = await fetch(`${this.endpoint}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: config?.model || this.model,
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.content
                })),
                stream: false,
                options: {
                    temperature: config?.temperature ?? 0.3
                }
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new AgentReviewError(`Ollama API error: ${response.status} - ${error}`, 'RUNTIME');
        }

        const data = (await response.json()) as OllamaResponse;
        return data.message.content;
    }
}

class CustomProvider implements AIProvider {
    name = 'Custom';

    constructor(
        private endpoint: string,
        private apiKey: string,
        private model: string
    ) {}

    async chat(messages: AgentMessage[], config?: Partial<AIRequestConfig>): Promise<string> {
        if (!this.endpoint) {
            throw new AgentReviewError('Custom API endpoint not configured (set AGENTREVIEW_API_ENDPOINT).', 'CONFIG');
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: config?.model || this.model,
                max_tokens: config?.maxTokens || 4096,
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.content
                })),
                temperature: config?.temperature ?? 0.3
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new AgentReviewError(`Custom API error: ${response.status} - ${error}`, 'RUNTIME');
        }

        const data = (await response.json()) as OpenAIResponse;
        return data.choices[0].message.content;
    }
}
