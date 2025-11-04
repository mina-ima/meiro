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
import { useSessionStore, type PauseReason } from '../state/sessionStore';

function createSvgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

const PREVIEW_IMAGES = {
  entry: createSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
      <rect width="320" height="180" fill="#0f172a"/>
      <rect x="36" y="48" width="248" height="84" rx="26" fill="#1e293b"/>
      <path d="M60 90 H260" stroke="#38bdf8" stroke-width="10" stroke-linecap="round" opacity="0.85"/>
      <circle cx="104" cy="90" r="12" fill="#22d3ee" opacity="0.8"/>
      <circle cx="220" cy="90" r="12" fill="#facc15" opacity="0.9"/>
    </svg>
  `),
  junction: createSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
      <rect width="320" height="180" fill="#0f172a"/>
      <path d="M160 30 V150 M30 90 H290" stroke="#38bdf8" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>
      <circle cx="160" cy="90" r="18" fill="#22d3ee" opacity="0.85"/>
      <rect x="210" y="46" width="34" height="88" rx="12" fill="#1e293b"/>
      <rect x="76" y="46" width="34" height="88" rx="12" fill="#1e293b"/>
    </svg>
  `),
  goal: createSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
      <defs>
        <radialGradient id="goalGlow" cx="0.82" cy="0.18" r="0.45">
          <stop offset="0%" stop-color="#fde68a" stop-opacity="1"/>
          <stop offset="60%" stop-color="#facc15" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="#facc15" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="320" height="180" fill="#0f172a"/>
      <path d="M40 150 L150 90 L210 120 L270 60" fill="none" stroke="#38bdf8" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
      <circle cx="270" cy="60" r="30" fill="url(#goalGlow)"/>
      <circle cx="270" cy="60" r="10" fill="#fde047"/>
      <path d="M262 32 L270 20 L278 32" fill="#f5d0c5" opacity="0.5"/>
    </svg>
  `),
} as const;

interface PreviewClip {
  id: 'entry' | 'junction' | 'goal';
  title: string;
  description: string;
  hint: string;
  previewImage: string;
  previewAlt: string;
}

const PREVIEW_CLIPS: readonly PreviewClip[] = [
  {
    id: 'entry',
    title: 'スタート地点の全体像',
    description: '最初の広場と正面の分岐を確認しておきましょう。',
    hint: 'スタート直後の導線をイメージしておくと迷いません。',
    previewImage: PREVIEW_IMAGES.entry,
    previewAlt: 'スタート地点プレビュー映像',
  },
  {
    id: 'junction',
    title: '複雑な十字路',
    description: '左手に長い通路、右手に袋小路。無駄なく抜けるルートをイメージしましょう。',
    hint: '曲がり角で減速しないよう、進行ルートを決めておきましょう。',
    previewImage: PREVIEW_IMAGES.junction,
    previewAlt: '十字路プレビュー映像',
  },
  {
    id: 'goal',
    title: 'ゴールへの最終コーナー',
    description: 'ゴールの光が一瞬だけ映ります。右折→直進でゴールに到達します。',
    hint: 'ゴール直前の曲がり方と光源位置をこの映像で確認してください。',
    previewImage: PREVIEW_IMAGES.goal,
    previewAlt: 'ゴールプレビュー映像',
  },
] as const;

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
  const clips = useMemo(() => PREVIEW_CLIPS, []);
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
