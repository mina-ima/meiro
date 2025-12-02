import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createSimplePreviewSvg } from '../src/views/simpleMazePreview';
import type { Direction, MazePreviewVariant } from '../src/views/PlayerView';
import type { ServerMazeCell } from '../src/state/sessionStore';

const dummyCell = {} as ServerMazeCell;
const dummyDirections: Direction[] = [];

function renderPreview(variant: MazePreviewVariant, openings: Parameters<typeof createSimplePreviewSvg>[4]) {
  const svg = createSimplePreviewSvg(dummyCell, dummyDirections, variant, 'north', openings);
  return render(<div dangerouslySetInnerHTML={{ __html: svg }} />);
}

function parsePoints(pointsAttr: string | null) {
  if (!pointsAttr) return [];
  return pointsAttr
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });
}

describe('simpleMazePreview', () => {
  it('スタートビューで床が画面下端まで伸び、左右の壁が1枚ずつだけ描かれる', () => {
    const { container } = renderPreview('start', {
      forward: true,
      left: false,
      right: false,
      backward: false,
    });

    const floor = container.querySelector('polygon[data-floor-layer="main"]');
    expect(floor).not.toBeNull();
    const floorYs = parsePoints(floor?.getAttribute('points') ?? null).map((p) => p.y);
    expect(Math.max(...floorYs)).toBeCloseTo(180);

    const leftWalls = container.querySelectorAll('polygon[data-wall-layer="main"][data-wall-side="left"]');
    const rightWalls = container.querySelectorAll('polygon[data-wall-layer="main"][data-wall-side="right"]');
    expect(leftWalls.length).toBe(1);
    expect(rightWalls.length).toBe(1);
    expect(container.querySelectorAll('[data-forward-block]').length).toBe(0);
  });

  it('分岐ビューは forward=true で前壁を描かず、false で前壁を1枚だけ描く', () => {
    const open = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });
    expect(open.container.querySelectorAll('[data-forward-block]').length).toBe(0);

    const closed = renderPreview('junction', {
      forward: false,
      left: true,
      right: true,
      backward: false,
    });
    expect(closed.container.querySelectorAll('[data-forward-block]').length).toBe(1);
  });

  it('左右分岐の床は奥ほど狭くなり、手前より外側にはみ出さない', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const leftFloors = Array.from(container.querySelectorAll('polygon[data-branch-floor="left"]'));
    expect(leftFloors.length).toBeGreaterThan(0);
    const widths = leftFloors.map((poly) => {
      const pts = parsePoints(poly.getAttribute('points'));
      return {
        width: Math.abs(pts[1].x - pts[0].x),
        nearLeft: pts[0].x,
        farLeft: pts[3].x,
      };
    });

    for (let i = 1; i < widths.length; i++) {
      expect(widths[i].width).toBeLessThan(widths[i - 1].width);
    }
    widths.forEach(({ nearLeft, farLeft }) => {
      expect(farLeft).toBeGreaterThanOrEqual(nearLeft);
    });
  });
});
