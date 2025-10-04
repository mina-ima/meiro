import type { PhysicsInput, PhysicsState, Vector2 } from '@meiro/common';
import type { Role } from './schema/ws';

export interface PlayerInputState extends PhysicsInput {
  clientTimestamp: number;
  receivedAt: number;
}

export interface PlayerRuntimeState {
  physics: PhysicsState;
  input: PlayerInputState;
}

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
  player: PlayerRuntimeState;
  solidCells: Set<string>;
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
    player: {
      physics: {
        position: defaultPlayerPosition(),
        angle: 0,
        velocity: { x: 0, y: 0 },
      },
      input: {
        forward: 0,
        turn: 0,
        clientTimestamp: now,
        receivedAt: now,
      },
    },
    solidCells: new Set(),
  };
}

function defaultPlayerPosition(): Vector2 {
  return { x: 0.5, y: 0.5 };
}
