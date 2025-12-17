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
const BRANCH_ANCHOR_SLICE_INDEX = 1;
const BRANCH_ANCHOR_DEPTH = BRANCH_ANCHOR_SLICE_INDEX - 0.5;

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

function branchNearEdge(
  points: { x: number; y: number }[],
  side: 'left' | 'right',
): { nearInner: { x: number; y: number }; nearOuter: { x: number; y: number }; nearY: number } {
  const ys = points.map((p) => p.y);
  const nearY = Math.max(...ys);
  const nearPoints = points.filter((p) => Math.abs(p.y - nearY) < 0.001);
  const minXPoint = nearPoints.reduce((min, p) => (p.x < min.x ? p : min), nearPoints[0]);
  const maxXPoint = nearPoints.reduce((max, p) => (p.x > max.x ? p : max), nearPoints[0]);
  const nearInner = side === 'left' ? maxXPoint : minXPoint;
  const nearOuter = side === 'left' ? minXPoint : maxXPoint;
  return { nearInner, nearOuter, nearY };
}

function pointsAlmostEqual(
  a: { x: number; y: number }[] | null,
  b: { x: number; y: number }[] | null,
  tolerance = 0.01,
) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every(
    (p, i) => Math.abs(p.x - b[i].x) < tolerance && Math.abs(p.y - b[i].y) < tolerance,
  );
}

function stopAt(depth: number) {
  const t = depth / SLICE_COUNT;
  return {
    y: VIEW_FLOOR_Y + (VIEW_HORIZON_Y - VIEW_FLOOR_Y) * t,
    left: VIEW_FLOOR_NEAR_LEFT + (VIEW_FLOOR_FAR_LEFT - VIEW_FLOOR_NEAR_LEFT) * t,
    right: VIEW_FLOOR_NEAR_RIGHT + (VIEW_FLOOR_FAR_RIGHT - VIEW_FLOOR_NEAR_RIGHT) * t,
  };
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

  it('junctionビューではforward=falseでも前壁を描かず、暗転で閉塞を示しつつ左右開口を見せる', () => {
    const { container } = renderPreview('junction', {
      forward: false,
      left: true,
      right: true,
      backward: false,
    });

    expect(container.querySelector('[data-wall-side="front"]')).toBeNull();

    const cap = container.querySelector('[data-role="junction-forward-cap"]');
    expect(cap).not.toBeNull();

    expect(container.querySelector('[data-role="branch-floor-left"]')).not.toBeNull();
    expect(container.querySelector('[data-role="branch-floor-right"]')).not.toBeNull();

    // 左右のメイン壁は残しつつ、前方に壁がせり出さないことを確認する
    expect(
      container.querySelector('[data-layer="wall"][data-wall-side="left"][data-slice="2"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-layer="wall"][data-wall-side="right"][data-slice="2"]'),
    ).not.toBeNull();
  });

  it('junctionビューはメイン床の手前角からL字の分岐を伸ばし、分岐側のメイン壁に開口マスクを適用する', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const anchorStop = stopAt(BRANCH_ANCHOR_DEPTH);
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
    const leftNear = branchNearEdge(leftBranchPoints, 'left');
    const rightNear = branchNearEdge(rightBranchPoints, 'right');
    expect(leftNear.nearY).toBeCloseTo(anchorStop.y, 0.01);
    expect(rightNear.nearY).toBeCloseTo(anchorStop.y, 0.01);
    expect(leftNear.nearOuter.x).toBeLessThan(anchorStop.left);
    expect(leftNear.nearInner.x).toBeGreaterThan(anchorStop.left);
    expect(rightNear.nearOuter.x).toBeGreaterThan(anchorStop.right);
    expect(rightNear.nearInner.x).toBeLessThan(anchorStop.right);

    expect(
      container.querySelectorAll('[data-layer="wall"][data-wall-side="left"][data-slice="2"]')
        .length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('[data-layer="wall"][data-wall-side="right"][data-slice="2"]')
        .length,
    ).toBeGreaterThan(0);

    const leftMask = container.querySelector(
      'mask[data-junction-mask="true"][data-mask-side="left"]',
    );
    const rightMask = container.querySelector(
      'mask[data-junction-mask="true"][data-mask-side="right"]',
    );
    expect(leftMask).not.toBeNull();
    expect(rightMask).not.toBeNull();
    expect(leftMask?.getAttribute('id')).toBeTruthy();
    expect(rightMask?.getAttribute('id')).toBeTruthy();

    const leftWallGroup = container.querySelector('g[data-wall-group="left"]');
    const rightWallGroup = container.querySelector('g[data-wall-group="right"]');
    expect(leftWallGroup?.getAttribute('mask')).toBe(`url(#${leftMask?.id})`);
    expect(rightWallGroup?.getAttribute('mask')).toBe(`url(#${rightMask?.id})`);
    expect(leftWallGroup?.getAttribute('data-junction-wall-mask-applied')).toBe('true');
    expect(rightWallGroup?.getAttribute('data-junction-wall-mask-applied')).toBe('true');

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
    expect(leftInnerPoints[0]).toEqual(leftNear.nearInner);
    expect(rightInnerPoints[0]).toEqual(rightNear.nearInner);
  });

  it('junctionマスクは開口側の壁スライス形状に一致するポリゴンでくり抜く', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const collectWallPointsBySlice = (side: 'left' | 'right') => {
      return Array.from(
        container.querySelectorAll(`[data-layer="wall"][data-wall-side="${side}"][data-slice]`),
      ).reduce<Map<string, { x: number; y: number }[]>>((map, el) => {
        const sliceIndex = el.getAttribute('data-slice');
        if (sliceIndex) {
          map.set(sliceIndex, parsePoints(el.getAttribute('points')));
        }
        return map;
      }, new Map());
    };

    const assertMaskMatchesWallSlices = (side: 'left' | 'right') => {
      const wallPointsBySlice = collectWallPointsBySlice(side);
      const maskPolys = Array.from(
        container.querySelectorAll(
          `mask[data-junction-mask="true"][data-mask-side="${side}"] polygon[data-branch-wall-mask-slice]`,
        ),
      );
      expect(maskPolys.length).toBeGreaterThan(0);
      const sliceIndexes = new Set(maskPolys.map((p) => p.getAttribute('data-branch-wall-mask-slice')));
      expect(sliceIndexes.has('1')).toBe(true);

      maskPolys.forEach((poly) => {
        const sliceIndex = poly.getAttribute('data-branch-wall-mask-slice');
        expect(sliceIndex).toBeTruthy();
        const wallPoints = sliceIndex ? wallPointsBySlice.get(sliceIndex) : null;
        expect(wallPoints).toBeDefined();
        expect(pointsAlmostEqual(parsePoints(poly.getAttribute('points')), wallPoints ?? null)).toBe(
          true,
        );
      });
    };

    assertMaskMatchesWallSlices('left');
    assertMaskMatchesWallSlices('right');
  });

  it('junctionビューは開口スライスに沿ってbranch-opening-fillを描き、forward=falseでも残す', () => {
    const openings = { forward: true, left: true, right: true, backward: false };
    const { container } = renderPreview('junction', openings);

    const assertFillMatchesMask = (side: 'left' | 'right') => {
      const fills = Array.from(
        container.querySelectorAll(`[data-role="branch-opening-fill-${side}"]`),
      );
      expect(fills.length).toBeGreaterThan(0);

      const maskPolys = Array.from(
        container.querySelectorAll(
          `mask[data-junction-mask="true"][data-mask-side="${side}"] polygon[data-branch-wall-mask-slice]`,
        ),
      );
      expect(maskPolys.length).toBeGreaterThan(0);

      const fillSlices = new Set(fills.map((poly) => poly.getAttribute('data-open-slice')));
      const maskSlices = new Set(maskPolys.map((poly) => poly.getAttribute('data-branch-wall-mask-slice')));
      expect(fillSlices).toEqual(maskSlices);

      maskPolys.forEach((maskPoly) => {
        const sliceIndex = maskPoly.getAttribute('data-branch-wall-mask-slice');
        const fillPoly = fills.find((poly) => poly.getAttribute('data-open-slice') === sliceIndex);
        expect(fillPoly).toBeDefined();
        expect(
          pointsAlmostEqual(
            parsePoints(fillPoly?.getAttribute('points')),
            parsePoints(maskPoly.getAttribute('points')),
          ),
        ).toBe(true);
      });
    };

    assertFillMatchesMask('left');
    assertFillMatchesMask('right');

    const closed = renderPreview('junction', { ...openings, forward: false });
    expect(closed.container.querySelector('[data-role="junction-forward-cap"]')).not.toBeNull();
    expect(closed.container.querySelector('[data-role="branch-opening-fill-left"]')).not.toBeNull();
    expect(closed.container.querySelector('[data-role="branch-opening-fill-right"]')).not.toBeNull();
  });

  it('junctionビューは分岐床をメイン床とシームで繋ぎ、分岐壁にクリップを適用する', () => {
    const openings = { forward: true, left: true, right: true, backward: false };
    const { container } = renderPreview('junction', openings);
    const anchor = stopAt(BRANCH_ANCHOR_DEPTH);

    const assertSeam = (side: 'left' | 'right', anchorX: number) => {
      const seam = container.querySelector<SVGPolygonElement>(
        `[data-role="branch-floor-seam-${side}"]`,
      );
      expect(seam).not.toBeNull();
      const points = parsePoints(seam?.getAttribute('points'));
      expect(points.length).toBeGreaterThan(0);
      const nearY = Math.max(...points.map((p) => p.y));
      expect(Math.abs(nearY - anchor.y)).toBeLessThan(0.6);
      expect(
        points.some((p) => Math.abs(p.x - anchorX) < 0.6 && Math.abs(p.y - anchor.y) < 0.6),
      ).toBe(true);
    };

    assertSeam('left', anchor.left);
    assertSeam('right', anchor.right);

    const assertClip = (side: 'left' | 'right') => {
      const clip = container.querySelector(`clipPath[data-role="branch-clip-${side}"]`);
      expect(clip).not.toBeNull();
      const clipId = clip?.getAttribute('id');
      expect(clipId).toBeTruthy();

      const wallGroup = container.querySelector(`g[data-role="branch-walls-${side}"]`);
      expect(wallGroup).not.toBeNull();
      expect(wallGroup?.getAttribute('clip-path')).toBe(`url(#${clipId})`);
    };

    assertClip('left');
    assertClip('right');
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

    const anchorStop = stopAt(BRANCH_ANCHOR_DEPTH);
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

    const anchorStop = stopAt(BRANCH_ANCHOR_DEPTH);
    const leftPoints = parsePoints(leftBranchFloors[0].getAttribute('points'));
    const leftMetrics = branchMetrics(leftPoints);
    const leftNear = branchNearEdge(leftPoints, 'left');
    const anchorWidth = anchorStop.right - anchorStop.left;
    expect(leftMetrics.nearY).toBeCloseTo(anchorStop.y, 0.5);
    expect(leftMetrics.farY).toBeLessThan(leftMetrics.nearY);
    expect(leftNear.nearInner.x - anchorStop.left).toBeGreaterThan(anchorWidth * 0.08);
    expect(leftNear.nearInner.x - anchorStop.left).toBeLessThan(anchorWidth * 0.18);
    expect(anchorStop.left - leftNear.nearOuter.x).toBeGreaterThan(anchorWidth * 0.15);
    expect(anchorStop.left - leftNear.nearOuter.x).toBeLessThan(anchorWidth * 0.25);
    expect(anchorStop.left - leftMetrics.farMinX).toBeLessThan(anchorWidth * 0.45);
    expect(leftMetrics.ySpan).toBeLessThan((VIEW_FLOOR_Y - VIEW_HORIZON_Y) * 0.35);
    expect(leftMetrics.farMinX).toBeLessThan(leftMetrics.nearMinX);

    const portal = container.querySelector('[data-goal-portal="true"]');
    expect(portal).not.toBeNull();
  });

  it('分岐床のmouthはアンカー境界から内側へ押し込み、幅のある線分を作る', () => {
    const anchor = stopAt(BRANCH_ANCHOR_DEPTH);
    const anchorWidth = anchor.right - anchor.left;
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const assertInset = (side: 'left' | 'right', anchorX: number) => {
      const floor = container.querySelector<SVGPolygonElement>(`[data-role="branch-floor-${side}"]`);
      expect(floor).not.toBeNull();
      const edge = branchNearEdge(parsePoints(floor?.getAttribute('points')), side);
      const inset = Math.abs(edge.nearInner.x - anchorX);
      expect(Math.abs(edge.nearInner.y - anchor.y)).toBeLessThan(0.01);
      expect(Math.abs(edge.nearOuter.y - anchor.y)).toBeLessThan(0.01);
      expect(inset).toBeGreaterThan(1);
      expect(inset).toBeGreaterThan(anchorWidth * 0.08);
      expect(inset).toBeLessThan(anchorWidth * 0.18);
      if (side === 'left') {
        expect(edge.nearInner.x).toBeGreaterThan(anchorX);
        expect(edge.nearOuter.x).toBeLessThan(anchorX);
      } else {
        expect(edge.nearInner.x).toBeLessThan(anchorX);
        expect(edge.nearOuter.x).toBeGreaterThan(anchorX);
      }
    };

    assertInset('left', anchor.left);
    assertInset('right', anchor.right);
  });

  it('分岐床の手前端はアンカーライン上で幅を持ち、境界を跨いで分岐を開始する', () => {
    const anchor = stopAt(BRANCH_ANCHOR_DEPTH);
    const anchorWidth = anchor.right - anchor.left;
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

    const assertBranch = (
      points: { x: number; y: number }[],
      side: 'left' | 'right',
      anchorX: number,
    ) => {
      const metrics = branchMetrics(points);
      const near = branchNearEdge(points, side);
      expect(metrics.nearY).toBeGreaterThanOrEqual(anchor.y - 0.6);
      expect(metrics.nearY).toBeLessThanOrEqual(anchor.y + 0.6);
      expect(metrics.farY).toBeLessThan(metrics.nearY);
      expect((near.nearInner.x - anchorX) * (near.nearOuter.x - anchorX)).toBeLessThan(0);
      const inset = Math.abs(near.nearInner.x - anchorX);
      expect(inset).toBeGreaterThan(anchorWidth * 0.08);
      expect(inset).toBeLessThan(anchorWidth * 0.18);
      const mouthSpan = Math.abs(near.nearOuter.x - near.nearInner.x);
      expect(mouthSpan).toBeGreaterThan(anchorWidth * 0.25);
    };

    assertBranch(parsePoints(leftBranch?.getAttribute('points')), 'left', anchor.left);
    assertBranch(parsePoints(rightBranch?.getAttribute('points')), 'right', anchor.right);
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

    const anchor = stopAt(BRANCH_ANCHOR_DEPTH);
    const maxYSpan = (VIEW_FLOOR_Y - VIEW_HORIZON_Y) * 0.35;
    const anchorWidth = anchor.right - anchor.left;

    const assertBranch = (selector: string, anchorEdge: number, side: 'left' | 'right') => {
      const poly = container.querySelector<SVGPolygonElement>(selector);
      expect(poly).not.toBeNull();
      const points = parsePoints(poly?.getAttribute('points'));
      const metrics = branchMetrics(points);
      const near = branchNearEdge(points, side);
      expect(metrics.nearY).toBeGreaterThanOrEqual(anchor.y - 0.01);
      expect(metrics.nearY).toBeCloseTo(anchor.y, 0.6);
      expect(metrics.farY).toBeLessThan(metrics.nearY);
      expect(metrics.ySpan).toBeLessThan(maxYSpan);
      expect((near.nearInner.x - anchorEdge) * (near.nearOuter.x - anchorEdge)).toBeLessThan(0);

      const inset = Math.abs(near.nearInner.x - anchorEdge);
      expect(inset).toBeGreaterThan(anchorWidth * 0.08);

      if (side === 'left') {
        expect(anchorEdge - near.nearOuter.x).toBeGreaterThan(anchorWidth * 0.15);
        expect(anchorEdge - metrics.farMinX).toBeLessThan(anchorWidth * 0.5);
        expect(metrics.farMinX).toBeLessThan(near.nearOuter.x);
      } else {
        expect(near.nearOuter.x - anchorEdge).toBeGreaterThan(anchorWidth * 0.15);
        expect(metrics.farMaxX - anchorEdge).toBeLessThan(anchorWidth * 0.5);
        expect(metrics.farMaxX).toBeGreaterThan(near.nearOuter.x);
      }
    };

    assertBranch('[data-role="branch-floor-left"]', anchor.left, 'left');
    assertBranch('[data-role="branch-floor-right"]', anchor.right, 'right');
  });

  it('分岐壁の根元はmouth位置に揃い、床と連続して奥へ伸びる', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const leftInnerWall = container.querySelector<SVGPolygonElement>(
      '[data-role="branch-wall-left-inner"]',
    );
    const rightInnerWall = container.querySelector<SVGPolygonElement>(
      '[data-role="branch-wall-right-inner"]',
    );
    const leftOuterWall = container.querySelector<SVGPolygonElement>(
      '[data-role="branch-wall-left-outer"]',
    );
    const rightOuterWall = container.querySelector<SVGPolygonElement>(
      '[data-role="branch-wall-right-outer"]',
    );
    const leftFloor = container.querySelector<SVGPolygonElement>('[data-role="branch-floor-left"]');
    const rightFloor = container.querySelector<SVGPolygonElement>('[data-role="branch-floor-right"]');
    expect(leftInnerWall).not.toBeNull();
    expect(rightInnerWall).not.toBeNull();
    expect(leftOuterWall).not.toBeNull();
    expect(rightOuterWall).not.toBeNull();
    expect(leftFloor).not.toBeNull();
    expect(rightFloor).not.toBeNull();

    const leftNear = branchNearEdge(parsePoints(leftFloor?.getAttribute('points')), 'left');
    const rightNear = branchNearEdge(parsePoints(rightFloor?.getAttribute('points')), 'right');

    const assertWall = (points: { x: number; y: number }[], expectedBase: { x: number; y: number }) => {
      expect(points.length).toBeGreaterThan(0);
      const baseY = Math.max(...points.map((p) => p.y));
      const baseXs = points.filter((p) => Math.abs(p.y - baseY) < 0.001).map((p) => p.x);
      expect(Math.abs(baseY - expectedBase.y)).toBeLessThanOrEqual(0.3);
      expect(baseXs.some((x) => Math.abs(x - expectedBase.x) < 0.6)).toBe(true);
      expect(Math.min(...points.map((p) => p.y))).toBeLessThan(baseY);
    };

    assertWall(parsePoints(leftInnerWall?.getAttribute('points')), leftNear.nearInner);
    assertWall(parsePoints(rightInnerWall?.getAttribute('points')), rightNear.nearInner);
    assertWall(parsePoints(leftOuterWall?.getAttribute('points')), leftNear.nearOuter);
    assertWall(parsePoints(rightOuterWall?.getAttribute('points')), rightNear.nearOuter);
  });
});
