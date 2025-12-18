import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createFancyMazePreviewSvg } from '../src/views/FancyMazePreview';
import type { Direction, MazePreviewVariant } from '../src/views/PlayerView';
import type { ServerMazeCell } from '../src/state/sessionStore';

const dummyCell = {} as ServerMazeCell;
const dummyDirections: Direction[] = [];

function renderPreview(
  variant: MazePreviewVariant,
  openings: Parameters<typeof createFancyMazePreviewSvg>[4],
) {
  const html = createFancyMazePreviewSvg(dummyCell, dummyDirections, variant, 'north', openings);
  return render(<div dangerouslySetInnerHTML={{ __html: html }} />);
}

describe('FancyMazePreview (固定タイル描画)', () => {
  it('startビューで閉じた左右と奥行き4段の床タイルを重ねる', () => {
    const { container } = renderPreview('start', {
      forward: true,
      left: false,
      right: false,
      backward: false,
    });

    const tiles = container.querySelectorAll('[data-tile-key]');
    expect(tiles.length).toBeGreaterThan(0);
    expect(container.querySelector('[data-preview-variant="start"]')).not.toBeNull();

    const floors = container.querySelectorAll('[data-tile-role="floor"]');
    expect(floors.length).toBe(4);
    ['1', '2', '3', '4'].forEach((depth) => {
      expect(container.querySelector(`[data-tile-key="left_closed_d${depth}"]`)).not.toBeNull();
      expect(container.querySelector(`[data-tile-key="right_closed_d${depth}"]`)).not.toBeNull();
    });
    expect(container.querySelector('[data-tile-key^="front_dead_"]')).toBeNull();
  });

  it('forwardが開いているjunctionでは左右開口がdepth2まで延び、以降は閉じる', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    expect(container.querySelector('[data-tile-key="left_open_d1"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="left_open_d2"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="left_open_d3"]')).toBeNull();
    expect(container.querySelector('[data-tile-key="left_closed_d3"]')).not.toBeNull();

    expect(container.querySelector('[data-tile-key="right_open_d1"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="right_open_d2"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="right_open_d3"]')).toBeNull();
    expect(container.querySelector('[data-tile-key="right_closed_d3"]')).not.toBeNull();

    expect(container.querySelector('[data-tile-key="opening_fill_left_d1"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="opening_fill_left_d2"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="opening_fill_right_d1"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="opening_fill_right_d2"]')).not.toBeNull();

    expect(container.querySelector('[data-tile-key="left_closed_d1"]')).toBeNull();
    expect(container.querySelector('[data-tile-key="right_closed_d1"]')).toBeNull();
    expect(container.querySelector('[data-tile-key^="front_dead_"]')).toBeNull();
  });

  it('forward=false ならdepth1でfront_dead_d1が入り、depth2以降は描画しない', () => {
    const { container } = renderPreview('start', {
      forward: false,
      left: true,
      right: false,
      backward: false,
    });

    const frontDead = container.querySelector('[data-tile-role="front"]');
    expect(frontDead).not.toBeNull();
    const depth = frontDead?.getAttribute('data-depth');
    expect(depth).toBe('1');

    expect(container.querySelector('[data-depth="2"]')).toBeNull();
    expect(container.querySelector('[data-depth="3"]')).toBeNull();
    expect(container.querySelector('[data-depth="4"]')).toBeNull();
    expect(container.querySelector('[data-tile-key="left_open_d1"]')).not.toBeNull();
  });

  it('goalビューでも同じタイル方式で描画される', () => {
    const { container } = renderPreview('goal', {
      forward: true,
      left: false,
      right: true,
      backward: false,
    });

    expect(container.querySelector('[data-preview-variant="goal"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="right_open_d2"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="left_closed_d2"]')).not.toBeNull();
  });
});
