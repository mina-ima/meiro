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

export interface OwnerRuntimeState {
  wallStock: number;
  wallRemoveLeft: 0 | 1;
  trapCharges: number;
  editCooldownUntil: number;
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
  mazeSize: 20 | 40;
  owner: OwnerRuntimeState;
  player: PlayerRuntimeState;
  solidCells: Set<string>;
}

export interface RoomStateOptions {
  mazeSize?: 20 | 40;
}

export function createInitialRoomState(
  id: string,
  now: number = Date.now(),
  exploreDurationMs = 5 * 60 * 1000,
  options: RoomStateOptions = {},
): RoomState {
  const mazeSize = options.mazeSize ?? 40;
  return {
    id,
    phase: 'lobby',
    createdAt: now,
    updatedAt: now,
    countdownDurationMs: 3_000,
    prepDurationMs: 60_000,
    exploreDurationMs,
    sessions: new Map(),
    mazeSize,
    owner: createInitialOwnerState(mazeSize, now),
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

function createInitialOwnerState(mazeSize: 20 | 40, now: number): OwnerRuntimeState {
  return {
    wallStock: initialWallStockForMaze(mazeSize),
    wallRemoveLeft: 1,
    trapCharges: 0,
    editCooldownUntil: now,
  };
}

function initialWallStockForMaze(mazeSize: 20 | 40): number {
  return mazeSize === 20 ? 48 : 140;
}

export function resetOwnerState(state: RoomState, now: number): void {
  state.owner = createInitialOwnerState(state.mazeSize, now);
}
