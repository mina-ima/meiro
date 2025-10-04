import { defineConfig } from 'vitest/config';

const commonEntryUrl = new URL('../packages/common/src/index.ts', import.meta.url);
let commonEntryPath = decodeURIComponent(commonEntryUrl.pathname);

if (commonEntryPath.startsWith('/') && /^[A-Za-z]:/.test(commonEntryPath.slice(1))) {
  commonEntryPath = commonEntryPath.slice(1);
}

export default defineConfig({
  resolve: {
    alias: {
      '@meiro/common': commonEntryPath,
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
