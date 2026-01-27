import * as vscode from 'vscode';
import { FileAnalysis } from '../types';

/**
 * AnalysisCache stores and retrieves file analysis results.
 * Uses VS Code's globalState for persistence across sessions.
 */
export class AnalysisCache {
    private memoryCache: Map<string, FileAnalysis> = new Map();
    private readonly CACHE_KEY: string;
    private readonly MAX_CACHE_SIZE = 100;
    private readonly MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

    constructor(private storage: vscode.Memento, workspaceKey?: string) {
        const suffix = workspaceKey?.trim() ? workspaceKey.trim() : 'global';
        this.CACHE_KEY = `codeReviewer.analysisCache:${suffix}`;
        this.loadFromStorage();
    }

    /**
     * Get analysis for a file
     */
    get(filePath: string): FileAnalysis | undefined {
        const analysis = this.memoryCache.get(filePath);

        if (analysis && this.isExpired(analysis)) {
            this.memoryCache.delete(filePath);
            return undefined;
        }

        return analysis;
    }

    /**
     * Store analysis for a file
     */
    set(filePath: string, analysis: FileAnalysis): void {
        // Enforce cache size limit
        if (this.memoryCache.size >= this.MAX_CACHE_SIZE) {
            this.evictOldest();
        }

        this.memoryCache.set(filePath, analysis);
        this.saveToStorage();
    }

    /**
     * Get all cached analyses
     */
    getAll(): Map<string, FileAnalysis> {
        // Clean expired entries
        for (const [path, analysis] of this.memoryCache) {
            if (this.isExpired(analysis)) {
                this.memoryCache.delete(path);
            }
        }

        return new Map(this.memoryCache);
    }

    /**
     * Remove analysis for a file
     */
    remove(filePath: string): void {
        this.memoryCache.delete(filePath);
        this.saveToStorage();
    }

    /**
     * Clear all cached analyses
     */
    clear(): void {
        this.memoryCache.clear();
        this.saveToStorage();
    }

    /**
     * Check if a file has cached analysis
     */
    has(filePath: string): boolean {
        const analysis = this.get(filePath);
        return analysis !== undefined;
    }

    /**
     * Get cache statistics
     */
    getStats(): {
        size: number;
        totalIssues: number;
        oldestEntry: Date | null;
        newestEntry: Date | null;
    } {
        let totalIssues = 0;
        let oldest: Date | null = null;
        let newest: Date | null = null;

        for (const analysis of this.memoryCache.values()) {
            totalIssues += analysis.issues.length;

            const date = analysis.analyzedAt;
            if (!oldest || date < oldest) oldest = date;
            if (!newest || date > newest) newest = date;
        }

        return {
            size: this.memoryCache.size,
            totalIssues,
            oldestEntry: oldest,
            newestEntry: newest
        };
    }

    /**
     * Invalidate analyses for files matching a pattern
     */
    invalidatePattern(pattern: RegExp): number {
        let count = 0;

        for (const path of this.memoryCache.keys()) {
            if (pattern.test(path)) {
                this.memoryCache.delete(path);
                count++;
            }
        }

        if (count > 0) {
            this.saveToStorage();
        }

        return count;
    }

    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------

    private isExpired(analysis: FileAnalysis): boolean {
        return Date.now() - analysis.analyzedAt.getTime() > this.MAX_AGE_MS;
    }

    private evictOldest(): void {
        let oldest: { path: string; date: Date } | null = null;

        for (const [path, analysis] of this.memoryCache) {
            if (!oldest || analysis.analyzedAt < oldest.date) {
                oldest = { path, date: analysis.analyzedAt };
            }
        }

        if (oldest) {
            this.memoryCache.delete(oldest.path);
        }
    }

    private loadFromStorage(): void {
        try {
            const stored = this.storage.get<Record<string, unknown>>(this.CACHE_KEY);

            if (stored) {
                for (const [path, data] of Object.entries(stored)) {
                    const analysis = this.deserializeAnalysis(data);
                    if (analysis && !this.isExpired(analysis)) {
                        this.memoryCache.set(path, analysis);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load analysis cache:', error);
        }
    }

    private saveToStorage(): void {
        try {
            const serialized: Record<string, unknown> = {};

            for (const [path, analysis] of this.memoryCache) {
                serialized[path] = this.serializeAnalysis(analysis);
            }

            this.storage.update(this.CACHE_KEY, serialized);
        } catch (error) {
            console.error('Failed to save analysis cache:', error);
        }
    }

    private serializeAnalysis(analysis: FileAnalysis): unknown {
        return {
            ...analysis,
            analyzedAt: analysis.analyzedAt.toISOString()
        };
    }

    private deserializeAnalysis(data: unknown): FileAnalysis | null {
        if (!data || typeof data !== 'object') {
            return null;
        }

        const obj = data as Record<string, unknown>;

        return {
            filePath: obj.filePath as string,
            languageId: obj.languageId as string,
            analyzedAt: new Date(obj.analyzedAt as string),
            issues: obj.issues as FileAnalysis['issues'],
            summary: obj.summary as FileAnalysis['summary'],
            metrics: obj.metrics as FileAnalysis['metrics'],
            testCoverage: obj.testCoverage as FileAnalysis['testCoverage']
        };
    }
}
