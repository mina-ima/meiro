import { useEffect, useMemo, useState } from 'react';
import { HUD } from './HUD';

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
}

export function PlayerView({
  points,
  targetPoints,
  predictionHits,
  phase,
  timeRemaining,
}: PlayerViewProps) {
  const clips = useMemo(() => PREVIEW_CLIPS, []);
  const [clipIndex, setClipIndex] = useState(0);
  const [secondsUntilNextClip, setSecondsUntilNextClip] = useState(PREVIEW_INTERVAL_MS / 1000);

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
        <canvas width={640} height={360} aria-label="レイキャスト表示" />
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
        <p>予測地点ヒット: {predictionHits}</p>
      </HUD>
    </div>
  );
}
