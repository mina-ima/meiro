import { useEffect, useMemo, useRef, useState } from 'react';
import { HUD } from './HUD';
import { useFixedFrameLoop } from '../game/frameLoop';
import {
  castRays,
  type RayHit,
  type RaycasterEnvironment,
  type RaycasterState,
} from '../game/Raycaster';
import { PLAYER_FOV_DEGREES, PLAYER_MAX_RAY_COUNT, PLAYER_VIEW_RANGE } from '../config/spec';
import {
  useSessionStore,
  type PauseReason,
  type ServerMazeCell,
  type ServerMazeState,
} from '../state/sessionStore';

function createSvgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

interface PreviewClip {
  id: 'entry' | 'junction' | 'goal';
  title: string;
  description: string;
  hint: string;
  previewImage: string;
  previewAlt: string;
}

let defaultPreviewClips: readonly PreviewClip[] | null = null;

function getDefaultPreviewClips(): readonly PreviewClip[] {
  if (!defaultPreviewClips) {
    defaultPreviewClips = createDefaultPreviewClips();
  }
  return defaultPreviewClips;
}

const PREVIEW_INTERVAL_MS = 5_000;

export interface PlayerViewProps {
  points: number;
  targetPoints: number;
  predictionHits: number;
  phase: 'lobby' | 'countdown' | 'prep' | 'explore' | 'result';
  timeRemaining: number;
  pauseReason?: PauseReason;
  pauseSecondsRemaining?: number;
  compensationBonus?: number;
}

const PLAYER_FOV_RADIANS = (PLAYER_FOV_DEGREES * Math.PI) / 180;
const BACKGROUND_COLOR = '#000000';
const BRICK_NEAR_COLOR = '#8c1c1c';
const BRICK_FAR_COLOR = '#2d0505';
const BRICK_LINE_COLOR = '#f0f0f0';
const CEILING_TINT_COLOR = '#120404';
const RAYCAST_GRID_SCALE = 2;
const NEAR_WALL_THRESHOLD = PLAYER_VIEW_RANGE * 0.35;
const OPEN_CORRIDOR_THRESHOLD = PLAYER_VIEW_RANGE * 0.85;
const JUNCTION_FRONT_THRESHOLD = PLAYER_VIEW_RANGE * 0.65;
const SIDE_OPENING_DEPTH = 0.62;

type ViewSilhouette =
  | 'dead-end'
  | 'corner-left'
  | 'corner-right'
  | 'junction'
  | 'corridor'
  | 'unknown';

interface ViewProfile {
  silhouette: ViewSilhouette;
  centerDistance: number;
  leftDistance: number;
  rightDistance: number;
  focusDistance: number;
  leftOpen: boolean;
  rightOpen: boolean;
  frontBlocked: boolean;
}

interface CorridorDimensions {
  width: number;
  height: number;
  topY: number;
  bottomY: number;
  leftNearX: number;
  rightNearX: number;
  leftFarX: number;
  rightFarX: number;
  centerX: number;
}

function computeCorridorDimensions(
  canvas: HTMLCanvasElement,
  profile?: ViewProfile | null,
): CorridorDimensions {
  const { width, height } = canvas;
  const baseTopY = Math.round(height * 0.18);
  const bottomY = Math.round(height * 0.98);
  const leftNearX = Math.round(width * 0.12);
  const rightNearX = width - leftNearX;
  const baseLeftFar = Math.round(width * 0.34);
  const baseRightFar = width - baseLeftFar;
  const centerX = width / 2;
  const focusRatio = profile ? clamp(profile.focusDistance / PLAYER_VIEW_RANGE, 0, 1) : 0.55;
  const leftRatio = profile ? clamp(profile.leftDistance / PLAYER_VIEW_RANGE, 0, 1) : 0.45;
  const rightRatio = profile ? clamp(profile.rightDistance / PLAYER_VIEW_RANGE, 0, 1) : 0.45;
  const leftFarX = lerp(baseLeftFar, centerX - width * 0.09, leftRatio * 0.9);
  const rightFarX = lerp(baseRightFar, centerX + width * 0.09, rightRatio * 0.9);
  const topY = Math.max(4, Math.round(lerp(baseTopY, baseTopY - height * 0.08, 1 - focusRatio)));

  return {
    width,
    height,
    topY,
    bottomY,
    leftNearX,
    rightNearX,
    leftFarX,
    rightFarX,
    centerX,
  };
}

export function PlayerView({
  points,
  targetPoints,
  predictionHits,
  phase,
  timeRemaining,
  pauseReason,
  pauseSecondsRemaining,
  compensationBonus,
}: PlayerViewProps) {
  const maze = useSessionStore((state) => state.maze);
  const clips = usePreviewClips(maze);
  const [clipIndex, setClipIndex] = useState(0);
  const [secondsUntilNextClip, setSecondsUntilNextClip] = useState(PREVIEW_INTERVAL_MS / 1000);
  const initialCompensation = Number.isFinite(compensationBonus)
    ? Math.max(0, Math.floor(compensationBonus ?? 0))
    : 0;
  const safeTargetPoints = Math.max(0, targetPoints);
  const reachedTarget = phase === 'result' && points >= safeTargetPoints;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const playerPosition = useSessionStore((state) =>
    state.serverSnapshot ? state.serverSnapshot.player.position : state.player.position,
  );
  const playerAngle = useSessionStore((state) =>
    state.serverSnapshot ? state.serverSnapshot.player.angle : 0,
  );
  const mazeSize = useSessionStore((state) => state.mazeSize);

  const rayStateRef = useRef<RaycasterState>({
    position: scaleVector(playerPosition),
    angle: playerAngle,
  });

  const environmentRef = useRef<RaycasterEnvironment>(createMazeEnvironment(maze, mazeSize));
  const exploringRef = useRef(phase === 'explore');

  useEffect(() => {
    environmentRef.current = createMazeEnvironment(maze, mazeSize);
  }, [maze, mazeSize]);

  useEffect(() => {
    rayStateRef.current = {
      position: scaleVector(playerPosition),
      angle: playerAngle,
    };
  }, [playerPosition, playerAngle]);

  useEffect(() => {
    exploringRef.current = phase === 'explore';
    if (phase !== 'explore') {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }
      clearScene(context);
    }
  }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    clearScene(context);
  }, []);

  useFixedFrameLoop(() => {
    if (!exploringRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const baseResolution = Math.max(1, Math.floor(canvas.width / 4));
    const resolution = Math.min(PLAYER_MAX_RAY_COUNT, baseResolution);

    const hits = castRays(
      rayStateRef.current,
      {
        fov: PLAYER_FOV_RADIANS,
        range: PLAYER_VIEW_RANGE * RAYCAST_GRID_SCALE,
        resolution,
      },
      environmentRef.current,
    );

    renderRaycastScene(context, hits);
  });

  useEffect(() => {
    if (phase !== 'prep') {
      setClipIndex(0);
      setSecondsUntilNextClip(PREVIEW_INTERVAL_MS / 1000);
      return;
    }

    setClipIndex(0);
    setSecondsUntilNextClip(PREVIEW_INTERVAL_MS / 1000);

    const changeTimer = window.setInterval(() => {
      setClipIndex((current) => (current + 1) % clips.length);
      setSecondsUntilNextClip(PREVIEW_INTERVAL_MS / 1000);
    }, PREVIEW_INTERVAL_MS);

    const countdownTimer = window.setInterval(() => {
      setSecondsUntilNextClip((value) => (value <= 1 ? PREVIEW_INTERVAL_MS / 1000 : value - 1));
    }, 1_000);

    return () => {
      window.clearInterval(changeTimer);
      window.clearInterval(countdownTimer);
    };
  }, [phase, clips.length, clips]);

  const activeClip = clips[clipIndex];
  const showPreview = phase === 'prep';

  return (
    <div>
      <h2>プレイヤービュー</h2>
      <div style={{ position: 'relative', width: 640, height: 360 }}>
        <canvas ref={canvasRef} width={640} height={360} aria-label="レイキャスト表示" />
        {showPreview ? (
          <div
            role="group"
            aria-label="準備中プレビュー"
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
              color: '#f8fafc',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '1.5rem',
              textAlign: 'center',
              gap: '0.75rem',
            }}
          >
            <p style={{ fontSize: '0.9rem' }}>
              クリップ {clipIndex + 1} / {clips.length}
            </p>
            <h3 style={{ fontSize: '1.3rem', margin: 0 }}>{activeClip.title}</h3>
            <figure
              style={{
                margin: 0,
                width: '100%',
                maxWidth: '20rem',
              }}
            >
              <img
                src={activeClip.previewImage}
                alt={activeClip.previewAlt}
                style={{
                  display: 'block',
                  width: '100%',
                  borderRadius: '0.75rem',
                  boxShadow: '0 24px 48px rgba(8, 47, 73, 0.45)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                }}
              />
              <figcaption
                style={{
                  fontSize: '0.8rem',
                  marginTop: '0.5rem',
                  color: '#cbd5f5',
                  lineHeight: 1.5,
                }}
              >
                {activeClip.hint}
              </figcaption>
            </figure>
            <p style={{ maxWidth: '24rem', lineHeight: 1.6 }}>{activeClip.description}</p>
            <p aria-live="polite" style={{ fontSize: '0.9rem', margin: 0 }}>
              次のクリップまで {secondsUntilNextClip} 秒
            </p>
          </div>
        ) : null}
      </div>
      <HUD timeRemaining={timeRemaining} score={points} targetScore={targetPoints}>
        {phase === 'explore' && initialCompensation > 0 ? (
          <p aria-live="polite">初期ポイント補填 +{initialCompensation}</p>
        ) : null}
        <p>予測地点ヒット: {predictionHits}</p>
        {pauseReason === 'disconnect' && pauseSecondsRemaining !== undefined ? (
          <p aria-live="polite">通信再開待ち: 残り {pauseSecondsRemaining} 秒</p>
        ) : null}
      </HUD>
      {reachedTarget ? (
        <div
          role="status"
          aria-live="assertive"
          style={{
            marginTop: '1rem',
            padding: '1rem',
            borderRadius: '0.75rem',
            background: 'rgba(21, 94, 117, 0.2)',
            color: '#f8fafc',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            boxShadow: '0 16px 32px rgba(15, 23, 42, 0.6)',
          }}
        >
          <p style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600 }}>規定ポイント達成！</p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.95rem' }}>最終スコア: {points}</p>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.95rem' }}>
            規定ポイント: {safeTargetPoints}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function usePreviewClips(maze?: ServerMazeState | null): readonly PreviewClip[] {
  return useMemo(() => createPreviewClipsFromMaze(maze), [maze]);
}

function createMazeEnvironment(
  maze: ServerMazeState | null | undefined,
  mazeSize: number,
): RaycasterEnvironment {
  if (!maze || !Array.isArray(maze.cells) || maze.cells.length === 0) {
    return createBoundaryEnvironment(mazeSize);
  }

  const gridSize = Math.max(1, mazeSize * RAYCAST_GRID_SCALE + 1);
  const grid = new Uint8Array(gridSize * gridSize).fill(1);

  maze.cells.forEach((cell) => {
    const cx = cell.x * RAYCAST_GRID_SCALE + 1;
    const cy = cell.y * RAYCAST_GRID_SCALE + 1;
    carveCell(grid, gridSize, cx, cy);
    if (!cell.walls.top) {
      carveCell(grid, gridSize, cx, cy - 1);
    }
    if (!cell.walls.bottom) {
      carveCell(grid, gridSize, cx, cy + 1);
    }
    if (!cell.walls.left) {
      carveCell(grid, gridSize, cx - 1, cy);
    }
    if (!cell.walls.right) {
      carveCell(grid, gridSize, cx + 1, cy);
    }
  });

  return {
    isWall(tileX: number, tileY: number) {
      if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) {
        return true;
      }
      const x = Math.floor(tileX);
      const y = Math.floor(tileY);
      if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) {
        return true;
      }
      return grid[y * gridSize + x] === 1;
    },
  };
}

function carveCell(grid: Uint8Array, size: number, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return;
  }
  grid[y * size + x] = 0;
}

function createBoundaryEnvironment(baseSize: number): RaycasterEnvironment {
  const limit = Math.max(1, baseSize * RAYCAST_GRID_SCALE + 1);
  return {
    isWall(tileX: number, tileY: number) {
      if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) {
        return true;
      }
      if (tileX < 0 || tileY < 0) {
        return true;
      }
      if (tileX >= limit || tileY >= limit) {
        return true;
      }
      return false;
    },
  };
}

function clearScene(context: CanvasRenderingContext2D): void {
  drawWireframeBase(context);
  drawBrickBackdrop(context);
  resetRayDataset(context.canvas);
}

function resetRayDataset(canvas: HTMLCanvasElement): void {
  canvas.dataset.lastRayIntensity = '';
  canvas.dataset.lastRayDistances = '';
  canvas.dataset.viewSilhouette = '';
  canvas.dataset.viewCenterDepth = '';
  canvas.dataset.viewLeftDepth = '';
  canvas.dataset.viewRightDepth = '';
  canvas.dataset.viewFogStart = '';
}

function drawWireframeBase(context: CanvasRenderingContext2D): void {
  const { width, height } = context.canvas;
  context.fillStyle = BACKGROUND_COLOR;
  context.fillRect(0, 0, width, height);
}

function drawBrickBackdrop(context: CanvasRenderingContext2D, profile?: ViewProfile): void {
  const dims = computeCorridorDimensions(context.canvas, profile);
  drawBrickCeiling(context, dims);
  drawBrickFloor(context, dims);
  context.canvas.dataset.viewFogStart = '1.00';
}

interface CorridorQuad {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

function drawBrickCeiling(context: CanvasRenderingContext2D, dims: CorridorDimensions): void {
  const layers = 6;
  for (let i = 0; i < layers; i += 1) {
    const startRatio = i / layers;
    const endRatio = (i + 1) / layers;
    const yStart = dims.topY * startRatio;
    const yEnd = dims.topY * endRatio;
    const color = mixHexColors(BRICK_NEAR_COLOR, CEILING_TINT_COLOR, endRatio);
    const quad: CorridorQuad = {
      topLeft: { x: 0, y: yStart },
      topRight: { x: context.canvas.width, y: yStart },
      bottomRight: { x: context.canvas.width, y: yEnd },
      bottomLeft: { x: 0, y: yEnd },
    };
    fillQuad(context, quad, color);

    context.strokeStyle = BRICK_LINE_COLOR;
    context.lineWidth = Math.max(1, context.canvas.height * 0.002);
    drawLine(context, 0, yStart, context.canvas.width, yStart);
  }
}

function drawBrickFloor(context: CanvasRenderingContext2D, dims: CorridorDimensions): void {
  const rows = 18;
  for (let i = 0; i < rows; i += 1) {
    const startRatio = i / rows;
    const endRatio = (i + 1) / rows;
    const quad = createFloorQuad(dims, startRatio, endRatio);
    const shadeRatio = endRatio;
    const color = mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, shadeRatio);
    fillQuad(context, quad, color);
    drawFloorMortar(context, quad, i);
  }
}

function createFloorQuad(
  dims: CorridorDimensions,
  startRatio: number,
  endRatio: number,
): CorridorQuad {
  const bottomY = lerp(dims.bottomY, dims.topY, startRatio);
  const topY = lerp(dims.bottomY, dims.topY, endRatio);
  const bottomLeft = {
    x: lerp(dims.leftNearX, dims.leftFarX, startRatio),
    y: bottomY,
  };
  const bottomRight = {
    x: lerp(dims.rightNearX, dims.rightFarX, startRatio),
    y: bottomY,
  };
  const topLeft = {
    x: lerp(dims.leftNearX, dims.leftFarX, endRatio),
    y: topY,
  };
  const topRight = {
    x: lerp(dims.rightNearX, dims.rightFarX, endRatio),
    y: topY,
  };
  return {
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
  };
}

function fillQuad(context: CanvasRenderingContext2D, quad: CorridorQuad, color: string): void {
  context.beginPath();
  context.moveTo(quad.bottomLeft.x, quad.bottomLeft.y);
  context.lineTo(quad.bottomRight.x, quad.bottomRight.y);
  context.lineTo(quad.topRight.x, quad.topRight.y);
  context.lineTo(quad.topLeft.x, quad.topLeft.y);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function drawFloorMortar(
  context: CanvasRenderingContext2D,
  quad: CorridorQuad,
  rowIndex: number,
): void {
  context.strokeStyle = BRICK_LINE_COLOR;
  context.lineWidth = Math.max(1, context.canvas.height * 0.0018);

  const horizontalLines = Math.max(1, Math.round((quad.bottomLeft.y - quad.topLeft.y) / 6));
  for (let i = 1; i < horizontalLines; i += 1) {
    const ratio = i / horizontalLines;
    const leftPoint = interpolatePoint(quad.bottomLeft, quad.topLeft, ratio);
    const rightPoint = interpolatePoint(quad.bottomRight, quad.topRight, ratio);
    drawLine(context, leftPoint.x, leftPoint.y, rightPoint.x, rightPoint.y);
  }

  const averageWidth =
    (quad.bottomRight.x - quad.bottomLeft.x + quad.topRight.x - quad.topLeft.x) / 2;
  const bricksPerRow = Math.max(2, Math.round(Math.abs(averageWidth) / 26));
  const offsetRatio = (rowIndex % 2) * (0.5 / bricksPerRow);

  for (let i = 0; i <= bricksPerRow; i += 1) {
    let ratio = i / bricksPerRow + offsetRatio;
    ratio -= Math.floor(ratio);
    const bottomPoint = interpolatePoint(quad.bottomLeft, quad.bottomRight, ratio);
    const topPoint = interpolatePoint(quad.topLeft, quad.topRight, ratio);
    drawLine(context, bottomPoint.x, bottomPoint.y, topPoint.x, topPoint.y);
  }
}

function interpolatePoint(
  start: { x: number; y: number },
  end: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  return {
    x: lerp(start.x, end.x, t),
    y: lerp(start.y, end.y, t),
  };
}

function drawLine(
  context: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): void {
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.stroke();
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function renderRaycastScene(context: CanvasRenderingContext2D, hits: RayHit[]): void {
  drawWireframeBase(context);
  const profile = hits.length > 0 ? analyzeViewProfile(hits) : undefined;
  drawBrickBackdrop(context, profile);

  if (!profile) {
    resetRayDataset(context.canvas);
    return;
  }

  drawRayColumns(context, hits);
  updateRayDataset(context.canvas, hits, profile);
}

function updateRayDataset(canvas: HTMLCanvasElement, hits: RayHit[], profile: ViewProfile): void {
  const lastIntensity = hits[hits.length - 1]?.intensity;
  canvas.dataset.lastRayIntensity = lastIntensity === undefined ? '' : lastIntensity.toFixed(2);
  canvas.dataset.lastRayDistances = hits.map((hit) => hit.distance.toFixed(2)).join(',');
  canvas.dataset.viewSilhouette = profile.silhouette;
  canvas.dataset.viewCenterDepth = profile.centerDistance.toFixed(2);
  canvas.dataset.viewLeftDepth = profile.leftDistance.toFixed(2);
  canvas.dataset.viewRightDepth = profile.rightDistance.toFixed(2);
}

function drawRayColumns(context: CanvasRenderingContext2D, hits: RayHit[]): void {
  const { width, height } = context.canvas;
  const horizon = Math.round(height * 0.18);
  const ground = Math.round(height * 0.98);
  const viewHeight = Math.max(1, ground - horizon);
  const spacing = hits.length > 0 ? width / hits.length : width;
  const minHeight = height * 0.08;

  hits.forEach((hit, index) => {
    if (!hit.tile) {
      return;
    }
    const normalizedDistance = clamp(hit.distance / PLAYER_VIEW_RANGE, 0, 1);
    const depthFactor = 1 - normalizedDistance ** 0.85;
    const columnHeight = Math.max(minHeight, viewHeight * depthFactor);
    const columnWidth = Math.max(2, spacing * (0.4 + depthFactor * 0.3));
    const left = index * spacing + spacing / 2 - columnWidth / 2;
    const top = ground - columnHeight;
    drawBrickColumn(context, left, top, columnWidth, columnHeight, normalizedDistance);
  });
}

function drawBrickColumn(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  distanceRatio: number,
): void {
  const color = mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, distanceRatio);
  context.fillStyle = color;
  context.fillRect(left, top, width, height);

  context.strokeStyle = BRICK_LINE_COLOR;
  const rowCount = Math.max(2, Math.round(height / 8));
  const brickHeight = height / rowCount;
  context.lineWidth = Math.max(1, height * 0.003);

  for (let row = 1; row < rowCount; row += 1) {
    const y = Math.round(top + row * brickHeight);
    drawLine(context, left, y, left + width, y);
  }

  const bricksPerRow = Math.max(2, Math.round(width / 8));
  for (let row = 0; row < rowCount; row += 1) {
    const offset = (row % 2) * (width / bricksPerRow / 2);
    const startY = top + row * brickHeight;
    const endY = startY + brickHeight;
    for (let column = 1; column < bricksPerRow; column += 1) {
      const x = left + offset + (width / bricksPerRow) * column;
      if (x <= left || x >= left + width) {
        continue;
      }
      drawLine(context, x, startY, x, endY);
    }
  }
}

function analyzeViewProfile(hits: RayHit[]): ViewProfile {
  if (hits.length === 0) {
    return {
      silhouette: 'unknown',
      centerDistance: PLAYER_VIEW_RANGE,
      leftDistance: PLAYER_VIEW_RANGE,
      rightDistance: PLAYER_VIEW_RANGE,
      focusDistance: PLAYER_VIEW_RANGE,
      leftOpen: false,
      rightOpen: false,
      frontBlocked: false,
    };
  }

  const centerDistance = sampleDistance(hits, 0.5);
  const leftDistance = sampleDistance(hits, 0.18);
  const rightDistance = sampleDistance(hits, 0.82);
  const focusDistance =
    hits.reduce((sum, hit) => sum + clamp(hit.distance, 0, PLAYER_VIEW_RANGE), 0) / hits.length;

  const frontBlocked = centerDistance <= NEAR_WALL_THRESHOLD;
  const leftOpen = leftDistance >= OPEN_CORRIDOR_THRESHOLD;
  const rightOpen = rightDistance >= OPEN_CORRIDOR_THRESHOLD;

  let silhouette: ViewSilhouette = 'corridor';

  if (frontBlocked && !leftOpen && !rightOpen) {
    silhouette = 'dead-end';
  } else if (frontBlocked && leftOpen && !rightOpen) {
    silhouette = 'corner-left';
  } else if (frontBlocked && rightOpen && !leftOpen) {
    silhouette = 'corner-right';
  } else if (leftOpen && rightOpen && centerDistance >= JUNCTION_FRONT_THRESHOLD) {
    silhouette = 'junction';
  } else if (!frontBlocked && leftOpen && !rightOpen) {
    silhouette = 'corner-left';
  } else if (!frontBlocked && rightOpen && !leftOpen) {
    silhouette = 'corner-right';
  } else if (!hits.length) {
    silhouette = 'unknown';
  }

  return {
    silhouette,
    centerDistance,
    leftDistance,
    rightDistance,
    focusDistance,
    leftOpen,
    rightOpen,
    frontBlocked,
  };
}

function sampleDistance(hits: RayHit[], fraction: number): number {
  if (hits.length === 0) {
    return PLAYER_VIEW_RANGE;
  }
  const clampedFraction = clamp(fraction, 0, 1);
  const index = Math.round((hits.length - 1) * clampedFraction);
  const hit = hits[index];
  return hit ? clamp(hit.distance, 0, PLAYER_VIEW_RANGE) : PLAYER_VIEW_RANGE;
}

function scaleVector(vector: { x: number; y: number }): { x: number; y: number } {
  return {
    x: vector.x * RAYCAST_GRID_SCALE,
    y: vector.y * RAYCAST_GRID_SCALE,
  };
}

function mixHexColors(colorA: string, colorB: string, t: number): string {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const ratio = clamp(t, 0, 1);
  const r = Math.round(lerp(a.r, b.r, ratio));
  const g = Math.round(lerp(a.g, b.g, ratio));
  const bl = Math.round(lerp(a.b, b.b, ratio));
  return `rgb(${r}, ${g}, ${bl})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const sanitized = hex.replace('#', '');
  const r = Number.parseInt(sanitized.slice(0, 2), 16);
  const g = Number.parseInt(sanitized.slice(2, 4), 16);
  const b = Number.parseInt(sanitized.slice(4, 6), 16);
  return { r, g, b };
}

function createPreviewClipsFromMaze(maze?: ServerMazeState | null): readonly PreviewClip[] {
  if (!maze || !Array.isArray(maze.cells) || maze.cells.length === 0) {
    return getDefaultPreviewClips();
  }

  const startCell = findCell(maze, maze.start) ?? maze.cells[0];
  const goalCell = findCell(maze, maze.goal) ?? startCell;

  if (!startCell || !goalCell) {
    return getDefaultPreviewClips();
  }

  const lookup = createCellLookup(maze.cells);
  const rng = createSeededRandom(maze.seed);
  const corridorCell = selectCorridorCell(maze, startCell, goalCell, rng);
  const startDirections = getOpenDirections(startCell);
  const corridorDirections = getOpenDirections(corridorCell);
  const goalDirections = getOpenDirections(goalCell);
  const startOrientation = deriveStartOrientation(lookup, startCell, goalCell, startDirections);
  const goalOrientation = deriveApproachOrientation(
    lookup,
    startCell,
    goalCell,
    goalDirections,
    startOrientation,
  );
  const corridorOrientation = deriveApproachOrientation(
    lookup,
    startCell,
    corridorCell,
    corridorDirections,
    startOrientation,
  );

  return [
    createStartClip(startCell, startDirections, startOrientation),
    createCorridorClip(corridorCell, corridorDirections, corridorOrientation),
    createGoalClip(goalCell, goalDirections, goalOrientation),
  ];
}

function createStartClip(
  cell: ServerMazeCell,
  openDirections: Direction[],
  orientation: Direction,
): PreviewClip {
  const description = `スタート近辺。${describeOpenDirections(openDirections)}`;
  const hint =
    openDirections.length > 0
      ? `${directionShortLabel(openDirections[0])}側へ抜けるルートを決めておくと迷いません。`
      : '四方を壁に囲まれるため、周囲を確認して進みましょう。';

  return {
    id: 'entry',
    title: 'スタート地点プレビュー',
    description,
    hint,
    previewImage: createPerspectivePreviewSvg(cell, openDirections, 'start', orientation),
    previewAlt: 'スタート地点プレビュー映像',
  };
}

function createCorridorClip(
  cell: ServerMazeCell,
  openDirections: Direction[],
  orientation: Direction,
): PreviewClip {
  const description = `分岐ポイント。${describeOpenDirections(openDirections)}`;
  const hint = buildCorridorHint(openDirections);

  return {
    id: 'junction',
    title: '迷路分岐プレビュー',
    description,
    hint,
    previewImage: createPerspectivePreviewSvg(cell, openDirections, 'junction', orientation),
    previewAlt: '迷路分岐プレビュー映像',
  };
}

function createGoalClip(
  cell: ServerMazeCell,
  openDirections: Direction[],
  orientation: Direction,
): PreviewClip {
  const description = `ゴール周辺。${describeOpenDirections(openDirections)}光源の位置を覚えましょう。`;
  const hint =
    openDirections.length > 0
      ? `${directionShortLabel(openDirections[0])}側から差し込む光を目印に、最後のコーナーで減速を抑えてください。`
      : '袋小路の光を見失わないよう、壁沿いに進んでください。';

  return {
    id: 'goal',
    title: 'ゴール直前プレビュー',
    description,
    hint,
    previewImage: createPerspectivePreviewSvg(cell, openDirections, 'goal', orientation),
    previewAlt: 'ゴールプレビュー映像',
  };
}

type Direction = 'north' | 'east' | 'south' | 'west';

const DIRECTION_INFO: Record<
  Direction,
  { wall: keyof ServerMazeCell['walls']; label: string; short: string }
> = {
  north: { wall: 'top', label: '北側', short: '北' },
  east: { wall: 'right', label: '東側', short: '東' },
  south: { wall: 'bottom', label: '南側', short: '南' },
  west: { wall: 'left', label: '西側', short: '西' },
};

const DIRECTION_SEQUENCE: Direction[] = ['north', 'east', 'south', 'west'];

const DIRECTION_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
};

function isDirectionOpen(cell: ServerMazeCell, direction: Direction): boolean {
  const wallKey = DIRECTION_INFO[direction].wall;
  return !cell.walls[wallKey];
}

function rotateDirection(direction: Direction, steps: number): Direction {
  const index = DIRECTION_SEQUENCE.indexOf(direction);
  if (index === -1) {
    return direction;
  }
  const normalized = (index + steps + DIRECTION_SEQUENCE.length) % DIRECTION_SEQUENCE.length;
  return DIRECTION_SEQUENCE[normalized] ?? direction;
}

function getOpenDirections(cell: ServerMazeCell): Direction[] {
  const directions: Direction[] = [];
  (Object.keys(DIRECTION_INFO) as Direction[]).forEach((direction) => {
    if (isDirectionOpen(cell, direction)) {
      directions.push(direction);
    }
  });
  return directions;
}

function describeOpenDirections(directions: Direction[]): string {
  if (directions.length === 0) {
    return '四方を壁に囲まれています。';
  }

  if (directions.length === 4) {
    return '四方向すべてに分岐しています。';
  }

  const labels = directions.map((direction) => DIRECTION_INFO[direction].label);
  return `${labels.join('・')}に抜けられます。`;
}

function directionShortLabel(direction: Direction): string {
  return DIRECTION_INFO[direction].short;
}

function buildCorridorHint(directions: Direction[]): string {
  if (directions.length >= 2) {
    const [first, second] = directions;
    return `${directionShortLabel(first)}→${directionShortLabel(second)}のラインで減速を抑えましょう。`;
  }

  if (directions.length === 1) {
    return `${directionShortLabel(directions[0])}方向へ素早く抜ける準備を整えてください。`;
  }

  return '袋小路なので最短で折り返すルートを想定しましょう。';
}

type MazeCellLookup = Map<string, ServerMazeCell>;

function createCellLookup(cells: ServerMazeCell[]): MazeCellLookup {
  const lookup: MazeCellLookup = new Map();
  cells.forEach((cell) => {
    lookup.set(cellKey(cell.x, cell.y), cell);
  });
  return lookup;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function getNeighborCell(
  cell: ServerMazeCell,
  direction: Direction,
  lookup: MazeCellLookup,
): ServerMazeCell | undefined {
  const vector = DIRECTION_VECTORS[direction];
  const key = cellKey(cell.x + vector.dx, cell.y + vector.dy);
  return lookup.get(key);
}

function findPathDirections(
  lookup: MazeCellLookup,
  start: ServerMazeCell,
  target: ServerMazeCell,
): Direction[] {
  if (start.x === target.x && start.y === target.y) {
    return [];
  }

  const startKey = cellKey(start.x, start.y);
  const targetKey = cellKey(target.x, target.y);
  const queue: ServerMazeCell[] = [start];
  const visited = new Set<string>([startKey]);
  const parents = new Map<string, { key: string; direction: Direction }>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const currentKey = cellKey(current.x, current.y);
    if (currentKey === targetKey) {
      break;
    }
    getOpenDirections(current).forEach((direction) => {
      const neighbor = getNeighborCell(current, direction, lookup);
      if (!neighbor) {
        return;
      }
      const neighborKey = cellKey(neighbor.x, neighbor.y);
      if (visited.has(neighborKey)) {
        return;
      }
      visited.add(neighborKey);
      parents.set(neighborKey, { key: currentKey, direction });
      queue.push(neighbor);
    });
  }

  if (!parents.has(targetKey)) {
    return [];
  }

  const path: Direction[] = [];
  let currentKey = targetKey;
  while (currentKey !== startKey) {
    const entry = parents.get(currentKey);
    if (!entry) {
      return [];
    }
    path.unshift(entry.direction);
    currentKey = entry.key;
  }
  return path;
}

function fallbackOrientationFromDirections(directions: Direction[]): Direction {
  return directions[0] ?? 'north';
}

function deriveStartOrientation(
  lookup: MazeCellLookup,
  start: ServerMazeCell,
  goal: ServerMazeCell,
  startDirections: Direction[],
): Direction {
  const path = findPathDirections(lookup, start, goal);
  if (path.length > 0) {
    return path[0];
  }
  return fallbackOrientationFromDirections(startDirections);
}

function deriveApproachOrientation(
  lookup: MazeCellLookup,
  start: ServerMazeCell,
  target: ServerMazeCell,
  targetDirections: Direction[],
  fallback: Direction,
): Direction {
  const path = findPathDirections(lookup, start, target);
  if (path.length > 0) {
    return path[path.length - 1];
  }
  if (targetDirections.length > 0) {
    return targetDirections[0];
  }
  return fallback;
}

function findCell(
  maze: ServerMazeState,
  target: { x: number; y: number },
): ServerMazeCell | undefined {
  return maze.cells.find((cell) => cell.x === target.x && cell.y === target.y);
}

function selectCorridorCell(
  maze: ServerMazeState,
  start: ServerMazeCell,
  goal: ServerMazeCell,
  rng: () => number,
): ServerMazeCell {
  const isSpecial = (cell: ServerMazeCell) => cell.x === start.x && cell.y === start.y;
  const isGoal = (cell: ServerMazeCell) => cell.x === goal.x && cell.y === goal.y;

  const preferred = maze.cells.filter((cell) => {
    if (isSpecial(cell) || isGoal(cell)) {
      return false;
    }
    return getOpenDirections(cell).length >= 3;
  });

  const fallback = maze.cells.filter((cell) => {
    if (isSpecial(cell) || isGoal(cell)) {
      return false;
    }
    return getOpenDirections(cell).length >= 2;
  });

  const pool = preferred.length > 0 ? preferred : fallback;
  if (pool.length === 0) {
    return start;
  }
  const index = Math.floor(rng() * pool.length);
  return pool[index] ?? pool[0];
}

type MazePreviewVariant = 'start' | 'junction' | 'goal';

function createPerspectivePreviewSvg(
  cell: ServerMazeCell,
  openDirections: Direction[],
  variant: MazePreviewVariant,
  orientation: Direction,
): string {
  const view = deriveViewParameters(cell, openDirections, variant);
  const relativeOpenings = computeRelativeOpenings(cell, orientation);
  const floor = buildFloorSvg(view.dims, variant);
  const ceiling = `<rect width="${view.dims.width}" height="${view.dims.topY - 4}" fill="${CEILING_TINT_COLOR}" opacity="0.9" />`;
  const farWall = buildFarWallSvg(view.dims, relativeOpenings.forward, variant);
  const leftOpening = relativeOpenings.left ? createSideOpeningGeometry(view.dims, 'left') : null;
  const rightOpening = relativeOpenings.right
    ? createSideOpeningGeometry(view.dims, 'right')
    : null;
  const leftWall = buildWallSvg(view.dims, 'left', variant, leftOpening);
  const rightWall = buildWallSvg(view.dims, 'right', variant, rightOpening);
  const backExit = buildRearExitSvg(view.dims, relativeOpenings.backward);

  const doorwayBackgrounds = [
    leftOpening ? buildDoorwayBackground(leftOpening) : '',
    rightOpening ? buildDoorwayBackground(rightOpening) : '',
  ].join('\n');

  const sideCorridors = [
    leftOpening ? buildSideCorridorSvg(leftOpening) : '',
    rightOpening ? buildSideCorridorSvg(rightOpening) : '',
  ].join('\n');

  const doorwayFrames = [
    leftOpening ? buildDoorwayFrame(leftOpening) : '',
    rightOpening ? buildDoorwayFrame(rightOpening) : '',
  ].join('\n');
  const depthFade = variant === 'start' ? buildDepthFadeOverlay(view.dims) : '';

  return createSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view.dims.width} ${view.dims.height}">
      <rect width="${view.dims.width}" height="${view.dims.height}" fill="${BACKGROUND_COLOR}" />
      <g
        data-view-tilt="${view.tilt.toFixed(2)}"
        data-facing="${orientation}"
        data-forward-open="${relativeOpenings.forward}"
        data-left-open="${relativeOpenings.left}"
        data-right-open="${relativeOpenings.right}"
        data-back-open="${relativeOpenings.backward}"
      >
        ${ceiling}
        ${floor}
        ${backExit}
        ${farWall}
        ${leftWall}
        ${rightWall}
        ${doorwayBackgrounds}
        ${sideCorridors}
        ${doorwayFrames}
        ${depthFade}
      </g>
    </svg>
  `);
}

function computeRelativeOpenings(cell: ServerMazeCell, facing: Direction): RelativeOpenings {
  return {
    forward: isDirectionOpen(cell, facing),
    right: isDirectionOpen(cell, rotateDirection(facing, 1)),
    backward: isDirectionOpen(cell, rotateDirection(facing, 2)),
    left: isDirectionOpen(cell, rotateDirection(facing, -1)),
  };
}

function createSideOpeningGeometry(
  dims: WireframeDimensions,
  side: 'left' | 'right',
): SideOpeningGeometry {
  const depthRatio = clamp(SIDE_OPENING_DEPTH, 0.55, 0.7);
  const direction = side === 'left' ? -1 : 1;
  const nearEdgeX = side === 'left' ? dims.leftNearX : dims.rightNearX;
  const farEdgeX = side === 'left' ? dims.leftFarX : dims.rightFarX;
  const innerFront = {
    x: lerp(nearEdgeX, farEdgeX, depthRatio),
    y: lerp(dims.bottomY, dims.topY, depthRatio),
  };
  const wallTopY = getWallTopY(dims);
  const visibleWallHeight = dims.bottomY - wallTopY;
  const doorWidth = clamp(dims.width * 0.1, 18, 42);
  const doorHeight = clamp(
    visibleWallHeight * 0.52,
    visibleWallHeight * 0.45,
    visibleWallHeight * 0.67,
  );
  const doorBottomY = innerFront.y;
  const wallMinX = Math.min(nearEdgeX, farEdgeX);
  const wallMaxX = Math.max(nearEdgeX, farEdgeX);
  const unclampedDoorX = side === 'left' ? innerFront.x - doorWidth : innerFront.x;
  const doorX = clamp(unclampedDoorX, wallMinX + 2, wallMaxX - doorWidth - 2);
  const doorY = clamp(doorBottomY - doorHeight, wallTopY + 4, doorBottomY - 4);

  const baseLeftX = doorX;
  const baseRightX = doorX + doorWidth;
  const corridorShift = direction * doorWidth * 1.2;
  const depthRise = clamp(doorHeight * 0.18, 6, visibleWallHeight * 0.35);
  const farFloorY = clamp(doorBottomY - depthRise, wallTopY + 6, doorBottomY - 2);
  const farLeftX = baseLeftX + corridorShift;
  const farRightX = baseRightX + corridorShift;

  const floorPoints: SideOpeningGeometry['corridor']['floor'] = [
    { x: baseLeftX, y: doorBottomY },
    { x: baseRightX, y: doorBottomY },
    { x: farRightX, y: farFloorY },
    { x: farLeftX, y: farFloorY },
  ];

  const farWallHeight = doorHeight * 0.42;
  const farWallWidth = (baseRightX - baseLeftX) * 0.68;
  const farWallCenter = clamp(
    (farLeftX + farRightX) / 2 + direction * doorWidth * 0.1,
    Math.min(farLeftX, farRightX) + farWallWidth / 2,
    Math.max(farLeftX, farRightX) - farWallWidth / 2,
  );
  const farWallBottomY = farFloorY - farWallHeight * 0.05;
  const farWallTopY = farWallBottomY - farWallHeight;
  const farWallPoints: SideOpeningGeometry['corridor']['farWall'] = [
    { x: farWallCenter - farWallWidth / 2, y: farWallBottomY },
    { x: farWallCenter + farWallWidth / 2, y: farWallBottomY },
    { x: farWallCenter + farWallWidth / 2, y: farWallTopY },
    { x: farWallCenter - farWallWidth / 2, y: farWallTopY },
  ];

  return {
    side,
    door: {
      x: doorX,
      y: doorY,
      width: doorWidth,
      height: doorHeight,
    },
    corridor: {
      floor: floorPoints,
      farWall: farWallPoints,
    },
  };
}

function buildDoorwayBackground(opening: SideOpeningGeometry): string {
  const { x, y, width, height } = opening.door;
  return `<rect data-doorway="${opening.side}" x="${x}" y="${y}" width="${width}" height="${height}" fill="#050101" opacity="0.85" />`;
}

function buildDoorwayFrame(opening: SideOpeningGeometry): string {
  const { x, y, width, height } = opening.door;
  const mutedStroke = mixHexColors(BRICK_NEAR_COLOR, BACKGROUND_COLOR, 0.65);
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="${mutedStroke}" stroke-width="0.85" opacity="0.35" />`;
}

function buildSideCorridorSvg(opening: SideOpeningGeometry): string {
  const {
    corridor: { floor, farWall },
    side,
    door,
  } = opening;
  const clipId = `doorway-clip-${side}-${Math.round(door.x)}-${Math.round(door.y)}`;
  const [nearLeft, nearRight, farRight, farLeft] = floor;
  const floorFill = mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, 0.28);
  const wallFill = mixHexColors(BRICK_FAR_COLOR, BACKGROUND_COLOR, 0.55);
  const farWallFill = mixHexColors(wallFill, '#d7eaff', 0.22);
  const mortar = mixHexColors(BRICK_LINE_COLOR, BRICK_NEAR_COLOR, 0.28);
  const rows = 2;
  const cols = 2;
  const lines: string[] = [];
  for (let i = 1; i <= rows; i += 1) {
    const t = i / (rows + 1);
    const y = lerp(nearLeft.y, farLeft.y, t);
    const leftX = lerp(nearLeft.x, farLeft.x, t);
    const rightX = lerp(nearRight.x, farRight.x, t);
    lines.push(
      `<line x1="${leftX}" y1="${y}" x2="${rightX}" y2="${y}" stroke="${mortar}" stroke-width="0.6" opacity="0.75" />`,
    );
  }
  for (let i = 1; i <= cols; i += 1) {
    const offset = i / (cols + 1);
    const start = {
      x: lerp(nearLeft.x, nearRight.x, offset),
      y: nearLeft.y,
    };
    const end = {
      x: lerp(farLeft.x, farRight.x, offset),
      y: farLeft.y,
    };
    lines.push(
      `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${mortar}" stroke-width="0.55" opacity="0.65" />`,
    );
  }
  return `
    <defs>
      <clipPath id="${clipId}">
        <rect x="${door.x}" y="${door.y}" width="${door.width}" height="${door.height}" />
      </clipPath>
    </defs>
    <g data-side-corridor="${side}" clip-path="url(#${clipId})">
      <polygon points="${polygonPoints(floor)}" fill="${floorFill}" opacity="0.95" />
      <polygon points="${polygonPoints(farWall)}" fill="${wallFill}" opacity="0.9" />
      <polygon points="${polygonPoints(farWall)}" fill="${farWallFill}" opacity="0.45" />
      ${lines.join('\n')}
    </g>
  `;
}

function buildRearExitSvg(dims: WireframeDimensions, backwardOpen: boolean): string {
  if (!backwardOpen) {
    return '';
  }
  const width = dims.width * 0.1;
  const height = Math.max(6, (dims.bottomY - dims.topY) * 0.05);
  const bottomY = dims.bottomY - 1;
  const topY = bottomY - height;
  const left = dims.centerX - width / 2;
  const right = dims.centerX + width / 2;
  const points = [
    { x: left + width * 0.2, y: topY },
    { x: right - width * 0.2, y: topY },
    { x: right, y: bottomY },
    { x: left, y: bottomY },
  ];
  const fill = mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, 0.2);
  return `<polygon data-backward-passage="true" points="${polygonPoints(points)}" fill="${fill}" opacity="0.35" />`;
}

type WireframeDimensions = {
  width: number;
  height: number;
  topY: number;
  bottomY: number;
  leftNearX: number;
  rightNearX: number;
  leftFarX: number;
  rightFarX: number;
  centerX: number;
};

type RelativeOpenings = {
  forward: boolean;
  left: boolean;
  right: boolean;
  backward: boolean;
};

interface SideOpeningGeometry {
  side: 'left' | 'right';
  door: { x: number; y: number; width: number; height: number };
  corridor: {
    floor: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    farWall: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
  };
}

function deriveViewParameters(
  cell: ServerMazeCell,
  openDirections: Direction[],
  variant: MazePreviewVariant,
): { dims: WireframeDimensions; tilt: number } {
  const width = 320;
  const height = 180;
  const centerX = width / 2;
  const isStart = variant === 'start';
  const isGoal = variant === 'goal';
  const baseTop = Math.round(height * (isStart ? 0.36 : 0.38));
  const bottomY = Math.round(height * (isStart ? 0.995 : 0.97));
  const openOffset = openDirections.includes('north') ? -2 : 2;
  const variantOffset = isGoal ? -2 : variant === 'junction' ? -1 : 0;
  const topY = clamp(
    baseTop + openOffset + variantOffset,
    Math.round(height * (isStart ? 0.32 : 0.34)),
    Math.round(height * (isStart ? 0.44 : 0.42)),
  );
  const corridorNearWidth = width * (isStart ? 0.88 : 0.62);
  const corridorFarWidth = corridorNearWidth * (isStart ? 0.42 : isGoal ? 0.32 : 0.3);

  const dims: WireframeDimensions = {
    width,
    height,
    topY,
    bottomY,
    leftNearX: Math.round(centerX - corridorNearWidth / 2),
    rightNearX: Math.round(centerX + corridorNearWidth / 2),
    leftFarX: Math.round(centerX - corridorFarWidth / 2),
    rightFarX: Math.round(centerX + corridorFarWidth / 2),
    centerX,
  };
  return { dims, tilt: 0 };
}

function buildFloorSvg(dims: WireframeDimensions, variant: MazePreviewVariant): string {
  const quad = [
    { x: dims.leftNearX, y: dims.bottomY },
    { x: dims.rightNearX, y: dims.bottomY },
    { x: dims.rightFarX, y: dims.topY },
    { x: dims.leftFarX, y: dims.topY },
  ];
  const fadeStart = variant === 'start' ? 0.52 : variant === 'goal' ? 0.7 : 1;
  const fadeRange = variant === 'start' ? 0.35 : variant === 'goal' ? 0.3 : 1;
  const farTintTarget =
    variant === 'start'
      ? BACKGROUND_COLOR
      : variant === 'goal'
        ? mixHexColors(BRICK_FAR_COLOR, '#cfe7ff', 0.35)
        : BRICK_FAR_COLOR;
  const baseColor = BRICK_NEAR_COLOR;
  const shadingMix = variant === 'start' ? 0.18 : variant === 'goal' ? 0.2 : 0.35;
  const shadingColor = mixHexColors(BRICK_NEAR_COLOR, farTintTarget, shadingMix);
  const lines: string[] = [
    `<polygon points="${polygonPoints(quad)}" fill="${baseColor}" />`,
    `<polygon points="${polygonPoints(quad)}" fill="${shadingColor}" opacity="0.25" />`,
  ];
  const rowCount = 9;
  const rowRatios: number[] = [];
  for (let i = 0; i <= rowCount; i += 1) {
    const t = i / rowCount;
    const perspective = 1 - (1 - t) * (1 - t);
    rowRatios.push(perspective);
    if (i === 0 || i === rowCount) {
      continue;
    }
    const y = lerp(dims.bottomY, dims.topY, perspective);
    const leftX = lerp(dims.leftNearX, dims.leftFarX, perspective);
    const rightX = lerp(dims.rightNearX, dims.rightFarX, perspective);
    const darknessBlend = clamp((perspective - fadeStart) / fadeRange, 0, 1);
    const lineColor =
      variant === 'start'
        ? mixHexColors(BRICK_LINE_COLOR, BACKGROUND_COLOR, 0.7)
        : variant === 'goal'
          ? mixHexColors(BRICK_LINE_COLOR, '#eaf5ff', 0.25)
          : BRICK_LINE_COLOR;
    const baseOpacity = variant === 'start' ? 0.55 : 0.75;
    const opacity =
      variant === 'start'
        ? baseOpacity * (1 - darknessBlend * 0.85)
        : baseOpacity + darknessBlend * 0.25;
    lines.push(
      `<line x1="${leftX}" y1="${y}" x2="${rightX}" y2="${y}" stroke="${lineColor}" stroke-width="0.9" stroke-linecap="round" opacity="${opacity}" />`,
    );
  }

  for (let row = 0; row < rowCount; row += 1) {
    const startRatio = rowRatios[row];
    const endRatio = rowRatios[row + 1];
    const brickCount = 4 + Math.round((rowCount - row) / 1.4);
    const offset = row % 2 === 0 ? 0 : 0.5;
    for (let c = 1; c < brickCount; c += 1) {
      const normalized = (c + offset) / brickCount;
      if (normalized >= 1) {
        continue;
      }
      const bottom = {
        x: lerp(
          lerp(dims.leftNearX, dims.leftFarX, startRatio),
          lerp(dims.rightNearX, dims.rightFarX, startRatio),
          normalized,
        ),
        y: lerp(dims.bottomY, dims.topY, startRatio),
      };
      const top = {
        x: lerp(
          lerp(dims.leftNearX, dims.leftFarX, endRatio),
          lerp(dims.rightNearX, dims.rightFarX, endRatio),
          normalized,
        ),
        y: lerp(dims.bottomY, dims.topY, endRatio),
      };
      const perspective = (startRatio + endRatio) / 2;
      const darknessBlend = clamp((perspective - fadeStart) / fadeRange, 0, 1);
      const lineColor =
        variant === 'start'
          ? mixHexColors(BRICK_LINE_COLOR, BACKGROUND_COLOR, 0.7)
          : variant === 'goal'
            ? mixHexColors(BRICK_LINE_COLOR, '#eaf5ff', 0.25)
            : BRICK_LINE_COLOR;
      const baseOpacity = variant === 'start' ? 0.45 : 0.65;
      const opacity =
        variant === 'start'
          ? baseOpacity * (1 - darknessBlend * 0.9)
          : baseOpacity + darknessBlend * 0.25;
      lines.push(
        `<line x1="${bottom.x}" y1="${bottom.y}" x2="${top.x}" y2="${top.y}" stroke="${lineColor}" stroke-width="0.75" stroke-linecap="round" opacity="${opacity}" />`,
      );
    }
  }

  if (variant === 'goal') {
    const glowId = `goal-floor-${dims.width}-${dims.height}`;
    const glowStart = lerp(dims.bottomY, dims.topY, 0.75);
    const glowEnd = dims.topY;
    lines.push(`
      <defs>
        <linearGradient id="${glowId}" x1="0" y1="${glowStart}" x2="0" y2="${glowEnd}">
          <stop offset="0%" stop-color="rgba(255,255,255,0)" />
          <stop offset="65%" stop-color="rgba(223, 241, 255, 0.12)" />
          <stop offset="100%" stop-color="rgba(223, 241, 255, 0.35)" />
        </linearGradient>
      </defs>
    `);
    lines.push(
      `<polygon data-goal-floor-glow="true" points="${polygonPoints(quad)}" fill="url(#${glowId})" opacity="1" />`,
    );
  }
  return lines.join('\n');
}

function buildDepthFadeOverlay(dims: WireframeDimensions): string {
  const quad = [
    { x: 0, y: dims.bottomY },
    { x: dims.width, y: dims.bottomY },
    { x: dims.width, y: dims.topY },
    { x: 0, y: dims.topY },
  ];
  const gradientId = `depth-fade-${dims.width}-${dims.height}`;
  const fadeStart = lerp(dims.bottomY, dims.topY, 0.55);
  const fadeEnd = dims.topY;
  return `
    <defs>
      <linearGradient id="${gradientId}" x1="0" y1="${fadeStart}" x2="0" y2="${fadeEnd}">
        <stop offset="0%" stop-color="${BACKGROUND_COLOR}" stop-opacity="0" />
        <stop offset="50%" stop-color="${BACKGROUND_COLOR}" stop-opacity="0.45" />
        <stop offset="100%" stop-color="${BACKGROUND_COLOR}" stop-opacity="0.96" />
      </linearGradient>
    </defs>
    <polygon data-depth-fade="start" points="${polygonPoints(quad)}" fill="url(#${gradientId})" opacity="1" />
  `;
}

function getWallTopY(dims: WireframeDimensions): number {
  const wallHeight = dims.bottomY - dims.topY;
  return Math.max(6, Math.round(dims.topY - wallHeight * 0.6));
}

function buildWallSvg(
  dims: WireframeDimensions,
  side: 'left' | 'right',
  variant: MazePreviewVariant,
  opening?: SideOpeningGeometry | null,
): string {
  const nearX = side === 'left' ? dims.leftNearX : dims.rightNearX;
  const farX = side === 'left' ? dims.leftFarX : dims.rightFarX;
  const ceilingY = getWallTopY(dims);
  const endX =
    opening && side === 'left'
      ? opening.door.x
      : opening && side === 'right'
        ? opening.door.x + opening.door.width
        : farX;
  const endY =
    opening && side === 'left'
      ? opening.door.y + opening.door.height
      : opening && side === 'right'
        ? opening.door.y + opening.door.height
        : dims.topY;
  const hasOpening = Boolean(opening);
  const points =
    side === 'left'
      ? hasOpening
        ? [
            { x: nearX, y: dims.bottomY },
            { x: nearX, y: ceilingY },
            { x: endX, y: ceilingY },
            { x: endX, y: endY },
            { x: nearX, y: endY },
          ]
        : [
            { x: nearX, y: dims.bottomY },
            { x: nearX, y: ceilingY },
            { x: endX, y: ceilingY },
            { x: endX, y: endY },
          ]
      : hasOpening
        ? [
            { x: endX, y: endY },
            { x: endX, y: ceilingY },
            { x: nearX, y: ceilingY },
            { x: nearX, y: dims.bottomY },
            { x: nearX, y: endY },
          ]
        : [
            { x: endX, y: endY },
            { x: endX, y: ceilingY },
            { x: nearX, y: ceilingY },
            { x: nearX, y: dims.bottomY },
          ];
  const tintRatio =
    variant === 'start' ? 0.4 : side === 'left' ? 0.48 : variant === 'goal' ? 0.52 : 0.58;
  const wallColor = mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, tintRatio);
  const mortarColor =
    variant === 'start' ? mixHexColors(BRICK_LINE_COLOR, BACKGROUND_COLOR, 0.65) : BRICK_LINE_COLOR;
  const layers: string[] = [
    `<polygon data-wall-side="${side}" points="${polygonPoints(points)}" fill="${wallColor}" opacity="0.98" />`,
  ];
  const mortarRows = 8;
  for (let i = 1; i < mortarRows; i += 1) {
    const ratio = i / mortarRows;
    const start = {
      x: nearX,
      y: lerp(dims.bottomY, ceilingY, ratio),
    };
    const end = {
      x: endX,
      y: lerp(endY, ceilingY, ratio),
    };
    layers.push(
      `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${mortarColor}" stroke-width="0.8" stroke-linecap="round" opacity="0.5" />`,
    );
  }
  const mortarColumns = 3;
  for (let i = 1; i <= mortarColumns; i += 1) {
    const ratio = i / (mortarColumns + 1);
    const bottom = {
      x: lerp(nearX, endX, ratio),
      y: lerp(dims.bottomY, endY, ratio),
    };
    const top = {
      x: lerp(nearX, endX, ratio),
      y: ceilingY,
    };
    layers.push(
      `<line x1="${bottom.x}" y1="${bottom.y}" x2="${top.x}" y2="${top.y}" stroke="${mortarColor}" stroke-width="0.75" stroke-linecap="round" opacity="0.4" />`,
    );
  }
  return layers.join('\n');
}

function buildFarWallSvg(
  dims: WireframeDimensions,
  forwardOpen: boolean,
  variant: MazePreviewVariant,
): string {
  const effectiveForwardOpen = variant === 'start' ? true : forwardOpen;
  const wallState = effectiveForwardOpen ? 'open' : 'closed';
  const groupAttributes =
    wallState === 'open'
      ? `data-front-wall="${wallState}" data-forward-extension="true"`
      : `data-front-wall="${wallState}"`;
  const parts: string[] = [`<g ${groupAttributes}>`];
  const wallWidth = dims.rightFarX - dims.leftFarX;
  const depth = dims.bottomY - dims.topY;
  const wallTopY = getWallTopY(dims);
  if (!effectiveForwardOpen) {
    const wallHeight = Math.max(32, depth * 0.45);
    const wallTop = Math.max(6, dims.topY - wallHeight);
    if (variant === 'goal') {
      const skyBaseId = `goal-sky-${Math.round(wallWidth)}-${Math.round(wallHeight)}`;
      const skyTop = '#6ec3ff';
      const skyBottom = '#ffffff';
      parts.push(`
        <defs>
          <linearGradient id="${skyBaseId}" x1="0" y1="${wallTop}" x2="0" y2="${wallTop + wallHeight}">
            <stop offset="0%" stop-color="${skyTop}" stop-opacity="0.95" />
            <stop offset="100%" stop-color="${skyBottom}" stop-opacity="0.92" />
          </linearGradient>
        </defs>
      `);
      parts.push(
        `<rect data-front-wall-fill="true" x="${dims.leftFarX}" y="${wallTop}" width="${wallWidth}" height="${wallHeight}" fill="url(#${skyBaseId})" opacity="0.98" />`,
      );
      const portalWidth = wallWidth * 0.82;
      const portalHeight = wallHeight * 0.72;
      const portalLeft = dims.centerX - portalWidth / 2;
      const portalTop = wallTop + wallHeight * 0.12;
      const portalBottom = portalTop + portalHeight;
      const glowId = `goal-window-${Math.round(wallWidth)}-${Math.round(wallHeight)}`;
      parts.push(`
        <defs>
          <linearGradient id="${glowId}" x1="0" y1="${portalTop}" x2="0" y2="${portalBottom}">
            <stop offset="0%" stop-color="${skyTop}" stop-opacity="0.95" />
            <stop offset="60%" stop-color="${skyTop}" stop-opacity="0.78" />
            <stop offset="100%" stop-color="${skyBottom}" stop-opacity="0.7" />
          </linearGradient>
        </defs>
      `);
      parts.push(
        `<rect data-goal-portal="true" x="${portalLeft}" y="${portalTop}" width="${portalWidth}" height="${portalHeight}" fill="url(#${glowId})" opacity="0.98" />`,
      );
      parts.push(
        `<rect data-goal-window="true" x="${portalLeft + portalWidth * 0.08}" y="${portalTop + portalHeight * 0.12}" width="${portalWidth * 0.84}" height="${portalHeight * 0.7}" fill="${skyBottom}" opacity="0.8" />`,
      );
    } else {
      const tintShift = variant === 'junction' ? -0.02 : 0;
      const baseColor = mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, 0.6 + tintShift);
      parts.push(
        `<rect data-front-wall-fill="true" x="${dims.leftFarX}" y="${wallTop}" width="${wallWidth}" height="${wallHeight}" fill="${baseColor}" opacity="0.98" />`,
      );
      const mortarRows = 5;
      for (let i = 1; i < mortarRows; i += 1) {
        const y = wallTop + (wallHeight / mortarRows) * i;
        parts.push(
          `<line x1="${dims.leftFarX}" y1="${y}" x2="${dims.rightFarX}" y2="${y}" stroke="${BRICK_LINE_COLOR}" stroke-width="0.75" opacity="0.7" />`,
        );
      }
      const bricks = 6;
      for (let i = 1; i < bricks; i += 1) {
        const x = dims.leftFarX + (wallWidth / bricks) * i;
        parts.push(
          `<line x1="${x}" y1="${wallTop}" x2="${x}" y2="${wallTop + wallHeight}" stroke="${BRICK_LINE_COLOR}" stroke-width="0.65" opacity="0.45" />`,
        );
      }
    }
  } else if (variant === 'junction') {
    const extensionTopY = Math.max(4, dims.topY - depth * 0.18);
    const secondTopY = Math.max(2, extensionTopY - depth * 0.16);
    const firstWidth = wallWidth * 0.62;
    const secondWidth = wallWidth * 0.38;
    const firstLeftX = dims.centerX - firstWidth / 2;
    const firstRightX = dims.centerX + firstWidth / 2;
    const secondLeftX = dims.centerX - secondWidth / 2;
    const secondRightX = dims.centerX + secondWidth / 2;
    const floorColor = mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, 0.35);
    const distantFloorColor = mixHexColors(BRICK_FAR_COLOR, BACKGROUND_COLOR, 0.5);
    const mortar = mixHexColors(BRICK_LINE_COLOR, BRICK_FAR_COLOR, 0.55);
    const firstFloor = [
      { x: dims.leftFarX, y: dims.topY },
      { x: dims.rightFarX, y: dims.topY },
      { x: firstRightX, y: extensionTopY },
      { x: firstLeftX, y: extensionTopY },
    ];
    const secondFloor = [
      { x: firstLeftX, y: extensionTopY },
      { x: firstRightX, y: extensionTopY },
      { x: secondRightX, y: secondTopY },
      { x: secondLeftX, y: secondTopY },
    ];
    parts.push(
      `<polygon data-forward-extension="true" points="${polygonPoints(firstFloor)}" fill="${floorColor}" opacity="0.94" />`,
    );
    parts.push(
      `<polygon data-forward-extension="true" points="${polygonPoints(secondFloor)}" fill="${distantFloorColor}" opacity="0.9" />`,
    );
    const rowSplits = [0.35, 0.7];
    rowSplits.forEach((t) => {
      const y = lerp(dims.topY, secondTopY, t);
      const leftX = lerp(dims.leftFarX, secondLeftX, t);
      const rightX = lerp(dims.rightFarX, secondRightX, t);
      parts.push(
        `<line x1="${leftX}" y1="${y}" x2="${rightX}" y2="${y}" stroke="${mortar}" stroke-width="0.55" opacity="0.7" />`,
      );
    });
    const colSplits = [0.33, 0.66];
    colSplits.forEach((offset) => {
      const start = {
        x: lerp(dims.leftFarX, dims.rightFarX, offset),
        y: dims.topY,
      };
      const end = {
        x: lerp(secondLeftX, secondRightX, offset),
        y: secondTopY,
      };
      parts.push(
        `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${mortar}" stroke-width="0.5" opacity="0.65" />`,
      );
    });
    const firstCeiling = Math.max(2, extensionTopY - depth * 0.22);
    const secondCeiling = Math.max(2, secondTopY - depth * 0.26);
    const sideShade = mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, 0.55);
    const farShade = mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, 0.62);
    const leftWall = [
      { x: dims.leftFarX, y: dims.topY },
      { x: dims.leftFarX, y: firstCeiling },
      { x: firstLeftX, y: firstCeiling },
      { x: firstLeftX, y: extensionTopY },
    ];
    const leftTail = [
      { x: firstLeftX, y: extensionTopY },
      { x: firstLeftX, y: secondCeiling },
      { x: secondLeftX, y: secondCeiling },
      { x: secondLeftX, y: secondTopY },
    ];
    const rightWall = [
      { x: dims.rightFarX, y: dims.topY },
      { x: dims.rightFarX, y: firstCeiling },
      { x: firstRightX, y: firstCeiling },
      { x: firstRightX, y: extensionTopY },
    ];
    parts.push(
      `<polygon data-forward-extension="true" points="${polygonPoints(leftWall)}" fill="${sideShade}" opacity="0.88" />`,
    );
    parts.push(
      `<polygon data-forward-extension="true" points="${polygonPoints(rightWall)}" fill="${farShade}" opacity="0.88" />`,
    );
    const rightTail = [
      { x: firstRightX, y: extensionTopY },
      { x: firstRightX, y: secondCeiling },
      { x: secondRightX, y: secondCeiling },
      { x: secondRightX, y: secondTopY },
    ];
    parts.push(
      `<polygon data-forward-extension="true" points="${polygonPoints(leftTail)}" fill="${mixHexColors(
        sideShade,
        BACKGROUND_COLOR,
        0.25,
      )}" opacity="0.85" />`,
    );
    parts.push(
      `<polygon data-forward-extension="true" points="${polygonPoints(rightTail)}" fill="${mixHexColors(
        farShade,
        BACKGROUND_COLOR,
        0.35,
      )}" opacity="0.85" />`,
    );
    const fadeGradientId = `forward-fade-${Math.round(dims.width)}-${variant}`;
    parts.push(`
      <defs>
        <linearGradient id="${fadeGradientId}" x1="0" y1="${extensionTopY}" x2="0" y2="${secondTopY}">
          <stop offset="0%" stop-color="${BACKGROUND_COLOR}" stop-opacity="0" />
          <stop offset="85%" stop-color="${BACKGROUND_COLOR}" stop-opacity="0.65" />
          <stop offset="100%" stop-color="${BACKGROUND_COLOR}" stop-opacity="1" />
        </linearGradient>
      </defs>
    `);
    parts.push(
      `<polygon data-forward-fade="true" points="${polygonPoints(secondFloor)}" fill="url(#${fadeGradientId})" opacity="1" />`,
    );
  } else {
    const extensionTopY = Math.max(4, dims.topY - depth * 0.18);
    const nextWidth = wallWidth * 0.6;
    const nextLeftX = dims.centerX - nextWidth / 2;
    const nextRightX = dims.centerX + nextWidth / 2;
    const baseFloorColor = mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, 0.35);
    const floorColor =
      variant === 'goal'
        ? mixHexColors(baseFloorColor, '#e0f4ff', 0.52)
        : variant === 'start'
          ? mixHexColors(baseFloorColor, BACKGROUND_COLOR, 0.6)
          : baseFloorColor;
    const extensionFloor = [
      { x: dims.leftFarX, y: dims.topY },
      { x: dims.rightFarX, y: dims.topY },
      { x: nextRightX, y: extensionTopY },
      { x: nextLeftX, y: extensionTopY },
    ];
    const extensionOpacity = variant === 'start' ? 0.7 : 0.92;
    parts.push(
      `<polygon data-forward-extension="true" points="${polygonPoints(extensionFloor)}" fill="${floorColor}" opacity="${extensionOpacity}" />`,
    );
    for (let i = 1; i <= 2; i += 1) {
      const t = i / 3;
      const y = lerp(dims.topY, extensionTopY, t);
      const leftX = lerp(dims.leftFarX, nextLeftX, t);
      const rightX = lerp(dims.rightFarX, nextRightX, t);
      parts.push(
        `<line x1="${leftX}" y1="${y}" x2="${rightX}" y2="${y}" stroke="${BRICK_LINE_COLOR}" stroke-width="0.65" opacity="0.7" />`,
      );
    }
    const extensionCeilingBase =
      variant === 'start' ? wallTopY : Math.max(2, extensionTopY - depth * 0.22);
    const extensionCeiling =
      variant === 'goal' ? Math.min(extensionCeilingBase, wallTopY + 2) : extensionCeilingBase;
    const sideShade =
      variant === 'start'
        ? mixHexColors(BRICK_NEAR_COLOR, BACKGROUND_COLOR, 0.65)
        : variant === 'goal'
          ? mixHexColors(BRICK_NEAR_COLOR, '#d7eaff', 0.5)
          : mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, 0.55);
    const farShade =
      variant === 'start'
        ? mixHexColors(BRICK_NEAR_COLOR, BACKGROUND_COLOR, 0.72)
        : variant === 'goal'
          ? mixHexColors(BRICK_FAR_COLOR, '#c9e5ff', 0.55)
          : mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, 0.62);
    const leftWall = [
      { x: dims.leftFarX, y: dims.topY },
      { x: dims.leftFarX, y: extensionCeiling },
      { x: nextLeftX, y: extensionCeiling },
      { x: nextLeftX, y: extensionTopY },
    ];
    const rightWall = [
      { x: dims.rightFarX, y: dims.topY },
      { x: dims.rightFarX, y: extensionCeiling },
      { x: nextRightX, y: extensionCeiling },
      { x: nextRightX, y: extensionTopY },
    ];
    parts.push(`<polygon points="${polygonPoints(leftWall)}" fill="${sideShade}" opacity="0.9" />`);
    parts.push(`<polygon points="${polygonPoints(rightWall)}" fill="${farShade}" opacity="0.9" />`);
    if (variant === 'goal') {
      const portalWidth = nextWidth * 0.9;
      const portalHeight = Math.max(depth * 0.42, (extensionTopY - extensionCeiling) * 0.92);
      const portalBottomY = extensionTopY - portalHeight * 0.04;
      const portalTopY = portalBottomY - portalHeight;
      const portalLeft = dims.centerX - portalWidth / 2;
      const glowId = `goal-portal-${Math.round(wallWidth)}`;
      const skyTop = '#6ec3ff';
      const skyBottom = '#ffffff';
      parts.push(`
        <defs>
          <linearGradient id="${glowId}" x1="0" y1="${portalTopY}" x2="0" y2="${portalBottomY}">
            <stop offset="0%" stop-color="${skyTop}" stop-opacity="0.9" />
            <stop offset="55%" stop-color="${skyTop}" stop-opacity="0.72" />
            <stop offset="100%" stop-color="${skyBottom}" stop-opacity="0.65" />
          </linearGradient>
        </defs>
      `);
      parts.push(
        `<rect data-goal-portal="true" x="${portalLeft}" y="${portalTopY}" width="${portalWidth}" height="${portalHeight}" fill="url(#${glowId})" opacity="0.95" />`,
      );
      parts.push(
        `<rect data-goal-window="true" x="${portalLeft + portalWidth * 0.12}" y="${portalTopY + portalHeight * 0.14}" width="${portalWidth * 0.76}" height="${portalHeight * 0.7}" fill="${skyBottom}" opacity="0.82" />`,
      );
    } else {
      const distantWallHeight = Math.max(16, depth * 0.12);
      const distantWallWidth = nextWidth * 0.65;
      const distantBottomY = extensionTopY - distantWallHeight * 0.15;
      const distantTopY = distantBottomY - distantWallHeight;
      const distantLeft = dims.centerX - distantWallWidth / 2;
      const distantColor =
        variant === 'start'
          ? mixHexColors(BRICK_FAR_COLOR, BACKGROUND_COLOR, 0.75)
          : mixHexColors(BRICK_FAR_COLOR, '#050505', 0.6);
      parts.push(
        `<rect x="${distantLeft}" y="${distantTopY}" width="${distantWallWidth}" height="${distantWallHeight}" fill="${distantColor}" opacity="0.7" />`,
      );
    }
    if (variant === 'start') {
      const fadeGradientId = `forward-fade-${Math.round(dims.width)}-${variant}`;
      parts.push(`
        <defs>
          <linearGradient id="${fadeGradientId}" x1="0" y1="${extensionTopY}" x2="0" y2="${wallTopY}">
            <stop offset="0%" stop-color="${BACKGROUND_COLOR}" stop-opacity="0.25" />
            <stop offset="55%" stop-color="${BACKGROUND_COLOR}" stop-opacity="0.7" />
            <stop offset="100%" stop-color="${BACKGROUND_COLOR}" stop-opacity="1" />
          </linearGradient>
        </defs>
      `);
      parts.push(
        `<polygon data-forward-fade="true" points="${polygonPoints(extensionFloor)}" fill="url(#${fadeGradientId})" opacity="1" />`,
      );
    }
  }
  parts.push('</g>');
  return parts.join('\n');
}

function polygonPoints(points: Array<{ x: number; y: number }>): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createDefaultPreviewClips(): readonly PreviewClip[] {
  const startDirections: Direction[] = ['north', 'east'];
  const junctionDirections: Direction[] = ['north', 'west', 'east'];
  const goalDirections: Direction[] = ['north'];
  const dummyStart = createDummyCellForDirections(startDirections, 0);
  const dummyJunction = createDummyCellForDirections(junctionDirections, 1);
  const dummyGoal = createDummyCellForDirections(goalDirections, 2);

  return [
    {
      id: 'entry',
      title: 'スタート地点プレビュー',
      description: `スタート近辺。${describeOpenDirections(startDirections)}`,
      hint: 'スタート直後の導線をイメージしておくと迷いません。',
      previewImage: createPerspectivePreviewSvg(
        dummyStart,
        startDirections,
        'start',
        fallbackOrientationFromDirections(startDirections),
      ),
      previewAlt: 'スタート地点プレビュー映像',
    },
    {
      id: 'junction',
      title: '迷路分岐プレビュー',
      description: `複雑な分岐。${describeOpenDirections(junctionDirections)}`,
      hint: '二手目までの動きを決めて、角で減速しないようにしましょう。',
      previewImage: createPerspectivePreviewSvg(
        dummyJunction,
        junctionDirections,
        'junction',
        fallbackOrientationFromDirections(junctionDirections),
      ),
      previewAlt: '迷路分岐プレビュー映像',
    },
    {
      id: 'goal',
      title: 'ゴール直前プレビュー',
      description: `ゴール周辺。${describeOpenDirections(goalDirections)}光源を追いかけましょう。`,
      hint: '差し込む光を目印に、最後のコーナーで減速を抑えてください。',
      previewImage: createPerspectivePreviewSvg(
        dummyGoal,
        goalDirections,
        'goal',
        fallbackOrientationFromDirections(goalDirections),
      ),
      previewAlt: 'ゴールプレビュー映像',
    },
  ] as const;
}

function createDummyCellForDirections(directions: Direction[], index: number): ServerMazeCell {
  const walls = {
    top: !directions.includes('north'),
    right: !directions.includes('east'),
    bottom: !directions.includes('south'),
    left: !directions.includes('west'),
  } as const;
  return {
    x: index * 3 + 1,
    y: index * 5 + 2,
    walls,
  } as ServerMazeCell;
}

function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  let hash = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return hash >>> 0;
}
