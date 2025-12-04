import type { Direction, MazePreviewVariant } from './PlayerView';
import type { ServerMazeCell } from '../state/sessionStore';

type Openings = {
  forward: boolean;
  left: boolean;
  right: boolean;
  backward: boolean;
};

const WIDTH = 320;
const HEIGHT = 180;
const SLICE_COUNT = 4;

const FLOOR_NEAR_Y = HEIGHT * 0.95;
const FLOOR_VANISH_Y = HEIGHT * 0.32;
const VANISH_POINT = { x: WIDTH / 2, y: FLOOR_VANISH_Y };
const FLOOR_NEAR_WIDTH = WIDTH * 0.82;
const FLOOR_FAR_WIDTH = WIDTH * 0.35;

const COLOR_BG = '#050608';
const COLOR_FLOOR_BASE = '#70757d';
const COLOR_FLOOR_FAR = '#3a3d44';
const COLOR_FLOOR_LINE = '#d8c6aa';
const COLOR_WALL = '#8a5f3f';
const COLOR_WALL_FAR = '#3c2417';
const COLOR_WALL_LINE = '#e6d4bd';
const COLOR_PORTAL = '#d7ecff';
const COLOR_PORTAL_FRAME = '#8ba8c5';

type SliceStop = {
  y: number;
  left: number;
  right: number;
};

type SliceGeometry = {
  index: number;
  near: SliceStop;
  far: SliceStop;
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixColor(base: string, overlay: string, t: number): string {
  const toRgb = (hex: string) =>
    hex
      .replace('#', '')
      .match(/.{1,2}/g)
      ?.map((v) => parseInt(v, 16)) ?? [];
  const [r1, g1, b1] = toRgb(base);
  const [r2, g2, b2] = toRgb(overlay);
  const r = Math.round(lerp(r1, r2, t));
  const g = Math.round(lerp(g1, g2, t));
  const b = Math.round(lerp(b1, b2, t));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function joinPoints(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

function buildSliceStops(): SliceStop[] {
  const stops: SliceStop[] = [];
  for (let i = 0; i <= SLICE_COUNT; i += 1) {
    const t = i / SLICE_COUNT;
    const y = lerp(FLOOR_NEAR_Y, FLOOR_VANISH_Y, t);
    const width = lerp(FLOOR_NEAR_WIDTH, FLOOR_FAR_WIDTH, t);
    const left = VANISH_POINT.x - width / 2;
    const right = VANISH_POINT.x + width / 2;
    stops.push({ y, left, right });
  }
  return stops;
}

function buildSliceGeometries(stops: SliceStop[]): SliceGeometry[] {
  const slices: SliceGeometry[] = [];
  for (let i = 1; i <= SLICE_COUNT; i += 1) {
    slices.push({
      index: i,
      near: stops[i - 1],
      far: stops[i],
    });
  }
  return slices;
}

function renderFloorSlices(slices: SliceGeometry[]): string {
  const parts: string[] = [];
  slices.forEach((slice) => {
    const t = slice.index / SLICE_COUNT;
    const fill = mixColor(COLOR_FLOOR_BASE, COLOR_FLOOR_FAR, t * 0.9);
    const points = [
      { x: slice.near.left, y: slice.near.y },
      { x: slice.near.right, y: slice.near.y },
      { x: slice.far.right, y: slice.far.y },
      { x: slice.far.left, y: slice.far.y },
    ];
    parts.push(
      `<polygon data-layer="floor" data-slice="${slice.index}" points="${joinPoints(points)}" fill="${fill}" />`,
    );

    const guideCount = 3 + slice.index;
    for (let i = 1; i < guideCount; i += 1) {
      const u = i / guideCount;
      const x = lerp(slice.near.left, slice.near.right, u);
      parts.push(
        `<line data-floor-guide="true" data-slice="${slice.index}" x1="${x}" y1="${slice.near.y}" x2="${VANISH_POINT.x}" y2="${VANISH_POINT.y}" stroke="${COLOR_FLOOR_LINE}" stroke-width="${Math.max(0.6, 1 - slice.index * 0.15)}" stroke-opacity="${0.32 - slice.index * 0.04}" />`,
      );
    }
  });

  // 4マス先は真っ黒で塗りつぶす
  parts.push(
    `<rect data-horizon="true" x="${VANISH_POINT.x - FLOOR_FAR_WIDTH / 2}" y="0" width="${FLOOR_FAR_WIDTH}" height="${FLOOR_VANISH_Y}" fill="${COLOR_BG}" />`,
  );
  return parts.join('\n');
}

function renderWallSlice(side: 'left' | 'right', slice: SliceGeometry): string {
  const nearX = side === 'left' ? slice.near.left : slice.near.right;
  const farX = side === 'left' ? slice.far.left : slice.far.right;
  const fill = mixColor(
    side === 'left' ? COLOR_WALL : COLOR_WALL_FAR,
    '#000000',
    slice.index * 0.05,
  );
  const brickRows = 2 + slice.index;

  const wallPolygon = `<polygon data-layer="wall" data-wall-side="${side}" data-slice="${slice.index}" data-brick-rows="${brickRows}" points="${joinPoints(
    [
      { x: nearX, y: slice.near.y },
      { x: farX, y: slice.far.y },
      { x: farX, y: 0 },
      { x: nearX, y: 0 },
    ],
  )}" fill="${fill}" fill-opacity="${0.92 - slice.index * 0.05}" />`;

  const lines: string[] = [];
  for (let row = 1; row <= brickRows; row += 1) {
    const v = row / (brickRows + 1);
    const yLeft = lerp(slice.near.y, 0, v);
    const yRight = lerp(slice.far.y, 0, v);
    lines.push(
      `<line data-brick-row="${row}" data-wall-side="${side}" data-slice="${slice.index}" x1="${nearX}" y1="${yLeft}" x2="${farX}" y2="${yRight}" stroke="${COLOR_WALL_LINE}" stroke-opacity="${0.28 - slice.index * 0.03}" stroke-width="0.9" />`,
    );
  }

  return [wallPolygon, ...lines].join('\n');
}

function renderCorridorWalls(
  slices: SliceGeometry[],
  variant?: MazePreviewVariant,
  openings?: Openings,
): string {
  const parts: string[] = [];
  slices.forEach((slice) => {
    const isBranchingVariant = variant === 'junction' || variant === 'goal';
    const skipLeft = isBranchingVariant && openings?.left && slice.index === 2;
    const skipRight = isBranchingVariant && openings?.right && slice.index === 2;

    if (!skipLeft) {
      parts.push(renderWallSlice('left', slice));
    }
    if (!skipRight) {
      parts.push(renderWallSlice('right', slice));
    }
  });
  return parts.join('\n');
}

function renderFrontWall(
  stops: SliceStop[],
  sliceIndex: number,
  variant: MazePreviewVariant,
): string {
  const stop = stops[sliceIndex];
  const baseColor =
    variant === 'goal'
      ? COLOR_PORTAL_FRAME
      : mixColor(COLOR_WALL_FAR, COLOR_BG, variant === 'junction' ? 0.25 : 0.15);
  const points = [
    { x: stop.left, y: 0 },
    { x: stop.right, y: 0 },
    { x: stop.right, y: stop.y },
    { x: stop.left, y: stop.y },
  ];
  return `<polygon data-layer="wall" data-wall-side="front" data-slice="${sliceIndex}" points="${joinPoints(
    points,
  )}" fill="${baseColor}" />`;
}

function renderGoalPortal(stop: SliceStop): string {
  const width = (stop.right - stop.left) * 0.45;
  const left = (stop.left + stop.right) / 2 - width / 2;
  const top = stop.y * 0.12;
  const height = stop.y - top * 1.1;
  return `<rect data-goal-portal="true" x="${left}" y="${top}" width="${width}" height="${height}" fill="${COLOR_PORTAL}" stroke="${COLOR_PORTAL_FRAME}" stroke-width="3" />`;
}

function renderFloorGradient(): string {
  return `
    <defs>
      <linearGradient id="corridor-floor-grad" x1="0" y1="${FLOOR_NEAR_Y}" x2="0" y2="${FLOOR_VANISH_Y}">
        <stop offset="0%" stop-color="${COLOR_FLOOR_BASE}" />
      <stop offset="100%" stop-color="${COLOR_FLOOR_FAR}" />
    </linearGradient>
    </defs>`;
}

// junction / goal 分岐: slice2 の床ラインを基準に、メイン通路の壁1枚分を切り取り、
// その穴に横方向へ90度に曲がる短い通路（床＋左右の壁）をはめ込む。
// 床は本線と同じグリッドで、奥に行くほど狭く・高くなるように台形で構成する。
function renderSideBranch(side: 'left' | 'right', slices: SliceGeometry[]): string {
  const isLeft = side === 'left';
  const dir = isLeft ? -1 : 1;

  const anchorSlice = slices[1];
  const anchorY = anchorSlice.near.y;
  const anchorX = isLeft ? anchorSlice.near.left : anchorSlice.near.right;

  const mainWidth = anchorSlice.near.right - anchorSlice.near.left;
  const widthNear = mainWidth * 0.6;
  const widthFar = widthNear * 0.7;
  const depth = 28;

  const nearInner = { x: anchorX, y: anchorY };
  const nearOuter = { x: anchorX + dir * widthNear, y: anchorY };
  const farY = anchorY - depth;
  const farInner = { x: anchorX + dir * 10, y: farY };
  const farOuter = { x: farInner.x + dir * widthFar, y: farY };

  // 1. 分岐床（メイン床と同じグレーグラデーション）
  const floorPoints = [nearInner, nearOuter, farOuter, farInner];
  const floorSvg = `<polygon data-branch="${side}" data-layer="floor"
    points="${joinPoints(floorPoints)}" fill="url(#corridor-floor-grad)" />`;

  // 2. 内側の壁（本線との境界側）: 床の端から天井まで
  const innerWallPoints = [nearInner, farInner, { x: farInner.x, y: 0 }, { x: nearInner.x, y: 0 }];
  const innerWallSvg = `<polygon data-branch-wall="${side}" data-branch-position="inner"
    points="${joinPoints(innerWallPoints)}" fill="${COLOR_WALL}" />`;

  // 3. 外側の壁（横通路外側）: 床の端から天井まで
  const outerWallPoints = [nearOuter, farOuter, { x: farOuter.x, y: 0 }, { x: nearOuter.x, y: 0 }];
  const outerWallSvg = `<polygon data-branch-wall="${side}" data-branch-position="outer"
    points="${joinPoints(outerWallPoints)}" fill="${COLOR_WALL}" fill-opacity="0.9" />`;

  return [floorSvg, innerWallSvg, outerWallSvg].join('\n');
}

function renderView(
  variant: MazePreviewVariant,
  openings: Openings,
  slices: SliceGeometry[],
  stops: SliceStop[],
): string {
  const parts: string[] = [];
  parts.push(renderFloorGradient());
  parts.push(renderFloorSlices(slices));
  parts.push(renderCorridorWalls(slices, variant, openings));

  if (variant === 'junction' || variant === 'goal') {
    // junction / goal 分岐: slice2 の床ラインから壁を1枚だけ抜き、横方向への短い通路をL字に挿し込む。
    if (openings.left) parts.push(renderSideBranch('left', slices));
    if (openings.right) parts.push(renderSideBranch('right', slices));
  }

  if (variant === 'junction') {
    if (!openings.forward) {
      parts.push(renderFrontWall(stops, 3, variant));
    }
  } else if (variant === 'goal') {
    parts.push(renderFrontWall(stops, 4, variant));
    parts.push(renderGoalPortal(stops[4]));
  } else {
    if (!openings.forward) {
      parts.push(renderFrontWall(stops, 3, variant));
    }
  }

  return parts.join('\n');
}

export function createFancyMazePreviewSvg(
  _cell: ServerMazeCell,
  _openDirections: Direction[],
  variant: MazePreviewVariant,
  orientation: Direction,
  openings: Openings,
): string {
  const stops = buildSliceStops();
  const slices = buildSliceGeometries(stops);
  const groupAttrs = [
    `data-view-tilt="0.00"`,
    `data-forward-open="${openings.forward}"`,
    `data-left-open="${openings.left}"`,
    `data-right-open="${openings.right}"`,
    `data-back-open="${openings.backward}"`,
    `data-facing="${orientation}"`,
    `data-preview-style="fancy"`,
  ].join(' ');

  const content = renderView(variant, openings, slices, stops);

  return `
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${COLOR_BG}" />
      <g ${groupAttrs}>
        ${content}
      </g>
    </svg>
  `;
}
