import * as vscode from 'vscode';
import {
    Task,
    TaskStatus,
    TaskType,
    TaskPriority,
    TaskSource,
    TaskGroup,
    CalendarEvent,
    TimeSlot
} from '../types';

/**
 * TaskManager handles task storage, retrieval, and lifecycle management.
 * Provides events for UI updates.
 */
export class TaskManager {
    private tasks: Map<string, Task> = new Map();
    private readonly STORAGE_KEY = 'codeReviewer.tasks';

    private _onTasksChanged = new vscode.EventEmitter<void>();
    readonly onTasksChanged = this._onTasksChanged.event;

    constructor(private storage: vscode.Memento) {
        this.loadFromStorage();
    }

    // =========================================================================
    // Task CRUD Operations
    // =========================================================================

    /**
     * Add a new task
     */
    async addTask(task: Task): Promise<void> {
        this.tasks.set(task.id, task);
        await this.saveToStorage();
        this._onTasksChanged.fire();
    }

    /**
     * Add multiple tasks
     */
    async addTasks(tasks: Task[]): Promise<void> {
        for (const task of tasks) {
            this.tasks.set(task.id, task);
        }
        await this.saveToStorage();
        this._onTasksChanged.fire();
    }

    /**
     * Get a task by ID
     */
    getTask(id: string): Task | undefined {
        return this.tasks.get(id);
    }

    /**
     * Get all tasks
     */
    getAllTasks(): Task[] {
        return Array.from(this.tasks.values());
    }

    /**
     * Update a task
     */
    async updateTask(id: string, updates: Partial<Task>): Promise<void> {
        const task = this.tasks.get(id);
        if (!task) return;

        const updated = {
            ...task,
            ...updates,
            updatedAt: new Date()
        };

        this.tasks.set(id, updated);
        await this.saveToStorage();
        this._onTasksChanged.fire();
    }

    /**
     * Delete a task
     */
    async deleteTask(id: string): Promise<void> {
        this.tasks.delete(id);
        await this.saveToStorage();
        this._onTasksChanged.fire();
    }

    /**
     * Delete all tasks
     */
    async clearAllTasks(): Promise<void> {
        this.tasks.clear();
        await this.saveToStorage();
        this._onTasksChanged.fire();
    }

    // =========================================================================
    // Task Status Operations
    // =========================================================================

    /**
     * Mark task as completed
     */
    async completeTask(id: string): Promise<void> {
        await this.updateTask(id, {
            status: TaskStatus.Completed,
            completedAt: new Date()
        });
    }

    /**
     * Mark task as in progress
     */
    async startTask(id: string): Promise<void> {
        await this.updateTask(id, {
            status: TaskStatus.InProgress
        });
    }

    /**
     * Defer a task
     */
    async deferTask(id: string): Promise<void> {
        await this.updateTask(id, {
            status: TaskStatus.Deferred,
            scheduledDate: undefined,
            scheduledTimeSlot: undefined
        });
    }

    /**
     * Cancel a task
     */
    async cancelTask(id: string): Promise<void> {
        await this.updateTask(id, {
            status: TaskStatus.Cancelled
        });
    }

    /**
     * Reschedule a task to a new date
     */
    async rescheduleTask(id: string, newDate: Date): Promise<void> {
        const task = this.tasks.get(id);
        if (!task) return;

        const start = new Date(newDate);
        start.setHours(9, 0, 0, 0);

        const end = new Date(start.getTime() + task.estimatedMinutes * 60000);

        await this.updateTask(id, {
            status: TaskStatus.Scheduled,
            scheduledDate: start,
            scheduledTimeSlot: { start, end }
        });
    }

    // =========================================================================
    // Query Methods
    // =========================================================================

    /**
     * Get tasks by status
     */
    getTasksByStatus(status: TaskStatus): Task[] {
        return this.getAllTasks().filter(t => t.status === status);
    }

    /**
     * Get tasks by type
     */
    getTasksByType(type: TaskType): Task[] {
        return this.getAllTasks().filter(t => t.type === type);
    }

    /**
     * Get tasks by priority
     */
    getTasksByPriority(priority: TaskPriority): Task[] {
        return this.getAllTasks().filter(t => t.priority === priority);
    }

    /**
     * Get tasks for a specific file
     */
    getTasksForFile(filePath: string): Task[] {
        return this.getAllTasks().filter(t =>
            t.affectedFiles.includes(filePath)
        );
    }

    /**
     * Get tasks scheduled for a date
     */
    getTasksForDate(date: Date): Task[] {
        const dateStr = date.toISOString().split('T')[0];

        return this.getAllTasks().filter(t => {
            if (!t.scheduledDate) return false;
            return t.scheduledDate.toISOString().split('T')[0] === dateStr;
        });
    }

    /**
     * Get tasks scheduled for a date range
     */
    getTasksForDateRange(start: Date, end: Date): Task[] {
        return this.getAllTasks().filter(t => {
            if (!t.scheduledDate) return false;
            return t.scheduledDate >= start && t.scheduledDate <= end;
        });
    }

    /**
     * Get pending tasks (not completed, cancelled, or deferred)
     */
    getPendingTasks(): Task[] {
        return this.getAllTasks().filter(t =>
            t.status === TaskStatus.Pending ||
            t.status === TaskStatus.Scheduled ||
            t.status === TaskStatus.InProgress
        );
    }

    /**
     * Get overdue tasks
     */
    getOverdueTasks(): Task[] {
        const now = new Date();

        return this.getAllTasks().filter(t => {
            if (t.status === TaskStatus.Completed ||
                t.status === TaskStatus.Cancelled) {
                return false;
            }

            if (!t.scheduledDate) return false;
            return t.scheduledDate < now;
        });
    }

    // =========================================================================
    // Grouping Methods
    // =========================================================================

    /**
     * Group tasks by type
     */
    groupByType(): TaskGroup[] {
        const groups: Map<TaskType, Task[]> = new Map();

        for (const task of this.getAllTasks()) {
            if (!groups.has(task.type)) {
                groups.set(task.type, []);
            }
            groups.get(task.type)!.push(task);
        }

        return Array.from(groups.entries()).map(([type, tasks]) => ({
            id: `type-${type}`,
            name: this.getTypeLabel(type),
            tasks,
            groupType: 'type' as const
        }));
    }

    /**
     * Group tasks by file
     */
    groupByFile(): TaskGroup[] {
        const groups: Map<string, Task[]> = new Map();

        for (const task of this.getAllTasks()) {
            const file = task.affectedFiles[0] || 'unknown';
            if (!groups.has(file)) {
                groups.set(file, []);
            }
            groups.get(file)!.push(task);
        }

        return Array.from(groups.entries()).map(([file, tasks]) => ({
            id: `file-${file}`,
            name: file.split(/[\\/]/).pop() || file,
            tasks,
            groupType: 'file' as const
        }));
    }

    /**
     * Group tasks by project (workspace folder)
     */
    groupByProject(): TaskGroup[] {
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const groups: Map<string, Task[]> = new Map();

        for (const task of this.getAllTasks()) {
            const file = task.affectedFiles[0] || '';
            let project = 'Unknown';

            for (const folder of workspaceFolders) {
                if (file.startsWith(folder.uri.fsPath)) {
                    project = folder.name;
                    break;
                }
            }

            if (!groups.has(project)) {
                groups.set(project, []);
            }
            groups.get(project)!.push(task);
        }

        return Array.from(groups.entries()).map(([project, tasks]) => ({
            id: `project-${project}`,
            name: project,
            tasks,
            groupType: 'project' as const
        }));
    }

    // =========================================================================
    // Calendar Integration
    // =========================================================================

    /**
     * Convert tasks to calendar events
     */
    toCalendarEvents(): CalendarEvent[] {
        return this.getAllTasks()
            .filter(t => t.scheduledDate && t.scheduledTimeSlot)
            .map(t => ({
                id: `event-${t.id}`,
                taskId: t.id,
                title: t.title,
                start: t.scheduledTimeSlot!.start,
                end: t.scheduledTimeSlot!.end,
                type: t.type,
                priority: t.priority,
                isCompleted: t.status === TaskStatus.Completed
            }));
    }

    // =========================================================================
    // Statistics
    // =========================================================================

    /**
     * Get task statistics
     */
    getStatistics(): {
        total: number;
        byStatus: Record<TaskStatus, number>;
        byType: Record<TaskType, number>;
        byPriority: Record<TaskPriority, number>;
        totalEstimatedMinutes: number;
        completedMinutes: number;
        overdueCount: number;
    } {
        const tasks = this.getAllTasks();

        const byStatus: Partial<Record<TaskStatus, number>> = {};
        const byType: Partial<Record<TaskType, number>> = {};
        const byPriority: Partial<Record<TaskPriority, number>> = {};

        let totalEstimatedMinutes = 0;
        let completedMinutes = 0;

        for (const task of tasks) {
            byStatus[task.status] = (byStatus[task.status] || 0) + 1;
            byType[task.type] = (byType[task.type] || 0) + 1;
            byPriority[task.priority] = (byPriority[task.priority] || 0) + 1;

            totalEstimatedMinutes += task.estimatedMinutes;

            if (task.status === TaskStatus.Completed) {
                completedMinutes += task.estimatedMinutes;
            }
        }

        return {
            total: tasks.length,
            byStatus: byStatus as Record<TaskStatus, number>,
            byType: byType as Record<TaskType, number>,
            byPriority: byPriority as Record<TaskPriority, number>,
            totalEstimatedMinutes,
            completedMinutes,
            overdueCount: this.getOverdueTasks().length
        };
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private async loadFromStorage(): Promise<void> {
        try {
            const stored = this.storage.get<Record<string, unknown>>(this.STORAGE_KEY);

            if (stored) {
                for (const [id, data] of Object.entries(stored)) {
                    const task = this.deserializeTask(data);
                    if (task) {
                        this.tasks.set(id, task);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load tasks:', error);
        }
    }

    private async saveToStorage(): Promise<void> {
        try {
            const serialized: Record<string, unknown> = {};

            for (const [id, task] of this.tasks) {
                serialized[id] = this.serializeTask(task);
            }

            await this.storage.update(this.STORAGE_KEY, serialized);
        } catch (error) {
            console.error('Failed to save tasks:', error);
        }
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
        if (!data || typeof data !== 'object') {
            return null;
        }

        const obj = data as Record<string, unknown>;

        return {
            id: obj.id as string,
            title: obj.title as string,
            description: obj.description as string,
            type: obj.type as TaskType,
            status: obj.status as TaskStatus,
            priority: obj.priority as TaskPriority,
            source: (obj.source as TaskSource) || TaskSource.Analysis,
            affectedFiles: obj.affectedFiles as string[],
            sourceIssueIds: obj.sourceIssueIds as string[],
            estimatedMinutes: obj.estimatedMinutes as number,
            scheduledDate: obj.scheduledDate ? new Date(obj.scheduledDate as string) : undefined,
            scheduledTimeSlot: obj.scheduledTimeSlot ? {
                start: new Date((obj.scheduledTimeSlot as { start: string }).start),
                end: new Date((obj.scheduledTimeSlot as { end: string }).end)
            } : undefined,
            dependencies: obj.dependencies as string[],
            confidence: obj.confidence as number,
            createdAt: new Date(obj.createdAt as string),
            updatedAt: new Date(obj.updatedAt as string),
            completedAt: obj.completedAt ? new Date(obj.completedAt as string) : undefined,
            aiRationale: obj.aiRationale as string,
            userNotes: obj.userNotes as string | undefined
        };
    }

    /**
     * Get tasks by source
     */
    getTasksBySource(source: TaskSource): Task[] {
        return this.getAllTasks().filter(t => t.source === source);
    }

    private getTypeLabel(type: TaskType): string {
        const labels: Record<TaskType, string> = {
            [TaskType.Refactor]: 'Refactoring',
            [TaskType.Test]: 'Testing',
            [TaskType.Expand]: 'Expansion',
            [TaskType.Documentation]: 'Documentation',
            [TaskType.Security]: 'Security',
            [TaskType.Performance]: 'Performance',
            [TaskType.BugFix]: 'Bug Fixes'
        };
        return labels[type] || type;
    }
}
