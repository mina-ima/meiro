import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'client/vitest.config.ts',
  'server/vitest.config.ts',
  'packages/common/vitest.config.ts',
]);
