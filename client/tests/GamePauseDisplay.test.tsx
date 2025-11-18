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

describe('切断ポーズ表示', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetToastStoreForTest();
    act(() => {
      useSessionStore.getState().reset();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('切断による一時停止中は警告と残り秒数を表示する', async () => {
    act(() => {
      useSessionStore.getState().setRoom('ROOM-PAUSE', 'player');
    });

    render(<App />);

    applyServerState({
      seq: 1,
      full: true,
      snapshot: {
        roomId: 'ROOM-PAUSE',
        phase: 'explore',
        phaseEndsAt: undefined,
        mazeSize: 20,
        updatedAt: 0,
        countdownDurationMs: 3_000,
        prepDurationMs: 60_000,
        exploreDurationMs: 300_000,
        targetScore: 15,
        paused: false,
        sessions: [
          { id: 'owner', role: 'owner', nick: 'Owner' },
          { id: 'player', role: 'player', nick: 'Runner' },
        ],
        player: {
          position: { x: 2, y: 2 },
          velocity: { x: 0, y: 0 },
          angle: 0,
          predictionHits: 0,
          score: 3,
        },
        owner: {
          wallStock: 48,
          wallRemoveLeft: 1,
          trapCharges: 1,
          editCooldownUntil: 0,
          editCooldownDuration: 1_000,
          forbiddenDistance: 2,
          predictionLimit: 3,
          predictionHits: 0,
          predictionMarks: [],
          traps: [],
          points: [],
        },
        maze: createMockMaze(20),
      },
    } as unknown as ServerStatePayload);

    act(() => {
      useSessionStore.setState((state) => ({
        ...state,
        paused: true,
        pauseReason: 'disconnect',
        pauseExpiresAt: Date.now() + 60_000,
        pauseRemainingMs: 60_000,
      }));
    });

    expect(screen.getByText('通信が途切れています')).toBeInTheDocument();
    expect(
      screen.getByText('再接続を待機しています。残り 60 秒で不在側の敗北となります。'),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(
      screen.getByText('再接続を待機しています。残り 45 秒で不在側の敗北となります。'),
    ).toBeInTheDocument();
  });
});
