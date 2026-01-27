export interface Spinner {
    update(text: string): void;
    stop(finalText?: string): void;
}

export function createSpinner(write: (s: string) => void): Spinner {
    const frames = ['|', '/', '-', '\\'];
    let idx = 0;
    let text = '';
    let timer: NodeJS.Timeout | undefined;

    const render = () => {
        const frame = frames[idx++ % frames.length];
        // Clear line + carriage return
        write(`\r\x1b[2K${frame} ${text}`);
    };

    timer = setInterval(render, 120);
    render();

    return {
        update(next: string) {
            text = next;
            render();
        },
        stop(finalText?: string) {
            if (timer) clearInterval(timer);
            timer = undefined;
            if (finalText) {
                write(`\r\x1b[2K${finalText}\n`);
            } else {
                write(`\r\x1b[2K`);
            }
        }
    };
}

