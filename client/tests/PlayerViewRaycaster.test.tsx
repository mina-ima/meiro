import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLAYER_FOV_DEGREES,
  PLAYER_MAX_RAY_COUNT,
  PLAYER_VIEW_RANGE,
} from '../src/config/spec';
import { FRAME_LOOP_INTERVAL_MS } from '../src/game/frameLoop';
import { castRays, type RaycasterConfig, type RayHit } from '../src/game/Raycaster';
import { PlayerView } from '../src/views/PlayerView';
import { useSessionStore } from '../src/state/sessionStore';
import { createMockMaze } from './helpers/mockMaze';

vi.mock('../src/game/Raycaster', async () => {
  const actual = await vi.importActual<typeof import('../src/game/Raycaster')>(
    '../src/game/Raycaster',
  );
  return {
    ...actual,
    castRays: vi.fn(),
  };
});

const castRaysMock = vi.mocked(castRays);

class FakeContext2D implements Partial<CanvasRenderingContext2D> {
  canvas: HTMLCanvasElement;
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  operations: Array<{
    fillStyle: string | CanvasGradient | CanvasPattern;
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 320;
    this.canvas.height = 180;
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.operations.push({
      fillStyle: this.fillStyle,
      x,
      y,
      width,
      height,
    });
  }

  createLinearGradient(): CanvasGradient {
    return {
      addColorStop: () => {},
    } as unknown as CanvasGradient;
  }
}

function flushAnimationFrame(callbacks: FrameRequestCallback[], time: number) {
  const cb = callbacks.shift();
  if (!cb) {
    throw new Error('requestAnimationFrame キューが空です');
  }
  act(() => {
    cb(time);
  });
}

describe('PlayerView レイキャスト仕様', () => {
  const rafCallbacks: FrameRequestCallback[] = [];
  let fakeContext: FakeContext2D;

  beforeEach(() => {
    castRaysMock.mockReset();
    rafCallbacks.length = 0;
    fakeContext = new FakeContext2D();

    vi.useFakeTimers();
    vi.setSystemTime(0);

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
      if (type === '2d') {
        return fakeContext as unknown as CanvasRenderingContext2D;
      }
      return null;
    });

    initializeSessionState();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    useSessionStore.getState().reset();
    castRaysMock.mockReset();
  });

  it('FOV/距離/レイ数を仕様どおりに設定する', () => {
    const configs: RaycasterConfig[] = [];
    castRaysMock.mockImplementation((state, config) => {
      configs.push(config);
      return [];
    });

    render(
      <PlayerView
        points={0}
        targetPoints={10}
        predictionHits={0}
        phase="explore"
        timeRemaining={120}
      />,
    );

    expect(screen.getByLabelText('レイキャスト表示')).toBeInTheDocument();

    flushAnimationFrame(rafCallbacks, 0);
    flushAnimationFrame(rafCallbacks, FRAME_LOOP_INTERVAL_MS + 1);

    expect(configs.length).toBeGreaterThan(0);
    const config = configs[0];
    const expectedFov = (PLAYER_FOV_DEGREES * Math.PI) / 180;

    expect(config.fov).toBeCloseTo(expectedFov);
    expect(config.range).toBeLessThanOrEqual(PLAYER_VIEW_RANGE);
    expect(config.resolution).toBeLessThanOrEqual(PLAYER_MAX_RAY_COUNT);
  });

  it('4マス目のヒットを減光して描画する', () => {
    const nearHit: RayHit = {
      tile: { x: 2, y: 2 },
      distance: 1,
      angle: 0,
      intensity: 1,
    };

    const farHit: RayHit = {
      tile: { x: 5, y: 2 },
      distance: PLAYER_VIEW_RANGE,
      angle: 0.1,
      intensity: 0.5,
    };

    castRaysMock.mockImplementation(() => [nearHit, farHit]);

    render(
      <PlayerView
        points={0}
        targetPoints={10}
        predictionHits={0}
        phase="explore"
        timeRemaining={120}
      />,
    );

    flushAnimationFrame(rafCallbacks, 0);
    flushAnimationFrame(rafCallbacks, FRAME_LOOP_INTERVAL_MS + 1);

    const columnOperations = fakeContext.operations.filter((op) => op.y !== 0 || op.height !== 0);

    expect(columnOperations.length).toBeGreaterThanOrEqual(2);

    const farColumn = columnOperations[columnOperations.length - 1];
    const expectedColor = expectedColorForIntensity(farHit.intensity);

    expect(farColumn.fillStyle).toBe(expectedColor);
  });

  it('境界の壁に命中した中央レイは距離4で減光する', async () => {
    const actualRaycaster = await vi.importActual<typeof import('../src/game/Raycaster')>(
      '../src/game/Raycaster',
    );

    const capturedHits: RayHit[][] = [];

    castRaysMock.mockImplementation((state, config, environment) => {
      const hits = actualRaycaster.castRays(state, config, environment);
      capturedHits.push(hits);
      return hits;
    });

    initializeSessionState({
      playerPosition: { x: 16, y: 2 },
      playerAngle: 0,
    });

    render(
      <PlayerView
        points={0}
        targetPoints={10}
        predictionHits={0}
        phase="explore"
        timeRemaining={120}
      />,
    );

    flushAnimationFrame(rafCallbacks, 0);
    flushAnimationFrame(rafCallbacks, FRAME_LOOP_INTERVAL_MS + 1);

    expect(capturedHits.length).toBeGreaterThan(0);
    const firstHits = capturedHits[0];
    const centerIndex = Math.floor(firstHits.length / 2);
    const centerHit = firstHits[centerIndex];

    expect(centerHit.tile).not.toBeNull();
    expect(centerHit.distance).toBeCloseTo(PLAYER_VIEW_RANGE, 6);
    expect(centerHit.intensity).toBeCloseTo(0.5, 6);
  });
});

function expectedColorForIntensity(intensity: number): string {
  const clamped = Math.max(0, Math.min(1, intensity));
  const near = { r: 226, g: 232, b: 240 };
  const far = { r: 15, g: 23, b: 42 };
  const r = Math.round(far.r + (near.r - far.r) * clamped);
  const g = Math.round(far.g + (near.g - far.g) * clamped);
  const b = Math.round(far.b + (near.b - far.b) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

interface SessionStateOverrides {
  playerPosition?: { x: number; y: number };
  playerAngle?: number;
}

function initializeSessionState(overrides: SessionStateOverrides = {}) {
  const now = Date.now();
  const playerPosition = overrides.playerPosition ?? { x: 2, y: 2 };
  const playerAngle = overrides.playerAngle ?? 0;
  const maze = createMockMaze(20);

  useSessionStore.setState((state) => ({
    ...state,
    roomId: 'ROOM1',
    role: 'player',
    phase: 'explore',
    phaseEndsAt: now + 60_000,
    paused: false,
    pauseReason: undefined,
    pauseExpiresAt: undefined,
    pauseRemainingMs: undefined,
    pausePhase: undefined,
    mazeSize: 20,
    maze,
    score: 0,
    targetScore: 10,
    serverSeq: 1,
    serverSnapshot: {
      roomId: 'ROOM1',
      phase: 'explore',
      phaseEndsAt: now + 60_000,
      updatedAt: now,
      mazeSize: 20,
      countdownDurationMs: 3_000,
      prepDurationMs: 60_000,
      exploreDurationMs: 300_000,
      targetScore: 10,
      pointCompensationAward: 0,
      paused: false,
      pauseReason: undefined,
      pauseExpiresAt: undefined,
      pauseRemainingMs: undefined,
      pausePhase: undefined,
      sessions: [],
      player: {
        position: { ...playerPosition },
        velocity: { x: 0, y: 0 },
        angle: playerAngle,
        predictionHits: 0,
        score: 0,
      },
      owner: {
        wallStock: 0,
        wallRemoveLeft: 1,
        trapCharges: 1,
        editCooldownUntil: now,
        editCooldownDuration: 1_000,
        forbiddenDistance: 2,
        predictionLimit: 3,
        predictionHits: 0,
        predictionMarks: [],
        traps: [],
        points: [],
      },
      maze,
    },
    player: {
      predictionHits: 0,
      position: { ...playerPosition },
    },
  }));
}
