import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { App } from '../src/app';
import { useSessionStore, type ServerStatePayload } from '../src/state/sessionStore';
import { resetToastStoreForTest } from '../src/ui/toasts';
import { createMockMaze } from './helpers/mockMaze';

function applyServerState(payload: ServerStatePayload): void {
  act(() => {
    useSessionStore.getState().applyServerState(payload);
  });
}

describe('App owner forbidden distance integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetToastStoreForTest();
    act(() => {
      useSessionStore.getState().reset();
      useSessionStore.getState().setRoom('ROOM-FORBID', 'owner');
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('STATEメッセージの禁止距離をHUDに反映する', () => {
    render(<App />);

    applyServerState({
      seq: 1,
      full: true,
      snapshot: {
        roomId: 'ROOM-FORBID',
        phase: 'prep',
        mazeSize: 40,
        updatedAt: 0,
        countdownDurationMs: 3_000,
        prepDurationMs: 60_000,
        exploreDurationMs: 300_000,
        targetScore: 0,
        pointCompensationAward: 0,
        paused: false,
        sessions: [],
        player: {
          position: { x: 10, y: 10 },
          velocity: { x: 0, y: 0 },
          angle: 0,
          predictionHits: 0,
          score: 0,
        },
        owner: {
          wallStock: 48,
          wallRemoveLeft: 1,
          trapCharges: 1,
          editCooldownUntil: 0,
          editCooldownDuration: 1_000,
          predictionLimit: 3,
          predictionHits: 0,
          predictionMarks: [],
          traps: [],
          points: [],
          forbiddenDistance: 4,
        },
        maze: createMockMaze(40),
      },
    });

    expect(screen.getByText('禁止エリア距離: 4')).toBeInTheDocument();
  });
});
