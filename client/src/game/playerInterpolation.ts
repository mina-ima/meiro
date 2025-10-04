import { useEffect, useMemo, useRef, useState } from 'react';
import { SERVER_TICK_INTERVAL_MS, type Vector2 } from '@meiro/common';
import { useFixedFrameLoop } from './frameLoop';

const INTERPOLATION_DELAY_MS = SERVER_TICK_INTERVAL_MS;
const EPSILON = 1e-4;
const VELOCITY_EPSILON = 1e-3;

export interface PlayerSnapshot {
  timestamp: number;
  position: Vector2;
  velocity: Vector2;
  angle: number;
}

export interface PlayerInterpolationState {
  position: Vector2;
  velocity: Vector2;
  angle: number;
}

interface SnapshotEntry {
  snapshot: PlayerSnapshot;
  receivedAt: number;
}

const DEFAULT_STATE: PlayerInterpolationState = {
  position: { x: 0, y: 0 },
  velocity: { x: 0, y: 0 },
  angle: 0,
};

export function usePlayerInterpolation(snapshot: PlayerSnapshot | null): PlayerInterpolationState {
  const bufferRef = useRef<SnapshotEntry[]>([]);
  const [state, setState] = useState<PlayerInterpolationState>(() =>
    snapshot ? snapshotToState(snapshot) : DEFAULT_STATE,
  );

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    const buffer = bufferRef.current;
    const now = performance.now();
    const existingIndex = buffer.findIndex(
      (entry) => entry.snapshot.timestamp === snapshot.timestamp,
    );
    if (existingIndex >= 0) {
      buffer.splice(existingIndex, 1);
    }

    buffer.push({ snapshot, receivedAt: now });
    buffer.sort((a, b) => a.snapshot.timestamp - b.snapshot.timestamp);

    while (buffer.length > 6) {
      buffer.shift();
    }

    setState(snapshotToState(snapshot));
  }, [snapshot]);

  useFixedFrameLoop(() => {
    const buffer = bufferRef.current;
    if (buffer.length === 0) {
      return;
    }

    const latest = buffer[buffer.length - 1];
    const now = performance.now();
    const serverNow = latest.snapshot.timestamp + (now - latest.receivedAt);
    const targetTime = serverNow - INTERPOLATION_DELAY_MS;

    const sampled = sampleState(buffer, targetTime);

    if (!statesEqual(sampled, state)) {
      setState(sampled);
    }
  });

  return useMemo(() => state, [state]);
}

function sampleState(buffer: SnapshotEntry[], targetTime: number): PlayerInterpolationState {
  if (buffer.length === 0) {
    return DEFAULT_STATE;
  }

  const first = buffer[0].snapshot;
  if (targetTime <= first.timestamp) {
    return snapshotToState(first);
  }

  for (let i = 1; i < buffer.length; i += 1) {
    const current = buffer[i].snapshot;
    if (targetTime <= current.timestamp) {
      const previous = buffer[i - 1].snapshot;
      const range = current.timestamp - previous.timestamp;
      if (range <= 0) {
        return snapshotToState(current);
      }
      const t = clamp((targetTime - previous.timestamp) / range, 0, 1);
      return interpolateSnapshots(previous, current, t);
    }
  }

  return snapshotToState(buffer[buffer.length - 1].snapshot);
}

function interpolateSnapshots(
  from: PlayerSnapshot,
  to: PlayerSnapshot,
  ratio: number,
): PlayerInterpolationState {
  const t = clamp(ratio, 0, 1);

  return {
    position: {
      x: clampToTargetAxis(lerp(from.position.x, to.position.x, t), from.position.x, to.position.x, to.velocity.x),
      y: clampToTargetAxis(lerp(from.position.y, to.position.y, t), from.position.y, to.position.y, to.velocity.y),
    },
    velocity: {
      x: lerp(from.velocity.x, to.velocity.x, t),
      y: lerp(from.velocity.y, to.velocity.y, t),
    },
    angle: lerpAngle(from.angle, to.angle, t),
  };
}

function snapshotToState(snapshot: PlayerSnapshot): PlayerInterpolationState {
  return {
    position: { ...snapshot.position },
    velocity: { ...snapshot.velocity },
    angle: snapshot.angle,
  };
}

function statesEqual(a: PlayerInterpolationState, b: PlayerInterpolationState): boolean {
  return (
    Math.abs(a.position.x - b.position.x) < EPSILON &&
    Math.abs(a.position.y - b.position.y) < EPSILON &&
    Math.abs(a.velocity.x - b.velocity.x) < EPSILON &&
    Math.abs(a.velocity.y - b.velocity.y) < EPSILON &&
    Math.abs(a.angle - b.angle) < EPSILON
  );
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  if (delta > Math.PI) {
    delta -= Math.PI * 2;
  } else if (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return a + delta * t;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function clampToTargetAxis(value: number, from: number, to: number, targetVelocity: number): number {
  if (Math.abs(targetVelocity) >= VELOCITY_EPSILON) {
    return value;
  }

  if (from > to) {
    return Math.min(value, to);
  }

  if (from < to) {
    return Math.max(value, to);
  }

  return to;
}
