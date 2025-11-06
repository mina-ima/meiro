import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('GitHub Actions プレビューデプロイ', () => {
  const workflowPath = resolve(
    __dirname,
    '../../../.github/workflows/deploy-preview.yml',
  );

  it('pull request でプレビューデプロイを実行するワークフローが存在する', () => {
    expect(existsSync(workflowPath)).toBe(true);

    const content = readFileSync(workflowPath, 'utf8');

    expect(content).toContain('name: Deploy Preview');
    expect(content).toMatch(/on:\s*\n\s*pull_request:/);
    expect(content).toContain('npm ci');
    expect(content).toContain('npm run lint --workspaces --if-present');
    expect(content).toContain('npm run typecheck --workspaces --if-present');
    expect(content).toContain('npm test');
    expect(content).toMatch(/deploy --env preview/);
    expect(content).toContain('cloudflare/pages-action@v1');
  });
});
