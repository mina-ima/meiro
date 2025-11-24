import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { PlayerView } from '../src/views/PlayerView';

vi.mock('../src/state/sessionStore', async () => {
  const mod = await vi.importActual<typeof import('../src/state/sessionStore')>(
    '../src/state/sessionStore',
  );
  return {
    ...mod,
    useSessionStore: vi.fn((selector) =>
      selector({
        maze: null,
        mazeSize: 5,
        serverSnapshot: null,
        player: { position: { x: 0, y: 0 }, angle: 0 },
      }),
    ),
  };
});

describe('PlayerView preview smoke test', () => {
  it('renders prep preview image without throwing', () => {
    const { getByRole } = render(
      <PlayerView
        points={0}
        targetPoints={10}
        predictionHits={0}
        phase="prep"
        timeRemaining={30}
      />,
    );

    const group = getByRole('group', { name: '準備中プレビュー' });
    expect(group).toBeTruthy();
  });
});
