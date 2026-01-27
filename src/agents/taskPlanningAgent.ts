import { v4 as uuidv4 } from 'uuid';
import { AIProvider } from '../ai/aiServiceFactory';
import { PROMPTS } from './prompts';
import {
    FileAnalysis,
    Task,
    TaskType,
    TaskStatus,
    TaskPriority,
    TaskSource,
    CodeIssue,
    IssueCategory,
    IssueSeverity,
    AgentMessage
} from '../types';

/**
 * TaskPlanningAgent converts code analysis results into structured, actionable tasks.
 *
 * Responsibilities:
 * - Transform issues into tasks with clear descriptions
 * - Set appropriate priority based on severity and impact
 * - Estimate effort for each task
 * - Identify task dependencies
 * - Group related issues into single tasks where appropriate
 */
export class TaskPlanningAgent {
    private readonly name = 'TaskPlanningAgent';

    constructor(private aiService: AIProvider) {}

    /**
     * Create tasks from file analysis results
     */
    async createTasks(analysis: FileAnalysis): Promise<Task[]> {
        const { issues, filePath } = analysis;

        if (issues.length === 0) {
            return [];
        }

        // Group related issues
        const groupedIssues = this.groupRelatedIssues(issues);

        // Generate tasks for each group
        const tasks: Task[] = [];

        for (const group of groupedIssues) {
            const task = await this.createTaskFromIssues(group, filePath);
            if (task) {
                tasks.push(task);
            }
        }

        // Identify dependencies between tasks
        this.identifyDependencies(tasks);

        return tasks;
    }

    /**
     * Create tasks from multiple file analyses (workspace-level)
     */
    async createWorkspaceTasks(
        analyses: Map<string, FileAnalysis>
    ): Promise<Task[]> {
        const allTasks: Task[] = [];

        for (const [filePath, analysis] of analyses) {
            const fileTasks = await this.createTasks(analysis);
            allTasks.push(...fileTasks);
        }

        // Cross-file dependency identification
        this.identifyDependencies(allTasks);

        // Sort by priority
        allTasks.sort((a, b) => b.priority - a.priority);

        return allTasks;
    }

    /**
     * Enhance task descriptions using AI
     */
    async enhanceTaskDescription(task: Task): Promise<Task> {
        const messages: AgentMessage[] = [
            { role: 'system', content: PROMPTS.TASK_ENHANCEMENT_SYSTEM },
            {
                role: 'user',
                content: PROMPTS.TASK_ENHANCEMENT_USER
                    .replace('{{TASK_TITLE}}', task.title)
                    .replace('{{TASK_DESCRIPTION}}', task.description)
                    .replace('{{AFFECTED_FILES}}', task.affectedFiles.join(', '))
                    .replace('{{AI_RATIONALE}}', task.aiRationale)
            }
        ];

        try {
            const response = await this.aiService.chat(messages, {
                temperature: 0.4,
                maxTokens: 1000
            });

            const enhanced = this.parseEnhancedTask(response);
            return {
                ...task,
                description: enhanced.description || task.description,
                aiRationale: enhanced.rationale || task.aiRationale
            };
        } catch {
            return task;
        }
    }

    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------

    private groupRelatedIssues(issues: CodeIssue[]): CodeIssue[][] {
        const groups: CodeIssue[][] = [];
        const used = new Set<string>();

        for (const issue of issues) {
            if (used.has(issue.id)) continue;

            const group = [issue];
            used.add(issue.id);

            // Find related issues
            for (const other of issues) {
                if (used.has(other.id)) continue;

                if (this.areRelated(issue, other)) {
                    group.push(other);
                    used.add(other.id);
                }
            }

            groups.push(group);
        }

        return groups;
    }

    private areRelated(a: CodeIssue, b: CodeIssue): boolean {
        // Same category
        if (a.category === b.category) {
            // Close proximity in code
            if (Math.abs(a.startLine - b.startLine) < 20) {
                return true;
            }
        }

        // Same function/block (heuristic: within 10 lines)
        if (Math.abs(a.startLine - b.startLine) < 10) {
            return true;
        }

        return false;
    }

    private async createTaskFromIssues(
        issues: CodeIssue[],
        filePath: string
    ): Promise<Task | null> {
        if (issues.length === 0) return null;

        const primaryIssue = issues[0];
        const taskType = this.mapCategoryToTaskType(primaryIssue.category);
        const priority = this.calculatePriority(issues);
        const estimatedMinutes = this.estimateEffort(issues);

        // Generate task title and description
        const title = this.generateTaskTitle(issues, taskType);
        const description = this.generateTaskDescription(issues);
        const rationale = this.generateRationale(issues);

        return {
            id: uuidv4(),
            title,
            description,
            type: taskType,
            status: TaskStatus.Pending,
            priority,
            source: TaskSource.Analysis,
            affectedFiles: [filePath],
            sourceIssueIds: issues.map(i => i.id),
            estimatedMinutes,
            dependencies: [],
            confidence: this.calculateConfidence(issues),
            createdAt: new Date(),
            updatedAt: new Date(),
            aiRationale: rationale
        };
    }

    private mapCategoryToTaskType(category: IssueCategory): TaskType {
        const mapping: Record<IssueCategory, TaskType> = {
            [IssueCategory.CodeSmell]: TaskType.Refactor,
            [IssueCategory.TechnicalDebt]: TaskType.Refactor,
            [IssueCategory.IncompleteLogic]: TaskType.Expand,
            [IssueCategory.Complexity]: TaskType.Refactor,
            [IssueCategory.Documentation]: TaskType.Documentation,
            [IssueCategory.Security]: TaskType.Security,
            [IssueCategory.Performance]: TaskType.Performance,
            [IssueCategory.Testing]: TaskType.Test,
            [IssueCategory.BestPractice]: TaskType.Refactor
        };

        return mapping[category] || TaskType.Refactor;
    }

    private calculatePriority(issues: CodeIssue[]): TaskPriority {
        const severityScores: Record<IssueSeverity, number> = {
            [IssueSeverity.Info]: 1,
            [IssueSeverity.Warning]: 2,
            [IssueSeverity.Error]: 3,
            [IssueSeverity.Critical]: 4
        };

        const maxSeverity = Math.max(
            ...issues.map(i => severityScores[i.severity])
        );

        // Factor in number of issues
        const issueCountBonus = Math.min(1, issues.length / 5);
        const adjustedScore = maxSeverity + issueCountBonus;

        if (adjustedScore >= 4) return TaskPriority.Critical;
        if (adjustedScore >= 3) return TaskPriority.High;
        if (adjustedScore >= 2) return TaskPriority.Medium;
        return TaskPriority.Low;
    }

    private estimateEffort(issues: CodeIssue[]): number {
        const effortMinutes: Record<string, number> = {
            'trivial': 5,
            'small': 15,
            'medium': 30,
            'large': 60,
            'xlarge': 120
        };

        let total = 0;
        for (const issue of issues) {
            total += effortMinutes[issue.estimatedEffort] || 30;
        }

        // Reduce for grouped issues (efficiency)
        if (issues.length > 1) {
            total = Math.round(total * 0.7);
        }

        return total;
    }

    private calculateConfidence(issues: CodeIssue[]): number {
        if (issues.length === 0) return 0;

        const avgConfidence = issues.reduce((sum, i) => sum + i.confidence, 0) / issues.length;
        return Math.round(avgConfidence * 100) / 100;
    }

    private generateTaskTitle(issues: CodeIssue[], taskType: TaskType): string {
        const typeLabels: Record<TaskType, string> = {
            [TaskType.Refactor]: 'Refactor',
            [TaskType.Test]: 'Add tests for',
            [TaskType.Expand]: 'Expand',
            [TaskType.Documentation]: 'Document',
            [TaskType.Security]: 'Fix security issue in',
            [TaskType.Performance]: 'Optimize',
            [TaskType.BugFix]: 'Fix bug in'
        };

        if (issues.length === 1) {
            return issues[0].title;
        }

        const primaryIssue = issues[0];
        const lineRange = `lines ${primaryIssue.startLine}-${issues[issues.length - 1].endLine}`;

        return `${typeLabels[taskType]} ${lineRange}`;
    }

    private generateTaskDescription(issues: CodeIssue[]): string {
        if (issues.length === 1) {
            return issues[0].description + (issues[0].suggestion ? `\n\nSuggestion: ${issues[0].suggestion}` : '');
        }

        let description = `Multiple related issues found:\n\n`;

        for (const issue of issues) {
            description += `- **Line ${issue.startLine}**: ${issue.title}\n`;
            description += `  ${issue.description}\n`;
        }

        return description;
    }

    private generateRationale(issues: CodeIssue[]): string {
        const categories = [...new Set(issues.map(i => i.category))];
        const severities = [...new Set(issues.map(i => i.severity))];

        let rationale = `This task addresses ${issues.length} issue(s) `;
        rationale += `in categories: ${categories.join(', ')}. `;
        rationale += `Severity levels: ${severities.join(', ')}. `;

        if (issues.some(i => i.severity === IssueSeverity.Critical)) {
            rationale += 'Includes critical issues that should be addressed promptly.';
        } else if (issues.some(i => i.severity === IssueSeverity.Error)) {
            rationale += 'Contains errors that may affect functionality.';
        }

        return rationale;
    }

    private identifyDependencies(tasks: Task[]): void {
        // Simple heuristic: security tasks should come before refactoring
        const securityTasks = tasks.filter(t => t.type === TaskType.Security);
        const testTasks = tasks.filter(t => t.type === TaskType.Test);

        for (const task of tasks) {
            if (task.type === TaskType.Refactor) {
                // Refactoring depends on security fixes being done first
                for (const secTask of securityTasks) {
                    if (this.filesOverlap(task.affectedFiles, secTask.affectedFiles)) {
                        if (!task.dependencies.includes(secTask.id)) {
                            task.dependencies.push(secTask.id);
                        }
                    }
                }
            }

            // Tests should come after implementation tasks
            if (task.type === TaskType.Expand || task.type === TaskType.Refactor) {
                for (const testTask of testTasks) {
                    if (this.filesOverlap(task.affectedFiles, testTask.affectedFiles)) {
                        if (!testTask.dependencies.includes(task.id)) {
                            testTask.dependencies.push(task.id);
                        }
                    }
                }
            }
        }
    }

    private filesOverlap(a: string[], b: string[]): boolean {
        return a.some(file => b.includes(file));
    }

    private parseEnhancedTask(response: string): { description?: string; rationale?: string } {
        try {
            const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1]);
            }
            return { description: response };
        } catch {
            return { description: response };
        }
    }
}
