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
const COLOR_BRANCH_FLOOR_BASE = COLOR_FLOOR_BASE;
const COLOR_BRANCH_FLOOR_DARK = COLOR_FLOOR_FAR;
const COLOR_BRANCH_WALL = '#744c32';
const COLOR_BRANCH_GUIDE = '#c6b59b';
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

type BranchAnchor = {
  anchorY: number;
  anchorFarY: number;
  anchorXLeft: number;
  anchorXRight: number;
  anchorFarLeft: number;
  anchorFarRight: number;
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

// junction/goal の左右分岐:
// slice2 の床ライン(anchorY)を入口とし、左右 90 度に曲がる横通路を
// グレーの床＋左右の壁で描画する。
// 分岐側では slice2 の本線側面壁を描かず、穴の中を分岐通路の床と壁で完全に埋める。
function renderSideBranch(side: 'left' | 'right', slices: SliceGeometry[]): string {
  const anchorSlice = slices[1];
  const anchorY = anchorSlice.near.y;
  const isLeft = side === 'left';
  const dir = isLeft ? -1 : 1;
  const anchorX = isLeft ? anchorSlice.near.left : anchorSlice.near.right;

  const mainWidth = anchorSlice.near.right - anchorSlice.near.left;
  const floorNearWidth = mainWidth * 0.65;
  const floorFarWidth = floorNearWidth * 0.7;
  const depth = 28;

  const nearInner = { x: anchorX, y: anchorY };
  const nearOuter = { x: anchorX + dir * floorNearWidth, y: anchorY };
  const farY = anchorY - depth;
  const farInner = { x: anchorX + dir * 18, y: farY };
  const farOuter = { x: farInner.x + dir * floorFarWidth, y: farY };

  const floorPoints = [nearInner, nearOuter, farOuter, farInner];
  const gradientId = `branch-floor-gradient-${side}`;
  const floorGradient = `
    <defs>
      <linearGradient id="${gradientId}" x1="0" y1="${anchorY}" x2="0" y2="${farY}">
        <stop offset="0%" stop-color="${COLOR_BRANCH_FLOOR_BASE}" />
        <stop offset="100%" stop-color="${COLOR_BRANCH_FLOOR_DARK}" />
      </linearGradient>
    </defs>`;
  const floorSvg = `${floorGradient}
    <polygon data-branch="${side}" data-layer="floor" points="${joinPoints(
      floorPoints,
    )}" fill="url(#${gradientId})" />`;

  const innerWallPoints = [
    { x: nearInner.x, y: anchorY },
    { x: farInner.x, y: farY },
    { x: farInner.x, y: 0 },
    { x: nearInner.x, y: 0 },
  ];
  const innerWallSvg = `<polygon data-branch-wall="${side}" data-branch-position="inner" points="${joinPoints(
    innerWallPoints,
  )}" fill="${COLOR_BRANCH_WALL}" />`;

  const outerWallPoints = [
    { x: nearOuter.x, y: anchorY },
    { x: farOuter.x, y: farY },
    { x: farOuter.x, y: 0 },
    { x: nearOuter.x, y: 0 },
  ];
  const outerWallSvg = `<polygon data-branch-wall="${side}" data-branch-position="outer" points="${joinPoints(
    outerWallPoints,
  )}" fill="${COLOR_BRANCH_WALL}" fill-opacity="0.85" />`;

  const guideTarget = { x: isLeft ? -80 : WIDTH + 80, y: farY - 8 };
  const guideStarts = [nearInner, nearOuter];
  const guides = guideStarts.map(
    (start, idx) =>
      `<line data-branch-guide="${side}" data-guide-index="${idx}" x1="${start.x}" y1="${start.y}" x2="${guideTarget.x}" y2="${guideTarget.y}" stroke="${COLOR_BRANCH_GUIDE}" stroke-opacity="0.32" stroke-width="0.9" />`,
  );

  return [floorSvg, innerWallSvg, outerWallSvg, ...guides].join('\n');
}

function renderView(
  variant: MazePreviewVariant,
  openings: Openings,
  slices: SliceGeometry[],
  stops: SliceStop[],
): string {
  const parts: string[] = [];
  parts.push(renderFloorSlices(slices));
  parts.push(renderCorridorWalls(slices, variant, openings));

  // junction/goal の左右分岐を本線床・壁の後に配置し、前壁より手前に描く。
  // openings.* 側では slice2 の本線側面壁を省き、分岐通路で穴を埋める。
  const anchorSlice = slices[1];
  const anchor: BranchAnchor = {
    anchorY: anchorSlice.near.y,
    anchorFarY: anchorSlice.far.y,
    anchorXLeft: anchorSlice.near.left,
    anchorXRight: anchorSlice.near.right,
    anchorFarLeft: anchorSlice.far.left,
    anchorFarRight: anchorSlice.far.right,
  };
  const branchMasks: string[] = [];
  const branchSections: string[] = [];
  if (variant === 'junction' || variant === 'goal') {
    // openings.* が true の側だけ slice2 の壁 1 枚ぶんを消し、その穴に横通路を差し込む
    if (openings.left) {
      branchMasks.push(
        `<polygon data-overlay="junction-mask-left" points="${joinPoints([
          { x: anchor.anchorXLeft, y: anchor.anchorY },
          { x: anchor.anchorFarLeft, y: anchor.anchorFarY },
          { x: anchor.anchorFarLeft, y: 0 },
          { x: anchor.anchorXLeft, y: 0 },
        ])}" fill="none" />`,
      );
    }
    if (openings.right) {
      branchMasks.push(
        `<polygon data-overlay="junction-mask-right" points="${joinPoints([
          { x: anchor.anchorFarRight, y: anchor.anchorFarY },
          { x: anchor.anchorXRight, y: anchor.anchorY },
          { x: anchor.anchorXRight, y: 0 },
          { x: anchor.anchorFarRight, y: 0 },
        ])}" fill="none" />`,
      );
    }
    if (openings.left) {
      branchSections.push(renderSideBranch('left', slices));
    }
    if (openings.right) {
      branchSections.push(renderSideBranch('right', slices));
    }
  }
  parts.push(...branchSections);

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
  parts.push(...branchMasks);

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
