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
  const clips = usePreviewClips();
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
    position: { ...playerPosition },
    angle: playerAngle,
  });

  const environmentRef = useRef<RaycasterEnvironment>(createBoundaryEnvironment(mazeSize));
  const exploringRef = useRef(phase === 'explore');

  useEffect(() => {
    environmentRef.current = createBoundaryEnvironment(mazeSize);
  }, [mazeSize]);

  useEffect(() => {
    rayStateRef.current = {
      position: { ...playerPosition },
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
        range: PLAYER_VIEW_RANGE,
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

function usePreviewClips(): readonly PreviewClip[] {
  const maze = useSessionStore((state) => state.maze);
  return useMemo(() => createPreviewClipsFromMaze(maze), [maze]);
}

function createBoundaryEnvironment(size: number): RaycasterEnvironment {
  const limit = Math.max(0, size);
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
  drawWireframeCorridor(context);
  context.canvas.dataset.lastRayIntensity = '';
}

function drawWireframeBase(context: CanvasRenderingContext2D): void {
  const { width, height } = context.canvas;
  context.fillStyle = BACKGROUND_COLOR;
  context.fillRect(0, 0, width, height);
}

function drawWireframeCorridor(context: CanvasRenderingContext2D): void {
  const { width, height } = context.canvas;
  const topY = Math.round(height * 0.2);
  const bottomY = Math.round(height * 0.96);
  const leftNearX = Math.round(width * 0.1);
  const rightNearX = width - leftNearX;
  const leftFarX = Math.round(width * 0.32);
  const rightFarX = width - leftFarX;
  const centerX = width / 2;

  applyLineDash(context, []);
  context.lineWidth = Math.max(1, width * 0.003);
  context.strokeStyle = LINE_COLOR;
  drawLine(context, leftNearX, bottomY, leftFarX, topY);
  drawLine(context, rightNearX, bottomY, rightFarX, topY);
  drawLine(context, leftNearX, bottomY, rightNearX, bottomY);

  context.strokeStyle = LINE_COLOR;
  applyLineDash(context, [8, 6]);
  drawLine(context, centerX, bottomY, centerX, topY);
  applyLineDash(context, []);

  context.strokeStyle = LINE_COLOR;
  context.lineWidth = Math.max(1, width * 0.002);
  applyLineDash(context, [4, 8]);
  for (let i = 1; i <= 5; i += 1) {
    const t = i / 6;
    const y = bottomY - (bottomY - topY) * t;
    const leftX = lerp(leftNearX, leftFarX, t);
    const rightX = lerp(rightNearX, rightFarX, t);
    drawLine(context, leftX, y, rightX, y);
  }
  applyLineDash(context, []);

  context.strokeStyle = LINE_COLOR;
  applyLineDash(context, [2, 6]);
  const verticalLines = 3;
  for (let i = 1; i <= verticalLines; i += 1) {
    const t = i / (verticalLines + 1);
    const leftStartX = lerp(leftNearX, centerX - width * 0.05, t * 0.5);
    const leftEndX = lerp(leftFarX, centerX - width * 0.03, t * 0.35);
    drawLine(context, leftStartX, bottomY, leftEndX, topY);
    const rightStartX = lerp(rightNearX, centerX + width * 0.05, t * 0.5);
    const rightEndX = lerp(rightFarX, centerX + width * 0.03, t * 0.35);
    drawLine(context, rightStartX, bottomY, rightEndX, topY);
  }
  applyLineDash(context, []);

  drawWallDots(context, leftNearX, leftFarX, centerX - width * 0.06, topY, bottomY, true);
  drawWallDots(context, rightNearX, rightFarX, centerX + width * 0.06, topY, bottomY, false);

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

  const lastIntensity = hits[hits.length - 1]?.intensity;
  context.canvas.dataset.lastRayIntensity =
    lastIntensity === undefined ? '' : lastIntensity.toFixed(2);

  drawWireframeCorridor(context);
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
    previewImage: createPerspectivePreviewSvg(openDirections, 'start'),
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
    previewImage: createPerspectivePreviewSvg(openDirections, 'junction'),
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
    previewImage: createPerspectivePreviewSvg(openDirections, 'goal'),
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
  openDirections: Direction[],
  variant: MazePreviewVariant,
): string {
  const dims = {
    width: 320,
    height: 180,
    topY: 38,
    bottomY: 170,
    leftNearX: 38,
    rightNearX: 282,
    leftFarX: 120,
    rightFarX: 200,
    centerX: 160,
  } as const;

  const horizontalLines = buildHorizontalWireLines(dims, 5);
  const verticalLines = buildVerticalWireLines(dims, 3);
  const dotRows = buildDotRows(dims, 4, 5);
  const door = buildDoorSvg(dims, variant);
  const directionOverlay = buildDirectionOverlay(openDirections, dims);

  const outerWalls = [
    createWirePath(
      [
        { x: dims.leftNearX, y: dims.bottomY },
        { x: dims.leftFarX, y: dims.topY },
      ],
      { width: 2.4 },
    ),
    createWirePath(
      [
        { x: dims.rightNearX, y: dims.bottomY },
        { x: dims.rightFarX, y: dims.topY },
      ],
      { width: 2.4 },
    ),
    createWirePath(
      [
        { x: dims.leftNearX, y: dims.bottomY },
        { x: dims.rightNearX, y: dims.bottomY },
      ],
      { width: 2.4 },
    ),
  ];

  return createSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dims.width} ${dims.height}">
      <rect width="${dims.width}" height="${dims.height}" fill="${BACKGROUND_COLOR}" />
      ${outerWalls.join('\n')}
      ${horizontalLines}
      ${verticalLines}
      ${dotRows}
      ${door}
      ${directionOverlay}
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

function buildDoorSvg(dims: WireframeDimensions, variant: MazePreviewVariant): string {
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

  return [
    {
      id: 'entry',
      title: 'スタート地点プレビュー',
      description: `スタート近辺。${describeOpenDirections(startDirections)}`,
      hint: 'スタート直後の導線をイメージしておくと迷いません。',
      previewImage: createPerspectivePreviewSvg(startDirections, 'start'),
      previewAlt: 'スタート地点プレビュー映像',
    },
    {
      id: 'junction',
      title: '迷路分岐プレビュー',
      description: `複雑な分岐。${describeOpenDirections(junctionDirections)}`,
      hint: '二手目までの動きを決めて、角で減速しないようにしましょう。',
      previewImage: createPerspectivePreviewSvg(junctionDirections, 'junction'),
      previewAlt: '迷路分岐プレビュー映像',
    },
    {
      id: 'goal',
      title: 'ゴール直前プレビュー',
      description: `ゴール周辺。${describeOpenDirections(goalDirections)}光源を追いかけましょう。`,
      hint: '差し込む光を目印に、最後のコーナーで減速を抑えてください。',
      previewImage: createPerspectivePreviewSvg(goalDirections, 'goal'),
      previewAlt: 'ゴールプレビュー映像',
    },
  ] as const;
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
