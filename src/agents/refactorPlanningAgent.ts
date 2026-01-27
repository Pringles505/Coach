import type { AIProvider } from '../types';
import { PROMPTS } from './prompts';
import type { TextDocumentLike } from '../core/document';
import {
    FileAnalysis,
    RefactorPlan,
    RefactorStep,
    AgentMessage,
    RiskLevel
} from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * RefactorPlanningAgent creates detailed, step-by-step refactoring plans.
 *
 * Responsibilities:
 * - Analyze code issues and determine refactoring strategy
 * - Create ordered steps with clear actions
 * - Estimate effort and risk for each step
 * - Provide rationale for recommended changes
 */
export class RefactorPlanningAgent {
    private readonly name = 'RefactorPlanningAgent';

    constructor(private aiService: AIProvider) {}

    /**
     * Create a comprehensive refactoring plan for a file
     */
    async createPlan(
        document: TextDocumentLike,
        analysis: FileAnalysis
    ): Promise<RefactorPlan> {
        const code = document.getText();
        const fileName = document.uri.fsPath.split(/[\\/]/).pop() || 'file';

        // Filter issues that warrant refactoring
        const refactorableIssues = analysis.issues.filter(issue =>
            ['code_smell', 'complexity', 'technical_debt', 'best_practice']
                .includes(issue.category)
        );

        if (refactorableIssues.length === 0) {
            return this.createEmptyPlan(document.uri.fsPath);
        }

        const messages: AgentMessage[] = [
            { role: 'system', content: PROMPTS.REFACTOR_PLANNING_SYSTEM },
            {
                role: 'user',
                content: PROMPTS.REFACTOR_PLANNING_USER
                    .replace('{{FILE_NAME}}', fileName)
                    .replace('{{LANGUAGE}}', document.languageId)
                    .replace('{{CODE}}', this.truncateCode(code, 12000))
                    .replace('{{ISSUES}}', JSON.stringify(refactorableIssues, null, 2))
            }
        ];

        const response = await this.aiService.chat(messages, {
            temperature: 0.3,
            maxTokens: 3000
        });

        return this.parsePlanResponse(response, document.uri.fsPath);
    }

    /**
     * Format refactor plan as readable markdown
     */
    formatPlan(plan: RefactorPlan): string {
        let markdown = `# Refactoring Plan\n\n`;
        markdown += `**File:** ${plan.affectedFiles.join(', ')}\n`;
        markdown += `**Total Estimated Effort:** ${plan.estimatedTotalMinutes} minutes\n`;
        markdown += `**Overall Risk Level:** ${this.getRiskBadge(plan.riskLevel)}\n\n`;

        markdown += `## Overview\n${plan.description}\n\n`;

        markdown += `## Steps\n\n`;

        for (const step of plan.steps) {
            markdown += `### Step ${step.order}: ${step.action}\n\n`;
            markdown += `**File:** ${step.file}\n`;
            if (step.lineRange) {
                markdown += `**Lines:** ${step.lineRange.start}-${step.lineRange.end}\n`;
            }
            markdown += `**Estimated Time:** ${step.estimatedMinutes} min\n`;
            markdown += `**Risk:** ${this.getRiskBadge(step.risk)}\n\n`;
            markdown += `**Rationale:** ${step.rationale}\n\n`;
            markdown += `---\n\n`;
        }

        markdown += `## Before You Start\n\n`;
        markdown += `1. Ensure all tests pass before refactoring\n`;
        markdown += `2. Create a backup or commit current state\n`;
        markdown += `3. Work through steps in order\n`;
        markdown += `4. Run tests after each significant change\n`;

        return markdown;
    }

    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------

    private parsePlanResponse(response: string, filePath: string): RefactorPlan {
        try {
            const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : response;
            const parsed = JSON.parse(jsonStr);

            const steps: RefactorStep[] = (parsed.steps || []).map((step: any, index: number) => ({
                order: index + 1,
                action: step.action || 'Refactor',
                file: step.file || filePath,
                lineRange: step.lineRange ? {
                    start: step.lineRange.start,
                    end: step.lineRange.end
                } : undefined,
                rationale: step.rationale || '',
                estimatedMinutes: step.estimatedMinutes || 15,
                risk: this.mapRiskLevel(step.risk)
            }));

            const totalMinutes = steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
            const highestRisk = this.calculateOverallRisk(steps);

            return {
                id: uuidv4(),
                title: parsed.title || 'Refactoring Plan',
                description: parsed.description || 'Improve code quality through refactoring',
                steps,
                estimatedTotalMinutes: totalMinutes,
                riskLevel: highestRisk,
                affectedFiles: [filePath]
            };
        } catch (error) {
            console.error('Failed to parse refactor plan:', error);
            return this.createEmptyPlan(filePath);
        }
    }

    private createEmptyPlan(filePath: string): RefactorPlan {
        return {
            id: uuidv4(),
            title: 'No Refactoring Needed',
            description: 'The code appears to be in good shape. No significant refactoring opportunities identified.',
            steps: [],
            estimatedTotalMinutes: 0,
            riskLevel: 'low',
            affectedFiles: [filePath]
        };
    }

    private mapRiskLevel(risk: string): RiskLevel {
        const map: Record<string, RiskLevel> = {
            'low': 'low',
            'medium': 'medium',
            'high': 'high',
            'critical': 'critical'
        };
        return map[risk?.toLowerCase()] || 'medium';
    }

    private calculateOverallRisk(steps: RefactorStep[]): RiskLevel {
        if (steps.length === 0) return 'low';

        const riskOrder: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
        let highest: RiskLevel = 'low';

        for (const step of steps) {
            if (riskOrder.indexOf(step.risk) > riskOrder.indexOf(highest)) {
                highest = step.risk;
            }
        }

        return highest;
    }

    private getRiskBadge(risk: RiskLevel): string {
        const badges: Record<RiskLevel, string> = {
            'low': '🟢 Low',
            'medium': '🟡 Medium',
            'high': '🟠 High',
            'critical': '🔴 Critical'
        };
        return badges[risk];
    }

    private truncateCode(code: string, maxChars: number): string {
        if (code.length <= maxChars) return code;
        return code.substring(0, maxChars) + '\n// ... (truncated)';
    }
}
