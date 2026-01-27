import * as vscode from 'vscode';
import { AgentOrchestrator } from './agents/orchestrator';
import { NLTaskCreationAgent } from './agents/nlTaskCreationAgent';
import { TaskManager } from './tasks/taskManager';
import { CalendarProvider } from './views/calendarProvider';
import { DashboardProvider } from './views/dashboardProvider';
import { TaskPanelProvider } from './views/taskPanelProvider';
import { CodeHealthProvider } from './views/codeHealthProvider';
import { InlineAnnotationController } from './annotations/inlineAnnotations';
import { AnalysisCache } from './cache/analysisCache';
import { AIServiceFactory } from './ai/aiServiceFactory';
import { ConfigManager } from './config/configManager';
import { SuggestionManager } from './suggestions/suggestionManager';
import { TaskPriority } from './types';

let orchestrator: AgentOrchestrator;
let taskManager: TaskManager;
let annotationController: InlineAnnotationController;
let analysisCache: AnalysisCache;
let suggestionManager: SuggestionManager;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('CodeReviewer AI is activating...');

    // Initialize core services
    const configManager = new ConfigManager();
    const aiService = AIServiceFactory.create(configManager);
    let currentWorkspaceKey = getWorkspaceKey();
    // Use workspaceState so analysis/tasks are scoped per workspace (project) by default.
    analysisCache = new AnalysisCache(context.workspaceState, currentWorkspaceKey);
    taskManager = new TaskManager(context.workspaceState);
    suggestionManager = new SuggestionManager(context.workspaceState, currentWorkspaceKey);

    // Initialize agent orchestrator
    orchestrator = new AgentOrchestrator(aiService, analysisCache, taskManager);

    // Initialize UI providers
    const dashboardProvider = new DashboardProvider(context.extensionUri, taskManager, analysisCache, suggestionManager);
    const calendarProvider = new CalendarProvider(context.extensionUri, taskManager);
    const taskPanelProvider = new TaskPanelProvider(context.extensionUri, taskManager, suggestionManager);
    const codeHealthProvider = new CodeHealthProvider(analysisCache);
    annotationController = new InlineAnnotationController(analysisCache);

    const switchWorkspaceScope = (): void => {
        const nextKey = getWorkspaceKey();
        if (nextKey === currentWorkspaceKey) return;

        currentWorkspaceKey = nextKey;
        analysisCache = new AnalysisCache(context.workspaceState, currentWorkspaceKey);
        suggestionManager = new SuggestionManager(context.workspaceState, currentWorkspaceKey);

        orchestrator.setAnalysisCache(analysisCache);
        dashboardProvider.setAnalysisCache(analysisCache);
        dashboardProvider.setSuggestionManager(suggestionManager);
        codeHealthProvider.setAnalysisCache(analysisCache);
        annotationController.setAnalysisCache(analysisCache);
        taskPanelProvider.setSuggestionManager(suggestionManager);
    };

    // Register webview providers
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('codeReviewer.dashboard', dashboardProvider),
        vscode.window.registerWebviewViewProvider('codeReviewer.tasks', taskPanelProvider),
        vscode.window.registerWebviewViewProvider('codeReviewer.calendar', calendarProvider)
    );

    // Register tree data providers
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('codeReviewer.codeHealth', codeHealthProvider)
    );

    // Register commands
    registerCommands(context, orchestrator, taskManager, dashboardProvider, calendarProvider, taskPanelProvider, configManager, suggestionManager);

    // Setup file watchers for auto-analysis
    setupFileWatchers(context, orchestrator, configManager);

    // Initialize inline annotations
    if (configManager.get<boolean>('inlineAnnotations')) {
        annotationController.activate(context);
    }

    // If we were activated before workspace folders were ready (or the user opens/changing folders),
    // re-scope analysis state so issues don't bleed across projects.
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => switchWorkspaceScope())
    );

    // In some startup sequences (especially starting with an empty window, or slow folder restore),
    // workspaceFolders can become available after activation without a folder-change event.
    // Poll briefly to ensure we leave "global" scope once the workspace is known.
    let attempts = 0;
    const interval = setInterval(() => {
        attempts++;
        switchWorkspaceScope();
        if (attempts >= 10) {
            clearInterval(interval);
        }
    }, 500);
    context.subscriptions.push(new vscode.Disposable(() => clearInterval(interval)));

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('codeReviewer')) {
                handleConfigChange(configManager, annotationController, context);
            }
        })
    );

    console.log('CodeReviewer AI activated successfully');
}

function registerCommands(
    context: vscode.ExtensionContext,
    orchestrator: AgentOrchestrator,
    taskManager: TaskManager,
    dashboardProvider: DashboardProvider,
    calendarProvider: CalendarProvider,
    taskPanelProvider: TaskPanelProvider,
    configManager: ConfigManager,
    suggestionManager: SuggestionManager
): void {
    // Analysis commands
    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.analyzeFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active file to analyze');
                return;
            }
            await analyzeFileWithProgress(editor.document.uri, orchestrator, dashboardProvider);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.analyzeWorkspace', async () => {
            await analyzeWorkspaceWithProgress(orchestrator, dashboardProvider);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.summarizeFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active file to summarize');
                return;
            }
            await summarizeFileWithProgress(editor.document, orchestrator);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.summarizeWorkspace', async () => {
            await summarizeWorkspaceWithProgress(orchestrator, dashboardProvider);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.generateRefactorPlan', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active file for refactor planning');
                return;
            }
            await generateRefactorPlanWithProgress(editor.document, orchestrator);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.generateTests', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showWarningMessage('Select code to generate tests');
                return;
            }
            const selectedText = editor.document.getText(editor.selection);
            await generateTestsWithProgress(editor.document, selectedText, orchestrator);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.scheduleModuleFixes', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active file');
                return;
            }
            await scheduleModuleFixesWithProgress(editor.document.uri, orchestrator, taskManager);
        })
    );

    // View commands
    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.openCalendar', () => {
            vscode.commands.executeCommand('codeReviewer.calendar.focus');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.openDashboard', () => {
            vscode.commands.executeCommand('codeReviewer.dashboard.focus');
        })
    );

    // Configuration command
    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.configureAI', async () => {
            await configureAIProvider();
        })
    );

    // Task management commands
    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.completeTask', async (taskId: string) => {
            await taskManager.completeTask(taskId);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.rescheduleTask', async (taskId: string, newDate: Date) => {
            await taskManager.rescheduleTask(taskId, newDate);
        })
    );

    // Natural language task creation
    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.createTaskFromDescription', async () => {
            await createTaskFromNaturalLanguage(configManager, suggestionManager, taskManager);
        })
    );

    // Task grouping commands
    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.groupTasksByType', () => {
            taskPanelProvider.setGroupMode('type');
            vscode.window.showInformationMessage('Tasks grouped by type');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.groupTasksByStatus', () => {
            taskPanelProvider.setGroupMode('status');
            vscode.window.showInformationMessage('Tasks grouped by status');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.groupTasksByPriority', () => {
            taskPanelProvider.setGroupMode('priority');
            vscode.window.showInformationMessage('Tasks grouped by priority');
        })
    );

    // Priority filter commands
    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.filterTasks', async () => {
            const currentFilter = taskPanelProvider.getPriorityFilter();
            const options: vscode.QuickPickItem[] = [
                { label: `${currentFilter.showCritical ? '$(check)' : '$(circle-outline)'} Critical`, description: 'Show critical priority tasks', picked: currentFilter.showCritical },
                { label: `${currentFilter.showHigh ? '$(check)' : '$(circle-outline)'} High`, description: 'Show high priority tasks', picked: currentFilter.showHigh },
                { label: `${currentFilter.showMedium ? '$(check)' : '$(circle-outline)'} Medium`, description: 'Show medium priority tasks', picked: currentFilter.showMedium },
                { label: `${currentFilter.showLow ? '$(check)' : '$(circle-outline)'} Low`, description: 'Show low priority tasks', picked: currentFilter.showLow }
            ];

            const selected = await vscode.window.showQuickPick(options, {
                canPickMany: true,
                placeHolder: 'Select priority levels to show'
            });

            if (selected) {
                taskPanelProvider.setPriorityFilter({
                    showCritical: selected.some(s => s.label.includes('Critical')),
                    showHigh: selected.some(s => s.label.includes('High')),
                    showMedium: selected.some(s => s.label.includes('Medium')),
                    showLow: selected.some(s => s.label.includes('Low'))
                });
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.showOnlyHighPriority', () => {
            taskPanelProvider.setPriorityFilter({
                showCritical: true,
                showHigh: true,
                showMedium: false,
                showLow: false
            });
            vscode.window.showInformationMessage('Showing only high and critical priority tasks');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.showAllPriorities', () => {
            taskPanelProvider.setPriorityFilter({
                showCritical: true,
                showHigh: true,
                showMedium: true,
                showLow: true
            });
            vscode.window.showInformationMessage('Showing all priority levels');
        })
    );

    // Suggestion management commands
    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.acceptSuggestion', async (arg: string | { suggestionId?: string }) => {
            // Handle both direct call (suggestionId string) and context menu call (tree item)
            const suggestionId = typeof arg === 'string' ? arg : arg?.suggestionId;
            if (!suggestionId) return;

            const task = await suggestionManager.acceptSuggestion(suggestionId);
            if (task) {
                await taskManager.addTask(task);
                vscode.window.showInformationMessage(`Task "${task.title}" added to your task list`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.dismissSuggestion', async (arg: string | { suggestionId?: string }) => {
            const suggestionId = typeof arg === 'string' ? arg : arg?.suggestionId;
            if (!suggestionId) return;

            await suggestionManager.dismissSuggestion(suggestionId);
            vscode.window.showInformationMessage('Suggestion dismissed');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.acceptAllSuggestions', async () => {
            const tasks = await suggestionManager.acceptAll();
            if (tasks.length > 0) {
                await taskManager.addTasks(tasks);
                vscode.window.showInformationMessage(`Added ${tasks.length} task(s) to your task list`);
            } else {
                vscode.window.showInformationMessage('No suggestions to accept');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codeReviewer.dismissAllSuggestions', async () => {
            await suggestionManager.dismissAll();
            vscode.window.showInformationMessage('All suggestions dismissed');
        })
    );
}

async function analyzeFileWithProgress(
    uri: vscode.Uri,
    orchestrator: AgentOrchestrator,
    dashboardProvider: DashboardProvider
): Promise<void> {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Analyzing file...',
        cancellable: true
    }, async (progress, token) => {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            progress.report({ increment: 20, message: 'Reading file...' });

            dashboardProvider.postAnalysisActivity({
                status: 'running',
                message: 'Analyzing current file...',
                filePath: document.uri.fsPath,
                codePreview: makeCodePreview(document.getText())
            });

            // Clear cached analysis to ensure fresh results
            analysisCache.remove(document.uri.fsPath);
            const result = await orchestrator.analyzeFile(document, token);
            progress.report({ increment: 80, message: 'Analysis complete' });

            progress.report({ increment: 10, message: 'Generating task suggestions...' });
            const suggestedTasks = await orchestrator.createTaskSuggestionsForFileAnalysis(result);
            await suggestionManager.addSuggestions(suggestedTasks, taskManager.getAllTasks());

            if (result.issues.length === 0) {
                vscode.window.showInformationMessage('No issues found in this file');
            } else {
                vscode.window.showInformationMessage(
                    `Found ${result.issues.length} issue(s). Check the sidebar for details.`
                );
            }

            if (suggestedTasks.length > 0) {
                vscode.window.showInformationMessage(
                    `Generated ${suggestedTasks.length} task suggestion(s). Review them in the Calendar.`
                );
            }
        } catch (error) {
            if (error instanceof Error && error.message !== 'Cancelled') {
                vscode.window.showErrorMessage(`Analysis failed: ${error.message}`);
            }
        } finally {
            dashboardProvider.postAnalysisActivity({
                status: 'idle',
                message: 'Idle'
            });
        }
    });
}

async function analyzeWorkspaceWithProgress(
    orchestrator: AgentOrchestrator,
    dashboardProvider: DashboardProvider
): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showWarningMessage('No workspace folder open');
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Analyzing workspace...',
        cancellable: true
    }, async (progress, token) => {
        try {
            dashboardProvider.postAnalysisActivity({
                status: 'running',
                message: 'Analyzing workspace...'
            });

            // Clear cached analyses to avoid mixing with prior results
            analysisCache.clear();
            const result = await orchestrator.analyzeWorkspace(
                workspaceFolders[0].uri,
                progress,
                token,
                (doc, index, total) => {
                    dashboardProvider.postAnalysisActivity({
                        status: 'running',
                        message: `Analyzing ${index}/${total}`,
                        filePath: doc.uri.fsPath,
                        codePreview: makeCodePreview(doc.getText())
                    });
                }
            );

            dashboardProvider.postAnalysisActivity({
                status: 'running',
                message: 'Generating task suggestions...',
                filePath: result.rootPath
            });

            const suggestedTasks = await orchestrator.createTaskSuggestionsForWorkspaceAnalyses(result.fileAnalyses);
            // Prevent UI overload; show the most impactful suggestions first.
            suggestedTasks.sort((a, b) => b.priority - a.priority);
            const capped = suggestedTasks.slice(0, 30);
            await suggestionManager.addSuggestions(capped, taskManager.getAllTasks());

            vscode.window.showInformationMessage(
                `Workspace analysis complete. Found ${result.totalIssues} issue(s) in ${result.filesAnalyzed} files.`
            );

            if (capped.length > 0) {
                vscode.window.showInformationMessage(
                    `Generated ${capped.length} task suggestion(s). Review them in the Calendar.`
                );
            }
        } catch (error) {
            if (error instanceof Error && error.message !== 'Cancelled') {
                vscode.window.showErrorMessage(`Workspace analysis failed: ${error.message}`);
            }
        } finally {
            dashboardProvider.postAnalysisActivity({
                status: 'idle',
                message: 'Idle'
            });
        }
    });
}

function makeCodePreview(code: string): string {
    const lines = code.split('\n');
    const maxLines = 120;
    const preview = lines.slice(0, maxLines);

    const width = String(Math.min(lines.length, maxLines)).length;
    const numbered = preview.map((line, i) => `${String(i + 1).padStart(width, ' ')} | ${line}`);

    if (lines.length > maxLines) {
        numbered.push('...');
    }

    const joined = numbered.join('\n');
    // Keep webview messages reasonable in size.
    return joined.length > 8000 ? `${joined.slice(0, 7999)}...` : joined;
}

async function summarizeFileWithProgress(document: vscode.TextDocument, orchestrator: AgentOrchestrator): Promise<void> {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Generating summary...',
        cancellable: false
    }, async () => {
        try {
            const summary = await orchestrator.summarizeFile(document);

            // Show summary in a new document
            const summaryDoc = await vscode.workspace.openTextDocument({
                content: summary,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(summaryDoc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        } catch (error) {
            vscode.window.showErrorMessage(`Summary generation failed: ${(error as Error).message}`);
        }
    });
}

async function summarizeWorkspaceWithProgress(
    orchestrator: AgentOrchestrator,
    dashboardProvider: DashboardProvider
): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('No workspace folder open');
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Generating workspace summary...',
        cancellable: true
    }, async (progress, token) => {
        try {
            const rootUri = workspaceFolders[0].uri;
            dashboardProvider.postAnalysisActivity({
                status: 'running',
                message: 'Summarizing workspace...'
            });

            const cachedAnalyses = analysisCache.getAll();

            if (cachedAnalyses.size === 0) {
                progress.report({ message: 'No cached analyses found. Analyzing workspace first...' });
                const result = await orchestrator.analyzeWorkspace(
                    rootUri,
                    progress,
                    token,
                    (doc, index, total) => {
                        dashboardProvider.postAnalysisActivity({
                            status: 'running',
                            message: `Analyzing ${index}/${total}`,
                            filePath: doc.uri.fsPath,
                            codePreview: makeCodePreview(doc.getText())
                        });
                    }
                );

                const markdown = orchestrator.formatProjectSummary(result.projectSummary, {
                    rootPath: result.rootPath,
                    analyzedAt: result.analyzedAt,
                    filesAnalyzed: result.filesAnalyzed,
                    totalIssues: result.totalIssues
                });

                const summaryDoc = await vscode.workspace.openTextDocument({
                    content: markdown,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(summaryDoc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
                return;
            }

            let totalIssues = 0;
            let newestAnalysis: Date | undefined;
            for (const analysis of cachedAnalyses.values()) {
                totalIssues += analysis.issues.length;
                if (!newestAnalysis || analysis.analyzedAt > newestAnalysis) {
                    newestAnalysis = analysis.analyzedAt;
                }
            }

            progress.report({ message: `Summarizing ${cachedAnalyses.size} analyzed file(s)...` });

            if (token.isCancellationRequested) {
                throw new Error('Cancelled');
            }

            const projectSummary = await orchestrator.summarizeProject(cachedAnalyses);
            const markdown = orchestrator.formatProjectSummary(projectSummary, {
                rootPath: rootUri.fsPath,
                analyzedAt: newestAnalysis,
                filesAnalyzed: cachedAnalyses.size,
                totalIssues
            });

            const summaryDoc = await vscode.workspace.openTextDocument({
                content: markdown,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(summaryDoc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        } catch (error) {
            if (error instanceof Error && error.message !== 'Cancelled') {
                vscode.window.showErrorMessage(`Workspace summary failed: ${error.message}`);
            }
        } finally {
            dashboardProvider.postAnalysisActivity({
                status: 'idle',
                message: 'Idle'
            });
        }
    });
}

async function generateRefactorPlanWithProgress(document: vscode.TextDocument, orchestrator: AgentOrchestrator): Promise<void> {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Generating refactor plan...',
        cancellable: false
    }, async () => {
        try {
            const plan = await orchestrator.generateRefactorPlan(document);

            const planDoc = await vscode.workspace.openTextDocument({
                content: plan,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(planDoc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        } catch (error) {
            vscode.window.showErrorMessage(`Refactor plan generation failed: ${(error as Error).message}`);
        }
    });
}

async function generateTestsWithProgress(
    document: vscode.TextDocument,
    selectedCode: string,
    orchestrator: AgentOrchestrator
): Promise<void> {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Generating tests...',
        cancellable: false
    }, async () => {
        try {
            const tests = await orchestrator.generateTests(document, selectedCode);

            const testDoc = await vscode.workspace.openTextDocument({
                content: tests,
                language: document.languageId
            });
            await vscode.window.showTextDocument(testDoc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        } catch (error) {
            vscode.window.showErrorMessage(`Test generation failed: ${(error as Error).message}`);
        }
    });
}

async function scheduleModuleFixesWithProgress(
    uri: vscode.Uri,
    orchestrator: AgentOrchestrator,
    taskManager: TaskManager
): Promise<void> {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Scheduling fixes...',
        cancellable: false
    }, async () => {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const tasks = await orchestrator.extractTasks(document);

            for (const task of tasks) {
                await taskManager.addTask(task);
            }

            vscode.window.showInformationMessage(
                `Scheduled ${tasks.length} task(s). Open the calendar to view.`
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Scheduling failed: ${(error as Error).message}`);
        }
    });
}

async function configureAIProvider(): Promise<void> {
    const provider = await vscode.window.showQuickPick(
        ['anthropic', 'openai', 'azure', 'ollama', 'custom'],
        { placeHolder: 'Select AI provider' }
    );

    if (!provider) return;

    const apiKey = await vscode.window.showInputBox({
        prompt: 'Enter API key',
        password: true,
        ignoreFocusOut: true
    });

    if (apiKey) {
        const config = vscode.workspace.getConfiguration('codeReviewer');
        await config.update('aiProvider', provider, vscode.ConfigurationTarget.Global);
        await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);

        // If the currently selected model is clearly incompatible with the provider, clear it so
        // the provider default is used (prevents e.g. OpenAI using a Claude model name).
        const currentModel = (config.get<string>('model') || '').trim().toLowerCase();
        const looksLikeClaude = currentModel.includes('claude');
        const looksLikeOpenAI = currentModel.startsWith('gpt-') || currentModel.startsWith('o1') || currentModel.startsWith('o3') || currentModel.includes('chatgpt');

        const mismatch =
            (provider !== 'anthropic' && looksLikeClaude) ||
            (provider === 'anthropic' && looksLikeOpenAI);

        if (mismatch) {
            await config.update('model', '', vscode.ConfigurationTarget.Global);
        }

        vscode.window.showInformationMessage('AI provider configured successfully');
    }
}

function setupFileWatchers(
    context: vscode.ExtensionContext,
    orchestrator: AgentOrchestrator,
    configManager: ConfigManager
): void {
    if (!configManager.get<boolean>('autoAnalyze')) return;

    const watcher = vscode.workspace.onDidSaveTextDocument(async (document) => {
        const excludePatterns = configManager.get<string[]>('excludePatterns') || [];
        const relativePath = vscode.workspace.asRelativePath(document.uri);

        // Check if file should be excluded
        const shouldExclude = excludePatterns.some(pattern => {
            const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
            return regex.test(relativePath);
        });

        if (!shouldExclude && isSupportedLanguage(document.languageId)) {
            // Debounced analysis on save
            await orchestrator.analyzeFileIncremental(document);
        }
    });

    context.subscriptions.push(watcher);
}

function getWorkspaceKey(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return 'global';
    }
    if (folders.length === 1) {
        return folders[0].uri.fsPath;
    }
    return folders
        .map(folder => folder.uri.fsPath)
        .sort()
        .join('|');
}

function isSupportedLanguage(languageId: string): boolean {
    const supported = [
        'typescript', 'javascript', 'typescriptreact', 'javascriptreact',
        'python', 'java', 'csharp', 'go', 'rust', 'cpp', 'c',
        'ruby', 'php', 'swift', 'kotlin'
    ];
    return supported.includes(languageId);
}

function handleConfigChange(
    configManager: ConfigManager,
    annotationController: InlineAnnotationController,
    context: vscode.ExtensionContext
): void {
    configManager.reload();

    if (configManager.get<boolean>('inlineAnnotations')) {
        annotationController.activate(context);
    } else {
        annotationController.deactivate();
    }
}

async function createTaskFromNaturalLanguage(
    configManager: ConfigManager,
    suggestionManager: SuggestionManager,
    taskManager: TaskManager
): Promise<void> {
    // Get description from user
    const description = await vscode.window.showInputBox({
        prompt: 'Describe the feature, improvement, or task you want to create',
        placeHolder: 'e.g., "Add user authentication with JWT tokens and refresh token support"',
        ignoreFocusOut: true
    });

    if (!description || description.trim() === '') {
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Creating tasks from description...',
        cancellable: false
    }, async (progress) => {
        try {
            progress.report({ message: 'Analyzing description with AI...' });

            const aiService = AIServiceFactory.create(configManager);
            const nlAgent = new NLTaskCreationAgent(aiService);

            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const tasks = await nlAgent.createTasksFromDescription(description, workspaceRoot);

            if (tasks.length === 0) {
                vscode.window.showWarningMessage('No tasks could be generated from the description. Try being more specific.');
                return;
            }

            progress.report({ message: 'Adding to suggestions...' });

            // Add tasks to suggestions for user review
            await suggestionManager.addSuggestions(tasks, taskManager.getAllTasks());

            // Show preview of generated tasks
            const summary = nlAgent.formatTaskSummary(tasks);
            const summaryDoc = await vscode.workspace.openTextDocument({
                content: summary,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(summaryDoc, { preview: true, viewColumn: vscode.ViewColumn.Beside });

            vscode.window.showInformationMessage(
                `Generated ${tasks.length} task suggestion(s). Review them in the Tasks panel under "Suggestions".`
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create tasks: ${(error as Error).message}`);
        }
    });
}

export function deactivate(): void {
    if (annotationController) {
        annotationController.deactivate();
    }
    console.log('CodeReviewer AI deactivated');
}
