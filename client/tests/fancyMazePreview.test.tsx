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

function centerX(points: { x: number; y: number }[], y: number) {
  const atY = points.filter((p) => Math.abs(p.y - y) < 0.001);
  return atY.reduce((sum, p) => sum + p.x, 0) / atY.length;
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

  it('分岐ビュー forward=true は前壁を描かず、左右の開口部に横通路をはめ込む', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    expect(container.querySelectorAll('[data-wall-side="front"]').length).toBe(0);

    const floorSlice2 = container.querySelector('polygon[data-layer="floor"][data-slice="2"]');
    expect(floorSlice2).not.toBeNull();
    const floor2Points = parsePoints(floorSlice2?.getAttribute('points') ?? '');
    const floor2NearY = Math.max(...floor2Points.map((p) => p.y));
    const floor2NearLeft = Math.min(
      ...floor2Points.filter((p) => Math.abs(p.y - floor2NearY) < 0.001).map((p) => p.x),
    );
    const floor2NearRight = Math.max(
      ...floor2Points.filter((p) => Math.abs(p.y - floor2NearY) < 0.001).map((p) => p.x),
    );
    const anchorY = floor2NearY;

    const leftBranchFloor = container.querySelector('polygon[data-branch="left"][data-layer="floor"]');
    const rightBranchFloor = container.querySelector(
      'polygon[data-branch="right"][data-layer="floor"]',
    );
    expect(leftBranchFloor).not.toBeNull();
    expect(rightBranchFloor).not.toBeNull();

    const assertBranch = (side: 'left' | 'right', element: Element | null, anchorNearX: number) => {
      const branchPoints = parsePoints(element?.getAttribute('points') ?? '');
      expect(branchPoints.length).toBe(4);
      expect(branchPoints[0]?.x).toBeCloseTo(anchorNearX, 0.001);
      expect(branchPoints[0]?.y).toBeCloseTo(anchorY, 1);
      expect(branchPoints[1]?.y).toBeCloseTo(anchorY, 1);
      const edges = edgeWidths(branchPoints);
      expect(edges.nearWidth).toBeGreaterThan(edges.farWidth);
      expect(edges.farY).toBeLessThan(edges.nearY);
      expect(edges.nearY).toBeCloseTo(anchorY, 1);
      const nearXs = branchPoints
        .filter((p) => Math.abs(p.y - edges.nearY) < 0.001)
        .map((p) => p.x);
      if (side === 'left') {
        expect(Math.max(...nearXs)).toBeCloseTo(anchorNearX, 0.001);
      } else {
        expect(Math.min(...nearXs)).toBeCloseTo(anchorNearX, 0.001);
      }
      const farXs = branchPoints
        .filter((p) => Math.abs(p.y - edges.farY) < 0.001)
        .map((p) => p.x);
      if (side === 'left') {
        expect(Math.max(...farXs)).toBeLessThan(Math.max(...nearXs));
      } else {
        expect(Math.min(...farXs)).toBeGreaterThan(Math.min(...nearXs));
      }

      const farInner = branchPoints[3];
      expect(Math.abs((farInner?.x ?? 0) - (branchPoints[0]?.x ?? 0))).toBeCloseTo(10, 1);
    };

    assertBranch('left', leftBranchFloor, floor2NearLeft);
    assertBranch('right', rightBranchFloor, floor2NearRight);

    const leftSlice2Walls = container.querySelectorAll(
      '[data-layer="wall"][data-wall-side="left"][data-slice="2"]',
    );
    const rightSlice2Walls = container.querySelectorAll(
      '[data-layer="wall"][data-wall-side="right"][data-slice="2"]',
    );
    expect(leftSlice2Walls.length).toBe(0);
    expect(rightSlice2Walls.length).toBe(0);

    const leftInnerWall = container.querySelector(
      '[data-branch-wall="left"][data-branch-position="inner"]',
    );
    const rightInnerWall = container.querySelector(
      '[data-branch-wall="right"][data-branch-position="inner"]',
    );
    expect(leftInnerWall).not.toBeNull();
    expect(rightInnerWall).not.toBeNull();
    const leftWallPoints = parsePoints(leftInnerWall?.getAttribute('points') ?? '');
    const rightWallPoints = parsePoints(rightInnerWall?.getAttribute('points') ?? '');
    expect(leftWallPoints[0]?.x).toBeCloseTo(floor2NearLeft, 0.001);
    expect(leftWallPoints[0]?.y).toBeCloseTo(anchorY, 0.5);
    expect(leftWallPoints[1]?.y).toBeCloseTo(anchorY - 28, 0.5);
    expect(rightWallPoints[0]?.x).toBeCloseTo(floor2NearRight, 0.001);
    expect(rightWallPoints[0]?.y).toBeCloseTo(anchorY, 0.5);
    expect(rightWallPoints[1]?.y).toBeCloseTo(anchorY - 28, 0.5);

    const branchWallsMatchFloor = (
      side: 'left' | 'right',
      floor: Element | null,
    ) => {
      const branchFloorPoints = parsePoints(floor?.getAttribute('points') ?? '');
      const nearY = Math.max(...branchFloorPoints.map((p) => p.y));
      const farY = Math.min(...branchFloorPoints.map((p) => p.y));
      expect(nearY).toBeCloseTo(anchorY, 1);

      const walls = Array.from(container.querySelectorAll(`[data-branch-wall="${side}"]`));
      expect(walls.length).toBeGreaterThanOrEqual(1);
      walls.forEach((wall) => {
        const ys = parsePoints(wall.getAttribute('points')).map((p) => p.y);
        expect(ys.some((y) => Math.abs(y - nearY) < 1)).toBe(true);
        expect(ys.some((y) => Math.abs(y - farY) < 1)).toBe(true);
      });
    };

    branchWallsMatchFloor('left', leftBranchFloor);
    branchWallsMatchFloor('right', rightBranchFloor);
  });

  it('分岐ビュー 左開放の切り欠きはslice2の壁幅いっぱいに揃い、枝通路の壁も同じ床ラインから立ち上がる', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: false,
      backward: false,
    });

    const branchInnerWall = container.querySelector(
      '[data-branch-wall="left"][data-branch-position="inner"]',
    );
    expect(
      container.querySelectorAll('[data-layer="wall"][data-wall-side="left"][data-slice="2"]')
        .length,
    ).toBe(0);
    expect(
      container.querySelectorAll('[data-layer="wall"][data-wall-side="right"][data-slice="2"]')
        .length,
    ).toBe(1);
    expect(branchInnerWall).not.toBeNull();

    const floorSlice2 = container.querySelector('polygon[data-layer="floor"][data-slice="2"]');
    expect(floorSlice2).not.toBeNull();
    const floor2Points = parsePoints(floorSlice2?.getAttribute('points') ?? '');
    const floor2NearY = Math.max(...floor2Points.map((p) => p.y));
    const floor2NearX = floor2Points.find((p) => Math.abs(p.y - floor2NearY) < 0.01)?.x ?? 0;

    const branchPoints = parsePoints(branchInnerWall?.getAttribute('points') ?? null);
    const branchNear = branchPoints[0];
    const branchFar = branchPoints[1];
    expect(branchNear?.y).toBeCloseTo(floor2NearY, 0.1);
    expect(Math.abs((branchNear?.x ?? 0) - floor2NearX)).toBeLessThan(0.5);
    expect(branchFar?.y).toBeCloseTo(floor2NearY - 28, 0.1);
  });

  it('分岐床はslice2の床ラインを起点に強く横へ伸び、遠ざかるほど横方向への移動が大きい', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: false,
      backward: false,
    });

    const floorSlice2 = container.querySelector('polygon[data-layer="floor"][data-slice="2"]');
    expect(floorSlice2).not.toBeNull();
    const floorPoints = parsePoints(floorSlice2?.getAttribute('points') ?? null);
    const anchorY = Math.max(...floorPoints.map((p) => p.y));
    const anchorXLeft = Math.min(
      ...floorPoints.filter((p) => Math.abs(p.y - anchorY) < 0.001).map((p) => p.x),
    );

    const branchFloor = container.querySelector(
      'polygon[data-branch="left"][data-layer="floor"]',
    );
    expect(branchFloor).not.toBeNull();
    const branchPoints = parsePoints(branchFloor?.getAttribute('points') ?? null);
    const nearY = Math.max(...branchPoints.map((p) => p.y));
    const farY = Math.min(...branchPoints.map((p) => p.y));
    expect(nearY).toBeCloseTo(anchorY, 0.5);

    const nearCenterX = centerX(branchPoints, nearY);
    const farCenterX = centerX(branchPoints, farY);
    const dx = Math.abs(farCenterX - nearCenterX);
    expect(dx).toBeGreaterThan(2);
    expect(farCenterX).toBeGreaterThan(nearCenterX);

    const minX = Math.min(...branchPoints.map((p) => p.x));
    expect(minX).toBeLessThan(anchorXLeft - 40);
  });

  it('分岐ビュー 左だけ開いている場合は右壁を切らず、左の穴だけを分岐通路で埋める', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: false,
      backward: false,
    });

    expect(
      container.querySelectorAll('[data-layer="wall"][data-wall-side="right"][data-slice="2"]').length,
    ).toBe(1);
    expect(
      container.querySelectorAll('[data-layer="wall"][data-wall-side="left"][data-slice="2"]').length,
    ).toBe(0);

    const floorSlice2 = container.querySelector('polygon[data-layer="floor"][data-slice="2"]');
    expect(floorSlice2).not.toBeNull();
    const floor2Points = parsePoints(floorSlice2?.getAttribute('points') ?? '');
    const floor2NearY = Math.max(...floor2Points.map((p) => p.y));
    const floor2NearLeft = Math.min(
      ...floor2Points.filter((p) => Math.abs(p.y - floor2NearY) < 0.001).map((p) => p.x),
    );
    const leftBranchInnerWall = container.querySelector(
      '[data-branch-wall="left"][data-branch-position="inner"]',
    );
    expect(leftBranchInnerWall).not.toBeNull();
    const leftWallPoints = parsePoints(leftBranchInnerWall?.getAttribute('points') ?? '');
    const leftWallNearY = Math.max(...leftWallPoints.map((p) => p.y));

    const leftBranchFloors = Array.from(
      container.querySelectorAll('polygon[data-branch="left"][data-layer="floor"]'),
    );
    const rightBranchFloors = Array.from(
      container.querySelectorAll('polygon[data-branch="right"][data-layer="floor"]'),
    );
    expect(leftBranchFloors.length).toBe(1);
    expect(rightBranchFloors.length).toBe(0);

    const leftLayer1 = edgeWidths(parsePoints(leftBranchFloors[0].getAttribute('points')));
    const leftNearXs = parsePoints(leftBranchFloors[0].getAttribute('points'))
      .filter((p) => Math.abs(p.y - leftLayer1.nearY) < 0.001)
      .map((p) => p.x);
    expect(Math.max(...leftNearXs)).toBeCloseTo(floor2NearLeft, 1);
    expect(leftLayer1.nearY).toBeCloseTo(floor2NearY, 0.5);
    expect(leftWallNearY).toBeCloseTo(floor2NearY, 0.1);
  });

  it('分岐ビュー forward=false は奥に1枚だけ前壁を描く', () => {
    const { container } = renderPreview('junction', {
      forward: false,
      left: true,
      right: true,
      backward: false,
    });

    const frontWalls = container.querySelectorAll('[data-wall-side="front"]');
    expect(frontWalls.length).toBe(1);
    const slices = new Set(Array.from(frontWalls).map((el) => el.getAttribute('data-slice')));
    expect(slices.has('3') || slices.has('4')).toBe(true);
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

  it('ゴールビューでも左右開放時は分岐用の切り欠きと横通路をjunctionと同じルールで描く', () => {
    const { container } = renderPreview('goal', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const leftSlice2Walls = container.querySelectorAll(
      '[data-layer="wall"][data-wall-side="left"][data-slice="2"]',
    );
    const rightSlice2Walls = container.querySelectorAll(
      '[data-layer="wall"][data-wall-side="right"][data-slice="2"]',
    );
    expect(leftSlice2Walls.length).toBe(0);
    expect(rightSlice2Walls.length).toBe(0);

    const floorSlice2 = container.querySelector('polygon[data-layer="floor"][data-slice="2"]');
    expect(floorSlice2).not.toBeNull();
    const floor2Points = parsePoints(floorSlice2?.getAttribute('points') ?? '');
    const floor2NearY = Math.max(...floor2Points.map((p) => p.y));

    const leftBranchFloors = container.querySelectorAll(
      'polygon[data-branch="left"][data-layer="floor"]',
    );
    const rightBranchFloors = container.querySelectorAll(
      'polygon[data-branch="right"][data-layer="floor"]',
    );
    expect(leftBranchFloors.length).toBe(1);
    expect(rightBranchFloors.length).toBe(1);
    const leftNearY = Math.max(
      ...parsePoints(leftBranchFloors[0].getAttribute('points')).map((p) => p.y),
    );
    const rightNearY = Math.max(
      ...parsePoints(rightBranchFloors[0].getAttribute('points')).map((p) => p.y),
    );
    expect(leftNearY).toBeCloseTo(floor2NearY, 0.01);
    expect(rightNearY).toBeCloseTo(floor2NearY, 0.01);

    const frontWall = container.querySelector('[data-wall-side="front"]');
    const portal = container.querySelector('[data-goal-portal="true"]');
    expect(frontWall).not.toBeNull();
    expect(portal).not.toBeNull();
  });

  it('ゴールビュー 左だけ開いている場合でも右側の壁は保たれる', () => {
    const { container } = renderPreview('goal', {
      forward: true,
      left: true,
      right: false,
      backward: false,
    });

    const rightSlice2Walls = container.querySelectorAll(
      '[data-layer="wall"][data-wall-side="right"][data-slice="2"]',
    );
    expect(rightSlice2Walls.length).toBe(1);
    expect(
      container.querySelectorAll('[data-layer="wall"][data-wall-side="left"][data-slice="2"]').length,
    ).toBe(0);

    const leftBranchFloors = Array.from(
      container.querySelectorAll('polygon[data-branch="left"][data-layer="floor"]'),
    );
    const rightBranchFloors = Array.from(
      container.querySelectorAll('polygon[data-branch="right"][data-layer="floor"]'),
    );
    expect(leftBranchFloors.length).toBe(1);
    expect(rightBranchFloors.length).toBe(0);

    const floorSlice2 = container.querySelector('polygon[data-layer="floor"][data-slice="2"]');
    expect(floorSlice2).not.toBeNull();
    const floor2Points = parsePoints(floorSlice2?.getAttribute('points') ?? '');
    const floor2NearY = Math.max(...floor2Points.map((p) => p.y));
    const floor2NearLeft = Math.min(
      ...floor2Points.filter((p) => Math.abs(p.y - floor2NearY) < 0.001).map((p) => p.x),
    );

    const leftLayer1 = edgeWidths(parsePoints(leftBranchFloors[0].getAttribute('points')));
    const leftNearXs = parsePoints(leftBranchFloors[0].getAttribute('points'))
      .filter((p) => Math.abs(p.y - leftLayer1.nearY) < 0.001)
      .map((p) => p.x);
    expect(Math.max(...leftNearXs)).toBeCloseTo(floor2NearLeft, 5);
    expect(leftLayer1.nearY).toBeCloseTo(floor2NearY, 0.5);

    const portal = container.querySelector('[data-goal-portal="true"]');
    expect(portal).not.toBeNull();
  });
});
