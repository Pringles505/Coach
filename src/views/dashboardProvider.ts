import * as vscode from 'vscode';
import { TaskManager } from '../tasks/taskManager';
import { AnalysisCache } from '../cache/analysisCache';
import { SuggestionManager } from '../suggestions/suggestionManager';
import {
    DashboardData,
    IssueCategory,
    IssueSeverity,
    TaskStatus,
    TaskSuggestion
} from '../types';

/**
 * DashboardProvider renders the main dashboard with code health overview
 */
export class DashboardProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codeReviewer.dashboard';

    private _view?: vscode.WebviewView;
    private suggestionSubscription?: vscode.Disposable;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly taskManager: TaskManager,
        private analysisCache: AnalysisCache,
        private suggestionManager: SuggestionManager
    ) {
        taskManager.onTasksChanged(() => this.updateView());
        this.suggestionSubscription = suggestionManager.onSuggestionsChanged(() => this.updateView());
    }

    setAnalysisCache(cache: AnalysisCache): void {
        this.analysisCache = cache;
        this.updateView();
    }

    setSuggestionManager(manager: SuggestionManager): void {
        this.suggestionSubscription?.dispose();
        this.suggestionManager = manager;
        this.suggestionSubscription = manager.onSuggestionsChanged(() => this.updateView());
        this.updateView();
    }

    postAnalysisActivity(activity: {
        status: 'idle' | 'running';
        message: string;
        filePath?: string;
        codePreview?: string;
    }): void {
        if (!this._view) return;
        this._view.webview.postMessage({ command: 'analysisActivity', activity });
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

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'analyzeWorkspace':
                    vscode.commands.executeCommand('codeReviewer.analyzeWorkspace');
                    break;
                case 'analyzeFile':
                    vscode.commands.executeCommand('codeReviewer.analyzeFile');
                    break;
                case 'summarizeFile':
                    vscode.commands.executeCommand('codeReviewer.summarizeFile');
                    break;
                case 'summarizeWorkspace':
                    vscode.commands.executeCommand('codeReviewer.summarizeWorkspace');
                    break;
                case 'openFile':
                    const doc = await vscode.workspace.openTextDocument(message.path);
                    await vscode.window.showTextDocument(doc);
                    break;
                case 'openTask':
                    // Navigate to task's file
                    const task = this.taskManager.getTask(message.taskId);
                    if (task && task.affectedFiles.length > 0) {
                        const taskDoc = await vscode.workspace.openTextDocument(task.affectedFiles[0]);
                        await vscode.window.showTextDocument(taskDoc);
                    }
                    break;
                case 'refresh':
                    this.updateView();
                    break;
                case 'acceptSuggestion': {
                    const task = await this.suggestionManager.acceptSuggestion(message.suggestionId);
                    if (task) {
                        await this.taskManager.addTask(task);
                    }
                    break;
                }
                case 'dismissSuggestion':
                    await this.suggestionManager.dismissSuggestion(message.suggestionId);
                    break;
                case 'acceptAllSuggestions': {
                    const tasks = await this.suggestionManager.acceptAll();
                    if (tasks.length > 0) {
                        await this.taskManager.addTasks(tasks);
                    }
                    break;
                }
                case 'dismissAllSuggestions':
                    await this.suggestionManager.dismissAll();
                    break;
            }
        });
    }

    private updateView(): void {
        if (!this._view) return;

        const data = this.getDashboardData();
        this._view.webview.postMessage({
            command: 'updateData',
            data
        });
    }

    private getDashboardData(): DashboardData {
        const analyses = this.analysisCache.getAll();
        const tasks = this.taskManager.getAllTasks();
        const stats = this.taskManager.getStatistics();

        // Calculate health score
        let totalIssues = 0;
        let criticalCount = 0;
        const issuesByCategory: Record<IssueCategory, number> = {} as Record<IssueCategory, number>;
        const issuesBySeverity: Record<IssueSeverity, number> = {} as Record<IssueSeverity, number>;

        // Initialize counters
        Object.values(IssueCategory).forEach(cat => { issuesByCategory[cat] = 0; });
        Object.values(IssueSeverity).forEach(sev => { issuesBySeverity[sev] = 0; });

        for (const analysis of analyses.values()) {
            for (const issue of analysis.issues) {
                totalIssues++;
                issuesByCategory[issue.category]++;
                issuesBySeverity[issue.severity]++;
                if (issue.severity === IssueSeverity.Critical) criticalCount++;
            }
        }

        // Health score calculation
        const healthScore = Math.max(0, Math.min(100,
            100 - (totalIssues * 2) - (criticalCount * 10)
        ));

        // Get recent analyses
        const recentAnalyses = Array.from(analyses.values())
            .sort((a, b) => b.analyzedAt.getTime() - a.analyzedAt.getTime())
            .slice(0, 5);

        // Get upcoming tasks
        const upcomingTasks = tasks
            .filter(t => t.status !== TaskStatus.Completed && t.status !== TaskStatus.Cancelled)
            .sort((a, b) => b.priority - a.priority)
            .slice(0, 5);

        // Calculate hotspots
        const hotspots = Array.from(analyses.entries())
            .filter(([_, a]) => a.issues.length > 2)
            .map(([path, analysis]) => ({
                path,
                reason: `${analysis.issues.length} issues`,
                issueCount: analysis.issues.length,
                severity: analysis.issues.reduce((max, i) =>
                    i.severity > max ? i.severity : max, IssueSeverity.Info
                )
            }))
            .sort((a, b) => b.issueCount - a.issueCount)
            .slice(0, 5);

        const taskSuggestions: TaskSuggestion[] = this.suggestionManager.getAll();

        return {
            healthScore,
            issuesByCategory,
            issuesBySeverity,
            recentAnalyses,
            upcomingTasks,
            hotspots,
            taskSuggestions
        };
    }

    private getHtmlContent(webview: vscode.Webview): string {
        const data = this.getDashboardData();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';">
    <title>Dashboard</title>
    <style>
        :root {
            --bg-primary: var(--vscode-editor-background);
            --bg-secondary: var(--vscode-sideBar-background);
            --text-primary: var(--vscode-editor-foreground);
            --text-secondary: var(--vscode-descriptionForeground);
            --border-color: var(--vscode-panel-border);
            --accent-color: var(--vscode-button-background);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--text-primary);
            background: var(--bg-primary);
            padding: 12px;
        }

        .section {
            margin-bottom: 20px;
        }

        .section-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            color: var(--text-secondary);
            margin-bottom: 8px;
            letter-spacing: 0.5px;
        }

        .health-card {
            background: var(--bg-secondary);
            border-radius: 6px;
            padding: 16px;
            text-align: center;
        }

        .health-score {
            font-size: 48px;
            font-weight: bold;
            line-height: 1;
        }

        .health-label {
            font-size: 12px;
            color: var(--text-secondary);
            margin-top: 4px;
        }

        .health-good { color: #4caf50; }
        .health-moderate { color: #ff9800; }
        .health-poor { color: #f44336; }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
        }

        .stat-card {
            background: var(--bg-secondary);
            border-radius: 4px;
            padding: 10px;
        }

        .stat-value {
            font-size: 20px;
            font-weight: bold;
        }

        .stat-label {
            font-size: 10px;
            color: var(--text-secondary);
        }

        .issue-bar {
            height: 6px;
            background: var(--border-color);
            border-radius: 3px;
            margin-top: 8px;
            overflow: hidden;
            display: flex;
        }

        .issue-segment {
            height: 100%;
        }

        .severity-info { background: #2196f3; }
        .severity-warning { background: #ff9800; }
        .severity-error { background: #f44336; }
        .severity-critical { background: #9c27b0; }

        .hotspot-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .hotspot-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px;
            background: var(--bg-secondary);
            border-radius: 4px;
            cursor: pointer;
        }

        .hotspot-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .hotspot-icon {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
        }

        .hotspot-info {
            flex: 1;
            overflow: hidden;
        }

        .hotspot-path {
            font-size: 11px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .hotspot-reason {
            font-size: 10px;
            color: var(--text-secondary);
        }

        .task-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .task-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 8px;
            background: var(--bg-secondary);
            border-radius: 4px;
            cursor: pointer;
        }

        .task-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .task-priority {
            width: 3px;
            height: 16px;
            border-radius: 2px;
        }

        .priority-1 { background: #4caf50; }
        .priority-2 { background: #2196f3; }
        .priority-3 { background: #ff9800; }
        .priority-4 { background: #f44336; }

        .task-title {
            flex: 1;
            font-size: 11px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .task-type {
            font-size: 9px;
            padding: 2px 4px;
            background: var(--border-color);
            border-radius: 2px;
            text-transform: uppercase;
        }

        .action-btn {
            background: var(--accent-color);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            width: 100%;
            font-size: 12px;
            margin-top: 12px;
        }

        .action-btn:hover {
            opacity: 0.9;
        }

        .empty-state {
            text-align: center;
            padding: 20px;
            color: var(--text-secondary);
            font-size: 11px;
        }

        .legend {
            display: flex;
            gap: 10px;
            margin-top: 8px;
            flex-wrap: wrap;
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 10px;
            color: var(--text-secondary);
        }

        .legend-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }

        .action-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 12px;
            margin-bottom: 20px;
        }

        .action-btn.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .suggestion-actions {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
        }

        .suggestion-actions .action-btn {
            margin-top: 0;
            width: auto;
            padding: 6px 10px;
        }

        .suggestion-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .suggestion-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px;
            background: var(--bg-secondary);
            border-radius: 4px;
        }

        .suggestion-main {
            flex: 1;
            min-width: 0;
        }

        .suggestion-title {
            font-size: 11px;
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .suggestion-meta {
            font-size: 10px;
            color: var(--text-secondary);
            margin-top: 2px;
        }

        .suggestion-buttons {
            display: flex;
            gap: 6px;
        }

        .suggestion-buttons button {
            border: none;
            border-radius: 3px;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 11px;
        }

        .suggestion-accept {
            background: var(--accent-color);
            color: var(--vscode-button-foreground);
        }

        .suggestion-dismiss {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .activity-card {
            background: var(--bg-secondary);
            border-radius: 6px;
            padding: 10px;
        }

        .activity-line {
            font-size: 11px;
            font-weight: 600;
            margin-bottom: 6px;
        }

        .activity-file {
            font-size: 10px;
            color: var(--text-secondary);
            margin-bottom: 8px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .activity-code {
            max-height: 180px;
            overflow: auto;
            font-size: 10px;
            line-height: 1.4;
            padding: 8px;
            background: var(--bg-primary);
            border-radius: 4px;
            border: 1px solid var(--border-color);
            white-space: pre;
        }
    </style>
</head>
<body>
    <div class="section">
        <div class="health-card">
            <div class="health-score ${getHealthClass(data.healthScore)}" id="healthScore">
                ${data.healthScore}
            </div>
            <div class="health-label">Code Health Score</div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Issues by Severity</div>
        <div class="issue-bar" id="severityBar">
            ${renderSeverityBar(data.issuesBySeverity)}
        </div>
        <div class="legend">
            <div class="legend-item"><div class="legend-dot severity-info"></div>Info</div>
            <div class="legend-item"><div class="legend-dot severity-warning"></div>Warning</div>
            <div class="legend-item"><div class="legend-dot severity-error"></div>Error</div>
            <div class="legend-item"><div class="legend-dot severity-critical"></div>Critical</div>
        </div>
    </div>

    <div class="action-row">
        <button class="action-btn" id="analyzeFileBtn">Analyze Current File</button>
        <button class="action-btn" id="analyzeBtn">Analyze Workspace</button>
        <button class="action-btn secondary" id="summarizeFileBtn">Summarize Current File</button>
        <button class="action-btn secondary" id="summarizeWorkspaceBtn">Summarize Workspace</button>
    </div>

    <div class="section">
        <div class="section-title">Quick Stats</div>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value" id="totalIssues">${getTotalIssues(data.issuesBySeverity)}</div>
                <div class="stat-label">Total Issues</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="filesAnalyzed">${data.recentAnalyses.length}</div>
                <div class="stat-label">Files Analyzed</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="pendingTasks">${data.upcomingTasks.length}</div>
                <div class="stat-label">Pending Tasks</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="hotspotCount">${data.hotspots.length}</div>
                <div class="stat-label">Hotspots</div>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Risk Hotspots</div>
        <div class="hotspot-list" id="hotspotList">
            ${renderHotspots(data.hotspots)}
        </div>
    </div>

    <div class="section">
        <div class="section-title">Priority Tasks</div>
        <div class="task-list" id="taskList">
            ${renderTasks(data.upcomingTasks)}
        </div>
    </div>

    <div class="section">
        <div class="section-title">Task Suggestions</div>
        <div class="suggestion-actions">
            <button class="action-btn secondary" id="acceptAllBtn">Accept All</button>
            <button class="action-btn secondary" id="dismissAllBtn">Decline All</button>
        </div>
        <div class="suggestion-list" id="suggestionList">
            ${renderSuggestions(data.taskSuggestions)}
        </div>
    </div>

    <div class="section">
        <div class="section-title">Live Analysis</div>
        <div class="activity-card">
            <div class="activity-line" id="activityMessage">Idle</div>
            <div class="activity-file" id="activityFile"></div>
            <pre class="activity-code" id="activityCode"></pre>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        document.getElementById('analyzeFileBtn').onclick = () => {
            vscode.postMessage({ command: 'analyzeFile' });
        };

        document.getElementById('analyzeBtn').onclick = () => {
            vscode.postMessage({ command: 'analyzeWorkspace' });
        };

        document.getElementById('summarizeFileBtn').onclick = () => {
            vscode.postMessage({ command: 'summarizeFile' });
        };

        document.getElementById('summarizeWorkspaceBtn').onclick = () => {
            vscode.postMessage({ command: 'summarizeWorkspace' });
        };

        document.getElementById('acceptAllBtn').onclick = () => {
            vscode.postMessage({ command: 'acceptAllSuggestions' });
        };

        document.getElementById('dismissAllBtn').onclick = () => {
            vscode.postMessage({ command: 'dismissAllSuggestions' });
        };

        document.querySelectorAll('.hotspot-item').forEach(item => {
            item.onclick = () => {
                vscode.postMessage({ command: 'openFile', path: item.dataset.path });
            };
        });

        document.querySelectorAll('.task-item').forEach(item => {
            item.onclick = () => {
                vscode.postMessage({ command: 'openTask', taskId: item.dataset.taskId });
            };
        });

        document.querySelectorAll('.suggestion-accept').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                vscode.postMessage({ command: 'acceptSuggestion', suggestionId: btn.dataset.suggestionId });
            };
        });

        document.querySelectorAll('.suggestion-dismiss').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                vscode.postMessage({ command: 'dismissSuggestion', suggestionId: btn.dataset.suggestionId });
            };
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateData') {
                updateDashboard(message.data);
            }
            if (message.command === 'analysisActivity') {
                updateActivity(message.activity);
            }
        });

        function updateDashboard(data) {
            document.getElementById('healthScore').textContent = data.healthScore;
            document.getElementById('healthScore').className = 'health-score ' + getHealthClass(data.healthScore);
            document.getElementById('totalIssues').textContent = getTotalIssues(data.issuesBySeverity);
            document.getElementById('filesAnalyzed').textContent = data.recentAnalyses.length;
            document.getElementById('pendingTasks').textContent = data.upcomingTasks.length;
            document.getElementById('hotspotCount').textContent = data.hotspots.length;
            document.getElementById('hotspotList').innerHTML = renderHotspots(data.hotspots);
            document.getElementById('taskList').innerHTML = renderTasks(data.upcomingTasks);
            document.getElementById('suggestionList').innerHTML = renderSuggestions(data.taskSuggestions);

            document.querySelectorAll('.hotspot-item').forEach(item => {
                item.onclick = () => {
                    vscode.postMessage({ command: 'openFile', path: item.dataset.path });
                };
            });

            document.querySelectorAll('.task-item').forEach(item => {
                item.onclick = () => {
                    vscode.postMessage({ command: 'openTask', taskId: item.dataset.taskId });
                };
            });

            document.querySelectorAll('.suggestion-accept').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'acceptSuggestion', suggestionId: btn.dataset.suggestionId });
                };
            });

            document.querySelectorAll('.suggestion-dismiss').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'dismissSuggestion', suggestionId: btn.dataset.suggestionId });
                };
            });
        }

        function updateActivity(activity) {
            document.getElementById('activityMessage').textContent = activity.message || '';
            document.getElementById('activityFile').textContent = activity.filePath || '';
            document.getElementById('activityCode').textContent = activity.codePreview || '';
        }

        function getHealthClass(score) {
            if (score >= 80) return 'health-good';
            if (score >= 50) return 'health-moderate';
            return 'health-poor';
        }

        function getTotalIssues(bySeverity) {
            return Object.values(bySeverity || {}).reduce((sum, n) => sum + (n || 0), 0);
        }

        function renderHotspots(hotspots) {
            if (!hotspots || hotspots.length === 0) {
                return '<div class="empty-state">No hotspots detected</div>';
            }

            return hotspots.map(h => {
                const file = (h.path || '').split(/[/\\\\]/).pop();
                return '<div class="hotspot-item" data-path="' + escapeHtml(h.path) + '">' +
                    '<div class="hotspot-icon" style="background: ' + getSeverityColor(h.severity) + '">!</div>' +
                    '<div class="hotspot-info">' +
                    '<div class="hotspot-path">' + escapeHtml(file) + '</div>' +
                    '<div class="hotspot-reason">' + escapeHtml(h.reason) + '</div>' +
                    '</div>' +
                    '</div>';
            }).join('');
        }

        function renderTasks(tasks) {
            if (!tasks || tasks.length === 0) {
                return '<div class="empty-state">No pending tasks</div>';
            }

            return tasks.map(t =>
                '<div class="task-item" data-task-id="' + escapeHtml(t.id) + '">' +
                    '<div class="task-priority priority-' + escapeHtml(t.priority) + '"></div>' +
                    '<div class="task-title">' + escapeHtml(t.title) + '</div>' +
                    '<div class="task-type">' + escapeHtml(t.type) + '</div>' +
                '</div>'
            ).join('');
        }

        function renderSuggestions(suggestions) {
            if (!suggestions || suggestions.length === 0) {
                return '<div class="empty-state">No task suggestions</div>';
            }

            const top = suggestions.slice(0, 20);
            let html = top.map(s =>
                '<div class="suggestion-item">' +
                    '<div class="suggestion-main">' +
                        '<div class="suggestion-title">' + escapeHtml(s.task.title) + '</div>' +
                        '<div class="suggestion-meta">' + escapeHtml(s.task.type) + ' · ' + s.task.estimatedMinutes + ' min · P' + s.task.priority + '</div>' +
                    '</div>' +
                    '<div class="suggestion-buttons">' +
                        '<button class="suggestion-accept" data-suggestion-id="' + escapeHtml(s.id) + '">Accept</button>' +
                        '<button class="suggestion-dismiss" data-suggestion-id="' + escapeHtml(s.id) + '">Decline</button>' +
                    '</div>' +
                '</div>'
            ).join('');

            if (suggestions.length > top.length) {
                html += '<div class="empty-state">Showing top 20 of ' + suggestions.length + ' suggestions</div>';
            }

            return html;
        }

        function getSeverityColor(severity) {
            const colors = {
                info: '#2196f3',
                warning: '#ff9800',
                error: '#f44336',
                critical: '#9c27b0'
            };
            return colors[severity] || '#666';
        }

        function escapeHtml(str) {
            return String(str || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }
    </script>
</body>
</html>`;

        function getHealthClass(score: number): string {
            if (score >= 80) return 'health-good';
            if (score >= 50) return 'health-moderate';
            return 'health-poor';
        }

        function getTotalIssues(bySeverity: Record<IssueSeverity, number>): number {
            return Object.values(bySeverity).reduce((sum, count) => sum + count, 0);
        }

        function renderSeverityBar(bySeverity: Record<IssueSeverity, number>): string {
            const total = getTotalIssues(bySeverity);
            if (total === 0) return '';

            const segments = [
                { class: 'severity-info', count: bySeverity[IssueSeverity.Info] || 0 },
                { class: 'severity-warning', count: bySeverity[IssueSeverity.Warning] || 0 },
                { class: 'severity-error', count: bySeverity[IssueSeverity.Error] || 0 },
                { class: 'severity-critical', count: bySeverity[IssueSeverity.Critical] || 0 }
            ];

            return segments
                .filter(s => s.count > 0)
                .map(s => `<div class="issue-segment ${s.class}" style="width: ${(s.count / total) * 100}%"></div>`)
                .join('');
        }

        function renderHotspots(hotspots: DashboardData['hotspots']): string {
            if (hotspots.length === 0) {
                return '<div class="empty-state">No hotspots detected</div>';
            }

            return hotspots.map(h => `
                <div class="hotspot-item" data-path="${h.path}">
                    <div class="hotspot-icon" style="background: ${getSeverityColor(h.severity)}">!</div>
                    <div class="hotspot-info">
                        <div class="hotspot-path">${h.path.split(/[\\/]/).pop()}</div>
                        <div class="hotspot-reason">${h.reason}</div>
                    </div>
                </div>
            `).join('');
        }

        function renderTasks(tasks: DashboardData['upcomingTasks']): string {
            if (tasks.length === 0) {
                return '<div class="empty-state">No pending tasks</div>';
            }

            return tasks.map(t => `
                <div class="task-item" data-task-id="${t.id}">
                    <div class="task-priority priority-${t.priority}"></div>
                    <div class="task-title">${t.title}</div>
                    <div class="task-type">${t.type}</div>
                </div>
            `).join('');
        }

        function renderSuggestions(suggestions: DashboardData['taskSuggestions']): string {
            if (!suggestions || suggestions.length === 0) {
                return '<div class="empty-state">No task suggestions</div>';
            }

            const top = suggestions.slice(0, 20);

            const rows = top.map(s => `
                <div class="suggestion-item">
                    <div class="suggestion-main">
                        <div class="suggestion-title">${escapeHtml(s.task.title)}</div>
                        <div class="suggestion-meta">${escapeHtml(s.task.type)} · ${s.task.estimatedMinutes} min · P${s.task.priority}</div>
                    </div>
                    <div class="suggestion-buttons">
                        <button class="suggestion-accept" data-suggestion-id="${escapeHtml(s.id)}">Accept</button>
                        <button class="suggestion-dismiss" data-suggestion-id="${escapeHtml(s.id)}">Decline</button>
                    </div>
                </div>
            `).join('');

            const more = suggestions.length > top.length
                ? `<div class="empty-state">Showing top ${top.length} of ${suggestions.length} suggestions</div>`
                : '';

            return rows + more;
        }

        function escapeHtml(value: unknown): string {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function getSeverityColor(severity: IssueSeverity): string {
            const colors: Record<IssueSeverity, string> = {
                [IssueSeverity.Info]: '#2196f3',
                [IssueSeverity.Warning]: '#ff9800',
                [IssueSeverity.Error]: '#f44336',
                [IssueSeverity.Critical]: '#9c27b0'
            };
            return colors[severity] || '#666';
        }
    }
}
