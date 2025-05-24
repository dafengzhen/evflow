import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, 'src/evflow.ts'),
      formats: ['es', 'cjs'],
    },
    sourcemap: true,
    target: 'esnext',
  },
  plugins: [dts({ exclude: ['**/*.test.ts'] })],
});
