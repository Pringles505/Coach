import picomatch from 'picomatch';

export function isIncluded(relPathPosix: string, include: string[], exclude: string[]): boolean {
    const inc = include.length ? picomatch(include, { dot: true }) : () => true;
    const exc = exclude.length ? picomatch(exclude, { dot: true }) : () => false;
    return inc(relPathPosix) && !exc(relPathPosix);
}

