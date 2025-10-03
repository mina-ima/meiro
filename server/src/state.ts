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
  sessions: Map<string, PlayerSession>;
}

export function createInitialRoomState(id: string): RoomState {
  return {
    id,
    phase: 'lobby',
    createdAt: Date.now(),
    sessions: new Map(),
  };
}
