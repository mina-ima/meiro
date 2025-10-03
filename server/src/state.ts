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
  sessions: Map<string, PlayerSession>;
}

export function createInitialRoomState(id: string, now: number = Date.now()): RoomState {
  return {
    id,
    phase: 'lobby',
    createdAt: now,
    updatedAt: now,
    sessions: new Map(),
  };
}
