import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createFancyMazePreviewSvg } from '../src/views/FancyMazePreview';
import type { Direction, MazePreviewVariant } from '../src/views/PlayerView';
import type { ServerMazeCell } from '../src/state/sessionStore';

const dummyCell = {} as ServerMazeCell;
const dummyDirections: Direction[] = [];

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 180;
const SLICE_COUNT = 4;
const VIEW_FLOOR_Y = VIEW_HEIGHT - 10;
const VIEW_HORIZON_Y = VIEW_HEIGHT * 0.35;
const VIEW_FLOOR_NEAR_LEFT = 40;
const VIEW_FLOOR_NEAR_RIGHT = VIEW_WIDTH - 40;
const VIEW_FLOOR_FAR_LEFT = VIEW_WIDTH * 0.5 - 60;
const VIEW_FLOOR_FAR_RIGHT = VIEW_WIDTH * 0.5 + 60;
const BRANCH_ANCHOR_SLICE_INDEX = 2;

function renderPreview(
  variant: MazePreviewVariant,
  openings: Parameters<typeof createFancyMazePreviewSvg>[4],
) {
  const svg = createFancyMazePreviewSvg(dummyCell, dummyDirections, variant, 'north', openings);
  return render(<div dangerouslySetInnerHTML={{ __html: svg }} />);
}

function parsePoints(pointsAttr: string | null | undefined) {
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

function branchMetrics(points: { x: number; y: number }[]) {
  const ys = points.map((p) => p.y);
  const nearY = Math.max(...ys);
  const farY = Math.min(...ys);
  const nearXs = points.filter((p) => Math.abs(p.y - nearY) < 0.001).map((p) => p.x);
  const farXs = points.filter((p) => Math.abs(p.y - farY) < 0.001).map((p) => p.x);
  return {
    nearY,
    farY,
    nearMinX: Math.min(...nearXs),
    nearMaxX: Math.max(...nearXs),
    farMinX: Math.min(...farXs),
    farMaxX: Math.max(...farXs),
    ySpan: nearY - farY,
  };
}

function buildSliceStops() {
  const stops: { y: number; left: number; right: number }[] = [];
  for (let i = 0; i <= SLICE_COUNT; i += 1) {
    const t = i / SLICE_COUNT;
    stops.push({
      y: VIEW_FLOOR_Y + (VIEW_HORIZON_Y - VIEW_FLOOR_Y) * t,
      left: VIEW_FLOOR_NEAR_LEFT + (VIEW_FLOOR_FAR_LEFT - VIEW_FLOOR_NEAR_LEFT) * t,
      right: VIEW_FLOOR_NEAR_RIGHT + (VIEW_FLOOR_FAR_RIGHT - VIEW_FLOOR_NEAR_RIGHT) * t,
    });
  }
  return stops;
}

describe('FancyMazePreview', () => {
  it('4枚の床スライスが奥ほど狭くなり、収束点を共有する', () => {
    const { container } = renderPreview('start', {
      forward: true,
      left: false,
      right: false,
      backward: false,
    });

    const floors = Array.from(
      container.querySelectorAll('polygon[data-layer="floor"][data-slice]'),
    );
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

  it('メイン床ポリゴンは視点基準の定数から生成される', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const mainFloor = container.querySelector('polygon[data-role="main-floor"]');
    expect(mainFloor).not.toBeNull();
    const points = parsePoints(mainFloor?.getAttribute('points'));
    expect(points[0]).toEqual({ x: VIEW_FLOOR_NEAR_LEFT, y: VIEW_FLOOR_Y });
    expect(points[1]).toEqual({ x: VIEW_FLOOR_NEAR_RIGHT, y: VIEW_FLOOR_Y });
    expect(points[2].x).toBeCloseTo(VIEW_FLOOR_FAR_RIGHT, 0.01);
    expect(points[2].y).toBeCloseTo(VIEW_HORIZON_Y, 0.01);
    expect(points[3].x).toBeCloseTo(VIEW_FLOOR_FAR_LEFT, 0.01);
    expect(points[3].y).toBeCloseTo(VIEW_HORIZON_Y, 0.01);
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

  it('junctionビューはメイン床の手前角からL字の分岐を伸ばし、分岐側のメイン壁を外す', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const anchorStop = buildSliceStops()[BRANCH_ANCHOR_SLICE_INDEX];
    const leftBranchFloor = container.querySelector(
      'polygon[data-branch="left"][data-layer="floor"]',
    );
    const rightBranchFloor = container.querySelector(
      'polygon[data-branch="right"][data-layer="floor"]',
    );
    expect(leftBranchFloor).not.toBeNull();
    expect(rightBranchFloor).not.toBeNull();

    const leftBranchPoints = parsePoints(leftBranchFloor?.getAttribute('points'));
    const rightBranchPoints = parsePoints(rightBranchFloor?.getAttribute('points'));
    const leftNearY = Math.max(...leftBranchPoints.map((p) => p.y));
    const rightNearY = Math.max(...rightBranchPoints.map((p) => p.y));
    expect(leftNearY).toBeCloseTo(anchorStop.y, 0.01);
    expect(rightNearY).toBeCloseTo(anchorStop.y, 0.01);
    expect(leftBranchPoints).toContainEqual({ x: anchorStop.left, y: anchorStop.y });
    expect(rightBranchPoints).toContainEqual({ x: anchorStop.right, y: anchorStop.y });

    expect(
      container.querySelectorAll('[data-layer="wall"][data-wall-side="left"][data-slice="2"]')
        .length,
    ).toBe(0);
    expect(
      container.querySelectorAll('[data-layer="wall"][data-wall-side="right"][data-slice="2"]')
        .length,
    ).toBe(0);

    const leftInnerWall = container.querySelector(
      '[data-branch-wall="left"][data-branch-position="inner"]',
    );
    const rightInnerWall = container.querySelector(
      '[data-branch-wall="right"][data-branch-position="inner"]',
    );
    expect(leftInnerWall).not.toBeNull();
    expect(rightInnerWall).not.toBeNull();

    const leftInnerPoints = parsePoints(leftInnerWall?.getAttribute('points'));
    const rightInnerPoints = parsePoints(rightInnerWall?.getAttribute('points'));
    expect(leftInnerPoints[0]).toEqual({ x: anchorStop.left, y: anchorStop.y });
    expect(rightInnerPoints[0]).toEqual({ x: anchorStop.right, y: anchorStop.y });
  });

  it('junctionビューにデバッグ用data属性と役割ラベルを付与する', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    expect(container.querySelector('[data-debug-junction="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-role="main-floor"]').length).toBe(1);
    expect(container.querySelectorAll('[data-role="main-wall-left"]').length).toBe(1);
    expect(container.querySelectorAll('[data-role="main-wall-right"]').length).toBe(1);
    expect(container.querySelectorAll('[data-role="branch-floor-left"]').length).toBe(1);
    expect(container.querySelectorAll('[data-role="branch-floor-right"]').length).toBe(1);
    expect(container.querySelectorAll('[data-role="branch-wall-left-inner"]').length).toBe(1);
    expect(container.querySelectorAll('[data-role="branch-wall-right-inner"]').length).toBe(1);
  });

  it('分岐ビューはopeningsに応じて片側だけ枝通路を描画する', () => {
    const leftOnly = renderPreview('junction', {
      forward: true,
      left: true,
      right: false,
      backward: false,
    });
    expect(leftOnly.container.querySelector('polygon[data-branch="left"]')).not.toBeNull();
    expect(leftOnly.container.querySelector('[data-branch-wall="left"]')).not.toBeNull();
    expect(leftOnly.container.querySelector('polygon[data-branch="right"]')).toBeNull();
    expect(leftOnly.container.querySelector('[data-branch-wall="right"]')).toBeNull();

    const rightOnly = renderPreview('junction', {
      forward: true,
      left: false,
      right: true,
      backward: false,
    });
    expect(rightOnly.container.querySelector('polygon[data-branch="right"]')).not.toBeNull();
    expect(rightOnly.container.querySelector('[data-branch-wall="right"]')).not.toBeNull();
    expect(rightOnly.container.querySelector('polygon[data-branch="left"]')).toBeNull();
    expect(rightOnly.container.querySelector('[data-branch-wall="left"]')).toBeNull();
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

  it('ゴールビューでも左右開放時は分岐とポータルを同時に描画する', () => {
    const { container } = renderPreview('goal', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const leftBranchFloors = container.querySelectorAll(
      'polygon[data-branch="left"][data-layer="floor"]',
    );
    const rightBranchFloors = container.querySelectorAll(
      'polygon[data-branch="right"][data-layer="floor"]',
    );
    expect(leftBranchFloors.length).toBe(1);
    expect(rightBranchFloors.length).toBe(1);

    const leftSlice2Walls = container.querySelectorAll(
      '[data-layer="wall"][data-wall-side="left"][data-slice="2"]',
    );
    const rightSlice2Walls = container.querySelectorAll(
      '[data-layer="wall"][data-wall-side="right"][data-slice="2"]',
    );
    expect(leftSlice2Walls.length).toBe(1);
    expect(rightSlice2Walls.length).toBe(1);

    const anchorStop = buildSliceStops()[BRANCH_ANCHOR_SLICE_INDEX];
    const leftNearY = Math.max(
      ...parsePoints(leftBranchFloors[0].getAttribute('points')).map((p) => p.y),
    );
    const rightNearY = Math.max(
      ...parsePoints(rightBranchFloors[0].getAttribute('points')).map((p) => p.y),
    );
    expect(leftNearY).toBeCloseTo(anchorStop.y, 0.01);
    expect(rightNearY).toBeCloseTo(anchorStop.y, 0.01);

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
    ).toBe(1);

    const leftBranchFloors = Array.from(
      container.querySelectorAll('polygon[data-branch="left"][data-layer="floor"]'),
    );
    const rightBranchFloors = Array.from(
      container.querySelectorAll('polygon[data-branch="right"][data-layer="floor"]'),
    );
    expect(leftBranchFloors.length).toBe(1);
    expect(rightBranchFloors.length).toBe(0);

    const anchorStop = buildSliceStops()[BRANCH_ANCHOR_SLICE_INDEX];
    const leftMetrics = branchMetrics(parsePoints(leftBranchFloors[0].getAttribute('points')));
    const anchorWidth = anchorStop.right - anchorStop.left;
    expect(leftMetrics.nearY).toBeCloseTo(anchorStop.y, 0.5);
    expect(leftMetrics.farY).toBeLessThan(leftMetrics.nearY);
    expect(leftMetrics.nearMaxX).toBeCloseTo(anchorStop.left, 1);
    expect(anchorStop.left - leftMetrics.nearMinX).toBeLessThan(anchorWidth * 0.35);
    expect(anchorStop.left - leftMetrics.farMinX).toBeLessThan(anchorWidth * 0.45);
    expect(leftMetrics.ySpan).toBeLessThan((VIEW_FLOOR_Y - VIEW_HORIZON_Y) * 0.35);
    expect(leftMetrics.farMinX).toBeLessThan(leftMetrics.nearMinX);

    const portal = container.querySelector('[data-goal-portal="true"]');
    expect(portal).not.toBeNull();
  });

  it('分岐床の手前端はスライス2の床ラインに揃い、壁の内側から連続する', () => {
    const stops = buildSliceStops();
    const anchor = stops[BRANCH_ANCHOR_SLICE_INDEX];
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const leftBranch = container.querySelector<SVGPolygonElement>('[data-role="branch-floor-left"]');
    const rightBranch = container.querySelector<SVGPolygonElement>(
      '[data-role="branch-floor-right"]',
    );
    expect(leftBranch).not.toBeNull();
    expect(rightBranch).not.toBeNull();

    const checkBranch = (points: { x: number; y: number }[], anchorX: number) => {
      expect(points.length).toBeGreaterThan(0);
      const nearY = Math.max(...points.map((p) => p.y));
      const farY = Math.min(...points.map((p) => p.y));
      const nearXs = points.filter((p) => Math.abs(p.y - nearY) < 0.001).map((p) => p.x);
      expect(nearY).toBeCloseTo(anchor.y, 0.5);
      const maxNearX = Math.max(...nearXs);
      const minNearX = Math.min(...nearXs);
      const expectedInner = anchorX < VIEW_WIDTH / 2 ? maxNearX : minNearX;
      expect(expectedInner).toBeCloseTo(anchorX, 0.5);
      expect(points.some((p) => Math.abs(p.x - anchorX) < 0.5 && Math.abs(p.y - anchor.y) < 0.5)).toBe(
        true,
      );
      expect(farY).toBeLessThan(nearY);
    };

    checkBranch(parsePoints(leftBranch?.getAttribute('points')), anchor.left);
    checkBranch(parsePoints(rightBranch?.getAttribute('points')), anchor.right);
  });

  it('分岐床は壁より後ろで描画され、壁が手前で床を隠せるDOM順になっている', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const leftBranchFloor = container.querySelector('[data-role="branch-floor-left"]');
    const rightBranchFloor = container.querySelector('[data-role="branch-floor-right"]');
    const leftMainWall = container.querySelector('[data-role="main-wall-left"]');
    const rightMainWall = container.querySelector('[data-role="main-wall-right"]');
    const leftBranchWall = container.querySelector('[data-role="branch-wall-left-inner"]');
    const rightBranchWall = container.querySelector('[data-role="branch-wall-right-inner"]');
    expect(leftBranchFloor).not.toBeNull();
    expect(rightBranchFloor).not.toBeNull();
    expect(leftMainWall).not.toBeNull();
    expect(rightMainWall).not.toBeNull();
    expect(leftBranchWall).not.toBeNull();
    expect(rightBranchWall).not.toBeNull();

    const assertBefore = (floor: Element, wall: Element) => {
      const position = floor.compareDocumentPosition(wall);
      // 壁が手前に来るよう、床要素が先に描画されていることを確認する
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      expect(position & Node.DOCUMENT_POSITION_PRECEDING).toBe(0);
    };

    assertBefore(leftBranchFloor!, leftMainWall!);
    assertBefore(rightBranchFloor!, rightMainWall!);
    assertBefore(leftBranchFloor!, leftBranchWall!);
    assertBefore(rightBranchFloor!, rightBranchWall!);
  });

  it('分岐床はアンカーより手前に出ず、奥側でわずかに外へ逃げる', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const anchor = buildSliceStops()[BRANCH_ANCHOR_SLICE_INDEX];
    const maxYSpan = (VIEW_FLOOR_Y - VIEW_HORIZON_Y) * 0.35;
    const anchorWidth = anchor.right - anchor.left;

    const assertBranch = (selector: string, anchorEdge: number, side: 'left' | 'right') => {
      const poly = container.querySelector<SVGPolygonElement>(selector);
      expect(poly).not.toBeNull();
      const metrics = branchMetrics(parsePoints(poly?.getAttribute('points')));
      expect(metrics.nearY).toBeGreaterThanOrEqual(anchor.y - 0.01);
      expect(metrics.nearY).toBeCloseTo(anchor.y, 0.6);
      expect(metrics.farY).toBeLessThan(metrics.nearY);
      expect(metrics.ySpan).toBeLessThan(maxYSpan);

      if (side === 'left') {
        expect(anchorEdge - metrics.nearMaxX).toBeLessThan(1.5);
        expect(anchorEdge - metrics.nearMinX).toBeLessThan(anchorWidth * 0.35);
        expect(anchorEdge - metrics.farMinX).toBeLessThan(anchorWidth * 0.45);
        expect(metrics.farMinX).toBeLessThan(metrics.nearMinX);
      } else {
        expect(metrics.nearMinX - anchorEdge).toBeLessThan(1.5);
        expect(metrics.nearMaxX - anchorEdge).toBeLessThan(anchorWidth * 0.35);
        expect(metrics.farMaxX - anchorEdge).toBeLessThan(anchorWidth * 0.45);
        expect(metrics.farMaxX).toBeGreaterThan(metrics.nearMaxX);
      }
    };

    assertBranch('[data-role="branch-floor-left"]', anchor.left, 'left');
    assertBranch('[data-role="branch-floor-right"]', anchor.right, 'right');
  });

  it('分岐壁は枝位置から奥に向かってのみ伸び、手前のメイン通路に食い込まない', () => {
    const stops = buildSliceStops();
    const anchor = stops[BRANCH_ANCHOR_SLICE_INDEX];
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const leftWall = container.querySelector<SVGPolygonElement>(
      '[data-role="branch-wall-left-inner"]',
    );
    const rightWall = container.querySelector<SVGPolygonElement>(
      '[data-role="branch-wall-right-inner"]',
    );
    expect(leftWall).not.toBeNull();
    expect(rightWall).not.toBeNull();

    const assertWall = (points: { x: number; y: number }[], anchorX: number) => {
      expect(points.length).toBeGreaterThan(0);
      const baseY = Math.max(...points.map((p) => p.y));
      expect(baseY).toBeCloseTo(anchor.y, 0.5);
      expect(points).toContainEqual({ x: anchorX, y: anchor.y });
      expect(Math.min(...points.map((p) => p.y))).toBeLessThan(baseY);
    };

    assertWall(parsePoints(leftWall?.getAttribute('points')), anchor.left);
    assertWall(parsePoints(rightWall?.getAttribute('points')), anchor.right);
  });
});
