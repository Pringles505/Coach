import * as vscode from 'vscode';

/**
 * ConfigManager provides type-safe access to extension configuration
 */
export class ConfigManager {
    private config: vscode.WorkspaceConfiguration;

    constructor() {
        this.config = vscode.workspace.getConfiguration('coach');
    }

    /**
     * Reload configuration (call after configuration changes)
     */
    reload(): void {
        this.config = vscode.workspace.getConfiguration('coach');
    }

    /**
     * Get a configuration value
     */
    get<T>(key: string): T | undefined {
        const value = this.config.get<T>(key);
        if (value !== undefined) return value;

        // Back-compat: old extension/settings used the `codeReviewerAi.*` namespace.
        return vscode.workspace.getConfiguration('codeReviewerAi').get<T>(key);
    }

    /**
     * Get a configuration value with default
     */
    getWithDefault<T>(key: string, defaultValue: T): T {
        const value = this.config.get<T>(key);
        if (value !== undefined) return value;

        // Back-compat: old extension/settings used the `codeReviewerAi.*` namespace.
        const legacyValue = vscode.workspace.getConfiguration('codeReviewerAi').get<T>(key);
        if (legacyValue !== undefined) return legacyValue;

        return defaultValue;
    }

    /**
     * Update a configuration value
     */
    async set(key: string, value: unknown, target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global): Promise<void> {
        await this.config.update(key, value, target);
    }

    // -------------------------------------------------
    // Typed getters for common configuration values
    // -------------------------------------------------

    get aiProvider(): string {
        return this.getWithDefault('aiProvider', 'anthropic');
    }

    get apiKey(): string {
        return this.getWithDefault('apiKey', '');
    }

    get apiEndpoint(): string {
        return this.getWithDefault('apiEndpoint', '');
    }

    get model(): string {
        return this.getWithDefault('model', '');
    }

    get analysisDepth(): 'light' | 'moderate' | 'deep' {
        return this.getWithDefault('analysisDepth', 'moderate');
    }

    get autoAnalyze(): boolean {
        return this.getWithDefault('autoAnalyze', true);
    }

    get inlineAnnotations(): boolean {
        return this.getWithDefault('inlineAnnotations', true);
    }

    get workHoursStart(): number {
        return this.getWithDefault('workHoursStart', 9);
    }

    get workHoursEnd(): number {
        return this.getWithDefault('workHoursEnd', 17);
    }

    get focusSessionDuration(): number {
        return this.getWithDefault('focusSessionDuration', 90);
    }

    get excludePatterns(): string[] {
        return this.getWithDefault('excludePatterns', [
            '**/node_modules/**',
            '**/dist/**',
            '**/.git/**',
            '**/coverage/**'
        ]);
    }

    /**
     * Check if API is configured
     */
    isApiConfigured(): boolean {
        const provider = this.aiProvider;

        if (provider === 'ollama') {
            return true; // Ollama doesn't require API key
        }

        if (provider === 'custom') {
            return !!this.apiEndpoint;
        }

        return !!this.apiKey;
    }
}
