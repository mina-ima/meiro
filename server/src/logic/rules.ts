const POINT_REQUIRED_RATE = 0.65;

/**
 * 規定ポイントを算出する。合計ポイントに係数を掛け、常に切り上げて返す。
 * 合計が0以下の場合は0を返す。
 */
export function requiredScore(totalPointValue: number): number {
  if (!Number.isFinite(totalPointValue)) {
    throw new TypeError('totalPointValue must be a finite number');
  }

  const clampedTotal = Math.max(0, totalPointValue);
  return Math.ceil(clampedTotal * POINT_REQUIRED_RATE);
}

export { POINT_REQUIRED_RATE };
