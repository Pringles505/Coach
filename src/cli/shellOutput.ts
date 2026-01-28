import { formatJson } from '../core/formatters/json';
import { formatMarkdown } from '../core/formatters/md';
import { formatPretty } from '../core/formatters/pretty';
import { formatSarif } from '../core/formatters/sarif';
import type { RunResult } from '../core/model';
import type { PureFileSummary, PureProjectSummary } from '../types';

export type OutputFormat = 'pretty' | 'json' | 'sarif' | 'md' | 'markdown';
export type SummarizeOutputFormat = 'json' | 'md' | 'markdown';

export function renderResult(format: string | undefined, result: RunResult): string {
    const f = (format || 'pretty').toLowerCase();
    switch (f as OutputFormat) {
        case 'pretty':
            return formatPretty(result);
        case 'json':
            return formatJson(result);
        case 'sarif':
            return formatSarif(result);
        case 'md':
        case 'markdown':
            return formatMarkdown(result);
        default:
            return formatPretty(result);
    }
}

export function formatTimestampForFilename(now = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    // Use UTC to keep filenames deterministic across machines/timezones.
    return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

export function defaultMarkdownFilename(now = new Date()): string {
    return `coach-${formatTimestampForFilename(now)}.md`;
}

export function defaultSummarizeFilename(now = new Date()): string {
    return `coach-summary-${formatTimestampForFilename(now)}.md`;
}

export interface SummarizeResult {
    type: 'file' | 'project';
    fileSummary?: PureFileSummary;
    projectSummary?: PureProjectSummary;
    rootPath?: string;
    filesAnalyzed?: number;
}

export function renderSummarizeResult(format: string | undefined, result: SummarizeResult): string {
    const f = (format || 'md').toLowerCase() as SummarizeOutputFormat;

    if (f === 'json') {
        if (result.type === 'file' && result.fileSummary) {
            return JSON.stringify(result.fileSummary, null, 2) + '\n';
        } else if (result.type === 'project' && result.projectSummary) {
            return JSON.stringify({
                rootPath: result.rootPath,
                filesAnalyzed: result.filesAnalyzed,
                projectSummary: result.projectSummary
            }, null, 2) + '\n';
        }
        return JSON.stringify(result, null, 2) + '\n';
    }

    // Default to markdown
    return formatSummarizeMarkdown(result);
}

export function formatSummarizeMarkdown(result: SummarizeResult): string {
    if (result.type === 'file' && result.fileSummary) {
        return formatFileSummaryMarkdown(result.fileSummary);
    } else if (result.type === 'project' && result.projectSummary) {
        return formatProjectSummaryMarkdown(result.projectSummary, {
            rootPath: result.rootPath,
            filesAnalyzed: result.filesAnalyzed
        });
    }
    return '# Summary\n\nNo summary data available.\n';
}

function formatFileSummaryMarkdown(summary: PureFileSummary): string {
    const { summary: fileSummary, metrics } = summary;

    let md = `# File Summary: ${summary.filePath.split(/[\\/]/).pop()}\n\n`;

    md += `## Purpose\n${fileSummary.purpose}\n\n`;

    md += `## Main Components\n`;
    for (const component of fileSummary.mainComponents) {
        md += `- ${component}\n`;
    }
    md += '\n';

    if (fileSummary.dependencies.length > 0) {
        md += `## Dependencies\n`;
        for (const dep of fileSummary.dependencies) {
            md += `- ${dep}\n`;
        }
        md += '\n';
    }

    if (fileSummary.publicApi.length > 0) {
        md += `## Public API\n`;
        for (const api of fileSummary.publicApi) {
            md += `- ${api}\n`;
        }
        md += '\n';
    }

    md += `## Metrics\n`;
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Lines of Code | ${metrics.linesOfCode} |\n`;
    md += `| Cyclomatic Complexity | ${metrics.cyclomaticComplexity} |\n`;
    md += `| Maintainability Index | ${metrics.maintainabilityIndex} |\n`;
    md += `| Complexity Level | ${fileSummary.complexity} |\n`;

    return md;
}

function formatProjectSummaryMarkdown(
    summary: PureProjectSummary,
    options?: { rootPath?: string; filesAnalyzed?: number }
): string {
    const workspaceName = options?.rootPath
        ? options.rootPath.split(/[\\/]/).filter(Boolean).pop()
        : 'Workspace';

    let md = `# Project Summary: ${workspaceName}\n\n`;

    if (options?.filesAnalyzed !== undefined) {
        md += `## Stats\n`;
        md += `- Files analyzed: ${options.filesAnalyzed}\n\n`;
    }

    md += `## Overview\n${summary.overview}\n\n`;
    md += `## Architecture\n${summary.architecture}\n\n`;

    md += `## Main Modules\n`;
    if (!summary.mainModules || summary.mainModules.length === 0) {
        md += `No modules identified.\n\n`;
    } else {
        for (const module of summary.mainModules) {
            md += `### ${module.name}\n`;
            md += `- Path: ${module.path}\n`;
            md += `- Purpose: ${module.purpose}\n\n`;
        }
    }

    if (summary.techStack && summary.techStack.length > 0) {
        md += `## Tech Stack\n`;
        for (const tech of summary.techStack) {
            md += `- ${tech}\n`;
        }
        md += '\n';
    }

    if (summary.entryPoints && summary.entryPoints.length > 0) {
        md += `## Entry Points\n`;
        for (const entry of summary.entryPoints) {
            md += `- ${entry}\n`;
        }
        md += '\n';
    }

    return md;
}
