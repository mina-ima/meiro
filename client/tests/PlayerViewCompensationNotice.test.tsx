import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerView } from '../src/views/PlayerView';

const baseProps = {
  points: 0,
  targetPoints: 100,
  predictionHits: 0,
  timeRemaining: 120,
} as const;

describe('PlayerView 初期ポイント補填表示', () => {
  it('探索開始時に補填ポイントのバッジを表示する', () => {
    render(
      <PlayerView
        {...baseProps}
        phase="explore"
        points={12}
        compensationBonus={12}
      />,
    );

    expect(screen.getByText('初期ポイント補填 +12')).toBeInTheDocument();
  });
});
