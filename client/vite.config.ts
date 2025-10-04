import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@meiro/common': resolve(__dirname, '../packages/common/src/index.ts'),
    },
  },
  build: {
    sourcemap: true,
  },
});
