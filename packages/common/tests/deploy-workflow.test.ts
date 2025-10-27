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
    expect(content).toContain('pnpm install --frozen-lockfile');
    expect(content).toContain('pnpm lint');
    expect(content).toContain('pnpm typecheck');
    expect(content).toContain('pnpm test');
    expect(content).toMatch(/deploy --env preview/);
    expect(content).toContain('cloudflare/pages-action@v1');
  });
});
