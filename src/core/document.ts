export interface UriLike {
    fsPath: string;
}

export interface TextDocumentLike {
    uri: UriLike;
    languageId: string;
    getText(range?: unknown): string;
}

export interface Logger {
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
}

export class NullLogger implements Logger {
    debug(): void {}
    info(): void {}
    warn(): void {}
    error(): void {}
}

