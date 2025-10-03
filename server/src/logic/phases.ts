import type { RoomState } from '../state';

export const DEFAULT_EXPLORE_DURATION_MS = 5 * 60 * 1000;
const COUNTDOWN_DURATION_MS = 3_000;
const PREP_DURATION_MS = 60_000;

export function startCountdown(state: RoomState, now: number): void {
  if (state.phase !== 'lobby') {
    throw new Error('Countdown can only start from lobby');
  }

  state.phase = 'countdown';
  state.updatedAt = now;
  state.countdownDurationMs = COUNTDOWN_DURATION_MS;
  state.phaseEndsAt = now + state.countdownDurationMs;
}

export function progressPhase(state: RoomState, now: number): void {
  if (state.phase === 'result') {
    return;
  }

  if (state.phaseEndsAt == null || now < state.phaseEndsAt) {
    return;
  }

  switch (state.phase) {
    case 'countdown': {
      state.phase = 'prep';
      state.updatedAt = now;
      state.prepDurationMs = PREP_DURATION_MS;
      state.phaseEndsAt = now + state.prepDurationMs;
      return;
    }
    case 'prep': {
      state.phase = 'explore';
      state.updatedAt = now;
      state.exploreDurationMs = state.exploreDurationMs || DEFAULT_EXPLORE_DURATION_MS;
      state.phaseEndsAt = now + state.exploreDurationMs;
      return;
    }
    case 'explore': {
      state.phase = 'result';
      state.updatedAt = now;
      state.phaseEndsAt = undefined;
      return;
    }
    default:
      return;
  }
}
