export const TRAP_SPEED_MULTIPLIER = 0.4;
export const MAX_ACTIVE_TRAPS = 2;
export const TRAP_DURATION_DIVISOR = 5;

export interface TrapApplicationParams {
  now: number;
  phaseEndsAt?: number;
  currentSlowUntil?: number;
  durationDivisor?: number;
}

export interface TrapApplicationResult {
  slowUntil: number;
  durationMs: number;
}

export function apply({
  now,
  phaseEndsAt,
  currentSlowUntil,
  durationDivisor = TRAP_DURATION_DIVISOR,
}: TrapApplicationParams): TrapApplicationResult {
  if (durationDivisor <= 0) {
    throw new Error('durationDivisor must be greater than zero.');
  }

  const phaseEndTime = phaseEndsAt ?? now;
  const remaining = Math.max(phaseEndTime - now, 0);
  const durationMs = remaining / durationDivisor;
  const base = Math.max(currentSlowUntil ?? now, now);
  const slowUntil = durationMs > 0 ? base + durationMs : base;

  return { slowUntil, durationMs };
}
