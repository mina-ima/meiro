import type { Role } from '../schema/ws';
import { resetOwnerState, type PlayerSession, type RoomState } from '../state';

export const LOBBY_CAPACITY = 2;
export const LOBBY_TIMEOUT_MS = 5 * 60 * 1000;

export interface LobbyJoinPayload {
  nick: string;
  role: Role;
}

export type LobbyJoinResult =
  | { kind: 'joined'; session: PlayerSession }
  | { kind: 'full' }
  | { kind: 'expired' }
  | { kind: 'role_taken' };

export function joinLobby(
  state: RoomState,
  payload: LobbyJoinPayload,
  now: number,
  newId: () => string = defaultSessionId,
): LobbyJoinResult {
  if (hasLobbyExpired(state, now)) {
    return { kind: 'expired' };
  }

  if (state.sessions.size >= LOBBY_CAPACITY) {
    return { kind: 'full' };
  }

  const roleTaken = Array.from(state.sessions.values()).some(
    (session) => session.role === payload.role,
  );
  if (roleTaken) {
    return { kind: 'role_taken' };
  }

  const session: PlayerSession = {
    id: newId(),
    nick: payload.nick,
    role: payload.role,
  };

  state.sessions.set(session.id, session);
  state.updatedAt = now;
  return { kind: 'joined', session };
}

export function removeSession(state: RoomState, sessionId: string, now: number): boolean {
  const removed = state.sessions.delete(sessionId);
  if (removed) {
    state.updatedAt = now;
  }

  return removed;
}

export function resetLobby(state: RoomState, now: number): void {
  state.sessions.clear();
  state.phase = 'lobby';
  state.createdAt = now;
  state.updatedAt = now;
  resetOwnerState(state, now);
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
  state.player.inputSequence = 0;
  state.solidCells.clear();
}

export function hasLobbyExpired(state: RoomState, now: number): boolean {
  return now - state.updatedAt >= LOBBY_TIMEOUT_MS;
}

function defaultSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `session-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}
