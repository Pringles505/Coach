import * as path from 'path';
import { pathToFileURL } from 'url';

import type { Finding, RunResult } from '../model';
import { severityToSarifLevel } from '../config';

type SarifLog = {
    $schema: string;
    version: '2.1.0';
    runs: Array<{
        tool: { driver: { name: string; version?: string; rules?: Array<{ id: string; name?: string; shortDescription?: { text: string } }> } };
        results: Array<{
            ruleId?: string;
            level: 'note' | 'warning' | 'error';
            message: { text: string };
            locations?: Array<{
                physicalLocation: {
                    artifactLocation: { uri: string };
                    region?: { startLine?: number; startColumn?: number; endLine?: number; endColumn?: number };
                };
            }>;
            properties?: Record<string, unknown>;
        }>;
    }>;
};

function toSarifLocation(rootPath: string, f: Finding): SarifLog['runs'][0]['results'][0]['locations'] {
    const abs = path.isAbsolute(f.file) ? f.file : path.join(rootPath, f.file);
    const uri = pathToFileURL(abs).toString();
    if (!f.range) {
        return [{ physicalLocation: { artifactLocation: { uri } } }];
    }
    return [{
        physicalLocation: {
            artifactLocation: { uri },
            region: {
                startLine: f.range.start.line,
                startColumn: f.range.start.column,
                endLine: f.range.end.line,
                endColumn: f.range.end.column
            }
        }
    }];
}

export function formatSarif(result: RunResult): string {
    const rulesMap = new Map<string, { id: string; name?: string; shortDescription?: { text: string } }>();
    for (const f of result.findings) {
        const id = f.ruleId || f.category || 'coach';
        if (!rulesMap.has(id)) {
            rulesMap.set(id, { id, name: f.category, shortDescription: { text: f.title } });
        }
    }

    const log: SarifLog = {
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [{
            tool: {
                driver: {
                    name: result.meta.tool.name,
                    version: result.meta.tool.version,
                    rules: Array.from(rulesMap.values())
                }
            },
            results: result.findings.map(f => ({
                ruleId: f.ruleId || f.category,
                level: severityToSarifLevel(f.severity),
                message: { text: `${f.title}${f.message ? `: ${f.message}` : ''}` },
                locations: toSarifLocation(result.meta.rootPath, f),
                properties: {
                    category: f.category,
                    confidence: f.confidence
                }
            }))
        }]
    };

    return JSON.stringify(log, null, 2) + '\n';
}
