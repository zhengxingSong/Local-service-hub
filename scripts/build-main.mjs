import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
mkdirSync(join(dist, 'main'), { recursive: true });
mkdirSync(join(dist, 'preload'), { recursive: true });

const common = { bundle: true, platform: 'node', target: 'node22', external: ['electron'], logLevel: 'info' };

await build({
  ...common,
  entryPoints: [join(root, 'src', 'main', 'index.ts')],
  format: 'esm',
  outfile: join(dist, 'main', 'index.js'),
});

await build({
  ...common,
  entryPoints: [join(root, 'src', 'preload', 'index.ts')],
  format: 'cjs',
  outfile: join(dist, 'preload', 'index.js'),
});

console.log('built dist/main/index.js + dist/preload/index.js');
