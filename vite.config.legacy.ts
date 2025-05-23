import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

import viteBabelPlugin from './vite-babel-plugin';

export default defineConfig({
  build: {
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, 'src'),
      formats: ['es', 'cjs'],
    },
    outDir: 'dist/legacy',
    sourcemap: true,
    target: 'es2015',
  },
  plugins: [viteBabelPlugin(), dts({ exclude: ['**/*.test.ts'] })],
});
