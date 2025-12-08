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

// カメラと床・地平線の基準位置（全variant共通）
const VIEW_FLOOR_Y = HEIGHT - 10; // 手前床のy
const VIEW_HORIZON_Y = HEIGHT * 0.35; // 地平線（奥の床が接するy）
const VIEW_FLOOR_NEAR_LEFT = 40;
const VIEW_FLOOR_NEAR_RIGHT = WIDTH - 40;
const VIEW_FLOOR_FAR_LEFT = WIDTH * 0.5 - 60;
const VIEW_FLOOR_FAR_RIGHT = WIDTH * 0.5 + 60;

const FLOOR_NEAR_Y = VIEW_FLOOR_Y;
const FLOOR_VANISH_Y = VIEW_HORIZON_Y;
const VANISH_POINT = { x: WIDTH / 2, y: VIEW_HORIZON_Y };
const FLOOR_FAR_WIDTH = VIEW_FLOOR_FAR_RIGHT - VIEW_FLOOR_FAR_LEFT;
const CORRIDOR_NEAR_WIDTH = VIEW_FLOOR_NEAR_RIGHT - VIEW_FLOOR_NEAR_LEFT;
const CORRIDOR_FAR_WIDTH = VIEW_FLOOR_FAR_RIGHT - VIEW_FLOOR_FAR_LEFT;
const VIEW_CENTER_X = WIDTH / 2;

const COLOR_BG = '#050608';
const COLOR_FLOOR_BASE = '#70757d';
const COLOR_FLOOR_FAR = '#3a3d44';
const COLOR_FLOOR_LINE = '#d8c6aa';
const COLOR_WALL = '#8a5f3f';
const COLOR_WALL_FAR = '#3c2417';
const COLOR_WALL_LINE = '#e6d4bd';
const COLOR_PORTAL = '#d7ecff';
const COLOR_PORTAL_FRAME = '#8ba8c5';
const BRANCH_ANCHOR_SLICE_INDEX = 2;

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

type FloorCorners = {
  nearLeft: { x: number; y: number };
  nearRight: { x: number; y: number };
  farLeft: { x: number; y: number };
  farRight: { x: number; y: number };
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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

function projectFloorPoint(x: number, depth: number): { x: number; y: number } {
  const t = clamp(depth / SLICE_COUNT, 0, 1);
  const width = lerp(CORRIDOR_NEAR_WIDTH, CORRIDOR_FAR_WIDTH, t);
  return {
    x: VIEW_CENTER_X + x * width,
    y: lerp(FLOOR_NEAR_Y, FLOOR_VANISH_Y, t),
  };
}

function corridorStopAt(depth: number): SliceStop {
  const left = projectFloorPoint(-0.5, depth);
  const right = projectFloorPoint(0.5, depth);
  return { y: left.y, left: left.x, right: right.x };
}

function getMainFloorCorners(): FloorCorners {
  const near = corridorStopAt(0);
  const far = corridorStopAt(SLICE_COUNT);
  return {
    nearLeft: { x: near.left, y: near.y },
    nearRight: { x: near.right, y: near.y },
    farRight: { x: far.right, y: far.y },
    farLeft: { x: far.left, y: far.y },
  };
}

function buildSliceStops(): SliceStop[] {
  const stops: SliceStop[] = [];
  for (let i = 0; i <= SLICE_COUNT; i += 1) {
    stops.push(corridorStopAt(i));
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
      `<polygon data-layer="floor" data-slice="${slice.index}" points="${joinPoints(
        points,
      )}" fill="${fill}" />`,
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

function renderWallSlice(side: 'left' | 'right', slice: SliceGeometry, dataRole?: string): string {
  const nearX = side === 'left' ? slice.near.left : slice.near.right;
  const farX = side === 'left' ? slice.far.left : slice.far.right;
  const fill = mixColor(
    side === 'left' ? COLOR_WALL : COLOR_WALL_FAR,
    '#000000',
    slice.index * 0.05,
  );
  const brickRows = 2 + slice.index;
  const roleAttr = dataRole ? ` data-role="${dataRole}"` : '';

  const wallPolygon = `<polygon data-layer="wall" data-wall-side="${side}" data-slice="${slice.index}" data-brick-rows="${brickRows}" points="${joinPoints(
    [
      { x: nearX, y: slice.near.y },
      { x: farX, y: slice.far.y },
      { x: farX, y: 0 },
      { x: nearX, y: 0 },
    ],
  )}"${roleAttr} fill="${fill}" fill-opacity="${0.92 - slice.index * 0.05}" />`;

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
    const i = slice.index;
    const skipLeft = variant === 'junction' && openings?.left && i === BRANCH_ANCHOR_SLICE_INDEX;
    const skipRight = variant === 'junction' && openings?.right && i === BRANCH_ANCHOR_SLICE_INDEX;
    const markMainWall = i === 1;

    if (!skipLeft) {
      parts.push(renderWallSlice('left', slice, markMainWall ? 'main-wall-left' : undefined));
    }
    if (!skipRight) {
      parts.push(renderWallSlice('right', slice, markMainWall ? 'main-wall-right' : undefined));
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

function renderMainFloor(mainFloor: FloorCorners): string {
  const mainFloorPoints = [
    { x: mainFloor.nearLeft.x, y: mainFloor.nearLeft.y },
    { x: mainFloor.nearRight.x, y: mainFloor.nearRight.y },
    { x: mainFloor.farRight.x, y: mainFloor.farRight.y },
    { x: mainFloor.farLeft.x, y: mainFloor.farLeft.y },
  ];
  return `<polygon data-layer="floor" data-role="main-floor" points="${joinPoints(
    mainFloorPoints,
  )}" fill="url(#corridor-floor-grad)" />`;
}

type BranchParts = {
  floor: string;
  innerWall: string;
  outerWall: string;
};

const BRANCH_WORLD_WIDTH = 1; // メイン通路1本分の幅で横に伸ばす
const BRANCH_WORLD_LENGTH = 1.35; // 奥行き（深さ）
const BRANCH_TAPER = 0.15; // 遠くでやや細く見せるためのオフセット

// junction / goal 分岐: メイン床の手前角から横方向にL字で伸ばす。
function renderSideBranch(side: 'left' | 'right', anchorDepth: number): BranchParts {
  const isLeft = side === 'left';
  const nearDepth = anchorDepth;
  const farDepth = Math.min(SLICE_COUNT, anchorDepth + BRANCH_WORLD_LENGTH);
  const anchorX = isLeft ? -0.5 : 0.5;
  const outerX = isLeft ? anchorX - BRANCH_WORLD_WIDTH : anchorX + BRANCH_WORLD_WIDTH;
  const taper = isLeft ? -BRANCH_TAPER : BRANCH_TAPER;

  const branchNearInner = projectFloorPoint(anchorX, nearDepth);
  const branchNearOuter = projectFloorPoint(outerX, nearDepth);
  const branchFarInner = projectFloorPoint(anchorX + taper, farDepth);
  const branchFarOuter = projectFloorPoint(outerX + taper, farDepth);

  // 1. 分岐床（メイン床と同じグレーグラデーション）
  const floorPoints = [branchNearInner, branchNearOuter, branchFarOuter, branchFarInner];
  const floorSvg = `<polygon data-branch="${side}" data-layer="floor" data-role="branch-floor-${side}"
    points="${joinPoints(floorPoints)}" fill="url(#corridor-floor-grad)" />`;

  // 2. 内側の壁（本線との境界側）: 床の端から天井まで
  const innerWallPoints = [
    branchNearInner,
    branchFarInner,
    { x: branchFarInner.x, y: 0 },
    { x: branchNearInner.x, y: 0 },
  ];
  const innerWallSvg = `<polygon data-branch-wall="${side}" data-branch-position="inner" data-role="branch-wall-${side}-inner"
    points="${joinPoints(innerWallPoints)}" fill="${COLOR_WALL}" />`;

  // 3. 外側の壁（横通路外側）: 床の端から天井まで
  const outerWallPoints = [
    branchNearOuter,
    branchFarOuter,
    { x: branchFarOuter.x, y: 0 },
    { x: branchNearOuter.x, y: 0 },
  ];
  const outerWallSvg = `<polygon data-branch-wall="${side}" data-branch-position="outer" data-role="branch-wall-${side}-outer"
    points="${joinPoints(outerWallPoints)}" fill="${COLOR_WALL}" fill-opacity="0.9" />`;

  return { floor: floorSvg, innerWall: innerWallSvg, outerWall: outerWallSvg };
}

function buildBranchParts(
  openings: Openings,
  anchorDepth: number,
): { floors: string[]; walls: string[] } {
  const floors: string[] = [];
  const walls: string[] = [];

  if (openings.left) {
    const left = renderSideBranch('left', anchorDepth);
    floors.push(left.floor);
    walls.push(left.innerWall, left.outerWall);
  }
  if (openings.right) {
    const right = renderSideBranch('right', anchorDepth);
    floors.push(right.floor);
    walls.push(right.innerWall, right.outerWall);
  }

  return { floors, walls };
}

function renderStartView(
  openings: Openings,
  slices: SliceGeometry[],
  stops: SliceStop[],
  mainFloor: FloorCorners,
): string {
  const parts: string[] = [];
  parts.push(renderMainFloor(mainFloor));
  parts.push(renderFloorSlices(slices));
  parts.push(renderCorridorWalls(slices, 'start', openings));

  if (!openings.forward) {
    parts.push(renderFrontWall(stops, 3, 'start'));
  }

  return parts.join('\n');
}

function renderJunctionView(
  openings: Openings,
  slices: SliceGeometry[],
  stops: SliceStop[],
  mainFloor: FloorCorners,
): string {
  const parts: string[] = [];
  const branchParts = buildBranchParts(openings, BRANCH_ANCHOR_SLICE_INDEX);

  // 1. 床（メイン通路）
  parts.push(renderMainFloor(mainFloor));
  parts.push(renderFloorSlices(slices));
  // 2. メイン左右壁
  parts.push(renderCorridorWalls(slices, 'junction', openings));
  // 3. 左右分岐（床）
  parts.push(...branchParts.floors);
  // 4. 左右分岐（壁）
  parts.push(...branchParts.walls);
  // 5. 正面奥の壁（必要なら）
  if (!openings.forward) {
    parts.push(renderFrontWall(stops, 3, 'junction'));
  }

  return parts.join('\n');
}

function renderGoalView(
  openings: Openings,
  slices: SliceGeometry[],
  stops: SliceStop[],
  mainFloor: FloorCorners,
): string {
  const parts: string[] = [];
  const branchParts = buildBranchParts(openings, BRANCH_ANCHOR_SLICE_INDEX);

  parts.push(renderMainFloor(mainFloor));
  parts.push(renderFloorSlices(slices));
  parts.push(renderCorridorWalls(slices, 'goal', openings));
  parts.push(...branchParts.floors);
  parts.push(...branchParts.walls);
  parts.push(renderFrontWall(stops, 4, 'goal'));
  parts.push(renderGoalPortal(stops[4]));
  return parts.join('\n');
}

function renderView(
  variant: MazePreviewVariant,
  openings: Openings,
  slices: SliceGeometry[],
  stops: SliceStop[],
  mainFloor: FloorCorners,
): string {
  const parts: string[] = [];
  parts.push(renderFloorGradient());

  if (variant === 'junction') {
    parts.push(renderJunctionView(openings, slices, stops, mainFloor));
  } else if (variant === 'goal') {
    parts.push(renderGoalView(openings, slices, stops, mainFloor));
  } else {
    parts.push(renderStartView(openings, slices, stops, mainFloor));
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
  const mainFloor = getMainFloorCorners();
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

  const content = renderView(variant, openings, slices, stops, mainFloor);

  return `
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${COLOR_BG}" />
      <g ${groupAttrs}${variant === 'junction' ? ' data-debug-junction="true"' : ''}>
        ${content}
      </g>
    </svg>
  `;
}
