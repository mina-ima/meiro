import { resetOwnerState, type RoomState } from '../state';

export const DEFAULT_EXPLORE_DURATION_MS = 5 * 60 * 1000;
const COUNTDOWN_DURATION_MS = 3_000;
const PREP_DURATION_MS = 60_000;
const REQUIRED_PLAYERS = 2;

export function startCountdown(state: RoomState, now: number): void {
  if (state.phase !== 'lobby') {
    throw new Error('Countdown can only start from lobby');
  }

  state.phase = 'countdown';
  state.updatedAt = now;
  state.countdownDurationMs = COUNTDOWN_DURATION_MS;
  state.phaseEndsAt = now + state.countdownDurationMs;
}

export function maybeStartCountdown(state: RoomState, now: number): boolean {
  if (state.phase !== 'lobby') {
    return false;
  }

  if (state.sessions.size < REQUIRED_PLAYERS) {
    return false;
  }

  startCountdown(state, now);
  return true;
}

export function resetForRematch(
  state: RoomState,
  now: number,
  random: () => number = Math.random,
): boolean {
  if (state.phase !== 'result') {
    return false;
  }

  if (state.sessions.size < REQUIRED_PLAYERS) {
    return false;
  }

  const players = Array.from(state.sessions.values());
  if (players.length < REQUIRED_PLAYERS) {
    return false;
  }

  const chooseFirst = random() < 0.5;
  const ownerSession = chooseFirst ? players[0] : players[1];
  const playerSession = ownerSession === players[0] ? players[1] : players[0];

  ownerSession.role = 'owner';
  playerSession.role = 'player';

  state.phase = 'lobby';
  state.phaseEndsAt = undefined;
  state.createdAt = now;
  state.updatedAt = now;
  resetOwnerState(state);

  state.player.physics = {
    position: { x: 0.5, y: 0.5 },
    angle: 0,
    velocity: { x: 0, y: 0 },
  };
  state.player.input = {
    forward: 0,
    turn: 0,
    clientTimestamp: now,
    receivedAt: now,
  };
  state.solidCells.clear();

  state.sessions.set(ownerSession.id, ownerSession);
  state.sessions.set(playerSession.id, playerSession);

  return true;
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
