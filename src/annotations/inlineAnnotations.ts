import * as vscode from 'vscode';
import { AnalysisCache } from '../cache/analysisCache';
import { CodeIssue, IssueSeverity, IssueCategory } from '../types';

/**
 * InlineAnnotationController manages inline decorations showing code issues
 * with high-visibility styling that stands out in any theme
 */
export class InlineAnnotationController {
    private decorationTypes: Map<IssueSeverity, vscode.TextEditorDecorationType> = new Map();
    private gutterDecorations: Map<IssueSeverity, vscode.TextEditorDecorationType> = new Map();
    private activeEditor: vscode.TextEditor | undefined;
    private disposables: vscode.Disposable[] = [];
    private isActive = false;

    constructor(private analysisCache: AnalysisCache) {
        this.createDecorationTypes();
    }

    setAnalysisCache(cache: AnalysisCache): void {
        this.analysisCache = cache;
        this.refresh();
    }

    /**
     * Activate inline annotations
     */
    activate(context: vscode.ExtensionContext): void {
        if (this.isActive) return;
        this.isActive = true;

        this.activeEditor = vscode.window.activeTextEditor;

        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                this.activeEditor = editor;
                if (editor) {
                    this.updateDecorations(editor);
                }
            })
        );

        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                if (this.activeEditor && event.document === this.activeEditor.document) {
                    // Clear cached analysis to avoid misaligned annotations after edits
                    this.analysisCache.remove(event.document.uri.fsPath);
                    this.updateDecorations(this.activeEditor);
                }
            })
        );

        if (this.activeEditor) {
            this.updateDecorations(this.activeEditor);
        }
    }

    /**
     * Deactivate inline annotations
     */
    deactivate(): void {
        this.isActive = false;

        for (const decorationType of this.decorationTypes.values()) {
            if (this.activeEditor) {
                this.activeEditor.setDecorations(decorationType, []);
            }
        }
        for (const decorationType of this.gutterDecorations.values()) {
            if (this.activeEditor) {
                this.activeEditor.setDecorations(decorationType, []);
            }
        }

        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }

    /**
     * Update decorations for an editor
     */
    updateDecorations(editor: vscode.TextEditor): void {
        if (!this.isActive) return;

        const filePath = editor.document.uri.fsPath;
        const analysis = this.analysisCache.get(filePath);

        // Clear existing decorations
        for (const decorationType of this.decorationTypes.values()) {
            editor.setDecorations(decorationType, []);
        }
        for (const decorationType of this.gutterDecorations.values()) {
            editor.setDecorations(decorationType, []);
        }

        if (!analysis || analysis.issues.length === 0) {
            return;
        }

        // Group issues by severity
        const bySeverity = new Map<IssueSeverity, vscode.DecorationOptions[]>();
        const gutterBySeverity = new Map<IssueSeverity, vscode.DecorationOptions[]>();
        for (const severity of Object.values(IssueSeverity)) {
            bySeverity.set(severity, []);
            gutterBySeverity.set(severity, []);
        }

        const seen = new Set<string>();
        for (const issue of analysis.issues) {
            // Defensive de-dupe: AI output sometimes repeats the same finding with slightly different ranges.
            const fingerprint = this.issueFingerprint(issue);
            if (seen.has(fingerprint)) continue;
            seen.add(fingerprint);

            const decoration = this.createDecoration(issue, editor.document);
            if (decoration) {
                bySeverity.get(issue.severity)!.push(decoration);
                gutterBySeverity.get(issue.severity)!.push({ range: decoration.range });
            }
        }

        // Apply decorations
        for (const [severity, decorations] of bySeverity) {
            const decorationType = this.decorationTypes.get(severity);
            const gutterType = this.gutterDecorations.get(severity);
            if (decorationType && decorations.length > 0) {
                editor.setDecorations(decorationType, decorations);
            }
            const gutterDecorations = gutterBySeverity.get(severity) || [];
            if (gutterType && gutterDecorations.length > 0) {
                editor.setDecorations(gutterType, gutterDecorations);
            }
        }
    }

    refresh(): void {
        if (this.activeEditor) {
            this.updateDecorations(this.activeEditor);
        }
    }

    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------

    private createDecorationTypes(): void {
        // High-visibility inline annotations with bold backgrounds

        // Info - Blue with high contrast
        this.decorationTypes.set(IssueSeverity.Info, vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                backgroundColor: '#1e90ff',
                color: '#ffffff',
                fontWeight: 'bold',
                border: '1px solid #0066cc',
                textDecoration: 'none; padding: 2px 8px; border-radius: 3px; font-size: 11px;'
            },
            overviewRulerColor: '#1e90ff',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        }));

        // Warning - Bright orange/yellow
        this.decorationTypes.set(IssueSeverity.Warning, vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                backgroundColor: '#ff8c00',
                color: '#000000',
                fontWeight: 'bold',
                border: '1px solid #cc7000',
                textDecoration: 'none; padding: 2px 8px; border-radius: 3px; font-size: 11px;'
            },
            backgroundColor: 'rgba(255, 140, 0, 0.15)',
            overviewRulerColor: '#ff8c00',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        }));

        // Error - Bright red
        this.decorationTypes.set(IssueSeverity.Error, vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                backgroundColor: '#ff3333',
                color: '#ffffff',
                fontWeight: 'bold',
                border: '1px solid #cc0000',
                textDecoration: 'none; padding: 2px 8px; border-radius: 3px; font-size: 11px;'
            },
            backgroundColor: 'rgba(255, 51, 51, 0.2)',
            overviewRulerColor: '#ff3333',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        }));

        // Critical - Purple/Magenta with strong highlight
        this.decorationTypes.set(IssueSeverity.Critical, vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                backgroundColor: '#ff00ff',
                color: '#ffffff',
                fontWeight: 'bold',
                border: '2px solid #cc00cc',
                textDecoration: 'none; padding: 2px 10px; border-radius: 3px; font-size: 12px;'
            },
            backgroundColor: 'rgba(255, 0, 255, 0.25)',
            border: '1px solid rgba(255, 0, 255, 0.5)',
            overviewRulerColor: '#ff00ff',
            overviewRulerLane: vscode.OverviewRulerLane.Full
        }));

        // Gutter icons for additional visibility
        this.gutterDecorations.set(IssueSeverity.Info, vscode.window.createTextEditorDecorationType({
            gutterIconPath: this.createGutterIcon('#1e90ff'),
            gutterIconSize: 'contain'
        }));

        this.gutterDecorations.set(IssueSeverity.Warning, vscode.window.createTextEditorDecorationType({
            gutterIconPath: this.createGutterIcon('#ff8c00'),
            gutterIconSize: 'contain'
        }));

        this.gutterDecorations.set(IssueSeverity.Error, vscode.window.createTextEditorDecorationType({
            gutterIconPath: this.createGutterIcon('#ff3333'),
            gutterIconSize: 'contain'
        }));

        this.gutterDecorations.set(IssueSeverity.Critical, vscode.window.createTextEditorDecorationType({
            gutterIconPath: this.createGutterIcon('#ff00ff'),
            gutterIconSize: 'contain'
        }));
    }

    private createGutterIcon(color: string): vscode.Uri {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="6" fill="${color}" stroke="${color}" stroke-width="1"/>
            <text x="8" y="11" text-anchor="middle" fill="white" font-size="10" font-weight="bold">!</text>
        </svg>`;
        return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
    }

    private createDecoration(issue: CodeIssue, document: vscode.TextDocument): vscode.DecorationOptions | null {
        if (issue.startLine < 1 || issue.startLine > document.lineCount) {
            return null;
        }

        const startLine = issue.startLine - 1;
        const line = document.lineAt(startLine);

        // Anchor the inline label to the start line to avoid end-line drift
        const range = new vscode.Range(
            startLine,
            issue.startColumn ?? line.firstNonWhitespaceCharacterIndex,
            startLine,
            line.range.end.character
        );

        // Keep hover minimal to reduce distraction.
        const hoverMessage = this.createCompactHover(issue);

        return {
            range,
            hoverMessage,
            renderOptions: {
                after: {
                    contentText: ` ${this.getInlineBadge(issue)}`,
                }
            }
        };
    }

    private createCompactHover(issue: CodeIssue): vscode.MarkdownString {
        const hover = new vscode.MarkdownString();
        hover.supportHtml = false;
        hover.isTrusted = false;

        // 2-3 lines max; keep it scannable.
        hover.appendMarkdown(`${this.getSeverityEmoji(issue.severity)} **${issue.title}**\n`);
        hover.appendMarkdown(`${issue.severity.toUpperCase()} · ${this.getCategoryLabel(issue.category)} · Line ${issue.startLine}\n\n`);

        const detail = (issue.suggestion || issue.description || '').trim();
        if (detail) {
            hover.appendMarkdown(this.truncateOneLine(detail, 160));
        }

        return hover;
    }

    private getInlineBadge(issue: CodeIssue): string {
        const category: Partial<Record<IssueCategory, string>> = {
            [IssueCategory.CodeSmell]: 'REFACTOR',
            [IssueCategory.TechnicalDebt]: 'DEBT',
            [IssueCategory.IncompleteLogic]: 'LOGIC',
            [IssueCategory.Complexity]: 'COMPLEX',
            [IssueCategory.Documentation]: 'DOCS',
            [IssueCategory.Security]: 'SEC',
            [IssueCategory.Performance]: 'PERF',
            [IssueCategory.Testing]: 'TESTS',
            [IssueCategory.BestPractice]: 'BP'
        };

        const cat = category[issue.category] || 'ISSUE';
        const sev = issue.severity.toUpperCase().slice(0, 4);
        return `${this.getSeverityEmoji(issue.severity)} ${sev} ${cat}`;
    }

    private issueFingerprint(issue: CodeIssue): string {
        const norm = (s: string | undefined) =>
            (s || '')
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .trim();

        return [
            issue.category,
            issue.severity,
            norm(issue.title),
            norm(issue.description),
            norm(issue.suggestion)
        ].join('|');
    }

    private truncateOneLine(text: string, max: number): string {
        const oneLine = text.replace(/\s+/g, ' ').trim();
        if (oneLine.length <= max) return oneLine;
        return `${oneLine.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
    }

    private getSeverityEmoji(severity: IssueSeverity): string {
        const emojis: Record<IssueSeverity, string> = {
            [IssueSeverity.Info]: 'ℹ️',
            [IssueSeverity.Warning]: '⚠️',
            [IssueSeverity.Error]: '❌',
            [IssueSeverity.Critical]: '🚨'
        };
        return emojis[severity];
    }

    private getSeverityColor(severity: IssueSeverity): string {
        const colors: Record<IssueSeverity, string> = {
            [IssueSeverity.Info]: '#1e90ff',
            [IssueSeverity.Warning]: '#ff8c00',
            [IssueSeverity.Error]: '#ff3333',
            [IssueSeverity.Critical]: '#ff00ff'
        };
        return colors[severity];
    }

    private getCategoryLabel(category: IssueCategory): string {
        const labels: Record<IssueCategory, string> = {
            [IssueCategory.CodeSmell]: 'Code Smell',
            [IssueCategory.TechnicalDebt]: 'Tech Debt',
            [IssueCategory.IncompleteLogic]: 'Incomplete',
            [IssueCategory.Complexity]: 'Complexity',
            [IssueCategory.Documentation]: 'Documentation',
            [IssueCategory.Security]: 'Security',
            [IssueCategory.Performance]: 'Performance',
            [IssueCategory.Testing]: 'Testing',
            [IssueCategory.BestPractice]: 'Best Practice'
        };
        return labels[category];
    }

    private formatEffort(effort: string): string {
        const formats: Record<string, string> = {
            'trivial': '🟢 Trivial (~5 min)',
            'small': '🟢 Small (~15 min)',
            'medium': '🟡 Medium (~30 min)',
            'large': '🟠 Large (~1 hour)',
            'xlarge': '🔴 X-Large (2+ hours)'
        };
        return formats[effort] || effort;
    }

    private formatRisk(risk: string): string {
        const formats: Record<string, string> = {
            'low': '🟢 Low',
            'medium': '🟡 Medium',
            'high': '🟠 High',
            'critical': '🔴 Critical'
        };
        return formats[risk] || risk;
    }
}
