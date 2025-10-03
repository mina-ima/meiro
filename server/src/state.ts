import type { Role } from './schema/ws';

export interface PlayerSession {
  id: string;
  role: Role;
  nick: string;
}

export interface RoomState {
  id: string;
  phase: 'lobby' | 'countdown' | 'prep' | 'explore' | 'result';
  createdAt: number;
  updatedAt: number;
  phaseEndsAt?: number;
  countdownDurationMs: number;
  prepDurationMs: number;
  exploreDurationMs: number;
  sessions: Map<string, PlayerSession>;
}

export function createInitialRoomState(
  id: string,
  now: number = Date.now(),
  exploreDurationMs = 5 * 60 * 1000,
): RoomState {
  return {
    id,
    phase: 'lobby',
    createdAt: now,
    updatedAt: now,
    countdownDurationMs: 3_000,
    prepDurationMs: 60_000,
    exploreDurationMs,
    sessions: new Map(),
  };
}
