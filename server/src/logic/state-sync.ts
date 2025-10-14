import type { Vector2 } from '@meiro/common';
import type { Role, ServerMessage } from '../schema/ws';
import type { RoomState } from '../state';

interface SnapshotSession {
  id: string;
  role: Role;
  nick: string;
}

interface SnapshotPlayer {
  position: Vector2;
  velocity: Vector2;
  angle: number;
  predictionHits: number;
  trapSlowUntil: number;
  score: number;
}

interface SnapshotPoint {
  position: Vector2;
  value: 1 | 3 | 5;
}

interface SnapshotOwner {
  wallStock: number;
  wallRemoveLeft: 0 | 1;
  trapCharges: number;
  editCooldownUntil: number;
  predictionLimit: number;
  predictionHits: number;
  predictionMarks: Vector2[];
  traps: Vector2[];
  points: SnapshotPoint[];
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
      predictionLimit: room.owner.predictionLimit,
      predictionHits: room.owner.predictionHits,
      predictionMarks: Array.from(room.owner.predictionMarks.values())
        .map((mark) => cloneVector(mark.cell))
        .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x)),
      traps: room.owner.traps
        .map((trap) => cloneVector(trap.cell))
        .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x)),
      points: Array.from(room.points.values())
        .map((point) => ({
          position: cloneVector(point.cell),
          value: point.value,
        }))
        .sort((a, b) =>
          a.position.x === b.position.x ? a.position.y - b.position.y : a.position.x - b.position.x,
        ),
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
    a.predictionLimit === b.predictionLimit &&
    a.predictionHits === b.predictionHits &&
    predictionMarksEqual(a.predictionMarks, b.predictionMarks) &&
    trapsEqual(a.traps, b.traps) &&
    pointsEqual(a.points, b.points)
  );
}

function predictionMarksEqual(a: Vector2[], b: Vector2[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((mark, index) => vectorsEqual(mark, b[index]));
}

function trapsEqual(a: Vector2[], b: Vector2[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((trap, index) => vectorsEqual(trap, b[index]));
}

function pointsEqual(a: SnapshotPoint[], b: SnapshotPoint[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((point, index) => {
    const other = b[index];
    return point.value === other.value && vectorsEqual(point.position, other.position);
  });
}
