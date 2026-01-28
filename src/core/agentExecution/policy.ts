import * as path from 'path';

import picomatch from 'picomatch';

import type { WorkspaceAgentExecutionConfig } from './types';

export interface Decision {
    allowed: boolean;
    requiresApproval: boolean;
    reason: string;
}

function normalizeCommand(command: string): string {
    return command.trim().replace(/\s+/g, ' ');
}

export function isDangerousCommand(command: string): boolean {
    const c = normalizeCommand(command).toLowerCase();
    // Always treat multi-line commands as dangerous/invalid.
    if (c.includes('\n') || c.includes('\r')) return true;

    // Extremely destructive operations across common shells.
    const patterns: RegExp[] = [
        /\brm\s+-rf\b/,
        /\brm\s+-r\b/,
        /\bdel\b.*\s\/s\b/,
        /\brmdir\b.*\s\/s\b/,
        /\bformat\b/,
        /\bmkfs\b/,
        /\bdd\b\s+if=/,
        /\bshutdown\b/,
        /\breboot\b/,
        /\bpoweroff\b/,
        /\bkill\s+-9\b/,
        /\bgit\s+reset\s+--hard\b/,
        /\bgit\s+clean\s+-f\b/,
        /\bRemove-Item\b.*-Recurse\b.*-Force\b/i
    ];

    return patterns.some((re) => re.test(c));
}

export function checkCommand(command: string, exec: WorkspaceAgentExecutionConfig): Decision {
    const normalized = normalizeCommand(command);
    if (!normalized) {
        return { allowed: false, requiresApproval: false, reason: 'Empty command.' };
    }

    const dangerous = isDangerousCommand(normalized);
    if (dangerous && !exec.allowDangerous) {
        return { allowed: false, requiresApproval: false, reason: 'Dangerous commands are disabled by policy (allowDangerous=false).' };
    }

    // Unrestricted means "allowed unless dangerous is disabled".
    if (exec.policy === 'unrestricted') {
        return { allowed: true, requiresApproval: false, reason: 'Allowed by unrestricted policy.' };
    }

    const exactAllowed = new Set((exec.allowedCommands || []).map(normalizeCommand));
    if (exactAllowed.has(normalized)) {
        return { allowed: true, requiresApproval: false, reason: 'Allowed by exact allowlist.' };
    }

    const prefixes = (exec.allowedCommandPrefixes || []).map((p) => normalizeCommand(p));
    if (prefixes.some((p) => p && normalized.toLowerCase().startsWith(p.toLowerCase()))) {
        return { allowed: true, requiresApproval: false, reason: 'Allowed by prefix allowlist.' };
    }

    // Conservative/standard: anything else requires approval.
    if (exec.policy === 'conservative' || exec.policy === 'standard') {
        return { allowed: false, requiresApproval: true, reason: 'Command not allowlisted.' };
    }

    return { allowed: false, requiresApproval: true, reason: 'Command not allowlisted.' };
}

export function toRelPath(rootPath: string, targetPath: string): string {
    const abs = path.resolve(rootPath, targetPath);
    const rel = path.relative(rootPath, abs);
    return rel.replace(/\\/g, '/');
}

export function isPathWithinRoot(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/');
    return !normalized.startsWith('../') && normalized !== '..';
}

export function checkWritePath(relPath: string, exec: WorkspaceAgentExecutionConfig): Decision {
    const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized) {
        return { allowed: false, requiresApproval: false, reason: 'Empty path.' };
    }
    if (!isPathWithinRoot(normalized)) {
        return { allowed: false, requiresApproval: false, reason: 'Path escapes workspace root.' };
    }

    const isDenied = (exec.deniedPathGlobs || []).some((g) => picomatch(g, { dot: true })(normalized));
    if (isDenied) {
        return { allowed: false, requiresApproval: false, reason: `Path is denied by policy: ${normalized}` };
    }

    const allowedGlobs = exec.allowedPathGlobs || ['**/*'];
    const isAllowed = allowedGlobs.some((g) => picomatch(g, { dot: true })(normalized));
    if (!isAllowed) {
        return { allowed: false, requiresApproval: true, reason: `Path is outside allowed scope: ${normalized}` };
    }

    return { allowed: true, requiresApproval: false, reason: 'Path allowed.' };
}
