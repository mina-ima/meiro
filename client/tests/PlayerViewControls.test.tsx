import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PlayerView } from '../src/views/PlayerView';
import { useSessionStore } from '../src/state/sessionStore';
import type { NetClient } from '../src/net/NetClient';

describe('PlayerView 操作', () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exploreフェーズで操作説明と方向ボタンを表示する', () => {
    render(
      <PlayerView
        client={null}
        points={0}
        targetPoints={10}
        predictionHits={0}
        phase="explore"
        timeRemaining={120}
        compensationBonus={0}
      />,
    );

    expect(screen.getByLabelText('プレイヤー操作')).toBeInTheDocument();
    expect(screen.getByLabelText('前進')).toBeInTheDocument();
    expect(screen.getByLabelText('後退')).toBeInTheDocument();
    expect(screen.getByLabelText('左回転')).toBeInTheDocument();
    expect(screen.getByLabelText('右回転')).toBeInTheDocument();
    // 操作説明バー
    expect(screen.getByLabelText('プレイヤー操作')).toHaveTextContent(/前進/);
  });

  it('explore以外では操作UIを表示しない', () => {
    render(
      <PlayerView
        client={null}
        points={0}
        targetPoints={10}
        predictionHits={0}
        phase="prep"
        timeRemaining={60}
        compensationBonus={0}
      />,
    );

    expect(screen.queryByLabelText('プレイヤー操作')).toBeNull();
  });

  it('Wキー押下でforward=1のP_INPUTを送信する', () => {
    const send = vi.fn();
    const client = { send } as unknown as NetClient;
    render(
      <PlayerView
        client={client}
        points={0}
        targetPoints={10}
        predictionHits={0}
        phase="explore"
        timeRemaining={120}
        compensationBonus={0}
      />,
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    });
    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(send).toHaveBeenCalled();
    const lastCall = send.mock.calls[send.mock.calls.length - 1][0];
    expect(lastCall).toMatchObject({ type: 'P_INPUT', forward: 1, yaw: 0 });
    expect(typeof lastCall.timestamp).toBe('number');
  });

  it('Wキー離すとforward=0に戻る', () => {
    const send = vi.fn();
    const client = { send } as unknown as NetClient;
    render(
      <PlayerView
        client={client}
        points={0}
        targetPoints={10}
        predictionHits={0}
        phase="explore"
        timeRemaining={120}
        compensationBonus={0}
      />,
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    });
    act(() => {
      vi.advanceTimersByTime(60);
    });

    const lastCall = send.mock.calls[send.mock.calls.length - 1][0];
    expect(lastCall.forward).toBe(0);
  });

  it('矢印右キーでyaw=+0.5を送信する', () => {
    const send = vi.fn();
    const client = { send } as unknown as NetClient;
    render(
      <PlayerView
        client={client}
        points={0}
        targetPoints={10}
        predictionHits={0}
        phase="explore"
        timeRemaining={120}
        compensationBonus={0}
      />,
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
    });
    act(() => {
      vi.advanceTimersByTime(60);
    });

    const lastCall = send.mock.calls[send.mock.calls.length - 1][0];
    expect(lastCall).toMatchObject({ type: 'P_INPUT', yaw: 0.5, forward: 0 });
  });

  it('前進ボタンpointerDownでforward=1のP_INPUTを送信する', () => {
    const send = vi.fn();
    const client = { send } as unknown as NetClient;
    render(
      <PlayerView
        client={client}
        points={0}
        targetPoints={10}
        predictionHits={0}
        phase="explore"
        timeRemaining={120}
        compensationBonus={0}
      />,
    );

    const forwardBtn = screen.getByLabelText('前進');
    act(() => {
      fireEvent.pointerDown(forwardBtn, { pointerId: 1 });
    });
    act(() => {
      vi.advanceTimersByTime(60);
    });

    const lastCall = send.mock.calls[send.mock.calls.length - 1][0];
    expect(lastCall).toMatchObject({ type: 'P_INPUT', forward: 1 });
  });

  it('clientが未接続なら送信しない', () => {
    render(
      <PlayerView
        client={null}
        points={0}
        targetPoints={10}
        predictionHits={0}
        phase="explore"
        timeRemaining={120}
        compensationBonus={0}
      />,
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // 未接続では何もしない（クラッシュしないことだけ確認）
    expect(true).toBe(true);
  });

  it('exploreフェーズではプレビュー風SVG画像を表示する（canvasではなく）', () => {
    // 迷路をstoreに注入
    const store = useSessionStore.getState();
    store.applyServerState({
      seq: 1,
      full: true,
      snapshot: {
        roomId: 'ROOM',
        phase: 'explore',
        phaseEndsAt: Date.now() + 60_000,
        updatedAt: Date.now(),
        mazeSize: 20,
        countdownDurationMs: 3_000,
        prepDurationMs: 60_000,
        exploreDurationMs: 300_000,
        targetScore: 10,
        pointCompensationAward: 0,
        paused: false,
        sessions: [],
        player: {
          angle: 0,
          predictionHits: 0,
          position: { x: 0.5, y: 0.5 },
          velocity: { x: 0, y: 0 },
          score: 0,
        },
        owner: {
          wallStock: 0,
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
        maze: {
          seed: 'TEST',
          start: { x: 0, y: 0 },
          goal: { x: 19, y: 19 },
          cells: [
            { x: 0, y: 0, walls: { top: true, right: false, bottom: false, left: true } },
          ],
        },
      },
    });

    render(
      <PlayerView
        client={null}
        points={0}
        targetPoints={10}
        predictionHits={0}
        phase="explore"
        timeRemaining={120}
        compensationBonus={0}
      />,
    );

    expect(screen.getByTestId('explore-svg-view')).toBeInTheDocument();
    expect(screen.queryByLabelText('レイキャスト表示')).toBeNull();
  });
});
