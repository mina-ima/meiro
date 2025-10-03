import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFixedFrameLoop } from '../src/game/frameLoop';

describe('useFixedFrameLoop', () => {
  const callbacks: FrameRequestCallback[] = [];
  let nextId = 1;
  let cancelSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    callbacks.length = 0;
    nextId = 1;

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return nextId++;
    });

    cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      callbacks.length = Math.max(0, callbacks.length - 1);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flush(time: number) {
    const cb = callbacks.shift();
    if (!cb) {
      throw new Error('requestAnimationFrame queue が空です');
    }

    act(() => {
      cb(time);
    });
  }

  it('33ms未満の連続呼び出しでは1フレームに制限する', () => {
    const onFrame = vi.fn();

    function TestComponent() {
      useFixedFrameLoop(onFrame);
      return null;
    }

    render(<TestComponent />);

    flush(0);
    flush(16);
    flush(32);

    expect(onFrame).not.toHaveBeenCalled();

    flush(48);
    expect(onFrame).toHaveBeenCalledTimes(1);

    flush(64);
    flush(80);
    expect(onFrame).toHaveBeenCalledTimes(2);
  });

  it('アンマウント時に登録済みのフレームを解除する', () => {
    function TestComponent() {
      useFixedFrameLoop(() => {});
      return null;
    }

    const { unmount } = render(<TestComponent />);

    flush(0);
    flush(40);

    unmount();

    expect(cancelSpy).toHaveBeenCalled();
  });
});
