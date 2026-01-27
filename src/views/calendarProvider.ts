import * as vscode from 'vscode';
import { TaskManager } from '../tasks/taskManager';
import { Task, TaskStatus, TaskType, CalendarEvent } from '../types';

/**
 * CalendarProvider renders an interactive calendar view for task scheduling.
 * Shows accepted/scheduled tasks.
 */
export class CalendarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codeReviewer.calendar';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly taskManager: TaskManager
    ) {
        // Listen for task changes
        taskManager.onTasksChanged(() => {
            this.updateView();
        });
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

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'reschedule':
                    await this.taskManager.rescheduleTask(
                        message.taskId,
                        new Date(message.newDate)
                    );
                    break;

                case 'complete':
                    await this.taskManager.completeTask(message.taskId);
                    break;

                case 'openTask':
                    this.openTaskDetails(message.taskId);
                    break;

                case 'refresh':
                    this.updateView();
                    break;

                case 'changeView':
                    // View mode changed (day/week/month)
                    break;
            }
        });
    }

    private updateView(): void {
        if (!this._view) return;

        const events = this.taskManager.toCalendarEvents();
        this._view.webview.postMessage({
            command: 'updateEvents',
            events: events.map(e => ({
                ...e,
                start: e.start.toISOString(),
                end: e.end.toISOString()
            }))
        });
    }

    private openTaskDetails(taskId: string): void {
        const task = this.taskManager.getTask(taskId);
        if (!task) return;

        // Open file with issue
        if (task.affectedFiles.length > 0) {
            const fileUri = vscode.Uri.file(task.affectedFiles[0]);
            vscode.window.showTextDocument(fileUri);
        }
    }

    private getHtmlContent(webview: vscode.Webview): string {
        const events = this.taskManager.toCalendarEvents();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';">
    <title>Calendar</title>
    <style>
        :root {
            --bg-primary: var(--vscode-editor-background);
            --bg-secondary: var(--vscode-sideBar-background);
            --text-primary: var(--vscode-editor-foreground);
            --text-secondary: var(--vscode-descriptionForeground);
            --border-color: var(--vscode-panel-border);
            --accent-color: var(--vscode-button-background);
            --hover-bg: var(--vscode-list-hoverBackground);
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
            padding: 10px;
        }

        .calendar-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            margin-bottom: 10px;
        }

        .nav-buttons {
            display: flex;
            gap: 5px;
        }

        .nav-btn, .view-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 12px;
        }

        .nav-btn:hover, .view-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .view-btn.active {
            background: var(--accent-color);
            color: var(--vscode-button-foreground);
        }

        .current-period {
            font-weight: bold;
            font-size: 14px;
        }

        .view-toggle {
            display: flex;
            gap: 3px;
        }

        .calendar-grid {
            display: grid;
            gap: 1px;
            background: var(--border-color);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            overflow: hidden;
        }

        .week-view {
            grid-template-columns: 50px repeat(7, 1fr);
        }

        .day-header {
            background: var(--bg-secondary);
            padding: 6px;
            text-align: center;
            font-size: 11px;
            font-weight: 500;
        }

        .time-slot {
            background: var(--bg-primary);
            min-height: 40px;
            padding: 2px;
            position: relative;
        }

        .time-label {
            background: var(--bg-secondary);
            padding: 4px;
            font-size: 10px;
            color: var(--text-secondary);
            text-align: right;
        }

        .event {
            background: var(--accent-color);
            color: var(--vscode-button-foreground);
            padding: 3px 5px;
            margin: 1px;
            border-radius: 2px;
            font-size: 10px;
            cursor: pointer;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .event:hover {
            opacity: 0.9;
        }

        .event.completed {
            opacity: 0.5;
            text-decoration: line-through;
        }

        .event.refactor { background: #4a9eff; }
        .event.test { background: #4caf50; }
        .event.expand { background: #ff9800; }
        .event.documentation { background: #9c27b0; }
        .event.security { background: #f44336; }
        .event.performance { background: #ff5722; }
        .event.bugfix { background: #e91e63; }

        .today {
            background: var(--hover-bg);
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--text-secondary);
        }

        .empty-state h3 {
            margin-bottom: 10px;
        }

        .task-list {
            margin-top: 15px;
        }

        .task-list h4 {
            margin-bottom: 8px;
            font-size: 12px;
            color: var(--text-secondary);
        }

        .task-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px;
            background: var(--bg-secondary);
            border-radius: 3px;
            margin-bottom: 4px;
            cursor: pointer;
        }

        .task-item:hover {
            background: var(--hover-bg);
        }

        .task-priority {
            width: 4px;
            height: 20px;
            border-radius: 2px;
        }

        .priority-1 { background: #4caf50; }
        .priority-2 { background: #ff9800; }
        .priority-3 { background: #f44336; }
        .priority-4 { background: #9c27b0; }

        .task-info {
            flex: 1;
            overflow: hidden;
        }

        .task-title {
            font-size: 11px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .task-time {
            font-size: 10px;
            color: var(--text-secondary);
        }

        .task-actions {
            display: flex;
            gap: 4px;
        }

        .task-btn {
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: 2px;
            font-size: 12px;
        }

        .task-btn:hover {
            color: var(--text-primary);
        }
    </style>
</head>
<body>
    <div class="calendar-header">
        <div class="nav-buttons">
            <button class="nav-btn" id="prevBtn">&lt;</button>
            <button class="nav-btn" id="todayBtn">Today</button>
            <button class="nav-btn" id="nextBtn">&gt;</button>
        </div>
        <span class="current-period" id="currentPeriod"></span>
        <div class="view-toggle">
            <button class="view-btn active" data-view="week">Week</button>
            <button class="view-btn" data-view="day">Day</button>
        </div>
    </div>

    <div id="calendarContainer"></div>

    <div class="task-list">
        <h4>Upcoming Tasks</h4>
        <div id="taskList"></div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentDate = new Date();
        let currentView = 'week';
        let events = ${JSON.stringify(events.map(e => ({
            ...e,
            start: e.start.toISOString(),
            end: e.end.toISOString()
        })))};

        function renderCalendar() {
            const container = document.getElementById('calendarContainer');
            const periodLabel = document.getElementById('currentPeriod');

            if (currentView === 'week') {
                renderWeekView(container, periodLabel);
            } else {
                renderDayView(container, periodLabel);
            }

            renderTaskList();
        }

        function renderWeekView(container, periodLabel) {
            const weekStart = getWeekStart(currentDate);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);

            periodLabel.textContent = formatDateRange(weekStart, weekEnd);

            const days = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const hours = Array.from({ length: 10 }, (_, i) => i + 8); // 8 AM to 5 PM

            let html = '<div class="calendar-grid week-view">';

            // Header row
            for (let i = 0; i <= 7; i++) {
                if (i === 0) {
                    html += '<div class="day-header"></div>';
                } else {
                    const date = new Date(weekStart);
                    date.setDate(date.getDate() + i - 1);
                    const isToday = isSameDay(date, new Date());
                    html += '<div class="day-header' + (isToday ? ' today' : '') + '">' +
                        days[date.getDay()] + ' ' + date.getDate() + '</div>';
                }
            }

            // Time slots
            for (const hour of hours) {
                html += '<div class="time-label">' + formatHour(hour) + '</div>';

                for (let day = 0; day < 7; day++) {
                    const slotDate = new Date(weekStart);
                    slotDate.setDate(slotDate.getDate() + day);
                    slotDate.setHours(hour, 0, 0, 0);

                    const slotEvents = getEventsForSlot(slotDate);
                    const isToday = isSameDay(slotDate, new Date());

                    html += '<div class="time-slot' + (isToday ? ' today' : '') + '">';
                    for (const event of slotEvents) {
                        html += renderEvent(event);
                    }
                    html += '</div>';
                }
            }

            html += '</div>';
            container.innerHTML = html;
        }

        function renderDayView(container, periodLabel) {
            periodLabel.textContent = formatDate(currentDate);

            const hours = Array.from({ length: 10 }, (_, i) => i + 8);

            let html = '<div class="calendar-grid" style="grid-template-columns: 50px 1fr;">';

            html += '<div class="day-header"></div>';
            html += '<div class="day-header">' + formatDate(currentDate) + '</div>';

            for (const hour of hours) {
                html += '<div class="time-label">' + formatHour(hour) + '</div>';

                const slotDate = new Date(currentDate);
                slotDate.setHours(hour, 0, 0, 0);

                const slotEvents = getEventsForSlot(slotDate);

                html += '<div class="time-slot">';
                for (const event of slotEvents) {
                    html += renderEvent(event);
                }
                html += '</div>';
            }

            html += '</div>';
            container.innerHTML = html;
        }

        function renderEvent(event) {
            const typeClass = event.type.toLowerCase().replace('_', '');
            const completedClass = event.isCompleted ? 'completed' : '';
            return '<div class="event ' + typeClass + ' ' + completedClass + '" ' +
                'onclick="openTask(\\'' + event.taskId + '\\')" ' +
                'title="' + event.title + '">' +
                event.title + '</div>';
        }

        function renderTaskList() {
            const container = document.getElementById('taskList');
            const upcoming = events
                .filter(e => !e.isCompleted && new Date(e.start) >= new Date())
                .sort((a, b) => new Date(a.start) - new Date(b.start))
                .slice(0, 5);

            if (upcoming.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>No upcoming tasks scheduled.</p></div>';
                return;
            }

            let html = '';
            for (const event of upcoming) {
                html += '<div class="task-item" onclick="openTask(\\'' + event.taskId + '\\')">' +
                    '<div class="task-priority priority-' + event.priority + '"></div>' +
                    '<div class="task-info">' +
                    '<div class="task-title">' + event.title + '</div>' +
                    '<div class="task-time">' + formatDateTime(new Date(event.start)) + '</div>' +
                    '</div>' +
                    '<div class="task-actions">' +
                    '<button class="task-btn" onclick="event.stopPropagation(); completeTask(\\'' + event.taskId + '\\')">✓</button>' +
                    '</div>' +
                    '</div>';
            }

            container.innerHTML = html;
        }

        function getEventsForSlot(slotDate) {
            const slotEnd = new Date(slotDate);
            slotEnd.setHours(slotEnd.getHours() + 1);

            return events.filter(e => {
                const start = new Date(e.start);
                return start >= slotDate && start < slotEnd;
            });
        }

        function getWeekStart(date) {
            const d = new Date(date);
            const day = d.getDay();
            d.setDate(d.getDate() - day);
            d.setHours(0, 0, 0, 0);
            return d;
        }

        function isSameDay(a, b) {
            return a.getFullYear() === b.getFullYear() &&
                a.getMonth() === b.getMonth() &&
                a.getDate() === b.getDate();
        }

        function formatHour(hour) {
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const h = hour % 12 || 12;
            return h + ' ' + ampm;
        }

        function formatDate(date) {
            return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        }

        function formatDateRange(start, end) {
            const opts = { month: 'short', day: 'numeric' };
            return start.toLocaleDateString('en-US', opts) + ' - ' + end.toLocaleDateString('en-US', opts);
        }

        function formatDateTime(date) {
            return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
                ' at ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        }

        function openTask(taskId) {
            vscode.postMessage({ command: 'openTask', taskId });
        }

        function completeTask(taskId) {
            vscode.postMessage({ command: 'complete', taskId });
        }

        // Navigation
        document.getElementById('prevBtn').onclick = () => {
            if (currentView === 'week') {
                currentDate.setDate(currentDate.getDate() - 7);
            } else {
                currentDate.setDate(currentDate.getDate() - 1);
            }
            renderCalendar();
        };

        document.getElementById('nextBtn').onclick = () => {
            if (currentView === 'week') {
                currentDate.setDate(currentDate.getDate() + 7);
            } else {
                currentDate.setDate(currentDate.getDate() + 1);
            }
            renderCalendar();
        };

        document.getElementById('todayBtn').onclick = () => {
            currentDate = new Date();
            renderCalendar();
        };

        // View toggle
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentView = btn.dataset.view;
                renderCalendar();
            };
        });

        // Message handler
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateEvents') {
                events = message.events;
                renderCalendar();
            }
        });

        // Initial render
        renderCalendar();
    </script>
</body>
</html>`;
    }
}
