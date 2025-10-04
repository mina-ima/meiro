import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@meiro/common': resolve(__dirname, '../packages/common/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30000,
    coverage: {
      reporter: ['text', 'lcov'],
    },
    passWithNoTests: true,
  },
});
