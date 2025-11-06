import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('CIパイプライン', () => {
  it('lint/format/typecheck/test を実行するワークフローが存在する', () => {
    const root = resolve(__dirname, '../../..');
    const workflowPath = resolve(root, '.github/workflows/ci.yml');

    expect(existsSync(workflowPath)).toBe(true);

    const yaml = readFileSync(workflowPath, 'utf8');
    expect(yaml).toContain('npm exec prettier -- --check "**/*.{ts,tsx,js,jsx,md,json}"');
    expect(yaml).toContain('npm run lint --workspaces --if-present');
    expect(yaml).toContain('npm run typecheck --workspaces --if-present');
    expect(yaml).toContain('npm test');
  });
});
