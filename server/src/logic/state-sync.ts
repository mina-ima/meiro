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
}

interface SnapshotOwner {
  wallStock: number;
  wallRemoveLeft: 0 | 1;
  trapCharges: number;
}

interface Snapshot {
  roomId: string;
  phase: RoomState['phase'];
  phaseEndsAt?: number;
  updatedAt: number;
  countdownDurationMs: number;
  prepDurationMs: number;
  exploreDurationMs: number;
  sessions: SnapshotSession[];
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
    countdownDurationMs: room.countdownDurationMs,
    prepDurationMs: room.prepDurationMs,
    exploreDurationMs: room.exploreDurationMs,
    sessions: Array.from(room.sessions.values())
      .map(({ id, role, nick }) => ({ id, role, nick }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    player: {
      position: cloneVector(room.player.physics.position),
      velocity: cloneVector(room.player.physics.velocity),
      angle: room.player.physics.angle,
    },
    owner: {
      wallStock: room.owner.wallStock,
      wallRemoveLeft: room.owner.wallRemoveLeft,
      trapCharges: room.owner.trapCharges,
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

  if (previous.countdownDurationMs !== next.countdownDurationMs) {
    changes.countdownDurationMs = next.countdownDurationMs;
  }

  if (previous.prepDurationMs !== next.prepDurationMs) {
    changes.prepDurationMs = next.prepDurationMs;
  }

  if (previous.exploreDurationMs !== next.exploreDurationMs) {
    changes.exploreDurationMs = next.exploreDurationMs;
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
    Math.abs(a.angle - b.angle) < 1e-4
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
    a.trapCharges === b.trapCharges
  );
}
