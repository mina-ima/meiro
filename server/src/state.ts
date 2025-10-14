import type { PhysicsInput, PhysicsState, Vector2 } from '@meiro/common';
import type { Role } from './schema/ws';

export type RoomPhase = 'lobby' | 'countdown' | 'prep' | 'explore' | 'result';

export interface PlayerInputState extends PhysicsInput {
  clientTimestamp: number;
  receivedAt: number;
}

export interface PlayerRuntimeState {
  physics: PhysicsState;
  input: PlayerInputState;
  predictionHits: number;
  trapSlowUntil: number;
  score: number;
  goalBonusAwarded: boolean;
  lastInputReceivedAt: number;
  inputWindowStart: number;
  inputCountInWindow: number;
}

export type PauseReason = 'disconnect';

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
  traps: TrapInstance[];
  predictionMarks: Map<string, PredictionMark>;
  predictionLimit: number;
  predictionHits: number;
}

export interface PredictionMark {
  cell: { x: number; y: number };
  createdAt: number;
}

export interface TrapInstance {
  cell: { x: number; y: number };
  placedAt: number;
}

export interface PointInstance {
  cell: { x: number; y: number };
  value: 1 | 3 | 5;
}

export interface RoomState {
  id: string;
  phase: RoomPhase;
  createdAt: number;
  updatedAt: number;
  phaseEndsAt?: number;
  phaseStartedAt: number;
  countdownDurationMs: number;
  prepDurationMs: number;
  exploreDurationMs: number;
  sessions: Map<string, PlayerSession>;
  mazeSize: 20 | 40;
  owner: OwnerRuntimeState;
  player: PlayerRuntimeState;
  solidCells: Set<string>;
  points: Map<string, PointInstance>;
  pointTotalValue: number;
  targetScore: number;
  targetScoreLocked: boolean;
  pointShortageCompensated: boolean;
  goalCell?: { x: number; y: number };
  paused: boolean;
  pauseReason?: PauseReason;
  pauseExpiresAt?: number;
  pauseRemainingMs?: number;
  pausePhase?: RoomPhase;
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
    phaseStartedAt: now,
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
      predictionHits: 0,
      trapSlowUntil: now,
      score: 0,
      goalBonusAwarded: false,
      lastInputReceivedAt: now,
      inputWindowStart: now,
      inputCountInWindow: 0,
    },
    solidCells: new Set(),
    points: new Map(),
    pointTotalValue: 0,
    targetScore: 0,
    targetScoreLocked: false,
    pointShortageCompensated: false,
    paused: false,
  };
}

function defaultPlayerPosition(): Vector2 {
  return { x: 0.5, y: 0.5 };
}

function createInitialOwnerState(mazeSize: 20 | 40, now: number): OwnerRuntimeState {
  return {
    wallStock: initialWallStockForMaze(mazeSize),
    wallRemoveLeft: 1,
    trapCharges: 1,
    editCooldownUntil: now,
    traps: [],
    predictionMarks: new Map(),
    predictionLimit: 3,
    predictionHits: 0,
  };
}

function initialWallStockForMaze(mazeSize: 20 | 40): number {
  return mazeSize === 20 ? 48 : 140;
}

export function resetOwnerState(state: RoomState, now: number): void {
  state.owner = createInitialOwnerState(state.mazeSize, now);
  state.player.trapSlowUntil = now;
  state.player.score = 0;
  state.player.goalBonusAwarded = false;
  state.player.lastInputReceivedAt = now;
  state.player.inputWindowStart = now;
  state.player.inputCountInWindow = 0;
  state.points = new Map();
  state.pointTotalValue = 0;
  state.targetScore = 0;
  state.targetScoreLocked = false;
  state.pointShortageCompensated = false;
  state.paused = false;
  state.pauseReason = undefined;
  state.pauseExpiresAt = undefined;
  state.pauseRemainingMs = undefined;
  state.pausePhase = undefined;
}
