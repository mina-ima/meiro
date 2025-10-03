import type { ReactNode } from 'react';

export interface HUDProps {
  timeRemaining: number;
  score: number;
  targetScore: number;
  children?: ReactNode;
}

export function HUD({ timeRemaining, score, targetScore, children }: HUDProps) {
  const safeTarget = Math.max(targetScore, 0);
  const currentScore = Math.max(score, 0);
  const progressPercent =
    safeTarget > 0 ? Math.min(100, Math.round((currentScore / safeTarget) * 100)) : 0;
  const goalBonus = safeTarget > 0 ? Math.ceil(safeTarget / 5) : 0;
  const formattedTime = formatTime(timeRemaining);

  return (
    <section aria-label="session hud">
      <header>
        <p>
          残り時間:{' '}
          <time role="timer" aria-label="残り時間">
            {formattedTime}
          </time>
        </p>
      </header>

      <div>
        <p>現在ポイント: {currentScore}</p>
        <p>規定ポイント: {safeTarget}</p>
        <p>ゴールボーナス: {goalBonus}</p>
      </div>

      <div>
        <p>達成率: {progressPercent}%</p>
        <div
          role="progressbar"
          aria-label="達成率"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span
            style={{
              display: 'inline-block',
              width: '8rem',
              height: '0.5rem',
              backgroundColor: '#2d3748',
              borderRadius: '999px',
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                display: 'block',
                width: `${progressPercent}%`,
                height: '100%',
                backgroundColor: '#48bb78',
              }}
            />
          </span>
        </div>
      </div>

      {children}
    </section>
  );
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '00:00';
  }

  const seconds = Math.floor(totalSeconds);
  const minutesPart = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secondsPart = (seconds % 60).toString().padStart(2, '0');

  return `${minutesPart}:${secondsPart}`;
}
