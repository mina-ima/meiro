import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { App } from '../src/app';
import { resetToastStoreForTest } from '../src/ui/toasts';
import { useSessionStore, type ServerStatePayload } from '../src/state/sessionStore';

describe('楽観UI禁止', () => {
  beforeEach(() => {
    resetToastStoreForTest();
    act(() => {
      useSessionStore.getState().reset();
      useSessionStore.getState().setRoom('ROOM-PENDING', 'owner');
    });
  });

  afterEach(() => {
    act(() => {
      useSessionStore.getState().reset();
    });
  });

  it('STATE受信前は待機表示のみをレンダリングする', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '接続待機中' })).toBeInTheDocument();
    expect(
      screen.getByText(/サーバーからのSTATE更新を待機しています。/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/罠権利/)).not.toBeInTheDocument();
    expect(screen.queryByText(/予測地点ヒット/)).not.toBeInTheDocument();

    const payload: ServerStatePayload = {
      seq: 1,
      full: true,
      snapshot: {
        roomId: 'ROOM-PENDING',
        phase: 'explore',
        mazeSize: 40,
        updatedAt: Date.now(),
        countdownDurationMs: 3_000,
        prepDurationMs: 60_000,
        exploreDurationMs: 300_000,
        phaseEndsAt: Date.now() + 30_000,
        targetScore: 0,
        pointCompensationAward: 0,
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
          wallStock: 12,
          wallRemoveLeft: 1,
          trapCharges: 1,
          editCooldownUntil: Date.now() + 1_000,
          editCooldownDuration: 1_000,
          forbiddenDistance: 2,
          predictionLimit: 3,
          predictionHits: 0,
          predictionMarks: [],
          traps: [],
          points: [],
        },
      },
    };

    act(() => {
      useSessionStore.getState().applyServerState(payload);
    });

    expect(screen.queryByRole('heading', { name: '接続待機中' })).not.toBeInTheDocument();
    expect(screen.getByText('罠権利: 1')).toBeInTheDocument();
    expect(screen.getByText('予測地点: 残り3 / 3')).toBeInTheDocument();
    expect(screen.getByLabelText('俯瞰マップ')).toBeInTheDocument();
  });
});
