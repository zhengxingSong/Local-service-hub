import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(desktopRoot, 'src', 'renderer');

export default defineConfig({
  root: rendererRoot,
  base: './',
  plugins: [react()],
  build: {
    outDir: join(desktopRoot, 'dist', 'renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: join(rendererRoot, 'index.html'),
    },
  },
  server: { port: 5173, strictPort: true },
});
