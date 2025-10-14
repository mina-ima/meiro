import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PlayerView } from '../src/views/PlayerView';

const baseProps = {
  points: 0,
  targetPoints: 100,
  predictionHits: 0,
  timeRemaining: 120,
} as const;

describe('PlayerView 準備プレビュー', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('準備フェーズ中にプレビューオーバーレイが表示される', () => {
    render(<PlayerView {...baseProps} phase="prep" />);

    const group = screen.getByRole('group', { name: '準備中プレビュー' });
    expect(group).toBeInTheDocument();
    expect(screen.getByText(/クリップ 1/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText(/ゴールの光が一瞬だけ映ります/)).toBeInTheDocument();
  });

  it('探索フェーズではキャンバスのみが表示される', () => {
    render(<PlayerView {...baseProps} phase="explore" />);

    expect(screen.getByLabelText('レイキャスト表示')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '準備中プレビュー' })).not.toBeInTheDocument();
  });
});
