import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ライセンス/著作権表記', () => {
  it('LICENSE と NOTICE が存在し、MIT表記を含む', () => {
    const root = resolve(__dirname, '../../..');
    const licensePath = resolve(root, 'LICENSE');
    const noticePath = resolve(root, 'NOTICE');

    expect(existsSync(licensePath)).toBe(true);
    expect(existsSync(noticePath)).toBe(true);

    const license = readFileSync(licensePath, 'utf8');
    const notice = readFileSync(noticePath, 'utf8');

    expect(license).toContain('MIT License');
    expect(notice).toMatch(/Copyright \(c\) 2025 MEIRO Team/);
  });
});
