import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { App } from '../src/app';
import { useSessionStore, type ServerStatePayload } from '../src/state/sessionStore';
import { resetToastStoreForTest } from '../src/ui/toasts';

function applyServerState(payload: ServerStatePayload): void {
  act(() => {
    useSessionStore.getState().applyServerState(payload);
  });
}

describe('App prediction integration', () => {
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

  it('STATEメッセージでオーナービューが予測地点情報を反映する', () => {
    act(() => {
      useSessionStore.getState().setRoom('ROOM-1', 'owner');
    });

    render(<App />);

    applyServerState({
      seq: 1,
      full: true,
      snapshot: {
        roomId: 'ROOM-1',
        phase: 'explore',
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
          position: { x: 0, y: 0 },
          velocity: { x: 0, y: 0 },
          angle: 0,
          predictionHits: 0,
          score: 0,
        },
        owner: {
          wallStock: 12,
          wallRemoveLeft: 1,
          trapCharges: 2,
          editCooldownUntil: 1_500,
          editCooldownDuration: 1_000,
          forbiddenDistance: 2,
          predictionLimit: 3,
          predictionHits: 0,
          predictionMarks: [
            { x: 10, y: 10 },
            { x: 11, y: 12 },
          ],
          traps: [],
          points: [],
        },
      },
    });

    expect(screen.getByText('罠権利: 2')).toBeInTheDocument();
    expect(screen.getByText('罠: 設置0/2')).toBeInTheDocument();
    expect(screen.getByText('編集クールダウン: 1.5秒')).toBeInTheDocument();
    expect(screen.getByText('予測地点: 残り1 / 3')).toBeInTheDocument();
  });

  it('予測地点ヒット数が増えるとプレイヤービューとトーストが更新される', () => {
    act(() => {
      useSessionStore.getState().setRoom('ROOM-2', 'player');
    });

    render(<App />);

    applyServerState({
      seq: 1,
      full: true,
      snapshot: {
        roomId: 'ROOM-2',
        phase: 'explore',
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
          editCooldownUntil: 0,
          editCooldownDuration: 1_000,
          forbiddenDistance: 2,
          predictionLimit: 3,
          predictionHits: 0,
          predictionMarks: [],
          traps: [],
          points: [],
        },
      },
    });

    applyServerState({
      seq: 2,
      full: false,
      changes: {
        updatedAt: 2_000,
        player: {
          predictionHits: 2,
        },
        owner: {
          wallStock: 49,
          wallRemoveLeft: 1,
          trapCharges: 1,
          editCooldownUntil: 0,
          editCooldownDuration: 1_000,
          forbiddenDistance: 2,
          predictionLimit: 3,
          predictionHits: 2,
          predictionMarks: [],
          traps: [],
        },
      },
    });

    expect(screen.getByText('予測地点ヒット: 2')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'エラー通知' })).toHaveTextContent('予測地点を通過！');
  });
});
