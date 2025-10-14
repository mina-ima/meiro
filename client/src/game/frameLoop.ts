import { useEffect, useRef } from 'react';
import { recordFrame } from '../logging/telemetry';

export type FrameLoopCallback = (deltaMs: number) => void;

const TARGET_FPS = 30;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
const EPSILON = 0.01;
const MAX_STEPS_PER_TICK = 5;

/**
 * `requestAnimationFrame` は環境によって60fps以上で呼び出されるため、そのまま利用すると
 * 仕様上の描画上限である30fpsを超えてしまう。累積時間を追跡し、既定間隔以上になるまで
 * コールバックを遅延させることで上限を保証する。
 */
export function useFixedFrameLoop(callback: FrameLoopCallback): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    let rafId: number | null = null;
    let lastTime: number | null = null;
    let accumulator = 0;

    const tick = (timestamp: number) => {
      if (lastTime === null) {
        lastTime = timestamp;
      }

      const delta = timestamp - lastTime;
      lastTime = timestamp;
      accumulator += delta;

      let steps = 0;
      while (accumulator + EPSILON >= FRAME_INTERVAL_MS && steps < MAX_STEPS_PER_TICK) {
        callbackRef.current(FRAME_INTERVAL_MS);
        recordFrame(FRAME_INTERVAL_MS);
        accumulator -= FRAME_INTERVAL_MS;
        steps += 1;
      }

      if (accumulator < 0) {
        accumulator = 0;
      }

      if (rafId !== null) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      lastTime = null;
      accumulator = 0;
    };
  }, []);
}

export const FRAME_LOOP_INTERVAL_MS = FRAME_INTERVAL_MS;
