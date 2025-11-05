import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..', '..');

function readSource(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

function scanFiles(paths: string[]): { path: string; matches: string[] }[] {
  const offenders: { path: string; matches: string[] }[] = [];

  for (const path of paths) {
    const source = readSource(path);
    const matches: string[] = [];

    if (source.includes('console.log')) {
      matches.push('console.log usage is not allowed (use info/warn/error)');
    }

    const piiPattern = /console\.\w+\([^)]*\bnick\b[^)]*\)/;
    if (piiPattern.test(source)) {
      matches.push('console.* call includes nickname (PII)');
    }

    if (matches.length > 0) {
      offenders.push({ path, matches });
    }
  }

  return offenders;
}

describe('ログ出力の安全性', () => {
  const TARGET_FILES = [
    'server/src/room-do.ts',
    'server/src/logic/outbound.ts',
    'server/src/logic/metrics.ts',
    'client/src/logging/telemetry.ts',
  ];

  it('本番コードで禁止されているログレベルやPIIを出力しない', () => {
    const offenders = scanFiles(TARGET_FILES);

    expect(offenders).toEqual(
      [],
      offenders
        .map(({ path, matches }) => `${path}:\n${matches.map((m) => `  - ${m}`).join('\n')}`)
        .join('\n\n'),
    );
  });
});
