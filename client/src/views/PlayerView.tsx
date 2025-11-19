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
    context.fillStyle = color;
    context.fillRect(0, yStart, context.canvas.width, Math.max(1, yEnd - yStart));

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

  const rng = createSeededRandom(maze.seed);
  const corridorCell = selectCorridorCell(maze, startCell, goalCell, rng);

  return [createStartClip(startCell), createCorridorClip(corridorCell), createGoalClip(goalCell)];
}

function createStartClip(cell: ServerMazeCell): PreviewClip {
  const openDirections = getOpenDirections(cell);
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
    previewImage: createPerspectivePreviewSvg(cell, openDirections, 'start'),
    previewAlt: 'スタート地点プレビュー映像',
  };
}

function createCorridorClip(cell: ServerMazeCell): PreviewClip {
  const openDirections = getOpenDirections(cell);
  const description = `分岐ポイント。${describeOpenDirections(openDirections)}`;
  const hint = buildCorridorHint(openDirections);

  return {
    id: 'junction',
    title: '迷路分岐プレビュー',
    description,
    hint,
    previewImage: createPerspectivePreviewSvg(cell, openDirections, 'junction'),
    previewAlt: '迷路分岐プレビュー映像',
  };
}

function createGoalClip(cell: ServerMazeCell): PreviewClip {
  const openDirections = getOpenDirections(cell);
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
    previewImage: createPerspectivePreviewSvg(cell, openDirections, 'goal'),
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

function getOpenDirections(cell: ServerMazeCell): Direction[] {
  const directions: Direction[] = [];
  (Object.keys(DIRECTION_INFO) as Direction[]).forEach((direction) => {
    const wallKey = DIRECTION_INFO[direction].wall;
    if (!cell.walls[wallKey]) {
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
): string {
  const view = deriveViewParameters(cell, openDirections, variant);
  const leftWall = buildWallSvg(view.dims, 'left', openDirections.includes('west'));
  const rightWall = buildWallSvg(view.dims, 'right', openDirections.includes('east'));
  const floor = buildFloorSvg(view.dims);
  const farWall = buildFarWallSvg(view.dims, openDirections.includes('north'), variant);
  const ceiling = `<rect width="${view.dims.width}" height="${view.dims.topY - 4}" fill="${CEILING_TINT_COLOR}" opacity="0.9" />`;

  return createSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view.dims.width} ${view.dims.height}">
      <rect width="${view.dims.width}" height="${view.dims.height}" fill="${BACKGROUND_COLOR}" />
      <g data-view-tilt="${view.tilt.toFixed(2)}">
        ${ceiling}
        ${leftWall}
        ${rightWall}
        ${floor}
        ${farWall}
      </g>
    </svg>
  `);
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

function deriveViewParameters(
  cell: ServerMazeCell,
  openDirections: Direction[],
  variant: MazePreviewVariant,
): { dims: WireframeDimensions; tilt: number } {
  const baseDims: WireframeDimensions = {
    width: 320,
    height: 180,
    topY: 38,
    bottomY: 170,
    leftNearX: 38,
    rightNearX: 282,
    leftFarX: 120,
    rightFarX: 200,
    centerX: 160,
  };
  const seed = `${cell.x},${cell.y},${variant}`;
  const rng = createSeededRandom(seed);
  let tilt = (rng() - 0.5) * 0.4;
  if (openDirections.includes('east') && !openDirections.includes('west')) {
    tilt += 0.18;
  }
  if (openDirections.includes('west') && !openDirections.includes('east')) {
    tilt -= 0.18;
  }
  const clampedTilt = clamp(tilt, -0.35, 0.35);
  const horizonShift =
    (variant === 'goal' ? -6 : variant === 'junction' ? -2 : 3) +
    (openDirections.includes('north') ? -4 : 3);
  const farShift = clampedTilt * 36;
  const centerShift = clampedTilt * 20;

  const dims: WireframeDimensions = {
    width: baseDims.width,
    height: baseDims.height,
    topY: baseDims.topY + horizonShift,
    bottomY: baseDims.bottomY,
    leftNearX: baseDims.leftNearX,
    rightNearX: baseDims.rightNearX,
    leftFarX: baseDims.leftFarX + farShift,
    rightFarX: baseDims.rightFarX + farShift,
    centerX: baseDims.centerX + centerShift,
  };
  return { dims, tilt: clampedTilt };
}

function buildFloorSvg(dims: WireframeDimensions): string {
  const quad = [
    { x: dims.leftNearX, y: dims.bottomY },
    { x: dims.rightNearX, y: dims.bottomY },
    { x: dims.rightFarX, y: dims.topY },
    { x: dims.leftFarX, y: dims.topY },
  ];
  const baseColor = mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, 0.35);
  const lines: string[] = [`<polygon points="${polygonPoints(quad)}" fill="${baseColor}" />`];
  const rows = 6;
  for (let i = 1; i < rows; i += 1) {
    const t = i / rows;
    const y = lerp(dims.bottomY, dims.topY, t);
    const leftX = lerp(dims.leftNearX, dims.leftFarX, t);
    const rightX = lerp(dims.rightNearX, dims.rightFarX, t);
    lines.push(
      `<line x1="${leftX}" y1="${y}" x2="${rightX}" y2="${y}" stroke="${BRICK_LINE_COLOR}" stroke-width="1.2" stroke-linecap="round" opacity="0.85" />`,
    );
  }
  const columns = 4;
  for (let i = 1; i < columns; i += 1) {
    const t = i / columns;
    const bottom = { x: lerp(dims.leftNearX, dims.rightNearX, t), y: dims.bottomY };
    const top = { x: lerp(dims.leftFarX, dims.rightFarX, t), y: dims.topY };
    lines.push(
      `<line x1="${bottom.x}" y1="${bottom.y}" x2="${top.x}" y2="${top.y}" stroke="${BRICK_LINE_COLOR}" stroke-width="0.9" stroke-linecap="round" opacity="0.7" />`,
    );
  }
  return lines.join('\n');
}

function buildWallSvg(
  dims: WireframeDimensions,
  side: 'left' | 'right',
  hasOpening: boolean,
): string {
  const points =
    side === 'left'
      ? [
          { x: 0, y: 0 },
          { x: dims.leftFarX, y: dims.topY },
          { x: dims.leftNearX, y: dims.bottomY },
          { x: 0, y: dims.bottomY },
        ]
      : [
          { x: dims.rightNearX, y: dims.bottomY },
          { x: dims.rightFarX, y: dims.topY },
          { x: dims.width, y: 0 },
          { x: dims.width, y: dims.bottomY },
        ];
  const tintRatio = side === 'left' ? 0.45 : 0.55;
  const wallColor = mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, tintRatio);
  const layers: string[] = [
    `<polygon points="${polygonPoints(points)}" fill="${wallColor}" opacity="0.95" />`,
  ];
  const rows = 5;
  for (let i = 1; i < rows; i += 1) {
    const ratio = i / rows;
    const start =
      side === 'left'
        ? { x: lerp(0, dims.leftNearX, ratio), y: lerp(0, dims.bottomY, ratio) }
        : { x: lerp(dims.rightNearX, dims.width, ratio), y: lerp(dims.bottomY, 0, ratio) };
    const end =
      side === 'left'
        ? { x: lerp(0, dims.leftFarX, ratio), y: lerp(0, dims.topY, ratio) }
        : { x: lerp(dims.rightFarX, dims.width, ratio), y: lerp(dims.topY, 0, ratio) };
    layers.push(
      `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${BRICK_LINE_COLOR}" stroke-width="0.9" stroke-linecap="round" opacity="0.7" />`,
    );
  }
  if (hasOpening) {
    const doorWidth = 26;
    const doorHeight = 32;
    const offsetX =
      side === 'left' ? Math.max(2, dims.leftNearX - doorWidth - 6) : dims.rightNearX + 6;
    layers.push(
      `<rect x="${offsetX}" y="${dims.bottomY - doorHeight - 12}" width="${doorWidth}" height="${doorHeight}" fill="${BACKGROUND_COLOR}" opacity="0.95" />`,
    );
  }
  return layers.join('\n');
}

function buildFarWallSvg(
  dims: WireframeDimensions,
  forwardOpen: boolean,
  variant: MazePreviewVariant,
): string {
  const wallWidth = dims.rightFarX - dims.leftFarX;
  const wallHeight = Math.max(18, wallWidth * 0.35);
  const color = mixHexColors(BRICK_NEAR_COLOR, BRICK_FAR_COLOR, 0.65);
  const parts: string[] = [
    `<rect x="${dims.leftFarX}" y="${dims.topY - wallHeight / 2}" width="${wallWidth}" height="${wallHeight}" fill="${color}" opacity="0.95" />`,
  ];
  const mortarRows = 3;
  for (let i = 1; i < mortarRows; i += 1) {
    const y = dims.topY - wallHeight / 2 + (wallHeight / mortarRows) * i;
    parts.push(
      `<line x1="${dims.leftFarX}" y1="${y}" x2="${dims.rightFarX}" y2="${y}" stroke="${BRICK_LINE_COLOR}" stroke-width="0.7" opacity="0.7" />`,
    );
  }
  const bricks = 4;
  for (let i = 1; i < bricks; i += 1) {
    const x = dims.leftFarX + (wallWidth / bricks) * i;
    parts.push(
      `<line x1="${x}" y1="${dims.topY - wallHeight / 2}" x2="${x}" y2="${dims.topY + wallHeight / 2}" stroke="${BRICK_LINE_COLOR}" stroke-width="0.7" opacity="0.5" />`,
    );
  }
  if (forwardOpen) {
    const doorWidth = variant === 'goal' ? wallWidth * 0.4 : wallWidth * 0.3;
    const doorHeight = wallHeight * 0.7;
    const doorX = dims.centerX - doorWidth / 2;
    const doorY = dims.topY - doorHeight / 2;
    parts.push(
      `<rect x="${doorX}" y="${doorY}" width="${doorWidth}" height="${doorHeight}" fill="${BACKGROUND_COLOR}" opacity="0.98" />`,
    );
    parts.push(
      `<rect x="${doorX}" y="${doorY}" width="${doorWidth}" height="${doorHeight}" fill="none" stroke="${BRICK_LINE_COLOR}" stroke-width="1.3" opacity="0.8" />`,
    );
  }
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
      previewImage: createPerspectivePreviewSvg(dummyStart, startDirections, 'start'),
      previewAlt: 'スタート地点プレビュー映像',
    },
    {
      id: 'junction',
      title: '迷路分岐プレビュー',
      description: `複雑な分岐。${describeOpenDirections(junctionDirections)}`,
      hint: '二手目までの動きを決めて、角で減速しないようにしましょう。',
      previewImage: createPerspectivePreviewSvg(dummyJunction, junctionDirections, 'junction'),
      previewAlt: '迷路分岐プレビュー映像',
    },
    {
      id: 'goal',
      title: 'ゴール直前プレビュー',
      description: `ゴール周辺。${describeOpenDirections(goalDirections)}光源を追いかけましょう。`,
      hint: '差し込む光を目印に、最後のコーナーで減速を抑えてください。',
      previewImage: createPerspectivePreviewSvg(dummyGoal, goalDirections, 'goal'),
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
