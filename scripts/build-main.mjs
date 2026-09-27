import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
mkdirSync(join(dist, 'main', 'assets'), { recursive: true });
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

// 托盘图标随主进程产物进入 asar：resources/ 只是构建资源目录，不会被打包
const traySrc = join(root, 'resources', 'tray.ico');
if (existsSync(traySrc)) {
  copyFileSync(traySrc, join(dist, 'main', 'assets', 'tray.ico'));
} else {
  console.warn('未找到 resources/tray.ico，托盘图标将回退为空图标');
}

console.log('built dist/main/index.js + dist/preload/index.js + dist/main/assets/tray.ico');
