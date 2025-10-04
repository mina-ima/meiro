import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('リポジトリ初期化', () => {
  it('client/server の雛形とREADMEが整備されている', () => {
    const root = resolve(__dirname, '../../..');

    expect(existsSync(resolve(root, 'client/src'))).toBe(true);
    expect(existsSync(resolve(root, 'server/src'))).toBe(true);

    const readmePath = resolve(root, 'README.md');
    expect(existsSync(readmePath)).toBe(true);

    const readme = readFileSync(readmePath, 'utf8');
    expect(readme).toContain('client/');
    expect(readme).toContain('server/');
    expect(readme).toContain('## ブランチ戦略');
  });
});
