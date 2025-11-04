import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { App } from '../src/app';
import { useSessionStore, type ServerStatePayload } from '../src/state/sessionStore';
import { resetToastStoreForTest } from '../src/ui/toasts';

function applyServerState(payload: ServerStatePayload): void {
  act(() => {
    useSessionStore.getState().applyServerState(payload);
  });
}

describe('オーナー編集クールダウン表示', () => {
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

  it('サーバーから受け取ったクールダウンが時間経過に合わせて短縮される', async () => {
    act(() => {
      useSessionStore.getState().setRoom('ROOM-COOLDOWN', 'owner');
    });

    render(<App />);

    applyServerState({
      seq: 1,
      full: true,
      snapshot: {
        roomId: 'ROOM-COOLDOWN',
        phase: 'explore',
        phaseEndsAt: 10_000,
        mazeSize: 40,
        updatedAt: 0,
        countdownDurationMs: 3_000,
        prepDurationMs: 60_000,
        exploreDurationMs: 300_000,
        targetScore: 0,
        paused: false,
        sessions: [],
        player: {
          position: { x: 0, y: 0 },
          velocity: { x: 0, y: 0 },
          angle: 0,
          predictionHits: 0,
          score: 0,
        },
        owner: {
          wallStock: 48,
          wallRemoveLeft: 1,
          trapCharges: 1,
          editCooldownUntil: 1_500,
          editCooldownDuration: 1_000,
          forbiddenDistance: 2,
          predictionLimit: 3,
          predictionHits: 0,
          predictionMarks: [],
          traps: [],
          points: [],
        },
      },
    } as unknown as ServerStatePayload);

    expect(screen.getByText('編集クールダウン: 1.5秒')).toBeInTheDocument();
    expect(useSessionStore.getState().owner.editCooldownUntil).toBe(1_500);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(screen.getByText('編集クールダウン: 0.9秒')).toBeInTheDocument();
  });
});
