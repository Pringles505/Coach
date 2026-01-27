export function tokenize(input: string): string[] {
    const args: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escape = false;

    const push = () => {
        if (current.length > 0) {
            args.push(current);
            current = '';
        }
    };

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];

        // Only treat backslash as an escape *inside quoted strings*.
        // This keeps Windows paths like C:\Users\... working when unquoted.
        if (escape) {
            current += ch;
            escape = false;
            continue;
        }

        if (quote && ch === '\\') {
            escape = true;
            continue;
        }

        if (quote) {
            if (ch === quote) {
                quote = null;
            } else {
                current += ch;
            }
            continue;
        }

        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }

        if (/\s/.test(ch)) {
            push();
            continue;
        }

        current += ch;
    }

    push();
    return args;
}
