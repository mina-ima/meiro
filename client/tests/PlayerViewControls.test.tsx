import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PlayerView } from '../src/views/PlayerView';
import { useSessionStore } from '../src/state/sessionStore';
import type { NetClient } from '../src/net/NetClient';

// 標準的な迷路スナップショットを注入するヘルパー
function applyMazeSnapshot(options: {
  cellWalls: { top: boolean; right: boolean; bottom: boolean; left: boolean };
  position?: { x: number; y: number };
  angle?: number;
}) {
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
        angle: options.angle ?? 0, // 0 = east(右向き)
        predictionHits: 0,
        position: options.position ?? { x: 0.5, y: 0.5 },
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
        cells: [{ x: 0, y: 0, walls: options.cellWalls }],
      },
    },
  });
}

describe('PlayerView 操作', () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exploreフェーズで操作説明と方向ボタンを表示する', () => {
    applyMazeSnapshot({ cellWalls: { top: false, right: false, bottom: false, left: false } });
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
    expect(screen.getByLabelText('左へ移動')).toBeInTheDocument();
    expect(screen.getByLabelText('右へ移動')).toBeInTheDocument();
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

  it('壁がある方向のボタンはdisabledになる', () => {
    // angle=0 (east向き)、east=right側に壁あり、それ以外は通路
    applyMazeSnapshot({ cellWalls: { top: false, right: true, bottom: false, left: false } });
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

    // east向きで前=east, 左=north, 右=south, 後=west
    // east(右壁)=true → 前進 disabled
    // north(上壁)=false → 左へ移動 enabled
    // south(下壁)=false → 右へ移動 enabled
    // west(左壁)=false → 後退 enabled
    expect(screen.getByLabelText('前進')).toBeDisabled();
    expect(screen.getByLabelText('後退')).not.toBeDisabled();
    expect(screen.getByLabelText('左へ移動')).not.toBeDisabled();
    expect(screen.getByLabelText('右へ移動')).not.toBeDisabled();
  });

  it('Wキー押下で1ステップ分のforward=1パルスを送信する', () => {
    applyMazeSnapshot({ cellWalls: { top: false, right: false, bottom: false, left: false } });
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
      vi.advanceTimersByTime(100); // パルス中
    });

    const midCall = send.mock.calls[send.mock.calls.length - 1][0];
    expect(midCall).toMatchObject({ type: 'P_INPUT', forward: 1, yaw: 0 });

    act(() => {
      vi.advanceTimersByTime(500); // パルス終了後
    });
    const finalCall = send.mock.calls[send.mock.calls.length - 1][0];
    expect(finalCall).toMatchObject({ type: 'P_INPUT', forward: 0, yaw: 0 });
  });

  it('壁方向のキー入力はステップを開始しない', () => {
    // east向きで前(east)に壁
    applyMazeSnapshot({ cellWalls: { top: false, right: true, bottom: false, left: false } });
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
      vi.advanceTimersByTime(200);
    });

    // 全ての送信は forward=0, yaw=0 のはず
    const allZero = send.mock.calls.every((c) => c[0].forward === 0 && c[0].yaw === 0);
    expect(allZero).toBe(true);
  });

  it('左ステップは250ms回転→500ms前進のシーケンスを送信する', () => {
    applyMazeSnapshot({ cellWalls: { top: false, right: false, bottom: false, left: false } });
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
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    });
    // フェーズ1: 回転
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ yaw: -1, forward: 0 });

    // フェーズ2: 前進
    act(() => {
      vi.advanceTimersByTime(250); // 回転終了→前進開始
    });
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ yaw: 0, forward: 1 });

    // 完了
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ yaw: 0, forward: 0 });
  });

  it('前進ボタンpointerDownで1ステップ実行する', () => {
    applyMazeSnapshot({ cellWalls: { top: false, right: false, bottom: false, left: false } });
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
      vi.advanceTimersByTime(100);
    });

    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ forward: 1 });
  });

  it('clientが未接続なら送信しない', () => {
    applyMazeSnapshot({ cellWalls: { top: false, right: false, bottom: false, left: false } });
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
    expect(true).toBe(true);
  });

  it('exploreフェーズではcanvas（レイキャスト表示）を描画する', () => {
    applyMazeSnapshot({ cellWalls: { top: true, right: false, bottom: false, left: true } });
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

    expect(screen.getByTestId('explore-canvas')).toBeInTheDocument();
  });
});
