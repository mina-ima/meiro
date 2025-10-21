import { create } from 'zustand';

export type PlayerRole = 'owner' | 'player';

export interface ServerVector {
  x: number;
  y: number;
}

export interface ServerPoint {
  position: ServerVector;
  value: 1 | 3 | 5;
}

export interface ServerSessionEntry {
  id: string;
  role: PlayerRole;
  nick: string;
}

type PackedVector = readonly [number, number];
type PackedPoint = readonly [number, number, 1 | 3 | 5];

export interface ServerOwnerState {
  wallStock: number;
  wallRemoveLeft: 0 | 1;
  trapCharges: number;
  editCooldownUntil: number;
  predictionLimit: number;
  predictionHits: number;
  predictionMarks: ServerVector[];
  traps: ServerVector[];
  points: ServerPoint[];
}

export interface ServerPlayerState {
  position: ServerVector;
  velocity: ServerVector;
  angle: number;
  predictionHits: number;
  score: number;
}

export interface ServerSnapshot {
  roomId: string;
  phase: 'lobby' | 'countdown' | 'prep' | 'explore' | 'result';
  phaseEndsAt?: number;
  updatedAt: number;
  mazeSize: 20 | 40;
  countdownDurationMs: number;
  prepDurationMs: number;
  exploreDurationMs: number;
  targetScore: number;
  sessions: ServerSessionEntry[];
  player: ServerPlayerState;
  owner: ServerOwnerState;
}

type NetworkPlayerState = ServerPlayerState & { trapSlowUntil?: number };

export interface NetworkOwnerState {
  wallStock: number;
  wallRemoveLeft: 0 | 1;
  trapCharges: number;
  editCooldownUntil: number;
  predictionLimit: number;
  predictionHits: number;
  predictionMarks: PackedVector[];
  traps: PackedVector[];
  points: PackedPoint[];
}

export interface NetworkSnapshot {
  roomId: string;
  phase: ServerSnapshot['phase'];
  phaseEndsAt?: number;
  updatedAt: number;
  mazeSize: 20 | 40;
  countdownDurationMs: number;
  prepDurationMs: number;
  exploreDurationMs: number;
  targetScore: number;
  sessions: ServerSessionEntry[];
  player: NetworkPlayerState;
  owner: NetworkOwnerState;
}

type PartialNetworkSnapshot = Partial<Omit<NetworkSnapshot, 'owner' | 'player' | 'sessions'>> & {
  owner?: Partial<NetworkOwnerState>;
  player?: Partial<NetworkPlayerState>;
  sessions?: ServerSessionEntry[];
};

export type NetworkStatePayload =
  | {
      seq: number;
      full: true;
      snapshot: NetworkSnapshot;
    }
  | {
      seq: number;
      full: false;
      changes: PartialNetworkSnapshot;
    };

type PartialServerSnapshot = Partial<Omit<ServerSnapshot, 'owner' | 'player' | 'sessions'>> & {
  owner?: Partial<ServerOwnerState>;
  player?: Partial<ServerPlayerState>;
  sessions?: ServerSessionEntry[];
};

export type ServerStatePayload =
  | {
      seq: number;
      full: true;
      snapshot: ServerSnapshot;
    }
  | {
      seq: number;
      full: false;
      changes: PartialServerSnapshot;
    };

export interface OwnerClientState {
  wallStock: number;
  wallRemoveLeft: 0 | 1;
  trapCharges: number;
  editCooldownUntil: number;
  predictionLimit: number;
  activePredictionCount: number;
  predictionHits: number;
  predictionMarks: ServerVector[];
  traps: ServerVector[];
}

export interface PlayerClientState {
  predictionHits: number;
  position: ServerVector;
}

export interface SessionState {
  roomId: string | null;
  role: PlayerRole | null;
  phase: ServerSnapshot['phase'];
  phaseEndsAt?: number;
  mazeSize: 20 | 40;
  score: number;
  targetScore: number;
  owner: OwnerClientState;
  player: PlayerClientState;
  serverSnapshot: ServerSnapshot | null;
  serverSeq: number;
  setRoom: (roomId: string, role: PlayerRole) => void;
  setScore: (score: number, targetScore: number) => void;
  applyServerState: (payload: ServerStatePayload) => void;
  reset: () => void;
}

function createInitialOwnerClientState(): OwnerClientState {
  return {
    wallStock: 0,
    wallRemoveLeft: 1,
    trapCharges: 1,
    editCooldownUntil: 0,
    predictionLimit: 3,
    activePredictionCount: 0,
    predictionHits: 0,
    predictionMarks: [],
    traps: [],
  };
}

function createInitialPlayerClientState(): PlayerClientState {
  return {
    predictionHits: 0,
    position: { x: 0, y: 0 },
  };
}

function cloneVector(vector: ServerVector): ServerVector {
  return { x: vector.x, y: vector.y };
}

function cloneVectorList(list: ServerVector[]): ServerVector[] {
  return list.map(cloneVector);
}

function clonePoints(list: ServerPoint[]): ServerPoint[] {
  return list.map((point) => ({
    value: point.value,
    position: cloneVector(point.position),
  }));
}

function unpackVector(vector: PackedVector): ServerVector {
  return { x: vector[0], y: vector[1] };
}

function unpackVectors(list: PackedVector[]): ServerVector[] {
  return list.map(unpackVector);
}

function unpackPoint(point: PackedPoint): ServerPoint {
  return {
    position: { x: point[0], y: point[1] },
    value: point[2],
  };
}

function unpackPoints(list: PackedPoint[]): ServerPoint[] {
  return list.map(unpackPoint);
}

function normalizeOwnerState(owner: NetworkOwnerState): ServerOwnerState {
  return {
    wallStock: owner.wallStock,
    wallRemoveLeft: owner.wallRemoveLeft,
    trapCharges: owner.trapCharges,
    editCooldownUntil: owner.editCooldownUntil,
    predictionLimit: owner.predictionLimit,
    predictionHits: owner.predictionHits,
    predictionMarks: unpackVectors(owner.predictionMarks),
    traps: unpackVectors(owner.traps),
    points: unpackPoints(owner.points),
  };
}

function normalizeOwnerPatch(
  owner?: Partial<NetworkOwnerState>,
): Partial<ServerOwnerState> | undefined {
  if (!owner) {
    return undefined;
  }

  const { predictionMarks, traps, points, ...rest } = owner;
  const normalized: Partial<ServerOwnerState> = { ...rest };

  if (predictionMarks) {
    normalized.predictionMarks = unpackVectors(predictionMarks);
  }
  if (traps) {
    normalized.traps = unpackVectors(traps);
  }
  if (points) {
    normalized.points = unpackPoints(points);
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeSnapshot(snapshot: NetworkSnapshot): ServerSnapshot {
  return {
    roomId: snapshot.roomId,
    phase: snapshot.phase,
    phaseEndsAt: snapshot.phaseEndsAt,
    updatedAt: snapshot.updatedAt,
    mazeSize: snapshot.mazeSize,
    countdownDurationMs: snapshot.countdownDurationMs,
    prepDurationMs: snapshot.prepDurationMs,
    exploreDurationMs: snapshot.exploreDurationMs,
    targetScore: snapshot.targetScore,
    sessions: snapshot.sessions.map((session) => ({ ...session })),
    player: {
      angle: snapshot.player.angle,
      predictionHits: snapshot.player.predictionHits,
      position: { ...snapshot.player.position },
      velocity: { ...snapshot.player.velocity },
      score: snapshot.player.score,
    },
    owner: normalizeOwnerState(snapshot.owner),
  };
}

function normalizePlayerPatch(
  player?: Partial<NetworkPlayerState>,
): Partial<ServerPlayerState> | undefined {
  if (!player) {
    return undefined;
  }

  const patch: Partial<ServerPlayerState> = {};

  if (player.angle !== undefined) {
    patch.angle = player.angle;
  }
  if (player.predictionHits !== undefined) {
    patch.predictionHits = player.predictionHits;
  }
  if (player.position) {
    patch.position = { ...player.position };
  }
  if (player.velocity) {
    patch.velocity = { ...player.velocity };
  }
  if (player.score !== undefined) {
    patch.score = player.score;
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
}

function normalizePartialSnapshot(changes: PartialNetworkSnapshot): PartialServerSnapshot {
  const { owner, player, sessions, ...rest } = changes;
  const normalized: PartialServerSnapshot = { ...(rest as PartialServerSnapshot) };

  if (sessions) {
    normalized.sessions = sessions.map((session) => ({ ...session }));
  }

  const playerPatch = normalizePlayerPatch(player);
  if (playerPatch) {
    normalized.player = playerPatch;
  }

  const ownerPatch = normalizeOwnerPatch(owner);
  if (ownerPatch) {
    normalized.owner = ownerPatch;
  }

  return normalized;
}

export function normalizeServerPayload(payload: NetworkStatePayload): ServerStatePayload {
  if (payload.full) {
    return {
      seq: payload.seq,
      full: true,
      snapshot: normalizeSnapshot(payload.snapshot),
    };
  }

  return {
    seq: payload.seq,
    full: false,
    changes: normalizePartialSnapshot(payload.changes),
  };
}

function cloneOwner(owner: ServerOwnerState): ServerOwnerState {
  return {
    ...owner,
    predictionMarks: cloneVectorList(owner.predictionMarks),
    traps: cloneVectorList(owner.traps),
    points: clonePoints(owner.points),
  };
}

function clonePlayer(player: ServerPlayerState): ServerPlayerState {
  return {
    angle: player.angle,
    predictionHits: player.predictionHits,
    position: cloneVector(player.position),
    velocity: cloneVector(player.velocity),
    score: player.score,
  };
}

function cloneSessions(sessions: ServerSessionEntry[]): ServerSessionEntry[] {
  return sessions.map((session) => ({ ...session }));
}

function cloneSnapshot(snapshot: ServerSnapshot): ServerSnapshot {
  return {
    ...snapshot,
    sessions: cloneSessions(snapshot.sessions),
    player: clonePlayer(snapshot.player),
    owner: cloneOwner(snapshot.owner),
  };
}

function mergePlayer(
  base: ServerPlayerState,
  patch?: Partial<ServerPlayerState>,
): ServerPlayerState {
  if (!patch) {
    return clonePlayer(base);
  }

  return {
    angle: patch.angle ?? base.angle,
    predictionHits: patch.predictionHits ?? base.predictionHits,
    position: cloneVector(patch.position ?? base.position),
    velocity: cloneVector(patch.velocity ?? base.velocity),
    score: patch.score ?? base.score,
  };
}

function mergeOwner(base: ServerOwnerState, patch?: Partial<ServerOwnerState>): ServerOwnerState {
  if (!patch) {
    return cloneOwner(base);
  }

  return {
    wallStock: patch.wallStock ?? base.wallStock,
    wallRemoveLeft: patch.wallRemoveLeft ?? base.wallRemoveLeft,
    trapCharges: patch.trapCharges ?? base.trapCharges,
    editCooldownUntil: patch.editCooldownUntil ?? base.editCooldownUntil,
    predictionLimit: patch.predictionLimit ?? base.predictionLimit,
    predictionHits: patch.predictionHits ?? base.predictionHits,
    predictionMarks: cloneVectorList(patch.predictionMarks ?? base.predictionMarks),
    traps: cloneVectorList(patch.traps ?? base.traps),
    points: clonePoints(patch.points ?? base.points),
  };
}

function mergeSnapshots(base: ServerSnapshot, changes: PartialServerSnapshot): ServerSnapshot {
  return {
    ...base,
    ...changes,
    sessions: changes.sessions ? cloneSessions(changes.sessions) : cloneSessions(base.sessions),
    player: mergePlayer(base.player, changes.player),
    owner: mergeOwner(base.owner, changes.owner),
  };
}

function buildNextSnapshot(
  previous: ServerSnapshot | null,
  payload: ServerStatePayload,
): ServerSnapshot | null {
  if (payload.full) {
    return cloneSnapshot(payload.snapshot);
  }

  if (!previous) {
    return null;
  }

  return mergeSnapshots(previous, payload.changes);
}

export const useSessionStore = create<SessionState>((set) => ({
  roomId: null,
  role: null,
  phase: 'lobby',
  phaseEndsAt: undefined,
  mazeSize: 40,
  score: 0,
  targetScore: 0,
  owner: createInitialOwnerClientState(),
  player: createInitialPlayerClientState(),
  serverSnapshot: null,
  serverSeq: 0,
  setRoom: (roomId, role) => set({ roomId, role }),
  setScore: (score, targetScore) => set({ score, targetScore }),
  applyServerState: (payload) =>
    set((state) => {
      if (state.serverSnapshot && payload.seq <= state.serverSeq) {
        return state;
      }

      const nextSnapshot = buildNextSnapshot(state.serverSnapshot, payload);
      if (!nextSnapshot) {
        return state;
      }

      return {
        ...state,
        serverSnapshot: nextSnapshot,
        serverSeq: payload.seq,
        mazeSize: nextSnapshot.mazeSize,
        phase: nextSnapshot.phase,
        phaseEndsAt: nextSnapshot.phaseEndsAt,
        score: nextSnapshot.player.score,
        targetScore: nextSnapshot.targetScore,
        owner: {
          wallStock: nextSnapshot.owner.wallStock,
          wallRemoveLeft: nextSnapshot.owner.wallRemoveLeft,
          trapCharges: nextSnapshot.owner.trapCharges,
          editCooldownUntil: nextSnapshot.owner.editCooldownUntil,
          predictionLimit: nextSnapshot.owner.predictionLimit,
          activePredictionCount: nextSnapshot.owner.predictionMarks.length,
          predictionHits: nextSnapshot.owner.predictionHits,
          predictionMarks: cloneVectorList(nextSnapshot.owner.predictionMarks),
          traps: cloneVectorList(nextSnapshot.owner.traps),
        },
        player: {
          predictionHits: nextSnapshot.player.predictionHits,
          position: cloneVector(nextSnapshot.player.position),
        },
      } satisfies Partial<SessionState>;
    }),
  reset: () =>
    set(() => ({
      roomId: null,
      role: null,
      phase: 'lobby',
      phaseEndsAt: undefined,
      mazeSize: 40,
      score: 0,
      targetScore: 0,
      owner: createInitialOwnerClientState(),
      player: createInitialPlayerClientState(),
      serverSnapshot: null,
      serverSeq: 0,
    })),
}));
