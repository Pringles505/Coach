import * as vscode from 'vscode';
import { TaskManager } from '../tasks/taskManager';
import { SuggestionManager } from '../suggestions/suggestionManager';
import { Task, TaskStatus, TaskType, TaskPriority, TaskSource, TaskSuggestion } from '../types';

/**
 * TaskPanelProvider renders tasks in a webview with rich UI for suggestions.
 * Shows suggestions at the top with accept/decline cards, then grouped tasks below.
 */
export class TaskPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codeReviewer.tasks';

    private _view?: vscode.WebviewView;
    private groupMode: 'type' | 'status' | 'priority' = 'type';
    private priorityFilter = {
        showLow: true,
        showMedium: true,
        showHigh: true,
        showCritical: true
    };

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly taskManager: TaskManager,
        private suggestionManager: SuggestionManager
    ) {
        taskManager.onTasksChanged(() => this.updateView());
        suggestionManager.onSuggestionsChanged(() => this.updateView());
    }

    setGroupMode(mode: 'type' | 'status' | 'priority'): void {
        this.groupMode = mode;
        this.updateView();
    }

    getPriorityFilter(): { showLow: boolean; showMedium: boolean; showHigh: boolean; showCritical: boolean } {
        return { ...this.priorityFilter };
    }

    setPriorityFilter(filter: Partial<typeof this.priorityFilter>): void {
        this.priorityFilter = { ...this.priorityFilter, ...filter };
        this.updateView();
    }

    setSuggestionManager(manager: SuggestionManager): void {
        this.suggestionManager = manager;
        manager.onSuggestionsChanged(() => this.updateView());
        this.updateView();
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'acceptSuggestion': {
                    const task = await this.suggestionManager.acceptSuggestion(message.id);
                    if (task) {
                        await this.taskManager.addTask(task);
                        vscode.window.showInformationMessage(`Task "${task.title}" added`);
                    }
                    break;
                }
                case 'dismissSuggestion':
                    await this.suggestionManager.dismissSuggestion(message.id);
                    break;
                case 'acceptAllSuggestions': {
                    const tasks = await this.suggestionManager.acceptAll();
                    if (tasks.length > 0) {
                        await this.taskManager.addTasks(tasks);
                        vscode.window.showInformationMessage(`Added ${tasks.length} task(s)`);
                    }
                    break;
                }
                case 'dismissAllSuggestions':
                    await this.suggestionManager.dismissAll();
                    break;
                case 'openTask':
                    this.openTaskFile(message.taskId);
                    break;
                case 'completeTask':
                    await this.taskManager.completeTask(message.taskId);
                    break;
                case 'setGroupMode':
                    this.groupMode = message.mode;
                    this.updateView();
                    break;
                case 'togglePriority':
                    this.priorityFilter[message.key as keyof typeof this.priorityFilter] = message.value;
                    this.updateView();
                    break;
                case 'createAiTask':
                    vscode.commands.executeCommand('codeReviewer.createTaskFromDescription');
                    break;
            }
        });
    }

    private updateView(): void {
        if (!this._view) return;
        this._view.webview.html = this.getHtmlContent();
    }

    private openTaskFile(taskId: string): void {
        const task = this.taskManager.getTask(taskId);
        if (task?.affectedFiles.length) {
            vscode.window.showTextDocument(vscode.Uri.file(task.affectedFiles[0]));
        }
    }

    private getHtmlContent(): string {
        const suggestions = this.suggestionManager.getAll();
        const tasks = this.getFilteredTasks();
        const groupedTasks = this.groupTasks(tasks);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        :root {
            --bg-primary: var(--vscode-editor-background);
            --bg-secondary: var(--vscode-sideBar-background);
            --bg-tertiary: var(--vscode-input-background);
            --text-primary: var(--vscode-editor-foreground);
            --text-secondary: var(--vscode-descriptionForeground);
            --border-color: var(--vscode-panel-border);
            --accent-color: var(--vscode-button-background);
            --accent-hover: var(--vscode-button-hoverBackground);
            --hover-bg: var(--vscode-list-hoverBackground);
            --success: #4caf50;
            --warning: #ff9800;
            --error: #f44336;
            --info: #2196f3;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: 12px;
            color: var(--text-primary);
            background: var(--bg-primary);
            padding: 8px;
        }

        /* Header */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border-color);
        }
        .header-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
        }
        .header-actions {
            display: flex;
            gap: 4px;
        }
        .icon-btn {
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: 4px;
            border-radius: 3px;
            font-size: 14px;
        }
        .icon-btn:hover {
            background: var(--hover-bg);
            color: var(--text-primary);
        }

        /* Suggestions Section */
        .suggestions-section {
            background: var(--bg-secondary);
            border-radius: 6px;
            padding: 10px;
            margin-bottom: 12px;
            border: 1px solid var(--border-color);
        }
        .suggestions-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .suggestions-title {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            font-weight: 600;
        }
        .suggestions-title .icon {
            font-size: 16px;
        }
        .suggestions-count {
            background: var(--accent-color);
            color: var(--vscode-button-foreground);
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 600;
        }
        .suggestions-actions {
            display: flex;
            gap: 6px;
        }
        .action-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 10px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
        }
        .action-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .action-btn.primary {
            background: var(--accent-color);
            color: var(--vscode-button-foreground);
        }
        .action-btn.primary:hover {
            background: var(--accent-hover);
        }

        /* Suggestion Card */
        .suggestion-card {
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 8px;
        }
        .suggestion-card:last-child {
            margin-bottom: 0;
        }
        .suggestion-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 6px;
        }
        .suggestion-info {
            flex: 1;
            min-width: 0;
        }
        .suggestion-title {
            font-weight: 600;
            font-size: 12px;
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .suggestion-title .source-icon {
            font-size: 14px;
        }
        .suggestion-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            font-size: 10px;
            color: var(--text-secondary);
        }
        .meta-item {
            display: flex;
            align-items: center;
            gap: 3px;
        }
        .suggestion-desc {
            font-size: 11px;
            color: var(--text-secondary);
            margin: 8px 0;
            line-height: 1.4;
        }
        .suggestion-buttons {
            display: flex;
            gap: 6px;
            margin-top: 8px;
        }
        .suggestion-btn {
            flex: 1;
            padding: 6px 12px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
        }
        .suggestion-btn.accept {
            background: var(--success);
            color: white;
        }
        .suggestion-btn.accept:hover {
            opacity: 0.9;
        }
        .suggestion-btn.decline {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .suggestion-btn.decline:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        /* Priority badges */
        .priority-badge {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }
        .priority-1 { background: var(--success); }
        .priority-2 { background: var(--warning); }
        .priority-3 { background: #ff5722; }
        .priority-4 { background: var(--error); }

        /* Type badges */
        .type-badge {
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 9px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .type-security { background: rgba(244,67,54,0.2); color: #f44336; }
        .type-bugfix { background: rgba(233,30,99,0.2); color: #e91e63; }
        .type-performance { background: rgba(255,87,34,0.2); color: #ff5722; }
        .type-refactor { background: rgba(74,158,255,0.2); color: #4a9eff; }
        .type-test { background: rgba(76,175,80,0.2); color: #4caf50; }
        .type-documentation { background: rgba(156,39,176,0.2); color: #9c27b0; }
        .type-expand { background: rgba(255,152,0,0.2); color: #ff9800; }

        /* Task Groups */
        .task-group {
            margin-bottom: 12px;
        }
        .group-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 8px;
            cursor: pointer;
            user-select: none;
            border-radius: 4px;
        }
        .group-header:hover {
            opacity: 1;
            background: var(--hover-bg);
        }
        .group-header:focus-visible {
            outline: 1px solid var(--accent-color);
            outline-offset: 2px;
        }
        .group-chevron {
            color: var(--text-secondary);
            font-size: 12px;
            width: 12px;
            text-align: center;
            display: inline-block;
            transition: transform 120ms ease;
        }
        .task-group.collapsed .group-chevron {
            transform: rotate(-90deg);
        }
        .group-icon {
            font-size: 14px;
        }
        .group-title {
            font-weight: 600;
            font-size: 11px;
        }
        .group-count {
            color: var(--text-secondary);
            font-size: 10px;
        }
        .group-tasks {
            padding-left: 22px;
        }

        /* Task Item */
        .task-entry {
            margin-bottom: 2px;
        }
        .task-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 8px;
            border-radius: 3px;
            cursor: pointer;
            margin-bottom: 2px;
        }
        .task-item:hover {
            background: var(--hover-bg);
        }
        .task-icon {
            font-size: 12px;
            width: 16px;
            text-align: center;
        }
        .task-content {
            flex: 1;
            min-width: 0;
        }
        .task-title {
            font-size: 11px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .task-meta {
            font-size: 10px;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .task-actions {
            display: flex;
            gap: 2px;
            opacity: 0;
        }
        .task-item:hover .task-actions {
            opacity: 1;
        }
        .suggestion-row .task-actions {
            opacity: 1;
        }
        .task-action-btn {
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 2px;
            font-size: 11px;
        }
        .task-action-btn:hover {
            background: var(--hover-bg);
            color: var(--text-primary);
        }
        .task-chevron {
            color: var(--text-secondary);
            font-size: 12px;
            width: 12px;
            text-align: center;
        }
        .task-item.expanded .task-chevron {
            transform: rotate(90deg);
        }
        .task-details {
            display: none;
            margin: 4px 0 8px 28px;
            padding: 8px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 4px;
        }
        .task-details.visible {
            display: block;
        }
        .task-details h5 {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
            margin-bottom: 6px;
        }
        .task-details .detail-text {
            font-size: 11px;
            color: var(--text-primary);
            white-space: pre-wrap;
            line-height: 1.35;
        }

        /* Empty state */
        .empty-state {
            text-align: center;
            padding: 20px;
            color: var(--text-secondary);
        }
        .empty-state p {
            margin-bottom: 10px;
        }

        /* Dropdown */
        .dropdown {
            position: relative;
            display: inline-block;
        }
        .dropdown-content {
            display: none;
            position: absolute;
            right: 0;
            top: 100%;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            min-width: 150px;
            z-index: 100;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .dropdown:hover .dropdown-content,
        .dropdown.active .dropdown-content {
            display: block;
        }
        .dropdown-item {
            padding: 6px 10px;
            cursor: pointer;
            font-size: 11px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .dropdown-item:hover {
            background: var(--hover-bg);
        }
        .dropdown-item.active {
            color: var(--accent-color);
        }
        .dropdown-divider {
            border-top: 1px solid var(--border-color);
            margin: 4px 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <span class="header-title">Tasks</span>
        <div class="header-actions">
            <button class="icon-btn" onclick="createAiTask()" title="Create AI Task">✨</button>
            <div class="dropdown">
                <button class="icon-btn" title="Group by">📂</button>
                <div class="dropdown-content">
                    <div class="dropdown-item ${this.groupMode === 'type' ? 'active' : ''}" onclick="setGroupMode('type')">📁 Group by Type</div>
                    <div class="dropdown-item ${this.groupMode === 'status' ? 'active' : ''}" onclick="setGroupMode('status')">📋 Group by Status</div>
                    <div class="dropdown-item ${this.groupMode === 'priority' ? 'active' : ''}" onclick="setGroupMode('priority')">🎯 Group by Priority</div>
                </div>
            </div>
            <div class="dropdown">
                <button class="icon-btn" title="Filter">🔽</button>
                <div class="dropdown-content">
                    <div class="dropdown-item" onclick="togglePriority('showCritical', ${!this.priorityFilter.showCritical})">
                        ${this.priorityFilter.showCritical ? '☑' : '☐'} Critical
                    </div>
                    <div class="dropdown-item" onclick="togglePriority('showHigh', ${!this.priorityFilter.showHigh})">
                        ${this.priorityFilter.showHigh ? '☑' : '☐'} High
                    </div>
                    <div class="dropdown-item" onclick="togglePriority('showMedium', ${!this.priorityFilter.showMedium})">
                        ${this.priorityFilter.showMedium ? '☑' : '☐'} Medium
                    </div>
                    <div class="dropdown-item" onclick="togglePriority('showLow', ${!this.priorityFilter.showLow})">
                        ${this.priorityFilter.showLow ? '☑' : '☐'} Low
                    </div>
                </div>
            </div>
        </div>
    </div>

    ${this.renderSuggestions(suggestions)}
    ${this.renderTaskGroups(groupedTasks)}

    <script>
        const vscode = acquireVsCodeApi();

        function acceptSuggestion(id) {
            vscode.postMessage({ command: 'acceptSuggestion', id });
        }
        function dismissSuggestion(id) {
            vscode.postMessage({ command: 'dismissSuggestion', id });
        }
        function acceptAllSuggestions() {
            vscode.postMessage({ command: 'acceptAllSuggestions' });
        }
        function dismissAllSuggestions() {
            vscode.postMessage({ command: 'dismissAllSuggestions' });
        }

        function getViewState() {
            return vscode.getState() || { collapsedGroups: {}, expandedTaskId: null };
        }
        function setViewState(next) {
            vscode.setState(next);
        }
        function updateViewState(patch) {
            const current = getViewState();
            setViewState({
                ...current,
                ...patch,
                collapsedGroups: { ...(current.collapsedGroups || {}), ...(patch.collapsedGroups || {}) }
            });
        }

        function toggleTaskDetails(taskId) {
            const detailsId = 'task-details-' + taskId;
            const rowId = 'task-row-' + taskId;
            const details = document.getElementById(detailsId);
            const row = document.getElementById(rowId);
            if (!details || !row) return;

            // Single-expand behavior: close any other open details.
            document.querySelectorAll('.task-details.visible').forEach(el => {
                if (el.id !== detailsId) el.classList.remove('visible');
            });
            document.querySelectorAll('.task-item.expanded').forEach(el => {
                if (el.id !== rowId) el.classList.remove('expanded');
            });

            const nextVisible = !details.classList.contains('visible');
            details.classList.toggle('visible', nextVisible);
            row.classList.toggle('expanded', nextVisible);

            updateViewState({ expandedTaskId: nextVisible ? taskId : null });
        }
        function openTask(taskId) {
            vscode.postMessage({ command: 'openTask', taskId });
        }
        function completeTask(taskId) {
            event.stopPropagation();
            vscode.postMessage({ command: 'completeTask', taskId });
        }
        function setGroupMode(mode) {
            vscode.postMessage({ command: 'setGroupMode', mode });
        }
        function togglePriority(key, value) {
            vscode.postMessage({ command: 'togglePriority', key, value });
        }
        function createAiTask() {
            vscode.postMessage({ command: 'createAiTask' });
        }

        function applyGroupCollapsed(id, collapsed) {
            const el = document.getElementById(id);
            if (!el) return;

            el.style.display = collapsed ? 'none' : 'block';

            const group = el.closest('.task-group');
            if (group) {
                group.classList.toggle('collapsed', collapsed);
                const header = group.querySelector('.group-header');
                if (header) {
                    header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                }
            }
        }

        function toggleGroup(id) {
            const el = document.getElementById(id);
            if (!el) return;

            const nextCollapsed = el.style.display !== 'none';
            applyGroupCollapsed(id, nextCollapsed);

            const state = getViewState();
            updateViewState({ collapsedGroups: { ...(state.collapsedGroups || {}), [id]: nextCollapsed } });
        }

        function restoreViewState() {
            const state = getViewState();

            const collapsedGroups = state.collapsedGroups || {};
            for (const [id, collapsed] of Object.entries(collapsedGroups)) {
                if (collapsed) applyGroupCollapsed(id, true);
            }

            if (state.expandedTaskId) {
                const details = document.getElementById('task-details-' + state.expandedTaskId);
                const row = document.getElementById('task-row-' + state.expandedTaskId);
                if (details && row) {
                    details.classList.add('visible');
                    row.classList.add('expanded');
                }
            }

            document.querySelectorAll('.group-header').forEach(header => {
                header.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        header.click();
                    }
                });
            });
        }

        restoreViewState();
    </script>
</body>
</html>`;
    }

    private renderSuggestions(suggestions: TaskSuggestion[]): string {
        if (suggestions.length === 0) return '';

        const rows = suggestions.slice(0, 20).map(s => this.renderSuggestionRow(s)).join('');
        const moreText = suggestions.length > 20 ? `<div class="empty-state"><p>Showing 20 of ${suggestions.length} suggestions</p></div>` : '';

        return `
        <div class="suggestions-section">
            <div class="suggestions-header">
                <div class="suggestions-title">
                    <span class="icon">💡</span>
                    Suggestions
                    <span class="suggestions-count">${suggestions.length}</span>
                </div>
                <div class="suggestions-actions">
                    <button class="action-btn primary" onclick="acceptAllSuggestions()">Accept All</button>
                    <button class="action-btn" onclick="dismissAllSuggestions()">Decline All</button>
                </div>
            </div>
            ${rows}
            ${moreText}
        </div>`;
    }

    private renderSuggestionRow(suggestion: TaskSuggestion): string {
        const task = suggestion.task;
        const typeLabel = this.getTypeLabel(task.type);
        const when = this.formatWhen(task);

        return `
        <div class="task-item suggestion-row">
            <div class="task-icon">💡</div>
            <div class="task-content">
                <div class="task-title">${this.escapeHtml(task.title)}</div>
                <div class="task-meta">
                    <span class="meta-item"><span class="priority-badge priority-${task.priority}"></span> P${task.priority}</span>
                    <span class="meta-item">${this.escapeHtml(typeLabel)}</span>
                    <span class="meta-item">⏱ ${task.estimatedMinutes}min</span>
                    <span class="meta-item">🗓 ${this.escapeHtml(when)}</span>
                </div>
            </div>
            <div class="task-actions">
                <button class="task-action-btn" title="Accept" onclick="event.stopPropagation(); acceptSuggestion('${suggestion.id}')">✓</button>
                <button class="task-action-btn" title="Decline" onclick="event.stopPropagation(); dismissSuggestion('${suggestion.id}')">✕</button>
            </div>
        </div>`;
    }

    private formatWhen(task: Task): string {
        if (task.scheduledTimeSlot?.start) {
            const date = new Date(task.scheduledTimeSlot.start);
            const d = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const t = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            return `${d} ${t}`;
        }
        return 'Unscheduled';
    }

    private renderTaskGroups(groups: Map<string, Task[]>): string {
        if (groups.size === 0) {
            return `<div class="empty-state"><p>No tasks yet</p><p>Run analysis or create AI tasks to get started</p></div>`;
        }

        let html = '';
        for (const [groupName, tasks] of groups) {
            const icon = this.getGroupIcon(groupName);
            const groupId = `group-${groupName.replace(/\s+/g, '-').toLowerCase()}`;

            html += `
            <div class="task-group">
                <div class="group-header" role="button" tabindex="0" title="Click to collapse/expand" aria-controls="${groupId}" aria-expanded="true" onclick="toggleGroup('${groupId}')">
                    <span class="group-chevron" aria-hidden="true">▾</span>
                    <span class="group-icon">${icon}</span>
                    <span class="group-title">${groupName}</span>
                    <span class="group-count">(${tasks.length})</span>
                </div>
                <div class="group-tasks" id="${groupId}">
                    ${tasks.map(t => this.renderTaskItem(t)).join('')}
                </div>
            </div>`;
        }
        return html;
    }

    private renderTaskItem(task: Task): string {
        const sourceIcon = this.getSourceIcon(task.source);
        const priorityBadge = ['', '🟢', '🟡', '🟠', '🔴'][task.priority];
        const description = (task.description || '').trim();
        const solution = (task.aiRationale || '').trim();

        return `
        <div class="task-entry">
        <div class="task-item" id="task-row-${task.id}" onclick="toggleTaskDetails('${task.id}')">
            <span class="task-chevron">›</span>
            <span class="task-icon">${this.getTypeIcon(task.type)}</span>
            <div class="task-content">
                <div class="task-title">${this.escapeHtml(task.title)}</div>
                <div class="task-meta">
                    <span>${sourceIcon}</span>
                    <span>${priorityBadge}</span>
                    <span>${task.estimatedMinutes}min</span>
                </div>
            </div>
            <div class="task-actions">
                <button class="task-action-btn" onclick="event.stopPropagation(); openTask('${task.id}')" title="Open">Open</button>
                <button class="task-action-btn" onclick="completeTask('${task.id}')" title="Complete">✓</button>
            </div>
        </div>
        <div class="task-details" id="task-details-${task.id}">
            ${description ? `<h5>Description</h5><div class="detail-text">${this.escapeHtml(description)}</div>` : `<h5>Description</h5><div class="detail-text">(none)</div>`}
            ${solution ? `<h5 style="margin-top:10px;">Solution</h5><div class="detail-text">${this.escapeHtml(solution)}</div>` : ``}
        </div>
        </div>`;
    }

    private getFilteredTasks(): Task[] {
        return this.taskManager.getAllTasks().filter(task => {
            switch (task.priority) {
                case TaskPriority.Low: return this.priorityFilter.showLow;
                case TaskPriority.Medium: return this.priorityFilter.showMedium;
                case TaskPriority.High: return this.priorityFilter.showHigh;
                case TaskPriority.Critical: return this.priorityFilter.showCritical;
                default: return true;
            }
        });
    }

    private groupTasks(tasks: Task[]): Map<string, Task[]> {
        const groups = new Map<string, Task[]>();

        for (const task of tasks) {
            let key: string;
            switch (this.groupMode) {
                case 'type':
                    key = this.getTypeLabel(task.type);
                    break;
                case 'status':
                    key = this.getStatusLabel(task.status);
                    break;
                case 'priority':
                    key = this.getPriorityLabel(task.priority);
                    break;
                default:
                    key = this.getTypeLabel(task.type);
            }

            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(task);
        }

        // Sort tasks within groups by priority
        for (const tasks of groups.values()) {
            tasks.sort((a, b) => b.priority - a.priority);
        }

        return groups;
    }

    private getTypeLabel(type: TaskType): string {
        const labels: Record<TaskType, string> = {
            [TaskType.Security]: 'Security',
            [TaskType.BugFix]: 'Bug Fixes',
            [TaskType.Performance]: 'Performance',
            [TaskType.Refactor]: 'Refactoring',
            [TaskType.Test]: 'Testing',
            [TaskType.Documentation]: 'Documentation',
            [TaskType.Expand]: 'Features'
        };
        return labels[type] || type;
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
            [TaskPriority.Critical]: 'Critical',
            [TaskPriority.High]: 'High',
            [TaskPriority.Medium]: 'Medium',
            [TaskPriority.Low]: 'Low'
        };
        return labels[priority];
    }

    private getGroupIcon(groupName: string): string {
        const icons: Record<string, string> = {
            'Security': '🛡️',
            'Bug Fixes': '🐛',
            'Performance': '⚡',
            'Refactoring': '🔧',
            'Testing': '🧪',
            'Documentation': '📖',
            'Features': '✨',
            'Pending': '📋',
            'Scheduled': '📅',
            'In Progress': '🔄',
            'Completed': '✅',
            'Deferred': '⏸️',
            'Critical': '🔴',
            'High': '🟠',
            'Medium': '🟡',
            'Low': '🟢'
        };
        return icons[groupName] || '📁';
    }

    private getTypeIcon(type: TaskType): string {
        const icons: Record<TaskType, string> = {
            [TaskType.Security]: '🛡️',
            [TaskType.BugFix]: '🐛',
            [TaskType.Performance]: '⚡',
            [TaskType.Refactor]: '🔧',
            [TaskType.Test]: '🧪',
            [TaskType.Documentation]: '📖',
            [TaskType.Expand]: '✨'
        };
        return icons[type] || '📋';
    }

    private getSourceIcon(source: TaskSource | undefined): string {
        if (!source) return '📊';
        const icons: Record<TaskSource, string> = {
            [TaskSource.Analysis]: '📊',
            [TaskSource.UserCreated]: '👤',
            [TaskSource.AiPlanned]: '🤖'
        };
        return icons[source] || '📊';
    }

    private escapeHtml(str: string): string {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
