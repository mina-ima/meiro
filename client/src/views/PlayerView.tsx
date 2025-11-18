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
const DEFAULT_BACKGROUND = '#020617';
const SKY_GRADIENT_TOP = '#0f172a';
const SKY_GRADIENT_BOTTOM = '#1e293b';
const FLOOR_COLOR = '#082f49';
const COLUMN_MIN_RATIO = 0.18;

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

    renderRaycastScene(context, hits, PLAYER_VIEW_RANGE);
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
  const { width, height } = context.canvas;
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, SKY_GRADIENT_TOP);
  gradient.addColorStop(0.6, SKY_GRADIENT_BOTTOM);
  gradient.addColorStop(1, FLOOR_COLOR);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.canvas.dataset.lastRayIntensity = '';
}

function renderRaycastScene(
  context: CanvasRenderingContext2D,
  hits: RayHit[],
  viewRange: number,
): void {
  const { width, height } = context.canvas;

  context.fillStyle = DEFAULT_BACKGROUND;
  context.fillRect(0, 0, width, height);

  if (hits.length === 0) {
    context.canvas.dataset.lastRayIntensity = '';
    return;
  }

  const columnWidth = width / hits.length;

  hits.forEach((hit, index) => {
    const columnHeight = computeColumnHeight(hit.distance, viewRange, height);
    const x = Math.floor(index * columnWidth);
    const y = Math.floor((height - columnHeight) / 2);
    const w = Math.max(1, Math.ceil(columnWidth));

    context.fillStyle = intensityToColor(hit.intensity);
    context.fillRect(x, y, w, columnHeight);
  });

  const lastIntensity = hits[hits.length - 1]?.intensity;
  context.canvas.dataset.lastRayIntensity =
    lastIntensity === undefined ? '' : lastIntensity.toFixed(2);
}

function computeColumnHeight(distance: number, viewRange: number, canvasHeight: number): number {
  if (!Number.isFinite(distance) || distance <= 0) {
    return canvasHeight;
  }

  const clampedDistance = Math.min(Math.max(distance, 0), Math.max(viewRange, 0.0001));
  const normalized = 1 - clampedDistance / Math.max(viewRange, 0.0001);
  const minHeight = canvasHeight * COLUMN_MIN_RATIO;
  const variableHeight = normalized * (canvasHeight * (1 - COLUMN_MIN_RATIO));
  return Math.max(minHeight, variableHeight + minHeight);
}

function intensityToColor(intensity: number): string {
  const clamped = Math.max(0, Math.min(1, intensity));
  const near = { r: 226, g: 232, b: 240 };
  const far = { r: 15, g: 23, b: 42 };

  const r = Math.round(far.r + (near.r - far.r) * clamped);
  const g = Math.round(far.g + (near.g - far.g) * clamped);
  const b = Math.round(far.b + (near.b - far.b) * clamped);

  return `rgb(${r}, ${g}, ${b})`;
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
  const accent = variant === 'goal' ? '#fde047' : variant === 'junction' ? '#38bdf8' : '#22d3ee';
  const hasForward = openDirections.includes('north');
  const hasLeft = openDirections.includes('west');
  const hasRight = openDirections.includes('east');
  const hasBack = openDirections.includes('south');

  const forwardPath = `<path d="M140 110 L180 110 L220 20 L100 20 Z" fill="${accent}" opacity="${
    hasForward ? '0.55' : '0.12'
  }" />`;
  const leftPath = `<path d="M80 110 L140 110 L110 20 L40 20 Z" fill="${accent}" opacity="${
    hasLeft ? '0.4' : '0.08'
  }" />`;
  const rightPath = `<path d="M180 110 L240 110 L280 20 L210 20 Z" fill="${accent}" opacity="${
    hasRight ? '0.4' : '0.08'
  }" />`;
  const backHighlight = `<path d="M60 180 L260 180 L230 130 L90 130 Z" fill="${accent}" opacity="${
    hasBack ? '0.25' : '0.08'
  }" />`;

  const glowDefs =
    variant === 'goal'
      ? `<defs>
          <radialGradient id="goalGlow" cx="0.75" cy="0.18" r="0.45">
            <stop offset="0%" stop-color="#fde68a" stop-opacity="1" />
            <stop offset="60%" stop-color="#facc15" stop-opacity="0.5" />
            <stop offset="100%" stop-color="#facc15" stop-opacity="0" />
          </radialGradient>
        </defs>`
      : '';

  const glow =
    variant === 'goal'
      ? `<circle cx="240" cy="60" r="45" fill="url(#goalGlow)" opacity="0.9" />`
      : '';

  return createSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
      ${glowDefs}
      <rect width="320" height="180" fill="#020617" />
      <path d="M0 0 L320 0 L260 110 L60 110 Z" fill="#0f172a" />
      <path d="M60 110 L260 110 L320 180 L0 180 Z" fill="#082f49" />
      ${leftPath}
      ${rightPath}
      ${forwardPath}
      ${backHighlight}
      ${glow}
      <path d="M0 0 L60 110" stroke="#0b212f" stroke-width="4" opacity="0.35" />
      <path d="M320 0 L260 110" stroke="#0b212f" stroke-width="4" opacity="0.35" />
    </svg>
  `);
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
