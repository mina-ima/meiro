import { useEffect, useMemo, useState } from 'react';
import { HUD } from './HUD';

const PREVIEW_CLIPS = [
  {
    id: 'entry',
    title: 'スタート地点の全体像',
    description: '最初の広場と正面の分岐を確認しておきましょう。',
  },
  {
    id: 'junction',
    title: '複雑な十字路',
    description: '左手に長い通路、右手に袋小路。無駄なく抜けるルートをイメージしましょう。',
  },
  {
    id: 'goal',
    title: 'ゴールへの最終コーナー',
    description: 'ゴールの光が一瞬だけ映ります。右折→直進でゴールに到達します。',
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
