import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..', '..');

describe('リリース運用', () => {
  it('CHANGELOG が存在し最新セクションを備えている', () => {
    const changelogPath = resolve(ROOT, 'CHANGELOG.md');

    expect(existsSync(changelogPath)).toBe(true);

    const content = readFileSync(changelogPath, 'utf8');
    expect(content).toMatch(/^# Changelog/m);
    expect(content).toMatch(/## \[Unreleased\]/);
    expect(content).toMatch(/## \[\d+\.\d+\.\d+\]/);
  });

  it('README にリリースタグとCHANGELOG更新手順が記載されている', () => {
    const readmePath = resolve(ROOT, 'README.md');
    const readme = readFileSync(readmePath, 'utf8');

    expect(readme).toMatch(/## リリースフロー/);
    expect(readme).toMatch(/git tag -a/);
    expect(readme).toMatch(/CHANGELOG\.md/);
  });

  it('README にロールバック手順と過去リリース保持の方針が記載されている', () => {
    const readmePath = resolve(ROOT, 'README.md');
    const readme = readFileSync(readmePath, 'utf8');

    expect(readme).toMatch(/### ロールバック手順/);
    expect(readme).toMatch(/git revert/);
    expect(readme).toMatch(/過去リリースを保持/);
  });
});
