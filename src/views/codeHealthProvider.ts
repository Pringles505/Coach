import * as vscode from 'vscode';
import { AnalysisCache } from '../cache/analysisCache';
import { FileAnalysis, IssueCategory, IssueSeverity, CodeIssue } from '../types';

/**
 * CodeHealthProvider shows code health in a tree view
 */
export class CodeHealthProvider implements vscode.TreeDataProvider<HealthTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<HealthTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private analysisCache: AnalysisCache) {}

    setAnalysisCache(cache: AnalysisCache): void {
        this.analysisCache = cache;
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: HealthTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: HealthTreeItem): Thenable<HealthTreeItem[]> {
        if (!element) {
            return Promise.resolve(this.getRootItems());
        }

        switch (element.contextValue) {
            case 'category':
                return Promise.resolve(this.getIssuesForCategory(element.categoryType!));
            case 'file':
                return Promise.resolve(this.getIssuesForFile(element.filePath!));
            case 'summary':
                return Promise.resolve(this.getSummaryDetails());
            default:
                return Promise.resolve([]);
        }
    }

    private getRootItems(): HealthTreeItem[] {
        const analyses = this.analysisCache.getAll();
        const stats = this.analysisCache.getStats();

        if (analyses.size === 0) {
            return [
                new HealthTreeItem(
                    'No analysis data',
                    vscode.TreeItemCollapsibleState.None,
                    'empty'
                )
            ];
        }

        const items: HealthTreeItem[] = [];

        // Summary section
        items.push(new HealthTreeItem(
            `📊 Summary (${stats.size} files, ${stats.totalIssues} issues)`,
            vscode.TreeItemCollapsibleState.Collapsed,
            'summary'
        ));

        // Issues by category
        const byCategory = this.groupByCategory(analyses);
        for (const [category, issues] of byCategory) {
            if (issues.length > 0) {
                const item = new HealthTreeItem(
                    `${this.getCategoryIcon(category)} ${this.getCategoryLabel(category)} (${issues.length})`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'category'
                );
                item.categoryType = category;
                items.push(item);
            }
        }

        // Files with issues
        items.push(new HealthTreeItem(
            '📁 Files with Issues',
            vscode.TreeItemCollapsibleState.Collapsed,
            'files-section'
        ));

        return items;
    }

    private getSummaryDetails(): HealthTreeItem[] {
        const analyses = this.analysisCache.getAll();
        const items: HealthTreeItem[] = [];

        let totalComplexity = 0;
        let totalDebt = 0;
        let fileCount = 0;

        for (const analysis of analyses.values()) {
            totalComplexity += analysis.metrics.cyclomaticComplexity;
            totalDebt += analysis.metrics.technicalDebtMinutes;
            fileCount++;
        }

        const avgComplexity = fileCount > 0 ? Math.round(totalComplexity / fileCount) : 0;

        items.push(this.createInfoItem('Files Analyzed', fileCount.toString()));
        items.push(this.createInfoItem('Avg Complexity', avgComplexity.toString()));
        items.push(this.createInfoItem('Technical Debt', `${totalDebt} min`));

        return items;
    }

    private getIssuesForCategory(category: IssueCategory): HealthTreeItem[] {
        const analyses = this.analysisCache.getAll();
        const items: HealthTreeItem[] = [];

        for (const analysis of analyses.values()) {
            const categoryIssues = analysis.issues.filter(i => i.category === category);

            for (const issue of categoryIssues) {
                const item = new HealthTreeItem(
                    `${this.getSeverityIcon(issue.severity)} ${issue.title}`,
                    vscode.TreeItemCollapsibleState.None,
                    'issue'
                );

                item.description = `Line ${issue.startLine}`;
                item.tooltip = new vscode.MarkdownString(
                    `**${issue.title}**\n\n${issue.description}\n\n` +
                    (issue.suggestion ? `**Suggestion:** ${issue.suggestion}` : '')
                );

                item.command = {
                    command: 'vscode.open',
                    title: 'Go to Issue',
                    arguments: [
                        vscode.Uri.file(analysis.filePath),
                        { selection: new vscode.Range(issue.startLine - 1, 0, issue.endLine - 1, 0) }
                    ]
                };

                items.push(item);
            }
        }

        return items;
    }

    private getIssuesForFile(filePath: string): HealthTreeItem[] {
        const analysis = this.analysisCache.get(filePath);
        if (!analysis) return [];

        return analysis.issues.map(issue => {
            const item = new HealthTreeItem(
                `${this.getSeverityIcon(issue.severity)} ${issue.title}`,
                vscode.TreeItemCollapsibleState.None,
                'issue'
            );

            item.description = `Line ${issue.startLine}`;
            item.tooltip = new vscode.MarkdownString(
                `**${issue.title}**\n\n${issue.description}`
            );

            item.command = {
                command: 'vscode.open',
                title: 'Go to Issue',
                arguments: [
                    vscode.Uri.file(filePath),
                    { selection: new vscode.Range(issue.startLine - 1, 0, issue.endLine - 1, 0) }
                ]
            };

            return item;
        });
    }

    private groupByCategory(analyses: Map<string, FileAnalysis>): Map<IssueCategory, CodeIssue[]> {
        const grouped = new Map<IssueCategory, CodeIssue[]>();

        for (const category of Object.values(IssueCategory)) {
            grouped.set(category, []);
        }

        for (const analysis of analyses.values()) {
            for (const issue of analysis.issues) {
                grouped.get(issue.category)!.push(issue);
            }
        }

        return grouped;
    }

    private createInfoItem(label: string, value: string): HealthTreeItem {
        const item = new HealthTreeItem(
            label,
            vscode.TreeItemCollapsibleState.None,
            'info'
        );
        item.description = value;
        return item;
    }

    private getCategoryIcon(category: IssueCategory): string {
        const icons: Record<IssueCategory, string> = {
            [IssueCategory.CodeSmell]: '👃',
            [IssueCategory.TechnicalDebt]: '💳',
            [IssueCategory.IncompleteLogic]: '🔲',
            [IssueCategory.Complexity]: '🔀',
            [IssueCategory.Documentation]: '📝',
            [IssueCategory.Security]: '🔒',
            [IssueCategory.Performance]: '⚡',
            [IssueCategory.Testing]: '🧪',
            [IssueCategory.BestPractice]: '✨'
        };
        return icons[category] || '•';
    }

    private getCategoryLabel(category: IssueCategory): string {
        const labels: Record<IssueCategory, string> = {
            [IssueCategory.CodeSmell]: 'Code Smells',
            [IssueCategory.TechnicalDebt]: 'Technical Debt',
            [IssueCategory.IncompleteLogic]: 'Incomplete Logic',
            [IssueCategory.Complexity]: 'Complexity',
            [IssueCategory.Documentation]: 'Documentation',
            [IssueCategory.Security]: 'Security',
            [IssueCategory.Performance]: 'Performance',
            [IssueCategory.Testing]: 'Testing',
            [IssueCategory.BestPractice]: 'Best Practices'
        };
        return labels[category] || category;
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
}

class HealthTreeItem extends vscode.TreeItem {
    public categoryType?: IssueCategory;
    public filePath?: string;

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string
    ) {
        super(label, collapsibleState);
    }
}
