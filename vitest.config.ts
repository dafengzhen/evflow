import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      exclude: ['src/evflow.ts', 'src/types.ts', 'src/vite-env.d.ts'],
      include: ['src'],
      reporter: ['text', 'html', 'clover', 'json', 'json-summary'],
      reportOnFailure: true,
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
    environment: 'jsdom',
  },
});
