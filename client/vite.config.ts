import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const commonEntryUrl = new URL('../packages/common/src/index.ts', import.meta.url);
let commonEntryPath = decodeURIComponent(commonEntryUrl.pathname);

if (commonEntryPath.startsWith('/') && /^[A-Za-z]:/.test(commonEntryPath.slice(1))) {
  commonEntryPath = commonEntryPath.slice(1);
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@meiro/common': commonEntryPath,
    },
  },
  build: {
    sourcemap: true,
  },
});
