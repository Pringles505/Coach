import {
    AIProvider,
    Task,
    TaskType,
    TaskStatus,
    TaskPriority,
    TaskSource,
    AgentMessage
} from '../types';

/**
 * Parsed task from AI response
 */
interface ParsedTask {
    title: string;
    description: string;
    type: TaskType;
    priority: TaskPriority;
    estimatedMinutes: number;
    affectedFiles: string[];
    dependencies: string[];
    rationale: string;
}

/**
 * NLTaskCreationAgent converts natural language descriptions of features
 * or tasks into structured Task objects that can be added to the task manager
 * and calendar.
 */
export class NLTaskCreationAgent {
    private readonly name = 'NLTaskCreationAgent';

    constructor(private aiService: AIProvider) {}

    /**
     * Create tasks from a natural language description
     */
    async createTasksFromDescription(
        description: string,
        workspaceRoot?: string
    ): Promise<Task[]> {
        const systemPrompt = this.buildSystemPrompt(workspaceRoot);

        const messages: AgentMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: description }
        ];

        const response = await this.aiService.chat(messages, {
            temperature: 0.3,
            maxTokens: 4000
        });

        return this.parseResponse(response);
    }

    private buildSystemPrompt(workspaceRoot?: string): string {
        const contextInfo = workspaceRoot
            ? `The user is working in a project at: ${workspaceRoot}`
            : 'No specific project context is available.';

        return `You are an expert software project planner. Your role is to take a natural language description of a feature, improvement, or task and break it down into actionable development tasks.

${contextInfo}

When the user describes what they want to build or accomplish, create a structured plan with individual tasks. Each task should be:
- Specific and actionable
- Appropriately scoped (not too large, not too small)
- In logical order with dependencies noted

For each task, provide:
1. A clear, concise title (imperative form, e.g., "Implement user authentication")
2. A detailed description of what needs to be done
3. The type of task (one of: refactor, test, expand, documentation, security, performance, bugfix)
4. Priority level (low, medium, high, critical)
5. Estimated time in minutes (15, 30, 60, 90, 120, 180, 240)
6. Files that might be affected (if you can infer them)
7. Dependencies on other tasks in the plan (by index, 0-based)
8. Rationale for why this task is needed

RESPOND ONLY WITH VALID JSON in this exact format:
{
  "tasks": [
    {
      "title": "Task title here",
      "description": "Detailed description of what to do",
      "type": "expand",
      "priority": "medium",
      "estimatedMinutes": 60,
      "affectedFiles": ["src/components/Feature.tsx"],
      "dependsOn": [],
      "rationale": "Why this task is important"
    }
  ],
  "summary": "Brief summary of the overall plan"
}

Guidelines:
- Break complex features into 3-8 tasks
- Order tasks logically (foundation first, then features, then tests/docs)
- Be realistic with time estimates
- Include testing tasks when appropriate
- Consider security and performance implications
- Use "expand" type for new features, "refactor" for improvements
- Higher priority for core functionality, lower for nice-to-haves`;
    }

    private parseResponse(response: string): Task[] {
        try {
            // Extract JSON from response (handle markdown code blocks)
            let jsonStr = response;
            const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1].trim();
            }

            const parsed = JSON.parse(jsonStr);

            if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
                throw new Error('Invalid response format: missing tasks array');
            }

            const tasks: Task[] = [];
            const now = new Date();

            for (let i = 0; i < parsed.tasks.length; i++) {
                const taskData = parsed.tasks[i] as ParsedTask;

                const task: Task = {
                    id: `ai-task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${i}`,
                    title: taskData.title || `Task ${i + 1}`,
                    description: taskData.description || '',
                    type: this.parseTaskType(taskData.type),
                    status: TaskStatus.Pending,
                    priority: this.parsePriority(taskData.priority),
                    source: TaskSource.AiPlanned,
                    affectedFiles: taskData.affectedFiles || [],
                    sourceIssueIds: [],
                    estimatedMinutes: this.parseEstimate(taskData.estimatedMinutes),
                    dependencies: [], // Will be resolved after all tasks created
                    confidence: 0.8, // AI-planned tasks have moderate confidence
                    createdAt: now,
                    updatedAt: now,
                    aiRationale: taskData.rationale || 'AI-generated task based on natural language description'
                };

                tasks.push(task);
            }

            // Resolve dependencies (convert indices to task IDs)
            for (let i = 0; i < parsed.tasks.length; i++) {
                const taskData = parsed.tasks[i];
                if (taskData.dependsOn && Array.isArray(taskData.dependsOn)) {
                    tasks[i].dependencies = taskData.dependsOn
                        .filter((idx: number) => idx >= 0 && idx < tasks.length && idx !== i)
                        .map((idx: number) => tasks[idx].id);
                }
            }

            return tasks;
        } catch (error) {
            console.error('Failed to parse NL task creation response:', error);
            throw new Error(`Failed to parse AI response: ${(error as Error).message}`);
        }
    }

    private parseTaskType(type: string): TaskType {
        const typeMap: Record<string, TaskType> = {
            refactor: TaskType.Refactor,
            test: TaskType.Test,
            testing: TaskType.Test,
            expand: TaskType.Expand,
            feature: TaskType.Expand,
            documentation: TaskType.Documentation,
            docs: TaskType.Documentation,
            security: TaskType.Security,
            performance: TaskType.Performance,
            bugfix: TaskType.BugFix,
            bug: TaskType.BugFix,
            fix: TaskType.BugFix
        };

        return typeMap[type?.toLowerCase()] || TaskType.Expand;
    }

    private parsePriority(priority: string | number): TaskPriority {
        if (typeof priority === 'number') {
            return Math.max(1, Math.min(4, priority)) as TaskPriority;
        }

        const priorityMap: Record<string, TaskPriority> = {
            low: TaskPriority.Low,
            medium: TaskPriority.Medium,
            high: TaskPriority.High,
            critical: TaskPriority.Critical
        };

        return priorityMap[priority?.toLowerCase()] || TaskPriority.Medium;
    }

    private parseEstimate(minutes: number | string): number {
        const num = typeof minutes === 'string' ? parseInt(minutes, 10) : minutes;

        if (isNaN(num) || num < 5) return 30;
        if (num > 480) return 480; // Cap at 8 hours

        // Round to standard increments
        const increments = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480];
        return increments.reduce((prev, curr) =>
            Math.abs(curr - num) < Math.abs(prev - num) ? curr : prev
        );
    }

    /**
     * Format tasks as a readable summary for the user
     */
    formatTaskSummary(tasks: Task[]): string {
        if (tasks.length === 0) {
            return 'No tasks were created.';
        }

        const lines: string[] = [
            `# AI Task Plan`,
            ``,
            `Created ${tasks.length} task(s):`,
            ``
        ];

        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            const priorityEmoji = this.getPriorityEmoji(task.priority);
            const typeLabel = this.getTypeLabel(task.type);

            lines.push(`## ${i + 1}. ${task.title}`);
            lines.push(``);
            lines.push(`- **Type:** ${typeLabel}`);
            lines.push(`- **Priority:** ${priorityEmoji} ${TaskPriority[task.priority]}`);
            lines.push(`- **Estimated:** ${task.estimatedMinutes} min`);

            if (task.dependencies.length > 0) {
                const depIndices = task.dependencies
                    .map(depId => tasks.findIndex(t => t.id === depId) + 1)
                    .filter(idx => idx > 0);
                if (depIndices.length > 0) {
                    lines.push(`- **Depends on:** Task(s) ${depIndices.join(', ')}`);
                }
            }

            lines.push(``);
            lines.push(task.description);
            lines.push(``);

            if (task.aiRationale) {
                lines.push(`> **Why:** ${task.aiRationale}`);
                lines.push(``);
            }
        }

        const totalMinutes = tasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;

        lines.push(`---`);
        lines.push(`**Total estimated time:** ${hours > 0 ? `${hours}h ` : ''}${mins}min`);

        return lines.join('\n');
    }

    private getPriorityEmoji(priority: TaskPriority): string {
        const emojis: Record<TaskPriority, string> = {
            [TaskPriority.Low]: '🟢',
            [TaskPriority.Medium]: '🟡',
            [TaskPriority.High]: '🟠',
            [TaskPriority.Critical]: '🔴'
        };
        return emojis[priority] || '⚪';
    }

    private getTypeLabel(type: TaskType): string {
        const labels: Record<TaskType, string> = {
            [TaskType.Refactor]: 'Refactoring',
            [TaskType.Test]: 'Testing',
            [TaskType.Expand]: 'Feature',
            [TaskType.Documentation]: 'Documentation',
            [TaskType.Security]: 'Security',
            [TaskType.Performance]: 'Performance',
            [TaskType.BugFix]: 'Bug Fix'
        };
        return labels[type] || type;
    }
}
