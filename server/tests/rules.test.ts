import { describe, expect, it } from 'vitest';
import { requiredScore } from '../src/logic/rules';

describe('requiredScore', () => {
  it.each([
    { total: 0, expected: 0 },
    { total: 1, expected: 1 },
    { total: 2, expected: 2 },
    { total: 3, expected: 2 },
    { total: 4, expected: 3 },
    { total: 5, expected: 4 },
    { total: 10, expected: 7 },
    { total: 15, expected: 10 },
    { total: 20, expected: 13 },
  ])('合計ポイント $total → 規定ポイント $expected', ({ total, expected }) => {
    expect(requiredScore(total)).toBe(expected);
  });

  it('小数点を含む入力でも正しく切り上げられる', () => {
    expect(requiredScore(12.3)).toBe(8);
    expect(requiredScore(19.9)).toBe(13);
  });
});
