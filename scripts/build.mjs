import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
});

await build({
  entryPoints: ['src/cli/cli.ts'],
  bundle: true,
  outfile: 'dist/cli.js',
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  // Prefer ESM entrypoints for dependencies when available (e.g. jsonc-parser),
  // to ensure esbuild can statically bundle their internal modules.
  mainFields: ['module', 'main'],
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __PKG_NAME__: JSON.stringify(pkg.name),
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
