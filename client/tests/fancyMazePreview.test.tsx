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
    expect(container.querySelectorAll('[data-overlay="junction-mask-left"]').length).toBe(1);
    expect(container.querySelectorAll('[data-overlay="junction-mask-right"]').length).toBe(1);

    const leftSlice2Walls = container.querySelectorAll(
      '[data-layer="wall"][data-wall-side="left"][data-slice="2"]',
    );
    const rightSlice2Walls = container.querySelectorAll(
      '[data-layer="wall"][data-wall-side="right"][data-slice="2"]',
    );
    expect(leftSlice2Walls.length).toBe(1);
    expect(rightSlice2Walls.length).toBe(1);

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

    const leftBranchFloors = Array.from(
      container.querySelectorAll('polygon[data-branch="left"][data-layer="floor"]'),
    );
    const rightBranchFloors = Array.from(
      container.querySelectorAll('polygon[data-branch="right"][data-layer="floor"]'),
    );
    expect(leftBranchFloors.length).toBe(1);
    expect(rightBranchFloors.length).toBe(1);

    const leftFloorPoints = parsePoints(leftBranchFloors[0].getAttribute('points'));
    const leftEdges = edgeWidths(leftFloorPoints);
    expect(leftEdges.nearWidth).toBeGreaterThan(leftEdges.farWidth);
    expect(leftEdges.farY).toBeLessThan(leftEdges.nearY);
    expect(leftEdges.nearY).toBeCloseTo(floor2NearY, 0.5);
    const leftNearXs = leftFloorPoints
      .filter((p) => Math.abs(p.y - leftEdges.nearY) < 0.001)
      .map((p) => p.x);
    expect(Math.max(...leftNearXs)).toBeCloseTo(floor2NearLeft, 1);
    const leftFarXs = leftFloorPoints
      .filter((p) => Math.abs(p.y - leftEdges.farY) < 0.001)
      .map((p) => p.x);
    expect(Math.max(...leftFarXs)).toBeLessThan(Math.max(...leftNearXs));

    const rightFloorPoints = parsePoints(rightBranchFloors[0].getAttribute('points'));
    const rightEdges = edgeWidths(rightFloorPoints);
    expect(rightEdges.nearWidth).toBeGreaterThan(rightEdges.farWidth);
    expect(rightEdges.farY).toBeLessThan(rightEdges.nearY);
    expect(rightEdges.nearY).toBeCloseTo(floor2NearY, 0.5);
    const rightNearXs = rightFloorPoints
      .filter((p) => Math.abs(p.y - rightEdges.nearY) < 0.001)
      .map((p) => p.x);
    expect(Math.min(...rightNearXs)).toBeCloseTo(floor2NearRight, 1);
    const rightFarXs = rightFloorPoints
      .filter((p) => Math.abs(p.y - rightEdges.farY) < 0.001)
      .map((p) => p.x);
    expect(Math.min(...rightFarXs)).toBeGreaterThan(Math.min(...rightNearXs));

    const leftMask = container.querySelector('[data-overlay="junction-mask-left"]');
    const rightMask = container.querySelector('[data-overlay="junction-mask-right"]');
    expect(leftMask).not.toBeNull();
    expect(rightMask).not.toBeNull();
    const leftMaskYs = parsePoints(leftMask?.getAttribute('points') ?? '').map((p) => p.y);
    const rightMaskYs = parsePoints(rightMask?.getAttribute('points') ?? '').map((p) => p.y);
    const leftMaskXs = parsePoints(leftMask?.getAttribute('points') ?? '').map((p) => p.x);
    const rightMaskXs = parsePoints(rightMask?.getAttribute('points') ?? '').map((p) => p.x);
    expect(Math.max(...leftMaskYs)).toBeCloseTo(floor2NearY, 0.1);
    expect(Math.max(...rightMaskYs)).toBeCloseTo(floor2NearY, 0.1);
    expect(Math.min(...leftMaskYs)).toBe(0);
    expect(Math.min(...rightMaskYs)).toBe(0);
    const leftWallXs = parsePoints(leftSlice2Walls[0].getAttribute('points')).map((p) => p.x);
    const rightWallXs = parsePoints(rightSlice2Walls[0].getAttribute('points')).map((p) => p.x);
    const leftMaskWidth = Math.max(...leftMaskXs) - Math.min(...leftMaskXs);
    const rightMaskWidth = Math.max(...rightMaskXs) - Math.min(...rightMaskXs);
    const leftWallWidth = Math.max(...leftWallXs) - Math.min(...leftWallXs);
    const rightWallWidth = Math.max(...rightWallXs) - Math.min(...rightWallXs);
    expect(leftMaskWidth).toBeCloseTo(leftWallWidth, 0.5);
    expect(rightMaskWidth).toBeCloseTo(rightWallWidth, 0.5);

    const branchWallsLeft = Array.from(container.querySelectorAll('[data-branch-wall="left"]'));
    const branchWallsRight = Array.from(container.querySelectorAll('[data-branch-wall="right"]'));
    expect(branchWallsLeft.length).toBeGreaterThan(0);
    expect(branchWallsRight.length).toBeGreaterThan(0);

    const leftGuides = Array.from(container.querySelectorAll('line[data-branch-guide="left"]'));
    const rightGuides = Array.from(container.querySelectorAll('line[data-branch-guide="right"]'));
    const leftVanishXs = new Set(leftGuides.map((line) => Number(line.getAttribute('x2'))));
    const leftVanishYs = new Set(leftGuides.map((line) => Number(line.getAttribute('y2'))));
    const rightVanishXs = new Set(rightGuides.map((line) => Number(line.getAttribute('x2'))));
    const rightVanishYs = new Set(rightGuides.map((line) => Number(line.getAttribute('y2'))));
    expect(leftVanishXs.size).toBe(1);
    expect(leftVanishYs.size).toBe(1);
    expect(rightVanishXs.size).toBe(1);
    expect(rightVanishYs.size).toBe(1);
  });

  it('分岐ビュー 左開放の切り欠きはslice2の壁幅いっぱいに揃い、枝通路の壁も同じ床ラインから立ち上がる', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: false,
      backward: false,
    });

    const leftWallSlice2 = container.querySelector(
      '[data-layer="wall"][data-wall-side="left"][data-slice="2"]',
    );
    const leftMask = container.querySelector('[data-overlay="junction-mask-left"]');
    const branchInnerWall = container.querySelector(
      '[data-branch-wall="left"][data-branch-position="inner"]',
    );
    expect(leftWallSlice2).not.toBeNull();
    expect(leftMask).not.toBeNull();
    expect(branchInnerWall).not.toBeNull();

    const wallPoints = parsePoints(leftWallSlice2?.getAttribute('points') ?? null);
    const wallNearY = Math.max(...wallPoints.map((p) => p.y));
    const wallFarY = Math.min(...wallPoints.map((p) => p.y));
    const wallNearX = wallPoints.find((p) => Math.abs(p.y - wallNearY) < 0.01)?.x ?? 0;
    const wallFarX = wallPoints.find((p) => Math.abs(p.y - wallFarY) < 0.01)?.x ?? 0;

    const maskPoints = parsePoints(leftMask?.getAttribute('points') ?? '');
    const maskXs = maskPoints.map((p) => p.x);
    const maskYs = maskPoints.map((p) => p.y);
    expect(Math.max(...maskYs)).toBeCloseTo(wallNearY, 0.1);
    expect(Math.min(...maskYs)).toBe(0);
    expect(maskXs.some((x) => Math.abs(x - wallNearX) < 0.2)).toBe(true);
    expect(maskXs.some((x) => Math.abs(x - wallFarX) < 0.2)).toBe(true);

    const branchPoints = parsePoints(branchInnerWall?.getAttribute('points') ?? null);
    const branchNearY = Math.max(...branchPoints.map((p) => p.y));
    const branchNearXs = branchPoints
      .filter((p) => Math.abs(p.y - branchNearY) < 0.001)
      .map((p) => p.x);
    expect(branchNearY).toBeCloseTo(wallNearY, 0.1);
    expect(branchNearXs.some((x) => Math.abs(x - wallNearX) < 0.5)).toBe(true);
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
    const dy = Math.abs(farY - nearY);
    expect(dx).toBeGreaterThan(dy * 1.4);
    expect(farCenterX).toBeLessThan(nearCenterX);

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

    expect(container.querySelectorAll('[data-overlay="branch-cut-right"]').length).toBe(0);
    expect(container.querySelectorAll('[data-overlay="junction-mask-right"]').length).toBe(0);
    expect(
      container.querySelectorAll('[data-layer="wall"][data-wall-side="right"][data-slice="2"]').length,
    ).toBe(1);

    const floorSlice2 = container.querySelector('polygon[data-layer="floor"][data-slice="2"]');
    expect(floorSlice2).not.toBeNull();
    const floor2Points = parsePoints(floorSlice2?.getAttribute('points') ?? '');
    const floor2NearY = Math.max(...floor2Points.map((p) => p.y));
    const floor2NearLeft = Math.min(
      ...floor2Points.filter((p) => Math.abs(p.y - floor2NearY) < 0.001).map((p) => p.x),
    );

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
    expect(leftSlice2Walls.length).toBe(1);
    expect(rightSlice2Walls.length).toBe(1);

    const leftMask = container.querySelector('[data-overlay="junction-mask-left"]');
    const rightMask = container.querySelector('[data-overlay="junction-mask-right"]');
    expect(leftMask).not.toBeNull();
    expect(rightMask).not.toBeNull();

    const floorSlice2 = container.querySelector('polygon[data-layer="floor"][data-slice="2"]');
    expect(floorSlice2).not.toBeNull();
    const floor2Points = parsePoints(floorSlice2?.getAttribute('points') ?? '');
    const floor2NearY = Math.max(...floor2Points.map((p) => p.y));
    const leftMaskYs = parsePoints(leftMask?.getAttribute('points') ?? '').map((p) => p.y);
    const rightMaskYs = parsePoints(rightMask?.getAttribute('points') ?? '').map((p) => p.y);
    expect(Math.max(...leftMaskYs)).toBeCloseTo(floor2NearY, 0.1);
    expect(Math.max(...rightMaskYs)).toBeCloseTo(floor2NearY, 0.1);

    const leftBranchFloors = container.querySelectorAll(
      'polygon[data-branch="left"][data-layer="floor"]',
    );
    const rightBranchFloors = container.querySelectorAll(
      'polygon[data-branch="right"][data-layer="floor"]',
    );
    expect(leftBranchFloors.length).toBe(1);
    expect(rightBranchFloors.length).toBe(1);

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

    expect(container.querySelectorAll('[data-overlay="branch-cut-right"]').length).toBe(0);
    expect(container.querySelectorAll('[data-overlay="junction-mask-right"]').length).toBe(0);

    const rightSlice2Walls = container.querySelectorAll(
      '[data-layer="wall"][data-wall-side="right"][data-slice="2"]',
    );
    expect(rightSlice2Walls.length).toBe(1);

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
