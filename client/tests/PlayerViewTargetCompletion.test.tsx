import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerView } from '../src/views/PlayerView';
import { useSessionStore } from '../src/state/sessionStore';

describe('PlayerView 規定ポイント達成表示', () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
  });

  it('探索中は規定ポイント達成メッセージを表示しない', () => {
    render(
      <PlayerView
        points={10}
        targetPoints={15}
        predictionHits={0}
        phase="explore"
        timeRemaining={120}
        compensationBonus={0}
      />,
    );

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('結果フェーズで規定ポイント到達時にメッセージを表示する', () => {
    render(
      <PlayerView
        points={18}
        targetPoints={15}
        predictionHits={0}
        phase="result"
        timeRemaining={0}
        compensationBonus={0}
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('規定ポイント達成！');
    expect(status).toHaveTextContent('最終スコア: 18');
    expect(status).toHaveTextContent('規定ポイント: 15');
  });
});
