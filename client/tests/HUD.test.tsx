import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HUD } from '../src/views/HUD';

describe('HUD', () => {
  it('プレイヤー向けに残時間・ポイント・達成率を表示する', () => {
    render(<HUD timeRemaining={125} score={32} targetScore={64} />);

    expect(screen.getByRole('timer', { name: '残り時間' })).toHaveTextContent('02:05');
    expect(screen.getByText('現在ポイント: 32')).toBeInTheDocument();
    expect(screen.getByText('規定ポイント: 64')).toBeInTheDocument();
    expect(screen.getByText('ゴールボーナス: 13')).toBeInTheDocument();

    const progress = screen.getByRole('progressbar', { name: '達成率' });
    expect(progress).toHaveAttribute('aria-valuenow', '50');
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('達成率: 50%')).toBeInTheDocument();
  });
});
