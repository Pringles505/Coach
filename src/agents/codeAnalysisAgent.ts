import { v4 as uuidv4 } from 'uuid';
import type { AIProvider } from '../types';
import { PROMPTS } from './prompts';
import type { TextDocumentLike } from '../core/document';
import {
    FileAnalysis,
    FileSummary,
    CodeMetrics,
    CodeIssue,
    AgentContext,
    AgentMessage,
    IssueSeverity,
    IssueCategory,
    ProjectSummary,
    ModuleInfo,
    HotspotInfo,
    PureFileSummary,
    PureProjectSummary
} from '../types';

/**
 * CodeAnalysisAgent is responsible for:
 * - Analyzing individual files for issues
 * - Computing code metrics
 * - Generating file summaries
 * - Identifying code smells, technical debt, and improvement opportunities
 */
export class CodeAnalysisAgent {
    private readonly name = 'CodeAnalysisAgent';

    constructor(private aiService: AIProvider) {}

    /**
     * Perform comprehensive analysis of a document
     */
    async analyze(
        document: TextDocumentLike,
        context: AgentContext,
        // Cancellation is supported in VS Code via the orchestrator, but the core agent only
        // needs an optional "isCancellationRequested" shape and can ignore it safely.
        token?: { isCancellationRequested?: boolean }
    ): Promise<FileAnalysis> {
        const code = document.getText();
        const filePath = document.uri.fsPath;
        const languageId = document.languageId;

        // Compute basic metrics locally (fast)
        const metrics = this.computeMetrics(code);

        // Request AI analysis
        const aiAnalysis = await this.requestAIAnalysis(
            code,
            filePath,
            languageId,
            context
        );

        return {
            filePath,
            languageId,
            analyzedAt: new Date(),
            issues: aiAnalysis.issues,
            summary: aiAnalysis.summary,
            metrics: { ...metrics, ...aiAnalysis.additionalMetrics }
        };
    }

    /**
     * Generate a project-level summary from multiple file analyses
     */
    async summarizeProject(
        fileAnalyses: Map<string, FileAnalysis>
    ): Promise<ProjectSummary> {
        const analysisData = Array.from(fileAnalyses.entries()).map(([path, analysis]) => ({
            path,
            issues: analysis.issues.length,
            summary: analysis.summary.purpose,
            complexity: analysis.metrics.cyclomaticComplexity
        }));

        const messages: AgentMessage[] = [
            { role: 'system', content: PROMPTS.PROJECT_SUMMARY_SYSTEM },
            {
                role: 'user',
                content: PROMPTS.PROJECT_SUMMARY_USER.replace(
                    '{{ANALYSIS_DATA}}',
                    JSON.stringify(analysisData, null, 2)
                )
            }
        ];

        const response = await this.aiService.chat(messages, {
            temperature: 0.3,
            maxTokens: 2000
        });

        return this.parseProjectSummary(response, fileAnalyses);
    }

    /**
     * Pure summarization - describes functionality without finding issues
     */
    async summarizeOnly(
        document: TextDocumentLike,
        context: AgentContext
    ): Promise<PureFileSummary> {
        const code = document.getText();
        const filePath = document.uri.fsPath;
        const languageId = document.languageId;

        // Compute basic metrics locally (fast)
        const metrics = this.computeMetrics(code);

        // Request AI summary (no issues)
        const aiSummary = await this.requestAISummary(
            code,
            filePath,
            languageId
        );

        return {
            filePath,
            languageId,
            summary: aiSummary.summary,
            metrics: { ...metrics, ...aiSummary.additionalMetrics }
        };
    }

    /**
     * Generate a project-level summary without issues/hotspots
     */
    async summarizeProjectOnly(
        fileSummaries: Map<string, PureFileSummary>
    ): Promise<PureProjectSummary> {
        const summaryData = Array.from(fileSummaries.entries()).map(([filePath, summary]) => ({
            path: filePath,
            purpose: summary.summary.purpose,
            components: summary.summary.mainComponents,
            dependencies: summary.summary.dependencies,
            complexity: summary.summary.complexity
        }));

        const messages: AgentMessage[] = [
            { role: 'system', content: PROMPTS.PURE_PROJECT_SUMMARY_SYSTEM },
            {
                role: 'user',
                content: PROMPTS.PURE_PROJECT_SUMMARY_USER.replace(
                    '{{ANALYSIS_DATA}}',
                    JSON.stringify(summaryData, null, 2)
                )
            }
        ];

        const response = await this.aiService.chat(messages, {
            temperature: 0.3,
            maxTokens: 2000
        });

        return this.parsePureProjectSummary(response);
    }

    /**
     * Format pure file summary as readable markdown (no issues section)
     */
    formatPureSummary(summary: PureFileSummary): string {
        const { summary: fileSummary, metrics } = summary;

        let markdown = `# File Summary: ${summary.filePath.split(/[\\/]/).pop()}\n\n`;

        markdown += `## Purpose\n${fileSummary.purpose}\n\n`;

        markdown += `## Main Components\n`;
        for (const component of fileSummary.mainComponents) {
            markdown += `- ${component}\n`;
        }
        markdown += '\n';

        if (fileSummary.dependencies.length > 0) {
            markdown += `## Dependencies\n`;
            for (const dep of fileSummary.dependencies) {
                markdown += `- ${dep}\n`;
            }
            markdown += '\n';
        }

        if (fileSummary.publicApi.length > 0) {
            markdown += `## Public API\n`;
            for (const api of fileSummary.publicApi) {
                markdown += `- ${api}\n`;
            }
            markdown += '\n';
        }

        markdown += `## Metrics\n`;
        markdown += `| Metric | Value |\n|--------|-------|\n`;
        markdown += `| Lines of Code | ${metrics.linesOfCode} |\n`;
        markdown += `| Cyclomatic Complexity | ${metrics.cyclomaticComplexity} |\n`;
        markdown += `| Maintainability Index | ${metrics.maintainabilityIndex} |\n`;
        markdown += `| Complexity Level | ${fileSummary.complexity} |\n`;

        return markdown;
    }

    /**
     * Format pure project summary as readable markdown (no hotspots/recommendations)
     */
    formatPureProjectSummary(
        summary: PureProjectSummary,
        options?: { rootPath?: string; analyzedAt?: Date; filesAnalyzed?: number }
    ): string {
        const workspaceName = options?.rootPath
            ? options.rootPath.split(/[\\/]/).filter(Boolean).pop()
            : 'Workspace';

        let markdown = `# Project Summary: ${workspaceName}\n\n`;

        if (options?.filesAnalyzed !== undefined || options?.analyzedAt) {
            markdown += `## Stats\n`;
            if (options?.filesAnalyzed !== undefined) {
                markdown += `- Files analyzed: ${options.filesAnalyzed}\n`;
            }
            if (options?.analyzedAt) {
                markdown += `- Updated: ${options.analyzedAt.toLocaleString()}\n`;
            }
            markdown += `\n`;
        }

        markdown += `## Overview\n${summary.overview}\n\n`;
        markdown += `## Architecture\n${summary.architecture}\n\n`;

        markdown += `## Main Modules\n`;
        if (!summary.mainModules || summary.mainModules.length === 0) {
            markdown += `No modules identified.\n\n`;
        } else {
            for (const module of summary.mainModules) {
                markdown += `### ${module.name}\n`;
                markdown += `- Path: ${module.path}\n`;
                markdown += `- Purpose: ${module.purpose}\n\n`;
            }
        }

        if (summary.techStack && summary.techStack.length > 0) {
            markdown += `## Tech Stack\n`;
            for (const tech of summary.techStack) {
                markdown += `- ${tech}\n`;
            }
            markdown += '\n';
        }

        if (summary.entryPoints && summary.entryPoints.length > 0) {
            markdown += `## Entry Points\n`;
            for (const entry of summary.entryPoints) {
                markdown += `- ${entry}\n`;
            }
            markdown += '\n';
        }

        return markdown;
    }

    /**
     * Format file analysis as readable markdown
     */
    formatSummary(analysis: FileAnalysis): string {
        const { summary, issues, metrics } = analysis;

        let markdown = `# File Summary: ${analysis.filePath.split(/[\\/]/).pop()}\n\n`;

        markdown += `## Purpose\n${summary.purpose}\n\n`;

        markdown += `## Main Components\n`;
        for (const component of summary.mainComponents) {
            markdown += `- ${component}\n`;
        }
        markdown += '\n';

        markdown += `## Metrics\n`;
        markdown += `| Metric | Value |\n|--------|-------|\n`;
        markdown += `| Lines of Code | ${metrics.linesOfCode} |\n`;
        markdown += `| Cyclomatic Complexity | ${metrics.cyclomaticComplexity} |\n`;
        markdown += `| Maintainability Index | ${metrics.maintainabilityIndex} |\n`;
        markdown += `| Technical Debt | ${metrics.technicalDebtMinutes} min |\n\n`;

        if (issues.length > 0) {
            markdown += `## Issues Found (${issues.length})\n\n`;
            for (const issue of issues) {
                const icon = this.getSeverityIcon(issue.severity);
                markdown += `### ${icon} ${issue.title}\n`;
                markdown += `**Line ${issue.startLine}** | ${issue.category} | ${issue.severity}\n\n`;
                markdown += `${issue.description}\n\n`;
                if (issue.suggestion) {
                    markdown += `**Suggestion:** ${issue.suggestion}\n\n`;
                }
            }
        } else {
            markdown += `## ✅ No Issues Found\n`;
        }

        return markdown;
    }

    /**
     * Format project summary as readable markdown
     */
    formatProjectSummary(
        summary: ProjectSummary,
        options?: { rootPath?: string; analyzedAt?: Date; filesAnalyzed?: number; totalIssues?: number }
    ): string {
        const workspaceName = options?.rootPath
            ? options.rootPath.split(/[\\/]/).filter(Boolean).pop()
            : 'Workspace';

        let markdown = `# Workspace Summary: ${workspaceName}\n\n`;

        if (options?.filesAnalyzed !== undefined || options?.totalIssues !== undefined || options?.analyzedAt) {
            markdown += `## Stats\n`;
            if (options?.filesAnalyzed !== undefined) {
                markdown += `- Files analyzed: ${options.filesAnalyzed}\n`;
            }
            if (options?.totalIssues !== undefined) {
                markdown += `- Total issues: ${options.totalIssues}\n`;
            }
            if (options?.analyzedAt) {
                markdown += `- Updated: ${options.analyzedAt.toLocaleString()}\n`;
            }
            markdown += `\n`;
        }

        markdown += `## Overview\n${summary.overview}\n\n`;
        markdown += `## Architecture\n${summary.architecture}\n\n`;

        markdown += `## Main Modules\n`;
        if (!summary.mainModules || summary.mainModules.length === 0) {
            markdown += `No modules identified.\n\n`;
        } else {
            for (const module of summary.mainModules) {
                markdown += `### ${module.name}\n`;
                markdown += `- Path: ${module.path}\n`;
                markdown += `- Health: ${module.healthScore}/100\n`;
                markdown += `- Issues: ${module.issueCount}\n`;
                markdown += `- Purpose: ${module.purpose}\n\n`;
            }
        }

        markdown += `## Hotspots\n`;
        if (!summary.hotspots || summary.hotspots.length === 0) {
            markdown += `No hotspots identified.\n\n`;
        } else {
            for (const hotspot of summary.hotspots) {
                const icon = this.getSeverityIcon(hotspot.severity);
                markdown += `- ${icon} ${hotspot.path} (${hotspot.issueCount} issues): ${hotspot.reason}\n`;
            }
            markdown += `\n`;
        }

        markdown += `## Recommendations\n`;
        if (!summary.recommendations || summary.recommendations.length === 0) {
            markdown += `No recommendations provided.\n`;
        } else {
            for (const rec of summary.recommendations) {
                markdown += `- ${rec}\n`;
            }
        }

        return markdown;
    }

    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------

    private async requestAIAnalysis(
        code: string,
        filePath: string,
        languageId: string,
        context: AgentContext
    ): Promise<{
        issues: CodeIssue[];
        summary: FileSummary;
        additionalMetrics: Partial<CodeMetrics>;
    }> {
        const fileName = filePath.split(/[\\/]/).pop() || 'unknown';

        const messages: AgentMessage[] = [
            { role: 'system', content: PROMPTS.CODE_ANALYSIS_SYSTEM },
            {
                role: 'user',
                content: PROMPTS.CODE_ANALYSIS_USER
                    .replace('{{FILE_NAME}}', fileName)
                    .replace('{{LANGUAGE}}', languageId)
                    .replace('{{CODE}}', this.addLineNumbers(this.truncateCode(code, 15000)))
                    .replace('{{DEPTH}}', context.userPreferences.analysisDepth)
            }
        ];

        const response = await this.aiService.chat(messages, {
            temperature: 0.2,
            maxTokens: 4000
        });

        return this.parseAnalysisResponse(response, filePath);
    }

    private async requestAISummary(
        code: string,
        filePath: string,
        languageId: string
    ): Promise<{
        summary: FileSummary;
        additionalMetrics: Partial<CodeMetrics>;
    }> {
        const fileName = filePath.split(/[\\/]/).pop() || 'unknown';

        const messages: AgentMessage[] = [
            { role: 'system', content: PROMPTS.FILE_SUMMARY_SYSTEM },
            {
                role: 'user',
                content: PROMPTS.FILE_SUMMARY_USER
                    .replace('{{FILE_NAME}}', fileName)
                    .replace(/\{\{LANGUAGE\}\}/g, languageId)
                    .replace('{{CODE}}', this.addLineNumbers(this.truncateCode(code, 15000)))
            }
        ];

        const response = await this.aiService.chat(messages, {
            temperature: 0.2,
            maxTokens: 2000
        });

        return this.parseSummaryResponse(response);
    }

    private parseSummaryResponse(
        response: string
    ): {
        summary: FileSummary;
        additionalMetrics: Partial<CodeMetrics>;
    } {
        try {
            const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : response;
            const parsed = JSON.parse(jsonStr);

            const summary: FileSummary = {
                purpose: parsed.summary?.purpose || 'No summary available',
                mainComponents: parsed.summary?.components || [],
                dependencies: parsed.summary?.dependencies || [],
                publicApi: parsed.summary?.publicApi || [],
                complexity: parsed.summary?.complexity || 'moderate'
            };

            return {
                summary,
                additionalMetrics: {
                    cognitiveComplexity: parsed.metrics?.cognitiveComplexity
                }
            };
        } catch (error) {
            console.error('Failed to parse AI summary response:', error);
            return {
                summary: {
                    purpose: 'Summary failed - could not parse response',
                    mainComponents: [],
                    dependencies: [],
                    publicApi: [],
                    complexity: 'moderate'
                },
                additionalMetrics: {}
            };
        }
    }

    private parsePureProjectSummary(response: string): PureProjectSummary {
        try {
            const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : response;
            const parsed = JSON.parse(jsonStr);

            return {
                overview: parsed.overview || 'No overview available',
                architecture: parsed.architecture || '',
                mainModules: (parsed.modules || []).map((m: any) => ({
                    name: m.name || '',
                    path: m.path || '',
                    purpose: m.purpose || ''
                })),
                techStack: parsed.techStack || [],
                entryPoints: parsed.entryPoints || []
            };
        } catch (error) {
            console.error('Failed to parse pure project summary:', error);
            return {
                overview: 'Summary complete',
                architecture: '',
                mainModules: [],
                techStack: [],
                entryPoints: []
            };
        }
    }

    private parseAnalysisResponse(
        response: string,
        filePath: string
    ): {
        issues: CodeIssue[];
        summary: FileSummary;
        additionalMetrics: Partial<CodeMetrics>;
    } {
        try {
            // Extract JSON from response
            const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : response;
            const parsed = JSON.parse(jsonStr);

            const seenExact = new Set<string>();
            const issuesRaw: CodeIssue[] = (parsed.issues || [])
                .map((issue: any) => {
                    const startLine = issue.startLine || 1;
                    const endLine = issue.endLine || issue.startLine || 1;
                    const severity = this.mapSeverity(issue.severity);
                    const category = this.mapCategory(issue.category);
                    const title = issue.title || 'Unnamed Issue';
                    const exactKey = `${startLine}:${endLine}:${severity}:${category}:${String(title).trim()}`;
                    if (seenExact.has(exactKey)) {
                        return null;
                    }
                    seenExact.add(exactKey);
                    return {
                        id: uuidv4(),
                        filePath,
                        startLine,
                        endLine,
                        severity,
                        category,
                        title,
                        description: issue.description || '',
                        suggestion: issue.suggestion,
                        estimatedEffort: issue.effort || 'medium',
                        riskLevel: issue.risk || 'medium',
                        confidence: issue.confidence || 0.8
                    };
                })
                .filter((issue: CodeIssue | null): issue is CodeIssue => issue !== null);

            // Defensive de-dupe: some models repeat the same finding with different ranges.
            const issues = this.dedupeIssues(issuesRaw);

            const summary: FileSummary = {
                purpose: parsed.summary?.purpose || 'No summary available',
                mainComponents: parsed.summary?.components || [],
                dependencies: parsed.summary?.dependencies || [],
                publicApi: parsed.summary?.publicApi || [],
                complexity: parsed.summary?.complexity || 'moderate'
            };

            return {
                issues,
                summary,
                additionalMetrics: {
                    cognitiveComplexity: parsed.metrics?.cognitiveComplexity
                }
            };
        } catch (error) {
            console.error('Failed to parse AI response:', error);
            return {
                issues: [],
                summary: {
                    purpose: 'Analysis failed - could not parse response',
                    mainComponents: [],
                    dependencies: [],
                    publicApi: [],
                    complexity: 'moderate'
                },
                additionalMetrics: {}
            };
        }
    }

    private dedupeIssues(issues: CodeIssue[]): CodeIssue[] {
        const norm = (s: string | undefined) =>
            (s || '')
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .trim();

        const byFingerprint = new Map<string, CodeIssue>();

        for (const issue of issues) {
            const fingerprint = [
                issue.category,
                issue.severity,
                norm(issue.title),
                norm(issue.description),
                norm(issue.suggestion)
            ].join('|');

            // Keep the first occurrence; repeated ones are usually noise.
            if (!byFingerprint.has(fingerprint)) {
                byFingerprint.set(fingerprint, issue);
            }
        }

        return Array.from(byFingerprint.values());
    }

    private parseProjectSummary(
        response: string,
        fileAnalyses: Map<string, FileAnalysis>
    ): ProjectSummary {
        try {
            const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : response;
            const parsed = JSON.parse(jsonStr);

            // Build hotspots from file analyses
            const hotspots: HotspotInfo[] = Array.from(fileAnalyses.entries())
                .filter(([_, analysis]) => analysis.issues.length > 3)
                .map(([path, analysis]) => ({
                    path,
                    reason: `${analysis.issues.length} issues found`,
                    issueCount: analysis.issues.length,
                    severity: this.getHighestSeverity(analysis.issues)
                }))
                .sort((a, b) => b.issueCount - a.issueCount)
                .slice(0, 10);

            // Build module info
            const modules: ModuleInfo[] = (parsed.modules || []).map((m: any) => ({
                name: m.name,
                path: m.path,
                purpose: m.purpose,
                healthScore: m.healthScore || 80,
                issueCount: m.issueCount || 0
            }));

            return {
                overview: parsed.overview || 'No overview available',
                architecture: parsed.architecture || '',
                mainModules: modules,
                hotspots,
                recommendations: parsed.recommendations || []
            };
        } catch (error) {
            console.error('Failed to parse project summary:', error);
            return {
                overview: 'Analysis complete',
                architecture: '',
                mainModules: [],
                hotspots: [],
                recommendations: []
            };
        }
    }

    private computeMetrics(code: string): CodeMetrics {
        const lines = code.split('\n');
        const linesOfCode = lines.filter(line =>
            line.trim().length > 0 && !line.trim().startsWith('//')
        ).length;

        // Basic cyclomatic complexity estimation
        const complexityKeywords = [
            /\bif\b/, /\belse\b/, /\bfor\b/, /\bwhile\b/, /\bswitch\b/,
            /\bcatch\b/, /\b\?\b/, /\b&&\b/, /\b\|\|\b/, /\bcase\b/
        ];

        let cyclomaticComplexity = 1;
        for (const line of lines) {
            for (const pattern of complexityKeywords) {
                if (pattern.test(line)) {
                    cyclomaticComplexity++;
                }
            }
        }

        // Maintainability index (simplified formula)
        const avgLineLength = code.length / Math.max(lines.length, 1);
        const maintainabilityIndex = Math.max(0, Math.min(100,
            171 - 5.2 * Math.log(cyclomaticComplexity) -
            0.23 * cyclomaticComplexity -
            16.2 * Math.log(linesOfCode) +
            50 * Math.sin(Math.sqrt(2.4 * (avgLineLength / 100)))
        ));

        // Technical debt estimation (minutes)
        const technicalDebtMinutes = Math.round(
            cyclomaticComplexity * 2 +
            Math.max(0, linesOfCode - 200) * 0.1
        );

        return {
            linesOfCode,
            cyclomaticComplexity,
            cognitiveComplexity: cyclomaticComplexity * 1.5, // Estimate
            maintainabilityIndex: Math.round(maintainabilityIndex),
            technicalDebtMinutes
        };
    }

    private truncateCode(code: string, maxChars: number): string {
        if (code.length <= maxChars) return code;

        const lines = code.split('\n');
        let result = '';
        let charCount = 0;

        for (const line of lines) {
            if (charCount + line.length > maxChars) {
                result += '\n// ... (truncated)';
                break;
            }
            result += line + '\n';
            charCount += line.length + 1;
        }

        return result;
    }

    private addLineNumbers(code: string): string {
        const lines = code.split('\n');
        const width = String(lines.length).length;
        return lines
            .map((line, index) => `${String(index + 1).padStart(width, ' ')} | ${line}`)
            .join('\n');
    }

    private mapSeverity(severity: string): IssueSeverity {
        const map: Record<string, IssueSeverity> = {
            'info': IssueSeverity.Info,
            'warning': IssueSeverity.Warning,
            'error': IssueSeverity.Error,
            'critical': IssueSeverity.Critical
        };
        return map[severity?.toLowerCase()] || IssueSeverity.Warning;
    }

    private mapCategory(category: string): IssueCategory {
        const map: Record<string, IssueCategory> = {
            'code_smell': IssueCategory.CodeSmell,
            'technical_debt': IssueCategory.TechnicalDebt,
            'incomplete_logic': IssueCategory.IncompleteLogic,
            'complexity': IssueCategory.Complexity,
            'documentation': IssueCategory.Documentation,
            'security': IssueCategory.Security,
            'performance': IssueCategory.Performance,
            'testing': IssueCategory.Testing,
            'best_practice': IssueCategory.BestPractice
        };
        return map[category?.toLowerCase()] || IssueCategory.CodeSmell;
    }

    private getSeverityIcon(severity: IssueSeverity): string {
        const icons: Record<IssueSeverity, string> = {
            [IssueSeverity.Info]: 'ℹ️',
            [IssueSeverity.Warning]: '⚠️',
            [IssueSeverity.Error]: '❌',
            [IssueSeverity.Critical]: '🔴'
        };
        return icons[severity];
    }

    private getHighestSeverity(issues: CodeIssue[]): IssueSeverity {
        const severityOrder = [
            IssueSeverity.Info,
            IssueSeverity.Warning,
            IssueSeverity.Error,
            IssueSeverity.Critical
        ];

        let highest = IssueSeverity.Info;
        for (const issue of issues) {
            if (severityOrder.indexOf(issue.severity) > severityOrder.indexOf(highest)) {
                highest = issue.severity;
            }
        }
        return highest;
    }
}
