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

function splitNearAndFarEdges(points: { x: number; y: number }[]) {
  const ys = points.map((p) => p.y);
  const nearY = Math.max(...ys);
  const farY = Math.min(...ys);
  const nearEdge = points.filter((p) => Math.abs(p.y - nearY) < 0.001);
  const farEdge = points.filter((p) => Math.abs(p.y - farY) < 0.001);
  return { nearEdge, farEdge, nearY, farY };
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

  it('床オーバーレイは段差が見えないほど薄い', () => {
    const { container } = renderPreview('start', {
      forward: true,
      left: false,
      right: false,
      backward: false,
    });

    const overlays = Array.from(container.querySelectorAll('polygon[data-floor="overlay"]'));
    overlays.forEach((poly) => {
      const opacity = Number(poly.getAttribute('fill-opacity') ?? '1');
      expect(opacity).toBeLessThanOrEqual(0.03);
    });
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

  it('前景の壁オーバーレイは極薄か描かれない', () => {
    const { container } = renderPreview('goal', {
      forward: true,
      left: false,
      right: false,
      backward: false,
    });

    const fgWalls = Array.from(container.querySelectorAll('polygon[data-wall-layer="foreground"]'));
    fgWalls.forEach((poly) => {
      const opacity = Number(poly.getAttribute('fill-opacity') ?? '1');
      expect(opacity).toBeLessThanOrEqual(0.05);
    });
  });

  it('左右分岐の床は奥ほど狭くなり、奥側がさらに側方へ伸びる', () => {
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
      expect(farLeft).toBeLessThan(nearLeft);
    });
  });

  it('分岐の床ポリゴンは入口と奥行きを示す最小限の枚数に抑える', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const leftFloors = container.querySelectorAll('polygon[data-branch-floor="left"]');
    const rightFloors = container.querySelectorAll('polygon[data-branch-floor="right"]');
    expect(leftFloors.length).toBeLessThanOrEqual(2);
    expect(rightFloors.length).toBeLessThanOrEqual(2);
  });

  it('左右分岐の床は壁の開口部から横方向へ伸び、奥に行くほど狭く高くなる', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const leftFloor = container.querySelector('polygon[data-branch-floor="left"]');
    const rightFloor = container.querySelector('polygon[data-branch-floor="right"]');
    expect(leftFloor).not.toBeNull();
    expect(rightFloor).not.toBeNull();

    const leftEdges = splitNearAndFarEdges(parsePoints(leftFloor?.getAttribute('points') ?? null));
    const rightEdges = splitNearAndFarEdges(parsePoints(rightFloor?.getAttribute('points') ?? null));

    const leftNearWidth =
      Math.max(...leftEdges.nearEdge.map((p) => p.x)) - Math.min(...leftEdges.nearEdge.map((p) => p.x));
    const leftFarWidth =
      Math.max(...leftEdges.farEdge.map((p) => p.x)) - Math.min(...leftEdges.farEdge.map((p) => p.x));
    expect(leftFarWidth).toBeLessThan(leftNearWidth);
    expect(Math.min(...leftEdges.farEdge.map((p) => p.x))).toBeLessThan(
      Math.min(...leftEdges.nearEdge.map((p) => p.x)),
    );
    expect(leftEdges.farY).toBeLessThan(leftEdges.nearY);

    const rightNearWidth =
      Math.max(...rightEdges.nearEdge.map((p) => p.x)) - Math.min(...rightEdges.nearEdge.map((p) => p.x));
    const rightFarWidth =
      Math.max(...rightEdges.farEdge.map((p) => p.x)) - Math.min(...rightEdges.farEdge.map((p) => p.x));
    expect(rightFarWidth).toBeLessThan(rightNearWidth);
    expect(Math.max(...rightEdges.farEdge.map((p) => p.x))).toBeGreaterThan(
      Math.max(...rightEdges.nearEdge.map((p) => p.x)),
    );
    expect(rightEdges.farY).toBeLessThan(rightEdges.nearY);
  });

  it('左右分岐には壁が縦長の開口部として切り欠かれている', () => {
    const { container } = renderPreview('junction', {
      forward: true,
      left: true,
      right: true,
      backward: false,
    });

    const openings = Array.from(container.querySelectorAll('polygon[data-branch-entry]'));
    expect(openings.length).toBe(2);

    openings.forEach((poly) => {
      const pts = parsePoints(poly.getAttribute('points'));
      expect(pts.length).toBeGreaterThanOrEqual(4);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);
      expect(width).toBeGreaterThan(12);
      expect(height).toBeGreaterThan(12);
    });
  });
});
