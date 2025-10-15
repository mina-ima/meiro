import { describe, expect, it } from 'vitest';
import { apply } from '../src/logic/trap';

describe('trap.apply', () => {
  it('既存の減速状態に追加して持続時間を延長する', () => {
    const now = 1_700_000_000_000;
    const phaseEndsAt = now + 60_000;

    const first = apply({
      now,
      phaseEndsAt,
      currentSlowUntil: undefined,
    });

    const expectedFirstExtension = (phaseEndsAt - now) / 5;
    expect(first.slowUntil).toBeCloseTo(now + expectedFirstExtension, 4);
    expect(first.durationMs).toBeCloseTo(expectedFirstExtension, 4);

    const midNow = now + 5_000;
    const second = apply({
      now: midNow,
      phaseEndsAt,
      currentSlowUntil: first.slowUntil,
    });

    const expectedSecondExtension = (phaseEndsAt - midNow) / 5;
    expect(second.slowUntil).toBeCloseTo(
      first.slowUntil + expectedSecondExtension,
      4,
    );
    expect(second.durationMs).toBeCloseTo(expectedSecondExtension, 4);
  });
});
