import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useSessionStore, type ServerStatePayload } from '../src/state/sessionStore';

function ScoreProbe() {
  const score = useSessionStore((state) => state.score);
  const targetScore = useSessionStore((state) => state.targetScore);

  return (
    <section>
      <output aria-label="現在ポイント">{score}</output>
      <output aria-label="規定ポイント">{targetScore}</output>
    </section>
  );
}

describe('セッションストアのスコア同期', () => {
  afterEach(() => {
    act(() => {
      useSessionStore.getState().reset();
    });
  });

  it('サーバーSTATE受信でスコアと規定ポイントを更新する', () => {
    render(<ScoreProbe />);

    const payload = {
      seq: 1,
      full: true,
      snapshot: {
        roomId: 'ROOM-POINT',
        phase: 'explore',
        mazeSize: 40,
        phaseEndsAt: Date.now() + 60_000,
        updatedAt: Date.now(),
        countdownDurationMs: 3_000,
        prepDurationMs: 60_000,
        exploreDurationMs: 300_000,
        targetScore: 42,
        paused: false,
        sessions: [],
        owner: {
          wallStock: 10,
          wallRemoveLeft: 1 as const,
          trapCharges: 1,
          editCooldownUntil: Date.now(),
          editCooldownDuration: 1_000,
          forbiddenDistance: 2,
          predictionLimit: 3,
          predictionHits: 0,
          predictionMarks: [],
          traps: [],
          points: [],
        },
        player: {
          position: { x: 0, y: 0 },
          velocity: { x: 0, y: 0 },
          angle: 0,
          predictionHits: 0,
          score: 12,
        },
      },
    } as unknown as ServerStatePayload;

    expect(screen.getByLabelText('現在ポイント')).toHaveTextContent('0');
    expect(screen.getByLabelText('規定ポイント')).toHaveTextContent('0');

    act(() => {
      useSessionStore.getState().applyServerState(payload);
    });

    expect(screen.getByLabelText('現在ポイント')).toHaveTextContent('12');
    expect(screen.getByLabelText('規定ポイント')).toHaveTextContent('42');
  });
});
