import * as vscode from 'vscode';
import { TaskManager } from '../tasks/taskManager';
import { SuggestionManager } from '../suggestions/suggestionManager';
import { Task, TaskStatus, TaskType, TaskPriority, TaskSource, TaskSuggestion } from '../types';

/**
 * GroupMode determines how tasks are organized in the tree view
 */
export enum TaskGroupMode {
    ByType = 'type',
    ByStatus = 'status',
    ByPriority = 'priority'
}

/**
 * PriorityFilter determines which priority levels are visible
 */
export interface PriorityFilter {
    showLow: boolean;
    showMedium: boolean;
    showHigh: boolean;
    showCritical: boolean;
}

/**
 * TaskTreeProvider renders tasks in a tree view with grouping and filtering.
 * Shows suggestions at the top with accept/decline actions.
 */
export class TaskTreeProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private groupMode: TaskGroupMode = TaskGroupMode.ByType;
    private priorityFilter: PriorityFilter = {
        showLow: true,
        showMedium: true,
        showHigh: true,
        showCritical: true
    };

    private suggestionManager?: SuggestionManager;

    constructor(private taskManager: TaskManager) {
        taskManager.onTasksChanged(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    setSuggestionManager(manager: SuggestionManager): void {
        this.suggestionManager = manager;
        manager.onSuggestionsChanged(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setGroupMode(mode: TaskGroupMode): void {
        this.groupMode = mode;
        this._onDidChangeTreeData.fire();
    }

    getGroupMode(): TaskGroupMode {
        return this.groupMode;
    }

    setPriorityFilter(filter: Partial<PriorityFilter>): void {
        this.priorityFilter = { ...this.priorityFilter, ...filter };
        this._onDidChangeTreeData.fire();
    }

    getPriorityFilter(): PriorityFilter {
        return { ...this.priorityFilter };
    }

    togglePriority(priority: TaskPriority): void {
        switch (priority) {
            case TaskPriority.Low:
                this.priorityFilter.showLow = !this.priorityFilter.showLow;
                break;
            case TaskPriority.Medium:
                this.priorityFilter.showMedium = !this.priorityFilter.showMedium;
                break;
            case TaskPriority.High:
                this.priorityFilter.showHigh = !this.priorityFilter.showHigh;
                break;
            case TaskPriority.Critical:
                this.priorityFilter.showCritical = !this.priorityFilter.showCritical;
                break;
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TaskTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TaskTreeItem): Thenable<TaskTreeItem[]> {
        if (!element) {
            // Root level - show suggestions first, then task groups
            return Promise.resolve(this.getRootItems());
        }

        if (element.contextValue === 'suggestionsGroup') {
            return Promise.resolve(this.getSuggestionItems());
        }

        if (element.contextValue === 'group') {
            // Show tasks in group
            return Promise.resolve(this.getTasksForGroup(element.groupType!, element.groupId!));
        }

        return Promise.resolve([]);
    }

    private getRootItems(): TaskTreeItem[] {
        const items: TaskTreeItem[] = [];

        // Add suggestions group at the top if there are any
        const suggestions = this.suggestionManager?.getAll() || [];
        if (suggestions.length > 0) {
            const suggestionsGroup = new TaskTreeItem(
                `Suggestions`,
                vscode.TreeItemCollapsibleState.Expanded,
                'suggestionsGroup',
                undefined,
                undefined,
                undefined,
                suggestions.length,
                new vscode.ThemeIcon('lightbulb', new vscode.ThemeColor('charts.yellow'))
            );
            suggestionsGroup.description = `(${suggestions.length}) - Review and accept`;
            items.push(suggestionsGroup);
        }

        // Add task groups
        items.push(...this.getGroups());

        return items;
    }

    private getSuggestionItems(): TaskTreeItem[] {
        const suggestions = this.suggestionManager?.getAll() || [];
        return suggestions.map(suggestion => this.createSuggestionItem(suggestion));
    }

    private createSuggestionItem(suggestion: TaskSuggestion): TaskTreeItem {
        const task = suggestion.task;
        const item = new TaskTreeItem(
            task.title,
            vscode.TreeItemCollapsibleState.None,
            'suggestion',
            task,
            undefined,
            undefined,
            undefined,
            undefined,
            suggestion.id
        );

        // Set icon based on source
        const sourceIcon = task.source === TaskSource.AiPlanned ? 'sparkle' : 'lightbulb';
        item.iconPath = new vscode.ThemeIcon(sourceIcon, new vscode.ThemeColor('charts.yellow'));

        // Build tooltip
        item.tooltip = new vscode.MarkdownString();
        item.tooltip.appendMarkdown(`**${task.title}** _(Suggestion)_\n\n`);
        item.tooltip.appendMarkdown(`${task.description}\n\n`);
        item.tooltip.appendMarkdown(`- **Type:** ${this.getTypeLabel(task.type)}\n`);
        item.tooltip.appendMarkdown(`- **Priority:** ${this.getPriorityLabel(task.priority)}\n`);
        item.tooltip.appendMarkdown(`- **Estimated:** ${task.estimatedMinutes} min\n`);
        item.tooltip.appendMarkdown(`- **Source:** ${this.getSourceLabel(task.source)}\n`);

        if (task.aiRationale) {
            item.tooltip.appendMarkdown(`\n---\n\n**AI Rationale:** ${task.aiRationale}\n`);
        }

        item.tooltip.appendMarkdown(`\n---\n\n_Click to accept, or use context menu to dismiss_`);

        // Build description
        const sourceEmoji = task.source === TaskSource.AiPlanned ? '🤖' : '📊';
        const priorityBadge = this.getPriorityBadge(task.priority);
        item.description = `${sourceEmoji} ${priorityBadge} ${task.estimatedMinutes}min • ${this.getTypeLabel(task.type)}`;

        // Command to accept on click
        item.command = {
            command: 'codeReviewer.acceptSuggestion',
            title: 'Accept Suggestion',
            arguments: [suggestion.id]
        };

        return item;
    }

    private getFilteredTasks(): Task[] {
        const allTasks = this.taskManager.getAllTasks();
        return allTasks.filter(task => this.passesPriorityFilter(task.priority));
    }

    private passesPriorityFilter(priority: TaskPriority): boolean {
        switch (priority) {
            case TaskPriority.Low:
                return this.priorityFilter.showLow;
            case TaskPriority.Medium:
                return this.priorityFilter.showMedium;
            case TaskPriority.High:
                return this.priorityFilter.showHigh;
            case TaskPriority.Critical:
                return this.priorityFilter.showCritical;
            default:
                return true;
        }
    }

    private getGroups(): TaskTreeItem[] {
        switch (this.groupMode) {
            case TaskGroupMode.ByType:
                return this.getTypeGroups();
            case TaskGroupMode.ByStatus:
                return this.getStatusGroups();
            case TaskGroupMode.ByPriority:
                return this.getPriorityGroups();
            default:
                return this.getTypeGroups();
        }
    }

    private getTypeGroups(): TaskTreeItem[] {
        const groups: TaskTreeItem[] = [];
        const tasks = this.getFilteredTasks();

        // Group by type
        const byType = new Map<TaskType, Task[]>();
        for (const task of tasks) {
            if (!byType.has(task.type)) {
                byType.set(task.type, []);
            }
            byType.get(task.type)!.push(task);
        }

        // Create group items in a logical order
        const typeOrder: TaskType[] = [
            TaskType.Security,
            TaskType.BugFix,
            TaskType.Performance,
            TaskType.Refactor,
            TaskType.Test,
            TaskType.Documentation,
            TaskType.Expand
        ];

        for (const type of typeOrder) {
            const typeTasks = byType.get(type);
            if (typeTasks && typeTasks.length > 0) {
                const icon = this.getTypeGroupIcon(type);
                groups.push(new TaskTreeItem(
                    this.getTypeLabel(type),
                    vscode.TreeItemCollapsibleState.Expanded,
                    'group',
                    undefined,
                    'type',
                    type,
                    typeTasks.length,
                    icon
                ));
            }
        }

        return groups;
    }

    private getStatusGroups(): TaskTreeItem[] {
        const groups: TaskTreeItem[] = [];
        const tasks = this.getFilteredTasks();

        // Group by status
        const byStatus = new Map<TaskStatus, Task[]>();
        for (const task of tasks) {
            if (!byStatus.has(task.status)) {
                byStatus.set(task.status, []);
            }
            byStatus.get(task.status)!.push(task);
        }

        // Create group items in order
        const statusOrder: TaskStatus[] = [
            TaskStatus.InProgress,
            TaskStatus.Scheduled,
            TaskStatus.Pending,
            TaskStatus.Completed,
            TaskStatus.Deferred
        ];

        for (const status of statusOrder) {
            const statusTasks = byStatus.get(status);
            if (statusTasks && statusTasks.length > 0) {
                groups.push(new TaskTreeItem(
                    this.getStatusLabel(status),
                    vscode.TreeItemCollapsibleState.Expanded,
                    'group',
                    undefined,
                    'status',
                    status,
                    statusTasks.length
                ));
            }
        }

        return groups;
    }

    private getPriorityGroups(): TaskTreeItem[] {
        const groups: TaskTreeItem[] = [];
        const tasks = this.getFilteredTasks();

        // Group by priority
        const byPriority = new Map<TaskPriority, Task[]>();
        for (const task of tasks) {
            if (!byPriority.has(task.priority)) {
                byPriority.set(task.priority, []);
            }
            byPriority.get(task.priority)!.push(task);
        }

        // Create group items in order (highest first)
        const priorityOrder: TaskPriority[] = [
            TaskPriority.Critical,
            TaskPriority.High,
            TaskPriority.Medium,
            TaskPriority.Low
        ];

        for (const priority of priorityOrder) {
            const priorityTasks = byPriority.get(priority);
            if (priorityTasks && priorityTasks.length > 0) {
                const icon = this.getPriorityGroupIcon(priority);
                groups.push(new TaskTreeItem(
                    this.getPriorityGroupLabel(priority),
                    vscode.TreeItemCollapsibleState.Expanded,
                    'group',
                    undefined,
                    'priority',
                    String(priority),
                    priorityTasks.length,
                    icon
                ));
            }
        }

        return groups;
    }

    private getTasksForGroup(groupType: string, groupId: string): TaskTreeItem[] {
        let tasks: Task[] = [];
        const allTasks = this.getFilteredTasks();

        if (groupType === 'status') {
            tasks = allTasks.filter(t => t.status === groupId);
        } else if (groupType === 'type') {
            tasks = allTasks.filter(t => t.type === groupId);
        } else if (groupType === 'priority') {
            tasks = allTasks.filter(t => t.priority === Number(groupId));
        }

        // Sort by priority (highest first)
        tasks.sort((a, b) => b.priority - a.priority);

        return tasks.map(task => this.createTaskItem(task));
    }

    private createTaskItem(task: Task): TaskTreeItem {
        const item = new TaskTreeItem(
            task.title,
            vscode.TreeItemCollapsibleState.None,
            'task',
            task
        );

        // Set icon based on type with color coding for priority
        item.iconPath = this.getTaskIcon(task);

        // Build tooltip with markdown
        item.tooltip = new vscode.MarkdownString();
        item.tooltip.appendMarkdown(`**${task.title}**\n\n`);
        item.tooltip.appendMarkdown(`${task.description}\n\n`);
        item.tooltip.appendMarkdown(`- **Type:** ${this.getTypeLabel(task.type)}\n`);
        item.tooltip.appendMarkdown(`- **Priority:** ${this.getPriorityLabel(task.priority)}\n`);
        item.tooltip.appendMarkdown(`- **Status:** ${this.getStatusLabel(task.status)}\n`);
        item.tooltip.appendMarkdown(`- **Estimated:** ${task.estimatedMinutes} min\n`);

        // Show source indicator
        const sourceLabel = this.getSourceLabel(task.source);
        item.tooltip.appendMarkdown(`- **Source:** ${sourceLabel}\n`);

        if (task.scheduledDate) {
            item.tooltip.appendMarkdown(`- **Scheduled:** ${task.scheduledDate.toLocaleDateString()}\n`);
        }

        if (task.aiRationale) {
            item.tooltip.appendMarkdown(`\n---\n\n**AI Rationale:** ${task.aiRationale}\n`);
        }

        // Build description with source indicator
        const sourceIcon = this.getSourceIcon(task.source);
        const priorityBadge = this.getPriorityBadge(task.priority);
        item.description = `${sourceIcon} ${priorityBadge} ${task.estimatedMinutes}min`;

        // Set command to open file
        if (task.affectedFiles.length > 0) {
            item.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [vscode.Uri.file(task.affectedFiles[0])]
            };
        }

        return item;
    }

    private getSourceLabel(source: TaskSource | undefined): string {
        if (!source) return 'Code Analysis';
        const labels: Record<TaskSource, string> = {
            [TaskSource.Analysis]: 'Code Analysis',
            [TaskSource.UserCreated]: 'User Created',
            [TaskSource.AiPlanned]: 'AI Planned'
        };
        return labels[source] || 'Unknown';
    }

    private getSourceIcon(source: TaskSource | undefined): string {
        if (!source) return '📊';
        const icons: Record<TaskSource, string> = {
            [TaskSource.Analysis]: '📊',      // Analysis from code
            [TaskSource.UserCreated]: '👤',   // User created
            [TaskSource.AiPlanned]: '🤖'      // AI planned from natural language
        };
        return icons[source] || '📊';
    }

    private getPriorityBadge(priority: TaskPriority): string {
        const badges: Record<TaskPriority, string> = {
            [TaskPriority.Low]: '🟢',
            [TaskPriority.Medium]: '🟡',
            [TaskPriority.High]: '🟠',
            [TaskPriority.Critical]: '🔴'
        };
        return badges[priority] || '';
    }

    private getTypeLabel(type: TaskType): string {
        const labels: Record<TaskType, string> = {
            [TaskType.Refactor]: 'Refactoring',
            [TaskType.Test]: 'Testing',
            [TaskType.Expand]: 'Feature Expansion',
            [TaskType.Documentation]: 'Documentation',
            [TaskType.Security]: 'Security',
            [TaskType.Performance]: 'Performance',
            [TaskType.BugFix]: 'Bug Fixes'
        };
        return labels[type] || type;
    }

    private getTypeGroupIcon(type: TaskType): vscode.ThemeIcon {
        const icons: Record<TaskType, string> = {
            [TaskType.Security]: 'shield',
            [TaskType.BugFix]: 'bug',
            [TaskType.Performance]: 'dashboard',
            [TaskType.Refactor]: 'wrench',
            [TaskType.Test]: 'beaker',
            [TaskType.Documentation]: 'book',
            [TaskType.Expand]: 'add'
        };
        return new vscode.ThemeIcon(icons[type] || 'circle');
    }

    private getStatusLabel(status: TaskStatus): string {
        const labels: Record<TaskStatus, string> = {
            [TaskStatus.Pending]: 'Pending',
            [TaskStatus.Scheduled]: 'Scheduled',
            [TaskStatus.InProgress]: 'In Progress',
            [TaskStatus.Completed]: 'Completed',
            [TaskStatus.Deferred]: 'Deferred',
            [TaskStatus.Cancelled]: 'Cancelled'
        };
        return labels[status] || status;
    }

    private getPriorityLabel(priority: TaskPriority): string {
        const labels: Record<TaskPriority, string> = {
            [TaskPriority.Low]: 'Low',
            [TaskPriority.Medium]: 'Medium',
            [TaskPriority.High]: 'High',
            [TaskPriority.Critical]: 'Critical'
        };
        return labels[priority];
    }

    private getPriorityGroupLabel(priority: TaskPriority): string {
        const labels: Record<TaskPriority, string> = {
            [TaskPriority.Critical]: 'Critical Priority',
            [TaskPriority.High]: 'High Priority',
            [TaskPriority.Medium]: 'Medium Priority',
            [TaskPriority.Low]: 'Low Priority'
        };
        return labels[priority];
    }

    private getPriorityGroupIcon(priority: TaskPriority): vscode.ThemeIcon {
        const colors: Record<TaskPriority, string> = {
            [TaskPriority.Critical]: 'testing-error-icon',
            [TaskPriority.High]: 'warning',
            [TaskPriority.Medium]: 'info',
            [TaskPriority.Low]: 'pass'
        };
        return new vscode.ThemeIcon(colors[priority] || 'circle');
    }

    private getTaskIcon(task: Task): vscode.ThemeIcon {
        // Use type-based icons with priority-influenced colors
        const typeIcons: Record<TaskType, string> = {
            [TaskType.Refactor]: 'wrench',
            [TaskType.Test]: 'beaker',
            [TaskType.Expand]: 'add',
            [TaskType.Documentation]: 'book',
            [TaskType.Security]: 'shield',
            [TaskType.Performance]: 'dashboard',
            [TaskType.BugFix]: 'bug'
        };

        const iconName = typeIcons[task.type] || 'circle';

        // Add color based on priority
        let color: vscode.ThemeColor | undefined;
        if (task.priority === TaskPriority.Critical) {
            color = new vscode.ThemeColor('charts.red');
        } else if (task.priority === TaskPriority.High) {
            color = new vscode.ThemeColor('charts.orange');
        }

        return new vscode.ThemeIcon(iconName, color);
    }
}

class TaskTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly task?: Task,
        public readonly groupType?: string,
        public readonly groupId?: string,
        public readonly count?: number,
        icon?: vscode.ThemeIcon,
        public readonly suggestionId?: string
    ) {
        super(label, collapsibleState);

        if (contextValue === 'group' && count !== undefined) {
            this.description = `(${count})`;
        }

        if (icon) {
            this.iconPath = icon;
        }
    }
}
