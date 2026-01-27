export class AgentReviewError extends Error {
    constructor(message: string, public readonly code: 'CONFIG' | 'RUNTIME', cause?: unknown) {
        super(message);
        this.name = 'AgentReviewError';
        if (cause) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).cause = cause;
        }
    }
}

