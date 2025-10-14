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
