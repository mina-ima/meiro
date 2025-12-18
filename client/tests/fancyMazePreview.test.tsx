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
    expect(container.querySelector('[data-tile-key="left_closed_d1"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="right_closed_d1"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key^="front_dead_"]')).toBeNull();
  });

  it('junctionで左右開口があるとleft_open_d1/right_open_d1とopening_fillが描画される', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    expect(container.querySelector('[data-tile-key="left_open_d1"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="right_open_d1"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="opening_fill_left_d1"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="opening_fill_right_d1"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="left_closed_d1"]')).toBeNull();
    expect(container.querySelector('[data-tile-key="right_closed_d1"]')).toBeNull();
  });

  it('forward=false なら最初の閉塞depthでfront_dead_dNが入り、それより手前のdepthタイルは描かない', () => {
    const { container } = renderPreview('start', {
      forward: false,
      left: true,
      right: false,
      backward: false,
    });

    const frontDead = container.querySelector('[data-tile-role="front"]');
    expect(frontDead).not.toBeNull();
    const depth = frontDead?.getAttribute('data-depth');
    expect(depth).toBe('4');

    const depth3Tile = container.querySelector('[data-depth="3"]');
    expect(depth3Tile).toBeNull();
    expect(container.querySelector('[data-tile-key="left_open_d1"]')).toBeNull();
    expect(container.querySelector('[data-tile-key="right_open_d1"]')).toBeNull();
  });

  it('goalビューでも同じタイル方式で描画される', () => {
    const { container } = renderPreview('goal', {
      forward: true,
      left: false,
      right: true,
      backward: false,
    });

    expect(container.querySelector('[data-preview-variant="goal"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="right_open_d1"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-key="left_closed_d1"]')).not.toBeNull();
  });
});
