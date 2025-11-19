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
const LINE_COLOR = '#ef4444';
const CEILING_COLOR = '#030712';
const FLOOR_GLOW_COLOR = '#38bdf8';
const FLOOR_TRACK_COLOR = '#f87171';
const SIDE_LEFT_COLOR = '#be185d';
const SIDE_RIGHT_COLOR = '#fb7185';
const WALL_TEXTURE_COLOR = '#fca5a5';
const FOG_COLOR = '#000000';
const FOG_MIN_RATIO = 0.55;
const FOG_MAX_RATIO = 0.95;
const WALL_TEXTURE_DEPTH_LIMIT = 0.7;
const FLOOR_GLOW_DEPTH_LIMIT = 0.85;
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
  drawPerspectiveBackdrop(context);
  drawWireframeCorridor(context);
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

function drawPerspectiveBackdrop(context: CanvasRenderingContext2D, profile?: ViewProfile): void {
  const dims = computeCorridorDimensions(context.canvas, profile);
  drawCeilingLayers(context, dims);
  drawSidewallLayers(context, dims, 'left', profile?.leftOpen ?? false);
  drawSidewallLayers(context, dims, 'right', profile?.rightOpen ?? false);
  drawFloorLayers(context, dims);
  const fogStart = drawDepthFog(context, dims, profile);
  context.canvas.dataset.viewFogStart = fogStart.toFixed(2);
}

function drawCeilingLayers(context: CanvasRenderingContext2D, dims: CorridorDimensions): void {
  const layers = 6;
  for (let i = 0; i < layers; i += 1) {
    const startRatio = i / layers;
    const endRatio = (i + 1) / layers;
    const yStart = dims.topY * startRatio;
    const yEnd = dims.topY * endRatio;
    const inset = lerp(0, dims.width * 0.12, endRatio);
    const alpha = clamp(0.45 - endRatio * 0.35, 0.08, 0.45);
    context.fillStyle = toRgba(CEILING_COLOR, alpha);
    context.fillRect(inset, yStart, dims.width - inset * 2, Math.max(1, yEnd - yStart));
  }
}

function drawSidewallLayers(
  context: CanvasRenderingContext2D,
  dims: CorridorDimensions,
  side: 'left' | 'right',
  open: boolean,
): void {
  const layers = 18;
  for (let i = 0; i < layers; i += 1) {
    const startRatio = i / layers;
    const endRatio = (i + 1) / layers;
    const yStart = lerp(dims.bottomY, dims.topY, startRatio);
    const yEnd = lerp(dims.bottomY, dims.topY, endRatio);
    const boundary =
      side === 'left'
        ? lerp(dims.leftNearX, dims.leftFarX, endRatio)
        : lerp(dims.rightNearX, dims.rightFarX, endRatio);
    const baseWidth = dims.width * 0.05 * (1 - endRatio * 0.9);
    const width = Math.max(2, baseWidth * (open ? 0.3 : 1));
    const x = side === 'left' ? boundary - width : boundary;
    const color = side === 'left' ? SIDE_LEFT_COLOR : SIDE_RIGHT_COLOR;
    const alphaBase = open ? 0.08 : 0.28;
    const alpha = clamp(alphaBase + (1 - endRatio) * 0.15, alphaBase, 0.65);
    context.fillStyle = toRgba(color, alpha);
    const segmentHeight = Math.max(1, yStart - yEnd);
    context.fillRect(x, yEnd, width, segmentHeight);
    if (!open) {
      drawWallTexture(context, side, x, yEnd, width, segmentHeight, endRatio);
    }
  }
}

function drawFloorLayers(context: CanvasRenderingContext2D, dims: CorridorDimensions): void {
  const layers = 24;
  for (let i = 0; i < layers; i += 1) {
    const startRatio = i / layers;
    const endRatio = (i + 1) / layers;
    if (endRatio > FLOOR_GLOW_DEPTH_LIMIT) {
      continue;
    }
    const yStart = lerp(dims.bottomY, dims.topY, startRatio);
    const yEnd = lerp(dims.bottomY, dims.topY, endRatio);
    const left = lerp(dims.leftNearX, dims.leftFarX, endRatio);
    const right = lerp(dims.rightNearX, dims.rightFarX, endRatio);
    const width = Math.max(1, right - left);
    const alpha = clamp(0.75 - endRatio * 0.6, 0.15, 0.75);
    context.fillStyle = toRgba(FLOOR_GLOW_COLOR, alpha);
    context.fillRect(left, yEnd, width, Math.max(1, yStart - yEnd));

    const trackWidth = Math.max(2, width * 0.4);
    const trackLeft = (left + right) / 2 - trackWidth / 2;
    context.fillStyle = toRgba(FLOOR_TRACK_COLOR, clamp(alpha - 0.3, 0.08, 0.45));
    context.fillRect(trackLeft, yEnd, trackWidth, Math.max(1, yStart - yEnd));
  }
}

function drawWallTexture(
  context: CanvasRenderingContext2D,
  side: 'left' | 'right',
  x: number,
  y: number,
  width: number,
  height: number,
  depthRatio: number,
): void {
  if (depthRatio > WALL_TEXTURE_DEPTH_LIMIT || width <= 0 || height <= 0) {
    return;
  }
  const stripes = 2;
  for (let i = 0; i < stripes; i += 1) {
    const stripeWidth = Math.max(1, width * (0.25 + i * 0.2));
    const inset = Math.max(0, width * 0.05 + i * stripeWidth * 0.35);
    const alpha = clamp(0.2 + (WALL_TEXTURE_DEPTH_LIMIT - depthRatio) * 0.6, 0.2, 0.65);
    context.fillStyle = toRgba(WALL_TEXTURE_COLOR, alpha);
    const stripeX = side === 'left' ? x + inset : x + width - inset - stripeWidth;
    const stripeHeight = Math.max(1, height * 0.6);
    context.fillRect(stripeX, y, stripeWidth, stripeHeight);
  }
  const bandHeight = Math.max(1, height * 0.18);
  const bandY = y + height * 0.45;
  context.fillRect(x, bandY, width, bandHeight);
}

function drawDepthFog(
  context: CanvasRenderingContext2D,
  dims: CorridorDimensions,
  profile?: ViewProfile,
): number {
  const normalizedFocus = profile ? clamp(profile.focusDistance / PLAYER_VIEW_RANGE, 0, 1) : 0.75;
  const fogStartRatio = clamp(normalizedFocus, FOG_MIN_RATIO, FOG_MAX_RATIO);
  const fogStartY = lerp(dims.bottomY, dims.topY, fogStartRatio);
  const fogLayers = 14;
  for (let i = 0; i < fogLayers; i += 1) {
    const start = i / fogLayers;
    const end = (i + 1) / fogLayers;
    const yStart = lerp(fogStartY, dims.topY, start);
    const yEnd = lerp(fogStartY, dims.topY, end);
    const alpha = clamp(0.2 + start * 0.6, 0.2, 0.95);
    context.fillStyle = toRgba(FOG_COLOR, alpha);
    context.fillRect(0, yStart, dims.width, Math.max(1, yEnd - yStart));
  }
  return fogStartRatio;
}

function drawWireframeCorridor(context: CanvasRenderingContext2D, profile?: ViewProfile): void {
  const dims = computeCorridorDimensions(context.canvas, profile);
  const { width, height } = context.canvas;
  const focusRatio = profile ? clamp(profile.focusDistance / PLAYER_VIEW_RANGE, 0, 1) : 0.5;

  applyLineDash(context, []);
  context.lineWidth = Math.max(1, width * 0.003);
  context.strokeStyle = LINE_COLOR;
  applyLineDash(context, profile?.leftOpen ? [12, 10] : []);
  drawLine(context, dims.leftNearX, dims.bottomY, dims.leftFarX, dims.topY);
  applyLineDash(context, profile?.rightOpen ? [12, 10] : []);
  drawLine(context, dims.rightNearX, dims.bottomY, dims.rightFarX, dims.topY);
  applyLineDash(context, []);
  drawLine(context, dims.leftNearX, dims.bottomY, dims.rightNearX, dims.bottomY);

  context.strokeStyle = LINE_COLOR;
  applyLineDash(context, [8, 6]);
  const centerLineTop = lerp(
    dims.bottomY,
    dims.topY,
    profile ? clamp(profile.centerDistance / PLAYER_VIEW_RANGE, 0, 1) : 0.5,
  );
  drawLine(context, dims.centerX, dims.bottomY, dims.centerX, centerLineTop);
  applyLineDash(context, []);

  context.strokeStyle = LINE_COLOR;
  context.lineWidth = Math.max(1, width * 0.002);
  applyLineDash(context, [4, 8]);
  for (let i = 1; i <= 5; i += 1) {
    const t = i / 6;
    const eased = Math.pow(t, 0.75 + (1 - focusRatio) * 0.2);
    const y = lerp(dims.bottomY, dims.topY, eased);
    const leftX = lerp(dims.leftNearX, dims.leftFarX, eased);
    const rightX = lerp(dims.rightNearX, dims.rightFarX, eased);
    drawLine(context, leftX, y, rightX, y);
  }
  applyLineDash(context, []);

  context.strokeStyle = LINE_COLOR;
  applyLineDash(context, [2, 6]);
  const verticalLines = 3;
  for (let i = 1; i <= verticalLines; i += 1) {
    const t = i / (verticalLines + 1);
    const leftStartX = lerp(dims.leftNearX, dims.centerX - width * 0.05, t * 0.5);
    const leftEndX = lerp(dims.leftFarX, dims.centerX - width * 0.03, t * 0.35);
    drawLine(context, leftStartX, dims.bottomY, leftEndX, dims.topY);
    const rightStartX = lerp(dims.rightNearX, dims.centerX + width * 0.05, t * 0.5);
    const rightEndX = lerp(dims.rightFarX, dims.centerX + width * 0.03, t * 0.35);
    drawLine(context, rightStartX, dims.bottomY, rightEndX, dims.topY);
  }
  applyLineDash(context, []);

  if (!profile?.leftOpen) {
    drawWallDots(
      context,
      dims.leftNearX,
      dims.leftFarX,
      dims.centerX - width * 0.06,
      dims.topY,
      dims.bottomY,
      true,
    );
  } else {
    drawCornerGuide(context, 'left', dims.leftNearX, dims.leftFarX, dims.topY, dims.bottomY);
  }
  if (!profile?.rightOpen) {
    drawWallDots(
      context,
      dims.rightNearX,
      dims.rightFarX,
      dims.centerX + width * 0.06,
      dims.topY,
      dims.bottomY,
      false,
    );
  } else {
    drawCornerGuide(context, 'right', dims.rightNearX, dims.rightFarX, dims.topY, dims.bottomY);
  }

  const showFrontPanel = !profile || profile.frontBlocked;
  if (showFrontPanel) {
    drawFrontPanel(context, dims.centerX, dims.topY, width, height);
  } else if (profile.silhouette === 'junction') {
    drawJunctionPanels(context, dims.centerX, dims.topY, width, height);
  }
}

function drawCornerGuide(
  context: CanvasRenderingContext2D,
  side: 'left' | 'right',
  nearX: number,
  farX: number,
  topY: number,
  bottomY: number,
): void {
  const direction = side === 'left' ? -1 : 1;
  const elbowX = lerp(nearX, farX, 0.45);
  const elbowY = lerp(bottomY, topY, 0.4);
  const tipX = elbowX + direction * context.canvas.width * 0.05;
  const tipY = elbowY - context.canvas.height * 0.05;
  context.lineWidth = Math.max(1, context.canvas.width * 0.002);
  applyLineDash(context, [4, 6]);
  drawLine(context, nearX, bottomY, elbowX, elbowY);
  applyLineDash(context, []);
  drawLine(context, elbowX, elbowY, tipX, tipY);
  drawLine(context, tipX, tipY, elbowX, elbowY - context.canvas.height * 0.035);
}

function drawFrontPanel(
  context: CanvasRenderingContext2D,
  centerX: number,
  topY: number,
  width: number,
  height: number,
): void {
  const doorWidth = Math.max(16, width * 0.08);
  const doorHeight = Math.max(12, height * 0.08);
  context.strokeStyle = LINE_COLOR;
  context.lineWidth = Math.max(1, width * 0.0025);
  applyLineDash(context, []);
  strokeRectSafe(context, centerX - doorWidth / 2, topY - doorHeight / 2, doorWidth, doorHeight);

  const doorDepth = doorHeight * 0.8;
  drawLine(
    context,
    centerX - doorWidth / 2,
    topY - doorHeight / 2,
    centerX - doorWidth / 3,
    topY - doorDepth,
  );
  drawLine(
    context,
    centerX + doorWidth / 2,
    topY - doorHeight / 2,
    centerX + doorWidth / 3,
    topY - doorDepth,
  );
  drawLine(
    context,
    centerX - doorWidth / 2,
    topY + doorHeight / 2,
    centerX - doorWidth / 3,
    topY + doorDepth * 0.15,
  );
  drawLine(
    context,
    centerX + doorWidth / 2,
    topY + doorHeight / 2,
    centerX + doorWidth / 3,
    topY + doorDepth * 0.15,
  );
}

function drawJunctionPanels(
  context: CanvasRenderingContext2D,
  centerX: number,
  topY: number,
  width: number,
  height: number,
): void {
  context.lineWidth = Math.max(1, width * 0.0025);
  context.strokeStyle = LINE_COLOR;
  const panelWidth = Math.max(12, width * 0.05);
  const panelHeight = Math.max(12, height * 0.07);
  const offset = width * 0.14;
  strokeRectSafe(
    context,
    centerX - offset - panelWidth / 2,
    topY - panelHeight / 2,
    panelWidth,
    panelHeight,
  );
  strokeRectSafe(
    context,
    centerX + offset - panelWidth / 2,
    topY - panelHeight / 2,
    panelWidth,
    panelHeight,
  );
}

function drawWallDots(
  context: CanvasRenderingContext2D,
  nearX: number,
  farX: number,
  innerX: number,
  topY: number,
  bottomY: number,
  isLeft: boolean,
): void {
  const rows = 5;
  const columns = 4;
  const dotSize = Math.max(1, context.canvas.width * 0.004);

  for (let row = 0; row < rows; row += 1) {
    const ratio = row / (rows - 1);
    const y = bottomY - (bottomY - topY) * ratio;
    const startX = lerp(nearX, farX, ratio);
    const endX = lerp(startX, innerX, 0.65);
    for (let col = 0; col < columns; col += 1) {
      const denominator = Math.max(1, columns - 1);
      const t = col / denominator;
      const x = isLeft ? lerp(startX, endX, t) : lerp(endX, startX, t);
      context.fillStyle = LINE_COLOR;
      context.fillRect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
    }
  }
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

function applyLineDash(context: CanvasRenderingContext2D, segments: number[]): void {
  if (typeof context.setLineDash === 'function') {
    context.setLineDash(segments);
  }
}

function strokeRectSafe(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (typeof context.strokeRect === 'function') {
    context.strokeRect(x, y, width, height);
    return;
  }

  drawLine(context, x, y, x + width, y);
  drawLine(context, x + width, y, x + width, y + height);
  drawLine(context, x + width, y + height, x, y + height);
  drawLine(context, x, y + height, x, y);
}

function renderRaycastScene(context: CanvasRenderingContext2D, hits: RayHit[]): void {
  drawWireframeBase(context);
  const profile = hits.length > 0 ? analyzeViewProfile(hits) : undefined;
  drawPerspectiveBackdrop(context, profile);

  if (!profile) {
    resetRayDataset(context.canvas);
    drawWireframeCorridor(context);
    return;
  }

  drawRayColumns(context, hits, profile);
  drawWireframeCorridor(context, profile);
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

function drawRayColumns(
  context: CanvasRenderingContext2D,
  hits: RayHit[],
  profile: ViewProfile,
): void {
  const { width, height } = context.canvas;
  const horizon = Math.round(height * 0.18);
  const ground = Math.round(height * 0.98);
  const viewHeight = Math.max(1, ground - horizon);
  const spacing = width / hits.length;
  const minHeight = height * 0.08;

  const topPoints: Array<{ x: number; y: number }> = [];
  const bottomPoints: Array<{ x: number; y: number }> = [];

  hits.forEach((hit, index) => {
    if (!hit.tile) {
      return;
    }
    const normalizedDistance = clamp(hit.distance / PLAYER_VIEW_RANGE, 0, 1);
    const depthFactor = 1 - normalizedDistance ** 0.85;
    const columnHeight = Math.max(minHeight, viewHeight * depthFactor);
    const columnWidth = Math.max(2, spacing * (0.45 + depthFactor * 0.4));
    const left = index * spacing + spacing / 2 - columnWidth / 2;
    const top = ground - columnHeight;
    const alpha = clamp(0.35 + hit.intensity * 0.5 + depthFactor * 0.1, 0.35, 0.98);

    context.fillStyle = toRgba(LINE_COLOR, alpha);
    context.fillRect(left, top, columnWidth, columnHeight);

    const sparkWidth = Math.max(2, columnWidth * 0.45);
    const sparkHeight = Math.max(1.5, columnWidth * 0.45);
    context.fillRect(
      left + columnWidth / 2 - sparkWidth / 2,
      top - sparkHeight * 0.6,
      sparkWidth,
      sparkHeight,
    );

    const centerX = left + columnWidth / 2;
    topPoints.push({ x: centerX, y: top });
    bottomPoints.push({ x: centerX, y: ground });
  });

  if (topPoints.length > 1) {
    context.strokeStyle = LINE_COLOR;
    context.lineWidth = Math.max(1, width * 0.0015);
    applyLineDash(context, [6, 10]);
    for (let i = 1; i < topPoints.length; i += 1) {
      const prevTop = topPoints[i - 1];
      const currentTop = topPoints[i];
      drawLine(context, prevTop.x, prevTop.y, currentTop.x, currentTop.y);
      const prevBottom = bottomPoints[i - 1];
      const currentBottom = bottomPoints[i];
      drawLine(context, prevBottom.x, prevBottom.y, currentBottom.x, currentBottom.y);
    }
    applyLineDash(context, []);
  }

  const centerIndex = Math.floor(topPoints.length / 2);
  const centerTop = topPoints[centerIndex];
  const centerBottom = bottomPoints[centerIndex];
  if (centerTop && centerBottom) {
    context.lineWidth = Math.max(profile.frontBlocked ? 2 : 1.5, width * 0.0025);
    drawLine(context, centerTop.x, centerTop.y, centerBottom.x, centerBottom.y);
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

function toRgba(hex: string, alpha: number): string {
  const sanitized = hex.replace('#', '');
  const r = Number.parseInt(sanitized.slice(0, 2), 16);
  const g = Number.parseInt(sanitized.slice(2, 4), 16);
  const b = Number.parseInt(sanitized.slice(4, 6), 16);
  const clampedAlpha = clamp(alpha, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${clampedAlpha.toFixed(3)})`;
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
  const horizontalLines = buildHorizontalWireLines(view.dims, 5);
  const verticalLines = buildVerticalWireLines(view.dims, 3);
  const dotRows = buildDotRows(view.dims, 4, 5);
  const door = buildDoorSvg(view.dims, variant, openDirections.includes('north'));
  const directionOverlay = buildDirectionOverlay(openDirections, view.dims);

  const outerWalls = [
    createWirePath(
      [
        { x: view.dims.leftNearX, y: view.dims.bottomY },
        { x: view.dims.leftFarX, y: view.dims.topY },
      ],
      { width: 2.4 },
    ),
    createWirePath(
      [
        { x: view.dims.rightNearX, y: view.dims.bottomY },
        { x: view.dims.rightFarX, y: view.dims.topY },
      ],
      { width: 2.4 },
    ),
    createWirePath(
      [
        { x: view.dims.leftNearX, y: view.dims.bottomY },
        { x: view.dims.rightNearX, y: view.dims.bottomY },
      ],
      { width: 2.4 },
    ),
  ];

  return createSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view.dims.width} ${view.dims.height}">
      <rect width="${view.dims.width}" height="${view.dims.height}" fill="${BACKGROUND_COLOR}" />
      <g data-view-tilt="${view.tilt.toFixed(2)}">
        ${outerWalls.join('\n')}
        ${horizontalLines}
        ${verticalLines}
        ${dotRows}
        ${door}
        ${directionOverlay}
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createWirePath(
  points: Array<{ x: number; y: number }>,
  options?: { width?: number; dash?: string },
): string {
  const d = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
    .join(' ');
  const dash = options?.dash ? ` stroke-dasharray="${options.dash}"` : '';
  const width = options?.width ?? 2;
  return `<path d="${d}" fill="none" stroke="${LINE_COLOR}" stroke-width="${width}" stroke-linecap="round"${dash} />`;
}

function buildHorizontalWireLines(dims: WireframeDimensions, count: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const t = i / (count + 1);
    const y = dims.bottomY - (dims.bottomY - dims.topY) * t;
    const leftX = lerp(dims.leftNearX, dims.leftFarX, t);
    const rightX = lerp(dims.rightNearX, dims.rightFarX, t);
    lines.push(
      createWirePath(
        [
          { x: leftX, y },
          { x: rightX, y },
        ],
        { dash: '6 12', width: 1.4 },
      ),
    );
  }
  return lines.join('\n');
}

function buildVerticalWireLines(dims: WireframeDimensions, count: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const t = i / (count + 1);
    const leftStart = lerp(dims.leftNearX, dims.centerX - dims.width * 0.04, t * 0.5);
    const leftEnd = lerp(dims.leftFarX, dims.centerX - dims.width * 0.02, t * 0.35);
    lines.push(
      createWirePath(
        [
          { x: leftStart, y: dims.bottomY },
          { x: leftEnd, y: dims.topY },
        ],
        { dash: '2 8', width: 1.2 },
      ),
    );
    const rightStart = lerp(dims.rightNearX, dims.centerX + dims.width * 0.04, t * 0.5);
    const rightEnd = lerp(dims.rightFarX, dims.centerX + dims.width * 0.02, t * 0.35);
    lines.push(
      createWirePath(
        [
          { x: rightStart, y: dims.bottomY },
          { x: rightEnd, y: dims.topY },
        ],
        { dash: '2 8', width: 1.2 },
      ),
    );
  }
  return lines.join('\n');
}

function buildDotRows(dims: WireframeDimensions, columns: number, rows: number): string {
  const dots: string[] = [];
  const dotSize = 1.8;
  for (let row = 0; row < rows; row += 1) {
    const ratio = row / (rows - 1);
    const y = dims.bottomY - (dims.bottomY - dims.topY) * ratio;
    const leftStart = lerp(dims.leftNearX, dims.leftFarX, ratio);
    const leftEnd = lerp(leftStart, dims.centerX - dims.width * 0.06, 0.65);
    const rightStart = lerp(dims.rightNearX, dims.rightFarX, ratio);
    const rightEnd = lerp(rightStart, dims.centerX + dims.width * 0.06, 0.65);
    for (let col = 0; col < columns; col += 1) {
      const denominator = Math.max(1, columns - 1);
      const t = col / denominator;
      const leftX = lerp(leftStart, leftEnd, t);
      const rightX = lerp(rightStart, rightEnd, t);
      dots.push(
        `<rect x="${leftX - dotSize / 2}" y="${y - dotSize / 2}" width="${dotSize}" height="${dotSize}" fill="${LINE_COLOR}" />`,
      );
      dots.push(
        `<rect x="${rightX - dotSize / 2}" y="${y - dotSize / 2}" width="${dotSize}" height="${dotSize}" fill="${LINE_COLOR}" />`,
      );
    }
  }
  return dots.join('\n');
}

function buildDoorSvg(
  dims: WireframeDimensions,
  variant: MazePreviewVariant,
  forwardOpen: boolean,
): string {
  const baseWidth = variant === 'goal' ? 52 : variant === 'junction' ? 58 : 64;
  const width = baseWidth;
  const height = Math.max(18, width * 0.45);
  const depth = height * 0.8;
  const rectX = dims.centerX - width / 2;
  const rectY = dims.topY - height / 2;

  const doorRect = `<rect data-name="wireframe-door" x="${rectX}" y="${rectY}" width="${width}" height="${height}" fill="none" stroke="${LINE_COLOR}" stroke-width="2" />`;
  const depthLines = [
    createWirePath(
      [
        { x: dims.centerX - width / 2, y: rectY },
        { x: dims.centerX - width / 3, y: dims.topY - depth },
      ],
      { width: 1.4 },
    ),
    createWirePath(
      [
        { x: dims.centerX + width / 2, y: rectY },
        { x: dims.centerX + width / 3, y: dims.topY - depth },
      ],
      { width: 1.4 },
    ),
    createWirePath(
      [
        { x: dims.centerX - width / 2, y: rectY + height },
        { x: dims.centerX - width / 3, y: dims.topY + depth * 0.15 },
      ],
      { width: 1.2 },
    ),
    createWirePath(
      [
        { x: dims.centerX + width / 2, y: rectY + height },
        { x: dims.centerX + width / 3, y: dims.topY + depth * 0.15 },
      ],
      { width: 1.2 },
    ),
  ];
  if (!forwardOpen) {
    depthLines.push(
      createWirePath(
        [
          { x: rectX, y: rectY },
          { x: rectX + width, y: rectY + height },
        ],
        { width: 1.2 },
      ),
    );
    depthLines.push(
      createWirePath(
        [
          { x: rectX + width, y: rectY },
          { x: rectX, y: rectY + height },
        ],
        { width: 1.2 },
      ),
    );
  }
  return [doorRect, ...depthLines].join('\n');
}

function buildDirectionOverlay(openDirections: Direction[], dims: WireframeDimensions): string {
  const overlays: string[] = [];
  if (openDirections.includes('north')) {
    overlays.push(
      createWirePath(
        [
          { x: dims.centerX, y: dims.bottomY - 20 },
          { x: dims.centerX, y: dims.topY - 20 },
        ],
        { dash: '4 10', width: 1.6 },
      ),
    );
  }
  if (openDirections.includes('south')) {
    overlays.push(
      createWirePath(
        [
          { x: dims.centerX - 12, y: dims.bottomY },
          { x: dims.centerX - 4, y: dims.bottomY + 12 },
          { x: dims.centerX + 12, y: dims.bottomY + 12 },
        ],
        { width: 1.4 },
      ),
    );
  }
  if (openDirections.includes('west')) {
    overlays.push(
      createWirePath(
        [
          { x: dims.leftNearX + 6, y: dims.bottomY - 10 },
          { x: dims.leftFarX - 8, y: dims.topY + 6 },
        ],
        { width: 1.2 },
      ),
    );
  }
  if (openDirections.includes('east')) {
    overlays.push(
      createWirePath(
        [
          { x: dims.rightNearX - 6, y: dims.bottomY - 10 },
          { x: dims.rightFarX + 8, y: dims.topY + 6 },
        ],
        { width: 1.2 },
      ),
    );
  }
  return overlays.join('\n');
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
