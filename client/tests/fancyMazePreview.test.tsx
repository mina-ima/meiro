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
  const svg = createFancyMazePreviewSvg(dummyCell, dummyDirections, variant, 'north', openings);
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

function edgeWidths(points: { x: number; y: number }[]) {
  const ys = points.map((p) => p.y);
  const nearY = Math.max(...ys);
  const farY = Math.min(...ys);
  const nearXs = points.filter((p) => Math.abs(p.y - nearY) < 0.001).map((p) => p.x);
  const farXs = points.filter((p) => Math.abs(p.y - farY) < 0.001).map((p) => p.x);
  const nearWidth = Math.max(...nearXs) - Math.min(...nearXs);
  const farWidth = Math.max(...farXs) - Math.min(...farXs);
  return { nearWidth, farWidth, nearY, farY };
}

describe('FancyMazePreview', () => {
  it('4枚の床スライスが奥ほど狭くなり、収束点を共有する', () => {
    const { container } = renderPreview('start', {
      forward: true,
      left: false,
      right: false,
      backward: false,
    });

    const floors = Array.from(container.querySelectorAll('polygon[data-layer="floor"]'));
    expect(floors.length).toBe(4);
    const widths = floors.map((poly) => edgeWidths(parsePoints(poly.getAttribute('points'))));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i].nearWidth).toBeLessThan(widths[i - 1].nearWidth);
      expect(widths[i].farWidth).toBeLessThan(widths[i - 1].farWidth);
      expect(widths[i].farY).toBeLessThan(widths[i].nearY);
    }

    const guides = Array.from(container.querySelectorAll('line[data-floor-guide="true"]'));
    const vanishXs = new Set(guides.map((line) => Number(line.getAttribute('x2'))));
    const vanishYs = new Set(guides.map((line) => Number(line.getAttribute('y2'))));
    expect(vanishXs.size).toBe(1);
    expect(vanishYs.size).toBe(1);
  });

  it('左右壁のレンガ行数はスライスが進むほど増える', () => {
    const { container } = renderPreview('start', {
      forward: true,
      left: false,
      right: false,
      backward: false,
    });

    const leftWalls = Array.from(
      container.querySelectorAll('[data-layer="wall"][data-wall-side="left"]'),
    );
    expect(leftWalls.length).toBe(4);
    const rowCounts = leftWalls.map((el) => Number(el.getAttribute('data-brick-rows')));
    for (let i = 1; i < rowCounts.length; i++) {
      expect(rowCounts[i]).toBeGreaterThan(rowCounts[i - 1]);
    }
  });

  it('スタートビューは forward=false で前壁を1枚だけ描き、forward=true では描かない', () => {
    const open = renderPreview('start', {
      forward: true,
      left: false,
      right: false,
      backward: false,
    });
    expect(open.container.querySelectorAll('[data-wall-side="front"]').length).toBe(0);

    const closed = renderPreview('start', {
      forward: false,
      left: false,
      right: false,
      backward: false,
    });
    const frontWalls = closed.container.querySelectorAll('[data-wall-side="front"]');
    expect(frontWalls.length).toBe(1);
    const slices = new Set(Array.from(frontWalls).map((el) => el.getAttribute('data-slice')));
    expect(slices.has('3') || slices.has('4')).toBe(true);
  });

  it('分岐ビューは前壁を必ず描き、左右の開口部に奥行きのある横通路を重ねる', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    expect(container.querySelectorAll('[data-wall-side="front"]').length).toBe(1);

    const leftBranchFloors = Array.from(
      container.querySelectorAll('polygon[data-branch="left"][data-layer="floor"]'),
    );
    const rightBranchFloors = Array.from(
      container.querySelectorAll('polygon[data-branch="right"][data-layer="floor"]'),
    );
    expect(leftBranchFloors.length).toBeGreaterThan(0);
    expect(rightBranchFloors.length).toBeGreaterThan(0);

    const leftSize = edgeWidths(parsePoints(leftBranchFloors[0].getAttribute('points')));
    expect(leftSize.farWidth).toBeLessThan(leftSize.nearWidth);
    expect(leftSize.farY).toBeLessThan(leftSize.nearY);

    const rightSize = edgeWidths(parsePoints(rightBranchFloors[0].getAttribute('points')));
    expect(rightSize.farWidth).toBeLessThan(rightSize.nearWidth);
    expect(rightSize.farY).toBeLessThan(rightSize.nearY);
  });

  it('ゴールビューは最奥の前壁スライスにポータルを設置する', () => {
    const { container } = renderPreview('goal', {
      forward: true,
      left: false,
      right: false,
      backward: false,
    });

    const portal = container.querySelector('rect[data-goal-portal="true"]');
    expect(portal).not.toBeNull();

    const frontWall = container.querySelector('[data-wall-side="front"]');
    expect(frontWall).not.toBeNull();
    expect(frontWall?.getAttribute('data-slice')).toBe('4');
  });
});
