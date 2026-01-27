import * as vscode from 'vscode';
import { Task, TaskStatus, TaskSuggestion } from '../types';

/**
 * SuggestionManager stores "proposed" tasks generated during analysis.
 *
 * Suggestions are not added to the calendar until the user accepts them.
 * Storage is scoped by workspace (via workspaceState) and also keyed by the
 * current workspaceKey to avoid bleeding across multi-root combinations.
 */
export class SuggestionManager {
    private suggestions: Map<string, TaskSuggestion> = new Map();
    private readonly STORAGE_KEY: string;

    private _onSuggestionsChanged = new vscode.EventEmitter<void>();
    readonly onSuggestionsChanged = this._onSuggestionsChanged.event;

    constructor(private storage: vscode.Memento, workspaceKey?: string) {
        const suffix = workspaceKey?.trim() ? workspaceKey.trim() : 'global';
        this.STORAGE_KEY = `codeReviewer.taskSuggestions:${suffix}`;
        void this.loadFromStorage();
    }

    getAll(): TaskSuggestion[] {
        return Array.from(this.suggestions.values())
            .sort((a, b) => b.task.priority - a.task.priority);
    }

    get(id: string): TaskSuggestion | undefined {
        return this.suggestions.get(id);
    }

    /**
     * Add tasks as suggestions, de-duping against existing suggestions and existing tasks.
     */
    async addSuggestions(tasks: Task[], existingTasks: Task[] = []): Promise<void> {
        const existingTaskFingerprints = new Set(existingTasks.map(t => this.taskFingerprint(t)));
        const existingSuggestionFingerprints = new Set(
            Array.from(this.suggestions.values()).map(s => this.taskFingerprint(s.task))
        );

        let changed = false;

        for (const task of tasks) {
            // Suggestions should not include already-completed work.
            if (task.status === TaskStatus.Completed || task.status === TaskStatus.Cancelled) continue;

            const fp = this.taskFingerprint(task);
            if (existingTaskFingerprints.has(fp)) continue;
            if (existingSuggestionFingerprints.has(fp)) continue;

            const suggestion: TaskSuggestion = {
                id: `suggestion-${task.id}`,
                task,
                createdAt: new Date()
            };

            this.suggestions.set(suggestion.id, suggestion);
            existingSuggestionFingerprints.add(fp);
            changed = true;
        }

        if (changed) {
            await this.saveToStorage();
            this._onSuggestionsChanged.fire();
        }
    }

    /**
     * Accept one suggestion (removes it from suggestions; caller persists the task).
     */
    async acceptSuggestion(id: string): Promise<Task | null> {
        const suggestion = this.suggestions.get(id);
        if (!suggestion) return null;

        this.suggestions.delete(id);
        await this.saveToStorage();
        this._onSuggestionsChanged.fire();
        return suggestion.task;
    }

    async dismissSuggestion(id: string): Promise<void> {
        if (!this.suggestions.has(id)) return;
        this.suggestions.delete(id);
        await this.saveToStorage();
        this._onSuggestionsChanged.fire();
    }

    async acceptAll(): Promise<Task[]> {
        const tasks = this.getAll().map(s => s.task);
        if (tasks.length === 0) return [];

        this.suggestions.clear();
        await this.saveToStorage();
        this._onSuggestionsChanged.fire();
        return tasks;
    }

    async dismissAll(): Promise<void> {
        if (this.suggestions.size === 0) return;
        this.suggestions.clear();
        await this.saveToStorage();
        this._onSuggestionsChanged.fire();
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    private async loadFromStorage(): Promise<void> {
        try {
            const stored = this.storage.get<Record<string, unknown>>(this.STORAGE_KEY);
            if (!stored) return;

            for (const [id, data] of Object.entries(stored)) {
                const suggestion = this.deserializeSuggestion(data);
                if (suggestion) {
                    this.suggestions.set(id, suggestion);
                }
            }
        } catch (error) {
            console.error('Failed to load suggestions:', error);
        }
    }

    private async saveToStorage(): Promise<void> {
        try {
            const serialized: Record<string, unknown> = {};
            for (const [id, suggestion] of this.suggestions) {
                serialized[id] = this.serializeSuggestion(suggestion);
            }

            await this.storage.update(this.STORAGE_KEY, serialized);
        } catch (error) {
            console.error('Failed to save suggestions:', error);
        }
    }

    private serializeSuggestion(suggestion: TaskSuggestion): unknown {
        return {
            ...suggestion,
            createdAt: suggestion.createdAt.toISOString(),
            task: this.serializeTask(suggestion.task)
        };
    }

    private deserializeSuggestion(data: unknown): TaskSuggestion | null {
        if (!data || typeof data !== 'object') return null;
        const obj = data as Record<string, unknown>;

        const task = this.deserializeTask(obj.task);
        if (!task) return null;

        return {
            id: obj.id as string,
            task,
            createdAt: new Date(obj.createdAt as string)
        };
    }

    private serializeTask(task: Task): unknown {
        return {
            ...task,
            createdAt: task.createdAt.toISOString(),
            updatedAt: task.updatedAt.toISOString(),
            scheduledDate: task.scheduledDate?.toISOString(),
            completedAt: task.completedAt?.toISOString(),
            scheduledTimeSlot: task.scheduledTimeSlot ? {
                start: task.scheduledTimeSlot.start.toISOString(),
                end: task.scheduledTimeSlot.end.toISOString()
            } : undefined
        };
    }

    private deserializeTask(data: unknown): Task | null {
        if (!data || typeof data !== 'object') return null;
        const obj = data as Record<string, unknown>;

        const scheduledTimeSlotObj = obj.scheduledTimeSlot as Record<string, unknown> | undefined;

        return {
            ...(obj as unknown as Task),
            createdAt: new Date(obj.createdAt as string),
            updatedAt: new Date(obj.updatedAt as string),
            scheduledDate: obj.scheduledDate ? new Date(obj.scheduledDate as string) : undefined,
            completedAt: obj.completedAt ? new Date(obj.completedAt as string) : undefined,
            scheduledTimeSlot: scheduledTimeSlotObj ? {
                start: new Date(scheduledTimeSlotObj.start as string),
                end: new Date(scheduledTimeSlotObj.end as string)
            } : undefined
        };
    }

    private taskFingerprint(task: Task): string {
        const norm = (s: string | undefined) =>
            (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

        const file = task.affectedFiles[0] || '';

        return [
            task.type,
            file,
            norm(task.title),
            norm(task.description)
        ].join('|');
    }
}
