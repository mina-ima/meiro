import { create } from 'zustand';

export interface SessionState {
  roomId: string | null;
  role: 'owner' | 'player' | null;
  score: number;
  targetScore: number;
  setRoom: (roomId: string, role: 'owner' | 'player') => void;
  setScore: (score: number, targetScore: number) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  roomId: null,
  role: null,
  score: 0,
  targetScore: 0,
  setRoom: (roomId, role) => set({ roomId, role }),
  setScore: (score, targetScore) => set({ score, targetScore }),
  reset: () =>
    set({
      roomId: null,
      role: null,
      score: 0,
      targetScore: 0,
    }),
}));
