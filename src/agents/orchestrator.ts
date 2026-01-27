import * as vscode from 'vscode';
import { AIProvider } from '../ai/aiServiceFactory';
import { AnalysisCache } from '../cache/analysisCache';
import { TaskManager } from '../tasks/taskManager';
import { CodeAnalysisAgent } from './codeAnalysisAgent';
import { RefactorPlanningAgent } from './refactorPlanningAgent';
import { TestGenerationAgent } from './testGenerationAgent';
import { TaskPlanningAgent } from './taskPlanningAgent';
import { SchedulingAgent } from './schedulingAgent';
import { SmartFileFilter, FileRelevance } from '../utils/fileFilter';
import {
    FileAnalysis,
    WorkspaceAnalysis,
    Task,
    AgentContext,
    CodeIssue,
    ProjectSummary
} from '../types';

/**
 * AgentOrchestrator coordinates the multi-agent system.
 *
 * Data Flow:
 * 1. User triggers analysis -> CodeAnalysisAgent identifies issues
 * 2. Issues flow to TaskPlanningAgent -> Creates structured tasks
 * 3. Tasks flow to SchedulingAgent -> Assigns time slots
 * 4. RefactorPlanningAgent provides detailed plans on demand
 * 5. TestGenerationAgent creates tests on demand
 *
 * Context is shared between agents via AgentContext to avoid redundant work.
 */
export class AgentOrchestrator {
    private codeAnalysisAgent: CodeAnalysisAgent;
    private refactorPlanningAgent: RefactorPlanningAgent;
    private testGenerationAgent: TestGenerationAgent;
    private taskPlanningAgent: TaskPlanningAgent;
    private schedulingAgent: SchedulingAgent;

    private analysisQueue: Map<string, Promise<FileAnalysis>> = new Map();
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor(
        private aiService: AIProvider,
        private analysisCache: AnalysisCache,
        private taskManager: TaskManager
    ) {
        this.codeAnalysisAgent = new CodeAnalysisAgent(aiService);
        this.refactorPlanningAgent = new RefactorPlanningAgent(aiService);
        this.testGenerationAgent = new TestGenerationAgent(aiService);
        this.taskPlanningAgent = new TaskPlanningAgent(aiService);
        this.schedulingAgent = new SchedulingAgent();
    }

    /**
     * Swap the analysis cache when the active workspace/project changes.
     * This prevents issues from one project bleeding into another.
     */
    setAnalysisCache(cache: AnalysisCache): void {
        this.analysisCache = cache;

        // Cancel any queued work keyed by old file paths and clear debouncers.
        this.analysisQueue.clear();
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
    }

    /**
     * Analyze a single file and cache results
     */
    async analyzeFile(
        document: vscode.TextDocument,
        token?: vscode.CancellationToken
    ): Promise<FileAnalysis> {
        const filePath = document.uri.fsPath;

        // Check cache first
        const cached = this.analysisCache.get(filePath);
        if (cached && !this.isStale(cached)) {
            return cached;
        }

        // Check if analysis is already in progress
        const inProgress = this.analysisQueue.get(filePath);
        if (inProgress) {
            return inProgress;
        }

        // Start new analysis
        const analysisPromise = this.performFileAnalysis(document, token);
        this.analysisQueue.set(filePath, analysisPromise);

        try {
            const result = await analysisPromise;
            this.analysisCache.set(filePath, result);
            return result;
        } finally {
            this.analysisQueue.delete(filePath);
        }
    }

    /**
     * Incremental analysis for file saves (debounced)
     */
    async analyzeFileIncremental(document: vscode.TextDocument): Promise<void> {
        const filePath = document.uri.fsPath;

        // Clear existing timer
        const existingTimer = this.debounceTimers.get(filePath);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Debounce analysis
        const timer = setTimeout(async () => {
            try {
                await this.analyzeFile(document);
                this.debounceTimers.delete(filePath);
            } catch (error) {
                console.error(`Incremental analysis failed for ${filePath}:`, error);
            }
        }, 1000);

        this.debounceTimers.set(filePath, timer);
    }

    /**
     * Analyze entire workspace
     */
    async analyzeWorkspace(
        rootUri: vscode.Uri,
        progress: vscode.Progress<{ increment?: number; message?: string }>,
        token: vscode.CancellationToken,
        onFile?: (document: vscode.TextDocument, index: number, total: number) => void
    ): Promise<WorkspaceAnalysis> {
        const startTime = Date.now();
        const fileAnalyses = new Map<string, FileAnalysis>();
        let totalIssues = 0;

        // Find all relevant files
        const files = await this.findAnalyzableFiles(rootUri);
        const totalFiles = files.length;

        progress.report({ message: `Found ${totalFiles} files to analyze` });

        // Analyze files in batches
        const batchSize = 5;
        for (let i = 0; i < files.length; i += batchSize) {
            if (token.isCancellationRequested) {
                throw new Error('Cancelled');
            }

            const batch = files.slice(i, i + batchSize);
            const batchPromises = batch.map(async (uri, j) => {
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const index = i + j + 1;
                    if (onFile) {
                        try {
                            onFile(doc, index, totalFiles);
                        } catch {
                            // Ignore visualization callback failures
                        }
                    }
                    return this.analyzeFile(doc, token);
                } catch (error) {
                    console.error(`Failed to analyze ${uri.fsPath}:`, error);
                    return null;
                }
            });

            const results = await Promise.all(batchPromises);

            for (const result of results) {
                if (result) {
                    fileAnalyses.set(result.filePath, result);
                    totalIssues += result.issues.length;
                }
            }

            const progressPercent = Math.round(((i + batch.length) / totalFiles) * 100);
            progress.report({
                increment: (batch.length / totalFiles) * 100,
                message: `Analyzed ${i + batch.length}/${totalFiles} files (${progressPercent}%)`
            });
        }

        // Generate project-level summary
        const projectSummary = await this.codeAnalysisAgent.summarizeProject(fileAnalyses);

        const healthScore = this.calculateHealthScore(fileAnalyses);

        return {
            rootPath: rootUri.fsPath,
            analyzedAt: new Date(),
            filesAnalyzed: fileAnalyses.size,
            totalIssues,
            fileAnalyses,
            projectSummary,
            healthScore
        };
    }

    /**
     * Generate a summary for a single file
     */
    async summarizeFile(document: vscode.TextDocument): Promise<string> {
        const analysis = await this.analyzeFile(document);
        return this.codeAnalysisAgent.formatSummary(analysis);
    }

    /**
     * Generate a project-level summary from existing analyses
     */
    async summarizeProject(fileAnalyses: Map<string, FileAnalysis>): Promise<ProjectSummary> {
        return this.codeAnalysisAgent.summarizeProject(fileAnalyses);
    }

    /**
     * Format a project summary as readable markdown
     */
    formatProjectSummary(
        summary: ProjectSummary,
        options?: { rootPath?: string; analyzedAt?: Date; filesAnalyzed?: number; totalIssues?: number }
    ): string {
        return this.codeAnalysisAgent.formatProjectSummary(summary, options);
    }

    /**
     * Generate a detailed refactoring plan
     */
    async generateRefactorPlan(document: vscode.TextDocument): Promise<string> {
        const analysis = await this.analyzeFile(document);
        const plan = await this.refactorPlanningAgent.createPlan(document, analysis);
        return this.refactorPlanningAgent.formatPlan(plan);
    }

    /**
     * Generate tests for selected code
     */
    async generateTests(
        document: vscode.TextDocument,
        selectedCode: string
    ): Promise<string> {
        const testSuite = await this.testGenerationAgent.generate(
            document,
            selectedCode
        );
        return this.testGenerationAgent.formatTests(testSuite);
    }

    /**
     * Extract and schedule tasks from file analysis
     */
    async extractTasks(document: vscode.TextDocument): Promise<Task[]> {
        const analysis = await this.analyzeFile(document);

        // Convert issues to tasks
        const tasks = await this.taskPlanningAgent.createTasks(analysis);

        // Schedule tasks based on priority and estimates
        const preferences = this.getUserPreferences();
        const scheduledTasks = await this.schedulingAgent.scheduleTasks(tasks, preferences);

        return scheduledTasks;
    }

    /**
     * Create scheduled task suggestions from an existing file analysis (no re-analysis).
     */
    async createTaskSuggestionsForFileAnalysis(analysis: FileAnalysis): Promise<Task[]> {
        const tasks = await this.taskPlanningAgent.createTasks(analysis);
        if (tasks.length === 0) return [];

        const preferences = this.getUserPreferences();
        return this.schedulingAgent.scheduleTasks(tasks, preferences, 30);
    }

    /**
     * Create scheduled task suggestions from workspace analyses (no re-analysis).
     */
    async createTaskSuggestionsForWorkspaceAnalyses(analyses: Map<string, FileAnalysis>): Promise<Task[]> {
        const tasks = await this.taskPlanningAgent.createWorkspaceTasks(analyses);
        if (tasks.length === 0) return [];

        const preferences = this.getUserPreferences();
        return this.schedulingAgent.scheduleTasks(tasks, preferences, 30);
    }

    /**
     * Get context for agent operations
     */
    getAgentContext(document?: vscode.TextDocument): AgentContext {
        const workspaceFolder = document
            ? vscode.workspace.getWorkspaceFolder(document.uri)
            : vscode.workspace.workspaceFolders?.[0];

        return {
            workspaceRoot: workspaceFolder?.uri.fsPath || '',
            currentFile: document?.uri.fsPath,
            currentCode: document?.getText(),
            analysisCache: this.analysisCache.getAll(),
            existingTasks: this.taskManager.getAllTasks(),
            userPreferences: this.getUserPreferences()
        };
    }

    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------

    private async performFileAnalysis(
        document: vscode.TextDocument,
        token?: vscode.CancellationToken
    ): Promise<FileAnalysis> {
        const context = this.getAgentContext(document);
        return this.codeAnalysisAgent.analyze(document, context, token);
    }

    private async findAnalyzableFiles(rootUri: vscode.Uri): Promise<vscode.Uri[]> {
        const config = vscode.workspace.getConfiguration('codeReviewer');
        const excludePatterns = config.get<string[]>('excludePatterns') || [];

        const pattern = '**/*.{ts,tsx,js,jsx,py,java,cs,go,rs,cpp,c,rb,php,swift,kt}';
        const exclude = `{${excludePatterns.join(',')}}`;

        // Get all matching files
        const allFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(rootUri, pattern),
            exclude
        );

        // Use smart filter to prioritize and filter files
        const filteredFiles = SmartFileFilter.filterForAnalysis(allFiles);

        // Log summary for debugging
        const summary = await SmartFileFilter.getWorkspaceSummary(rootUri);
        console.log(`[CodeReviewer] File analysis summary:`);
        console.log(`  Total files: ${summary.total}`);
        console.log(`  Core files: ${summary.byRelevance[FileRelevance.Core]}`);
        console.log(`  Supporting: ${summary.byRelevance[FileRelevance.Supporting]}`);
        console.log(`  Config (skipped): ${summary.byRelevance[FileRelevance.Config]}`);
        console.log(`  Generated (skipped): ${summary.byRelevance[FileRelevance.Generated]}`);
        console.log(`  Test files: ${summary.byRelevance[FileRelevance.Test]}`);
        console.log(`  Files to analyze: ${summary.toAnalyze}`);

        return filteredFiles;
    }

    private isStale(analysis: FileAnalysis): boolean {
        const maxAge = 5 * 60 * 1000; // 5 minutes
        return Date.now() - analysis.analyzedAt.getTime() > maxAge;
    }

    private calculateHealthScore(analyses: Map<string, FileAnalysis>): number {
        if (analyses.size === 0) return 100;

        let totalScore = 0;
        for (const analysis of analyses.values()) {
            const issueScore = Math.max(0, 100 - (analysis.issues.length * 5));
            const complexityScore = 100 - (analysis.metrics.cyclomaticComplexity * 2);
            const maintainabilityScore = analysis.metrics.maintainabilityIndex;

            totalScore += (issueScore + complexityScore + maintainabilityScore) / 3;
        }

        return Math.round(totalScore / analyses.size);
    }

    private getUserPreferences() {
        const config = vscode.workspace.getConfiguration('codeReviewer');
        return {
            workHoursStart: config.get<number>('workHoursStart') || 9,
            workHoursEnd: config.get<number>('workHoursEnd') || 17,
            focusSessionDuration: config.get<number>('focusSessionDuration') || 90,
            preferredTaskTypes: [],
            excludePatterns: config.get<string[]>('excludePatterns') || [],
            analysisDepth: config.get<'light' | 'moderate' | 'deep'>('analysisDepth') || 'moderate'
        };
    }
}
