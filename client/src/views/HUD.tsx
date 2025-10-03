import type { ReactNode } from 'react';

export interface HUDProps {
  timeRemaining: number;
  score: number;
  targetScore: number;
  children?: ReactNode;
}

export function HUD({ timeRemaining, score, targetScore, children }: HUDProps): JSX.Element {
  return (
    <section aria-label="session hud">
      <p>残り時間: {timeRemaining.toFixed(0)}s</p>
      <p>
        スコア: {score} / {targetScore}
      </p>
      {children}
    </section>
  );
}
