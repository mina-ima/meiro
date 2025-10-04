import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_RADIUS, SERVER_TICK_INTERVAL_MS } from '@meiro/common';
import { usePlayerInterpolation, type PlayerSnapshot } from '../src/game/playerInterpolation';

function TestComponent({ snapshot }: { snapshot: PlayerSnapshot | null }) {
  const state = usePlayerInterpolation(snapshot);

  return (
    <output data-testid="player-x">
      {state.position.x.toFixed(4)}
    </output>
  );
}

describe('usePlayerInterpolation', () => {
  const callbacks: FrameRequestCallback[] = [];
  let now = 0;

  beforeEach(() => {
    callbacks.length = 0;
    now = 0;
    vi.useFakeTimers();
    vi.setSystemTime(0);

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });

    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      callbacks.length = Math.max(0, callbacks.length - 1);
    });

    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function flushRaf(time: number) {
    const callback = callbacks.shift();
    if (!callback) {
      throw new Error('requestAnimationFrame queue が空です');
    }

    act(() => {
      now = time;
      callback(time);
    });
  }

  it('サーバ更新を補間しつつ壁位置を超えない', () => {
    const initial: PlayerSnapshot = {
      timestamp: 0,
      position: { x: 0.5, y: 0.5 },
      angle: 0,
      velocity: { x: 0, y: 0 },
    };

    const { rerender } = render(<TestComponent snapshot={initial} />);

    flushRaf(0);
    flushRaf(34);

    rerender(
      <TestComponent
        snapshot={{
          timestamp: SERVER_TICK_INTERVAL_MS,
          position: { x: 0.9, y: 0.5 },
          angle: 0,
          velocity: { x: 2, y: 0 },
        }}
      />,
    );

    flushRaf(68);

    rerender(
      <TestComponent
        snapshot={{
          timestamp: SERVER_TICK_INTERVAL_MS * 2,
          position: { x: 1 - PLAYER_RADIUS, y: 0.5 },
          angle: 0,
          velocity: { x: 0, y: 0 },
        }}
      />,
    );

    const limit = 1 - PLAYER_RADIUS + 1e-6;

    for (let i = 0; i < 6; i += 1) {
      flushRaf(68 + (i + 1) * 34);
      const displayed = Number(screen.getByTestId('player-x').textContent);
      expect(displayed).toBeLessThanOrEqual(Number(limit.toFixed(4)));
    }
  });
});
