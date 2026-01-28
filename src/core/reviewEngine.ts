import * as path from 'path';

import type { AIProvider, AgentContext } from '../types';
import { IssueSeverity } from '../types';
import { CodeAnalysisAgent } from '../agents/codeAnalysisAgent';

import type { Logger } from './document';
import { NullLogger } from './document';
import type { AgentReviewConfig } from './config';
import type { Finding, RunResult, Severity } from './model';
import { AgentReviewError } from './errors';
import { readTextFileSafe } from './fileSelection';

export interface ReviewSelectionMeta {
    mode: 'path' | 'changed' | 'since';
    sinceRef?: string;
    targetPath?: string;
}

export interface RunReviewOptions {
    rootPath: string;
    filePaths: string[];
    config: AgentReviewConfig;
    configFile?: string;
    selection: ReviewSelectionMeta;
    aiProvider: AIProvider;
    tool: { name: string; version: string };
    logger?: Logger;
    onProgress?: (event: {
        type: 'fileStart' | 'fileDone' | 'fileSkipped' | 'truncated';
        filePath?: string;
        index?: number;
        total: number;
        filesAnalyzed: number;
        findings: number;
    }) => void;
}

export function languageIdFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.ts': return 'typescript';
        case '.tsx': return 'typescriptreact';
        case '.js': return 'javascript';
        case '.jsx': return 'javascriptreact';
        case '.py': return 'python';
        case '.java': return 'java';
        case '.cs': return 'csharp';
        case '.go': return 'go';
        case '.rs': return 'rust';
        case '.cpp': return 'cpp';
        case '.c': return 'c';
        case '.rb': return 'ruby';
        case '.php': return 'php';
        case '.swift': return 'swift';
        case '.kt': return 'kotlin';
        default: return 'plaintext';
    }
}

function mapSeverity(sev: IssueSeverity): Severity {
    if (sev === IssueSeverity.Info) return 'info';
    if (sev === IssueSeverity.Warning) return 'warning';
    return 'error';
}

function toFinding(rootPath: string, issue: any): Finding {
    const rel = path.relative(rootPath, issue.filePath);
    const file = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : issue.filePath;
    return {
        file,
        range: issue.startLine ? {
            start: { line: issue.startLine, column: issue.startColumn },
            end: { line: issue.endLine || issue.startLine, column: issue.endColumn }
        } : undefined,
        severity: mapSeverity(issue.severity),
        category: String(issue.category || 'code_smell'),
        title: String(issue.title || 'Issue'),
        message: String(issue.description || ''),
        suggestion: issue.suggestion ? String(issue.suggestion) : undefined,
        ruleId: String(issue.category || 'coach'),
        confidence: typeof issue.confidence === 'number' ? issue.confidence : undefined
    };
}

function buildSummary(findings: Finding[], filesAnalyzed: number): string {
    const counts = { info: 0, warning: 0, error: 0 } as Record<Severity, number>;
    for (const f of findings) counts[f.severity]++;
    const total = findings.length;
    return `Analyzed ${filesAnalyzed} file(s). Found ${total} finding(s) (${counts.error} error, ${counts.warning} warning, ${counts.info} info).`;
}

export async function runReview(opts: RunReviewOptions): Promise<RunResult> {
    const logger = opts.logger || new NullLogger();
    const started = Date.now();
    const startedAt = new Date(started).toISOString();

    const rootPath = path.resolve(opts.rootPath);
    const agent = new CodeAnalysisAgent(opts.aiProvider);

    const context: AgentContext = {
        workspaceRoot: rootPath,
        analysisCache: new Map(),
        existingTasks: [],
        userPreferences: {
            workHoursStart: 9,
            workHoursEnd: 17,
            focusSessionDuration: 90,
            preferredTaskTypes: [],
            excludePatterns: opts.config.exclude,
            analysisDepth: opts.config.analysisDepth
        }
    };

    const findings: Finding[] = [];
    let filesAnalyzed = 0;
    const total = opts.filePaths.length;

    for (let i = 0; i < opts.filePaths.length; i++) {
        const filePath = opts.filePaths[i];
        opts.onProgress?.({ type: 'fileStart', filePath, index: i + 1, total, filesAnalyzed, findings: findings.length });
        const text = readTextFileSafe(filePath, opts.config.maxFileSizeBytes);
        if (text == null) {
            logger.debug('Skipping file (binary/too large)', { filePath });
            opts.onProgress?.({ type: 'fileSkipped', filePath, index: i + 1, total, filesAnalyzed, findings: findings.length });
            continue;
        }

        const document = {
            uri: { fsPath: filePath },
            languageId: languageIdFromPath(filePath),
            getText: () => text
        };

        try {
            const analysis = await agent.analyze(document, context);
            filesAnalyzed++;
            for (const issue of analysis.issues) {
                findings.push(toFinding(rootPath, issue));
                if (findings.length >= opts.config.maxFindings) {
                    logger.warn('Max findings reached; truncating output', { maxFindings: opts.config.maxFindings });
                    opts.onProgress?.({ type: 'truncated', total, filesAnalyzed, findings: findings.length });
                    break;
                }
            }
        } catch (error) {
            throw new AgentReviewError(`Failed to analyze ${filePath}: ${(error as Error).message}`, 'RUNTIME', error);
        }

        opts.onProgress?.({ type: 'fileDone', filePath, index: i + 1, total, filesAnalyzed, findings: findings.length });
        if (findings.length >= opts.config.maxFindings) break;
    }

    const ended = Date.now();
    const endedAt = new Date(ended).toISOString();

    return {
        findings,
        summary: buildSummary(findings, filesAnalyzed),
        meta: {
            rootPath,
            startedAt,
            endedAt,
            durationMs: ended - started,
            filesAnalyzed,
            tool: opts.tool,
            configFile: opts.configFile,
            selection: opts.selection,
            truncated: findings.length >= opts.config.maxFindings ? true : undefined
        }
    };
}
