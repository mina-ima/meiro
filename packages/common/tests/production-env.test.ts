import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..', '..');

describe('本番環境の秘密情報/環境変数', () => {
  it('.env.example に必要なシークレットのプレースホルダーが定義されている', () => {
    const envExamplePath = resolve(ROOT, '.env.example');
    const envExample = readFileSync(envExamplePath, 'utf8');

    const expectedKeys = [
      'VITE_WS_URL=',
      'CF_ACCOUNT_ID=',
      'CF_WORKERS_API_TOKEN=',
      'CF_PAGES_API_TOKEN=',
      'CF_PAGES_PROJECT=',
      'SENTRY_DSN=',
    ];

    for (const key of expectedKeys) {
      expect(envExample).toContain(
        key,
        `.env.example should list ${key} as an empty placeholder`,
      );
    }
  });

  it('README に本番向けシークレット/環境変数の説明が記載されている', () => {
    const readmePath = resolve(ROOT, 'README.md');
    const readme = readFileSync(readmePath, 'utf8');

    expect(readme).toMatch(/## 環境変数/);

    const documentedKeys = [
      'VITE_WS_URL',
      'CF_ACCOUNT_ID',
      'CF_WORKERS_API_TOKEN',
      'CF_PAGES_API_TOKEN',
      'CF_PAGES_PROJECT',
      'SENTRY_DSN',
    ];

    for (const key of documentedKeys) {
      expect(readme).toContain(
        key,
        `README should mention ${key} to guide production configuration`,
      );
    }
  });
});
