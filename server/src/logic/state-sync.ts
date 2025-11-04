import type { Vector2 } from '@meiro/common';
import type { Role, ServerMessage } from '../schema/ws';
import type { RoomState } from '../state';

interface SnapshotSession {
  id: string;
  role: Role;
  nick: string;
}

type PackedVector = readonly [number, number];
type PackedPoint = readonly [number, number, 1 | 3 | 5];

interface SnapshotPlayer {
  position: Vector2;
  velocity: Vector2;
  angle: number;
  predictionHits: number;
  trapSlowUntil: number;
  score: number;
}

interface SnapshotOwner {
  wallStock: number;
  wallRemoveLeft: 0 | 1;
  trapCharges: number;
  editCooldownUntil: number;
  editCooldownDuration: number;
  forbiddenDistance: number;
  predictionLimit: number;
  predictionHits: number;
  predictionMarks: PackedVector[];
  traps: PackedVector[];
  points: PackedPoint[];
}

interface Snapshot {
  roomId: string;
  phase: RoomState['phase'];
  phaseEndsAt?: number;
  updatedAt: number;
  mazeSize: RoomState['mazeSize'];
  countdownDurationMs: number;
  prepDurationMs: number;
  exploreDurationMs: number;
  sessions: SnapshotSession[];
  targetScore: number;
  paused: boolean;
  pauseReason?: RoomState['pauseReason'] | null;
  pauseExpiresAt?: number | null;
  pauseRemainingMs?: number | null;
  pausePhase?: RoomState['phase'] | null;
  player: SnapshotPlayer;
  owner: SnapshotOwner;
}

interface ComposeOptions {
  forceFull?: boolean;
}

type SnapshotPayload = {
  seq: number;
  full: true;
  snapshot: Snapshot;
};

type DiffPayload = {
  seq: number;
  full: false;
  changes: Partial<Snapshot>;
};

type StatePayload = SnapshotPayload | DiffPayload;
type StatePayloadWithoutSeq =
  | {
      full: true;
      snapshot: Snapshot;
    }
  | {
      full: false;
      changes: Partial<Snapshot>;
    };

export class StateComposer {
  private lastSnapshot: Snapshot | null = null;
  private sequence = 0;

  compose(room: RoomState, options: ComposeOptions = {}): ServerMessage | null {
    const snapshot = createSnapshot(room);
    const forceFull = options.forceFull === true;

    if (this.lastSnapshot === null || forceFull) {
      this.lastSnapshot = snapshot;
      return this.createMessage({ full: true, snapshot });
    }

    const changes = diffSnapshot(this.lastSnapshot, snapshot);
    if (Object.keys(changes).length === 0) {
      return null;
    }

    this.lastSnapshot = snapshot;
    return this.createMessage({ full: false, changes });
  }

  private createMessage(payload: StatePayloadWithoutSeq): ServerMessage {
    this.sequence += 1;
    const enriched: StatePayload = {
      seq: this.sequence,
      ...payload,
    } as StatePayload;

    return {
      type: 'STATE',
      payload: enriched,
    } satisfies ServerMessage;
  }
}

function createSnapshot(room: RoomState): Snapshot {
  return {
    roomId: room.id,
    phase: room.phase,
    phaseEndsAt: room.phaseEndsAt,
    updatedAt: room.updatedAt,
    mazeSize: room.mazeSize,
    countdownDurationMs: room.countdownDurationMs,
    prepDurationMs: room.prepDurationMs,
    exploreDurationMs: room.exploreDurationMs,
    targetScore: room.targetScore,
    paused: room.paused,
    pauseReason: room.pauseReason,
    pauseExpiresAt: room.pauseExpiresAt,
    pauseRemainingMs: room.pauseRemainingMs,
    pausePhase: room.pausePhase,
    sessions: Array.from(room.sessions.values())
      .map(({ id, role, nick }) => ({ id, role, nick }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    player: {
      position: cloneVector(room.player.physics.position),
      velocity: cloneVector(room.player.physics.velocity),
      angle: room.player.physics.angle,
      predictionHits: room.player.predictionHits,
      trapSlowUntil: room.player.trapSlowUntil,
      score: room.player.score,
    },
    owner: {
      wallStock: room.owner.wallStock,
      wallRemoveLeft: room.owner.wallRemoveLeft,
      trapCharges: room.owner.trapCharges,
      editCooldownUntil: room.owner.editCooldownUntil,
      editCooldownDuration: room.owner.editCooldownDuration,
      forbiddenDistance: room.owner.forbiddenDistance,
      predictionLimit: room.owner.predictionLimit,
      predictionHits: room.owner.predictionHits,
      predictionMarks: Array.from(room.owner.predictionMarks.values())
        .map((mark) => packVector(mark.cell))
        .sort(comparePackedVector),
      traps: room.owner.traps.map((trap) => packVector(trap.cell)).sort(comparePackedVector),
      points: Array.from(room.points.values())
        .map((point) => packPoint(point))
        .sort(comparePackedPoint),
    },
  };
}

function diffSnapshot(previous: Snapshot, next: Snapshot): Partial<Snapshot> {
  const changes: Partial<Snapshot> = {};

  if (previous.phase !== next.phase) {
    changes.phase = next.phase;
  }

  if ((previous.phaseEndsAt ?? null) !== (next.phaseEndsAt ?? null)) {
    changes.phaseEndsAt = next.phaseEndsAt;
  }

  if (previous.updatedAt !== next.updatedAt) {
    changes.updatedAt = next.updatedAt;
  }

  if (previous.mazeSize !== next.mazeSize) {
    changes.mazeSize = next.mazeSize;
  }

  if (previous.countdownDurationMs !== next.countdownDurationMs) {
    changes.countdownDurationMs = next.countdownDurationMs;
  }

  if (previous.prepDurationMs !== next.prepDurationMs) {
    changes.prepDurationMs = next.prepDurationMs;
  }

  if (previous.exploreDurationMs !== next.exploreDurationMs) {
    changes.exploreDurationMs = next.exploreDurationMs;
  }

  if (previous.targetScore !== next.targetScore) {
    changes.targetScore = next.targetScore;
  }

  if (previous.paused !== next.paused) {
    changes.paused = next.paused;
  }

  const nextPauseReason = next.pauseReason ?? null;
  const previousPauseReason = previous.pauseReason ?? null;
  if (previousPauseReason !== nextPauseReason) {
    changes.pauseReason = next.pauseReason ?? null;
  }

  const nextPauseExpiresAt = next.pauseExpiresAt ?? null;
  const previousPauseExpiresAt = previous.pauseExpiresAt ?? null;
  if (previousPauseExpiresAt !== nextPauseExpiresAt) {
    changes.pauseExpiresAt = next.pauseExpiresAt ?? null;
  }

  const nextPauseRemainingMs = next.pauseRemainingMs ?? null;
  const previousPauseRemainingMs = previous.pauseRemainingMs ?? null;
  if (previousPauseRemainingMs !== nextPauseRemainingMs) {
    changes.pauseRemainingMs = next.pauseRemainingMs ?? null;
  }

  const nextPausePhase = next.pausePhase ?? null;
  const previousPausePhase = previous.pausePhase ?? null;
  if (previousPausePhase !== nextPausePhase) {
    changes.pausePhase = next.pausePhase ?? null;
  }

  if (!sessionsEqual(previous.sessions, next.sessions)) {
    changes.sessions = next.sessions;
  }

  if (!playerEqual(previous.player, next.player)) {
    changes.player = next.player;
  }

  if (!ownerEqual(previous.owner, next.owner)) {
    changes.owner = next.owner;
  }

  return changes;
}

function packVector(source: Vector2): PackedVector {
  return [Number(source.x), Number(source.y)];
}

function packPoint(point: { cell: Vector2; value: 1 | 3 | 5 }): PackedPoint {
  return [Number(point.cell.x), Number(point.cell.y), point.value];
}

function comparePackedVector(a: PackedVector, b: PackedVector): number {
  if (a[0] !== b[0]) {
    return a[0] - b[0];
  }
  return a[1] - b[1];
}

function comparePackedPoint(a: PackedPoint, b: PackedPoint): number {
  if (a[0] !== b[0]) {
    return a[0] - b[0];
  }
  if (a[1] !== b[1]) {
    return a[1] - b[1];
  }
  return a[2] - b[2];
}

function sessionsEqual(a: SnapshotSession[], b: SnapshotSession[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((session, index) => {
    const other = b[index];
    return session.id === other.id && session.role === other.role && session.nick === other.nick;
  });
}

function playerEqual(a: SnapshotPlayer, b: SnapshotPlayer): boolean {
  return (
    vectorsEqual(a.position, b.position) &&
    vectorsEqual(a.velocity, b.velocity) &&
    Math.abs(a.angle - b.angle) < 1e-4 &&
    a.predictionHits === b.predictionHits &&
    a.trapSlowUntil === b.trapSlowUntil &&
    a.score === b.score
  );
}

function vectorsEqual(a: Vector2, b: Vector2): boolean {
  return Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;
}

function cloneVector(source: Vector2): Vector2 {
  return { x: source.x, y: source.y };
}

function ownerEqual(a: SnapshotOwner, b: SnapshotOwner): boolean {
  return (
    a.wallStock === b.wallStock &&
    a.wallRemoveLeft === b.wallRemoveLeft &&
    a.trapCharges === b.trapCharges &&
    a.editCooldownUntil === b.editCooldownUntil &&
    a.editCooldownDuration === b.editCooldownDuration &&
    a.forbiddenDistance === b.forbiddenDistance &&
    a.predictionLimit === b.predictionLimit &&
    a.predictionHits === b.predictionHits &&
    packedVectorsEqual(a.predictionMarks, b.predictionMarks) &&
    packedVectorsEqual(a.traps, b.traps) &&
    packedPointsEqual(a.points, b.points)
  );
}

function packedVectorsEqual(a: PackedVector[], b: PackedVector[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((mark, index) => mark[0] === b[index][0] && mark[1] === b[index][1]);
}

function packedPointsEqual(a: PackedPoint[], b: PackedPoint[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((point, index) => {
    const other = b[index];
    return point[0] === other[0] && point[1] === other[1] && point[2] === other[2];
  });
}
