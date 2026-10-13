import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const PUBLIC_SKIP = new Set(['CNAME', '.nojekyll']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Emits dist/sw.js: precache every built asset + public file, versioned by their content. */
function serviceWorker(): Plugin {
  return {
    name: 'rec-deck-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const hash = createHash('sha256');
      const files = new Set<string>(['/', '/index.html']);
      for (const [name, chunk] of Object.entries(bundle)) {
        if (name.endsWith('.map')) continue;
        files.add(`/${name}`);
        hash.update(name);
        hash.update(chunk.type === 'chunk' ? chunk.code : chunk.source);
      }
      const pub = join(import.meta.dirname, 'public');
      for (const full of walk(pub)) {
        const rel = relative(pub, full).split('\\').join('/');
        if (PUBLIC_SKIP.has(rel) || rel.startsWith('.')) continue;
        files.add(`/${rel}`);
        hash.update(rel);
        hash.update(readFileSync(full));
      }
      const template = readFileSync(join(import.meta.dirname, 'src/shell/sw-template.js'), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__VERSION__', hash.digest('hex').slice(0, 12))
          .replace('__PRECACHE__', JSON.stringify([...files].sort(), null, 2)),
      });
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [serviceWorker()],
  build: { outDir: 'dist', target: 'es2022' },
  test: {
    include: ['src/**/*.test.ts', 'worker/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      enabled: true,
      include: ['worker/src/streaks.ts'],
      reporter: ['text'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
