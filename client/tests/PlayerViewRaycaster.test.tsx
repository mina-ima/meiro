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
import { useSessionStore, type ServerMazeState } from '../src/state/sessionStore';
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
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  lineWidth = 1;
  operations: Array<{
    fillStyle: string | CanvasGradient | CanvasPattern;
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];
  strokes: Array<{
    strokeStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
    lineDash: number[];
    kind: 'path' | 'rect';
    rect?: { x: number; y: number; width: number; height: number };
  }> = [];
  private currentPath: Array<{ type: 'move' | 'line'; x: number; y: number }> = [];
  private lineDash: number[] = [];

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

  beginPath(): void {
    this.currentPath = [];
  }

  moveTo(x: number, y: number): void {
    this.currentPath.push({ type: 'move', x, y });
  }

  lineTo(x: number, y: number): void {
    this.currentPath.push({ type: 'line', x, y });
  }

  stroke(): void {
    this.strokes.push({
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineDash: [...this.lineDash],
      kind: 'path',
    });
    this.currentPath = [];
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.strokes.push({
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineDash: [...this.lineDash],
      kind: 'rect',
      rect: { x, y, width, height },
    });
  }

  setLineDash(segments: number[]): void {
    this.lineDash = [...segments];
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
    expect(config.range).toBeLessThanOrEqual(PLAYER_VIEW_RANGE * 2);
    expect(config.range).toBeGreaterThan(PLAYER_VIEW_RANGE);
    expect(config.resolution).toBeLessThanOrEqual(PLAYER_MAX_RAY_COUNT);
  });

  it('レイキャストの強度をデータ属性に記録する', () => {
    const farHit: RayHit = {
      tile: { x: 5, y: 2 },
      distance: PLAYER_VIEW_RANGE * 2,
      angle: 0.1,
      intensity: 0.5,
    };

    castRaysMock.mockImplementation(() => [farHit]);

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

    const datasetValue = fakeContext.canvas.dataset.lastRayIntensity;
    expect(datasetValue).toBe(farHit.intensity.toFixed(2));
  });

  it('ASCII スタイルのワイヤーフレームを描画する', () => {
    castRaysMock.mockReturnValue([]);

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

    const fillStyles = fakeContext.operations
      .map((operation) => operation.fillStyle)
      .filter((style): style is string => typeof style === 'string');

    expect(fillStyles).toContain('#000000');
    expect(fillStyles).toContain('#ef4444');
    const strokeStyles = fakeContext.strokes
      .map((stroke) => stroke.strokeStyle)
      .filter((style): style is string => typeof style === 'string');

    expect(strokeStyles.length).toBeGreaterThan(0);
    strokeStyles.forEach((style) => {
      expect(style).toBe('#ef4444');
    });
    expect(fakeContext.strokes.some((stroke) => stroke.kind === 'rect')).toBe(true);
  });

  it('迷路の壁に応じて中心レイの距離が変化する', async () => {
    const actualRaycaster = await vi.importActual<typeof import('../src/game/Raycaster')>(
      '../src/game/Raycaster',
    );

    const capturedHits: RayHit[][] = [];

    castRaysMock.mockImplementation((state, config, environment) => {
      const hits = actualRaycaster.castRays(state, config, environment);
      capturedHits.push(hits);
      return hits;
    });

    const maze = createMockMaze(20);
    const center = maze.cells.find((cell) => cell.x === 10 && cell.y === 10);
    const east = maze.cells.find((cell) => cell.x === 11 && cell.y === 10);
    if (!center || !east) {
      throw new Error('maze setup failed');
    }
    center.walls.right = true;
    east.walls.left = true;

    initializeSessionState({
      playerPosition: { x: 10.5, y: 10.5 },
      playerAngle: 0,
      maze,
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

    expect(centerHit.distance).toBeLessThan(2);
    expect(centerHit.distance).toBeCloseTo(1, 1);
  });

  it('レイヒット距離に応じて縦線を描画する', () => {
    castRaysMock.mockReturnValue([
      { tile: { x: 1, y: 1 }, distance: 0.5, angle: -0.1, intensity: 1 },
      { tile: { x: 2, y: 1 }, distance: 2, angle: 0, intensity: 0.85 },
      { tile: { x: 3, y: 1 }, distance: 4, angle: 0.1, intensity: 0.5 },
    ]);

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

    const rayColumns = fakeContext.operations.filter((operation) => {
      if (typeof operation.fillStyle !== 'string') {
        return false;
      }
      const isRayColor = operation.fillStyle.startsWith('rgba(239, 68, 68');
      const isWideEnough = operation.width >= 2;
      return isRayColor && isWideEnough;
    });

    expect(rayColumns.length).toBeGreaterThanOrEqual(3);
    const heights = rayColumns.map((column) => column.height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(10);
  });

  it('正面が抜けている場合は床の奥行きレイヤーを描き、壁列を減らす', () => {
    castRaysMock.mockReturnValue([
      { tile: { x: 1, y: 1 }, distance: 0.8, angle: -0.2, intensity: 1 },
      { tile: null, distance: PLAYER_VIEW_RANGE, angle: 0, intensity: 0 },
      { tile: { x: 3, y: 1 }, distance: 0.9, angle: 0.2, intensity: 0.9 },
    ]);

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

    const wallColumns = fakeContext.operations.filter((operation) => {
      if (typeof operation.fillStyle !== 'string') {
        return false;
      }
      return operation.fillStyle.startsWith('rgba(239, 68, 68');
    });
    expect(wallColumns.length).toBe(2);

    const floorLayers = fakeContext.operations.filter((operation) => {
      if (typeof operation.fillStyle !== 'string') {
        return false;
      }
      return operation.fillStyle.startsWith('rgba(56, 189, 248');
    });

    expect(floorLayers.length).toBeGreaterThan(0);
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
      playerPosition: { x: 16.5, y: 2.5 },
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
    expect(centerHit.tile).toBeNull();
    expect(centerHit.intensity).toBe(0);

    const datasetDistances = fakeContext.canvas.dataset.lastRayDistances ?? '';
    expect(datasetDistances).not.toBe('');
    const parsed = datasetDistances
      .split(',')
      .map((entry) => Number.parseFloat(entry))
      .filter((value) => Number.isFinite(value));
    expect(parsed.length).toBeGreaterThan(0);
    const normalizedCenter = parsed[Math.floor(parsed.length / 2)];
    expect(normalizedCenter).toBeCloseTo(PLAYER_VIEW_RANGE, 2);
  });

  it('視界シルエットを dead-end として判定して公開する', () => {
    const hits: RayHit[] = [
      { tile: { x: 0, y: 0 }, distance: 0.5, angle: -0.3, intensity: 1 },
      { tile: { x: 1, y: 0 }, distance: 0.6, angle: 0, intensity: 0.9 },
      { tile: { x: 2, y: 0 }, distance: 0.5, angle: 0.3, intensity: 0.8 },
    ];
    castRaysMock.mockReturnValue(hits);

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

    expect(fakeContext.canvas.dataset.viewSilhouette).toBe('dead-end');
    expect(fakeContext.canvas.dataset.viewCenterDepth).toBe('0.60');
  });

  it('視界シルエットを corner-left として判定して公開する', () => {
    const hits: RayHit[] = [
      { tile: { x: 0, y: 0 }, distance: PLAYER_VIEW_RANGE, angle: -0.4, intensity: 0.5 },
      { tile: { x: 1, y: 0 }, distance: 0.6, angle: -0.1, intensity: 0.8 },
      { tile: { x: 2, y: 0 }, distance: 0.6, angle: 0.2, intensity: 0.7 },
    ];
    castRaysMock.mockReturnValue(hits);

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

    expect(fakeContext.canvas.dataset.viewSilhouette).toBe('corner-left');
    expect(fakeContext.canvas.dataset.viewLeftDepth).toBe(PLAYER_VIEW_RANGE.toFixed(2));
  });

  it('視界シルエットを junction として判定して公開する', () => {
    const hits: RayHit[] = [
      { tile: { x: 0, y: 0 }, distance: PLAYER_VIEW_RANGE, angle: -0.4, intensity: 0.6 },
      { tile: { x: 1, y: 0 }, distance: PLAYER_VIEW_RANGE, angle: 0, intensity: 0.6 },
      { tile: { x: 2, y: 0 }, distance: PLAYER_VIEW_RANGE, angle: 0.4, intensity: 0.6 },
    ];
    castRaysMock.mockReturnValue(hits);

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

    expect(fakeContext.canvas.dataset.viewSilhouette).toBe('junction');
    expect(fakeContext.canvas.dataset.viewRightDepth).toBe(PLAYER_VIEW_RANGE.toFixed(2));
  });

  it('4マス先は黒フォグで覆い床グローが抑制される', () => {
    castRaysMock.mockReturnValue([
      { tile: { x: 1, y: 1 }, distance: 0.8, angle: -0.2, intensity: 0.9 },
      { tile: null, distance: PLAYER_VIEW_RANGE, angle: 0, intensity: 0 },
      { tile: { x: 3, y: 1 }, distance: 1.2, angle: 0.2, intensity: 0.8 },
    ]);

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

    const fogLayers = fakeContext.operations.filter((operation) => {
      if (typeof operation.fillStyle !== 'string') {
        return false;
      }
      return operation.fillStyle.startsWith('rgba(0, 0, 0');
    });
    expect(fogLayers.length).toBeGreaterThan(0);

    const glowLayers = fakeContext.operations.filter((operation) => {
      if (typeof operation.fillStyle !== 'string') {
        return false;
      }
      return operation.fillStyle.startsWith('rgba(56, 189, 248');
    });
    expect(glowLayers.length).toBeGreaterThan(0);
    const highestGlow = Math.min(...glowLayers.map((layer) => layer.y));
    const lowestFog = Math.min(...fogLayers.map((layer) => layer.y));
    expect(lowestFog).toBeLessThan(highestGlow);
  });

  it('閉じた壁面にはテクスチャストライプを描画する', () => {
    castRaysMock.mockReturnValue([
      { tile: { x: 1, y: 1 }, distance: 0.6, angle: -0.3, intensity: 1 },
      { tile: { x: 2, y: 1 }, distance: 0.7, angle: 0, intensity: 0.9 },
      { tile: { x: 3, y: 1 }, distance: 0.6, angle: 0.3, intensity: 1 },
    ]);

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

    const textureLayers = fakeContext.operations.filter((operation) => {
      if (typeof operation.fillStyle !== 'string') {
        return false;
      }
      return operation.fillStyle.startsWith('rgba(252, 165, 165');
    });

    expect(textureLayers.length).toBeGreaterThan(0);
  });
});

interface SessionStateOverrides {
  playerPosition?: { x: number; y: number };
  playerAngle?: number;
  maze?: ServerMazeState;
}

function initializeSessionState(overrides: SessionStateOverrides = {}) {
  const now = Date.now();
  const playerPosition = overrides.playerPosition ?? { x: 2.5, y: 2.5 };
  const playerAngle = overrides.playerAngle ?? 0;
  const maze = overrides.maze ?? createMockMaze(20);

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
