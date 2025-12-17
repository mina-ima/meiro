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
const COLOR_BRANCH_OPENING_FILL = mixColor(COLOR_BG, COLOR_WALL_FAR, 0.3);
const BRANCH_ANCHOR_SLICE_INDEX = 1;
const BRANCH_ANCHOR_DEPTH = BRANCH_ANCHOR_SLICE_INDEX - 0.5; // 手前スライスの前半から分岐を開始し、柱を含めて開口する
const BRANCH_DEPTH_DELTA = 0.65; // アンカーから奥へ浅く伸ばし、slice2付近に限定する
const BRANCH_NEAR_SPAN = 0.2; // アンカー位置で見せる横幅（通路幅に対する比率）
const BRANCH_FAR_EXTRA_SPAN = 0.1; // 奥側でわずかに広げる
const BRANCH_MOUTH_INSET = 0.12; // 分岐口を通路内側へ少し食い込ませる（アンカー幅比）
const BRANCH_INNER_TAPER = 0.04; // 奥側でほんの少し内側へ寄せ、“コの字”の奥行きを見せる
const BRANCH_FAR_LATERAL_SHIFT = 10; // 遠方でわずかに外へ寄せて“横通路”感を出す

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
  _variant?: MazePreviewVariant,
  _openings?: Openings,
  wallMasks?: Partial<Record<'left' | 'right', string>>,
): string {
  const leftParts: string[] = [];
  const rightParts: string[] = [];
  slices.forEach((slice) => {
    const markMainWall = slice.index === 1;

    leftParts.push(renderWallSlice('left', slice, markMainWall ? 'main-wall-left' : undefined));
    rightParts.push(renderWallSlice('right', slice, markMainWall ? 'main-wall-right' : undefined));
  });

  const wrapWithMask = (side: 'left' | 'right', elements: string[]) => {
    if (!elements.length) return '';
    const maskId = wallMasks?.[side];
    const maskAttr = maskId ? ` mask="url(#${maskId})"` : '';
    const groupAttrs = [
      `data-wall-group="${side}"`,
      maskId ? 'data-junction-wall-mask-applied="true"' : null,
      maskId ? `data-wall-mask-id="${maskId}"` : null,
    ]
      .filter(Boolean)
      .join(' ');
    return `<g ${groupAttrs}${maskAttr}>${elements.join('\n')}</g>`;
  };

  return [wrapWithMask('left', leftParts), wrapWithMask('right', rightParts)]
    .filter(Boolean)
    .join('\n');
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

function renderJunctionForwardCap(stop: SliceStop): string {
  const width = stop.right - stop.left;
  return `<rect data-role="junction-forward-cap" x="${stop.left}" y="0" width="${width}" height="${stop.y}" fill="${COLOR_BG}" fill-opacity="0.85" />`;
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
      <linearGradient id="goal-floor-glow" x1="0" y1="${FLOOR_NEAR_Y}" x2="0" y2="${FLOOR_VANISH_Y}">
        <stop offset="0%" stop-color="${COLOR_PORTAL}" stop-opacity="0" />
        <stop offset="70%" stop-color="${COLOR_PORTAL}" stop-opacity="0" />
        <stop offset="100%" stop-color="${COLOR_PORTAL}" stop-opacity="0.25" />
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

function renderGoalFloorGlow(mainFloor: FloorCorners): string {
  const points = [
    { x: mainFloor.nearLeft.x, y: mainFloor.nearLeft.y },
    { x: mainFloor.nearRight.x, y: mainFloor.nearRight.y },
    { x: mainFloor.farRight.x, y: mainFloor.farRight.y },
    { x: mainFloor.farLeft.x, y: mainFloor.farLeft.y },
  ];
  return `<polygon data-layer="floor" data-role="goal-floor-glow" points="${joinPoints(
    points,
  )}" fill="url(#goal-floor-glow)" />`;
}

type BranchParts = {
  side: 'left' | 'right';
  geometry: BranchGeometry;
  floor: string;
  innerWall: string;
  outerWall: string;
};

type BranchGeometry = {
  side: 'left' | 'right';
  anchorDepth: number;
  farDepth: number;
  anchorStop: SliceStop;
  farStop: SliceStop;
  nearInner: { x: number; y: number };
  nearOuter: { x: number; y: number };
  farInner: { x: number; y: number };
  farOuter: { x: number; y: number };
  anchorEdgeX: number;
  farEdgeX: number;
};

type BranchOpeningShape = {
  side: 'left' | 'right';
  sliceIndex: number;
  points: { x: number; y: number }[];
};

function createBranchGeometry(side: 'left' | 'right', anchorDepth: number): BranchGeometry {
  const isLeft = side === 'left';
  const direction = isLeft ? -1 : 1;
  const nearDepth = anchorDepth;
  const farDepth = Math.min(SLICE_COUNT, anchorDepth + BRANCH_DEPTH_DELTA);
  const anchorStop = corridorStopAt(nearDepth);
  const farStop = corridorStopAt(farDepth);
  const anchorWidth = anchorStop.right - anchorStop.left;
  const farWidth = farStop.right - farStop.left;
  const anchorEdgeX = isLeft ? anchorStop.left : anchorStop.right;
  const farEdgeX = isLeft ? farStop.left : farStop.right;

  const inset = anchorWidth * BRANCH_MOUTH_INSET;
  const nearInnerX = isLeft ? anchorEdgeX + inset : anchorEdgeX - inset;
  const branchNearInner = { x: nearInnerX, y: anchorStop.y };
  const branchNearOuter = {
    x: anchorEdgeX + direction * (anchorWidth * BRANCH_NEAR_SPAN),
    y: anchorStop.y,
  };
  const branchFarInner = {
    x:
      farEdgeX +
      direction * (farWidth * BRANCH_INNER_TAPER) +
      direction * BRANCH_FAR_LATERAL_SHIFT * 0.35,
    y: farStop.y,
  };
  const branchFarOuter = {
    x:
      farEdgeX +
      direction * (farWidth * (BRANCH_NEAR_SPAN + BRANCH_FAR_EXTRA_SPAN)) +
      direction * BRANCH_FAR_LATERAL_SHIFT,
    y: farStop.y,
  };

  return {
    side,
    anchorDepth,
    farDepth,
    anchorStop,
    farStop,
    nearInner: branchNearInner,
    nearOuter: branchNearOuter,
    farInner: branchFarInner,
    farOuter: branchFarOuter,
    anchorEdgeX,
    farEdgeX,
  };
}

// junction / goal 分岐: メイン床の手前角から横方向にL字で伸ばす。
function renderSideBranch(geometry: BranchGeometry): BranchParts {
  const {
    side,
    nearInner: branchNearInner,
    nearOuter: branchNearOuter,
    farInner: branchFarInner,
    farOuter: branchFarOuter,
  } = geometry;

  // 1. 分岐床（メイン床と同じグレーグラデーション）
  const floorPoints = [branchNearInner, branchNearOuter, branchFarOuter, branchFarInner];
  const floorSvg = `<polygon data-branch="${side}" data-layer="floor" data-role="branch-floor-${side}"
    points="${joinPoints(floorPoints)}" fill="url(#corridor-floor-grad)" stroke="${COLOR_FLOOR_LINE}" stroke-width="0.6" stroke-opacity="0.12" />`;

  // 2. 内側の壁（本線との境界側）: 床の端から天井まで
  const innerWallPoints = [
    branchNearInner,
    branchFarInner,
    { x: branchFarInner.x, y: 0 },
    { x: branchNearInner.x, y: 0 },
  ];
  const innerWallSvg = `<polygon data-branch-wall="${side}" data-branch-position="inner" data-role="branch-wall-${side}-inner"
    points="${joinPoints(innerWallPoints)}" fill="${COLOR_WALL}" stroke="${COLOR_WALL_LINE}" stroke-width="0.8" stroke-opacity="0.18" />`;

  // 3. 外側の壁（横通路外側）: 床の端から天井まで
  const outerWallPoints = [
    branchNearOuter,
    branchFarOuter,
    { x: branchFarOuter.x, y: 0 },
    { x: branchNearOuter.x, y: 0 },
  ];
  const outerWallSvg = `<polygon data-branch-wall="${side}" data-branch-position="outer" data-role="branch-wall-${side}-outer"
    points="${joinPoints(outerWallPoints)}" fill="${COLOR_WALL}" fill-opacity="0.9" stroke="${COLOR_WALL_LINE}" stroke-width="0.6" stroke-opacity="0.12" />`;

  return { side, geometry, floor: floorSvg, innerWall: innerWallSvg, outerWall: outerWallSvg };
}

function buildBranchParts(openings: Openings, anchorDepth: number): BranchParts[] {
  const parts: BranchParts[] = [];

  if (openings.left) {
    const leftGeometry = createBranchGeometry('left', anchorDepth);
    parts.push(renderSideBranch(leftGeometry));
  }
  if (openings.right) {
    const rightGeometry = createBranchGeometry('right', anchorDepth);
    parts.push(renderSideBranch(rightGeometry));
  }

  return parts;
}

function buildBranchWallMasks(
  geometries: BranchGeometry[],
  slices: SliceGeometry[],
): {
  defs: string[];
  maskIds: Partial<Record<'left' | 'right', string>>;
  openingShapes: BranchOpeningShape[];
} {
  const defs: string[] = [];
  const maskIds: Partial<Record<'left' | 'right', string>> = {};
  const openingShapes: BranchOpeningShape[] = [];

  geometries.forEach((geometry) => {
    const maskId = `junction-wall-mask-${geometry.side}`;
    maskIds[geometry.side] = maskId;
    const openSlices = slices.filter((slice) => {
      const nearDepth = slice.index - 1;
      const farDepth = slice.index;
      return nearDepth < geometry.farDepth && farDepth > geometry.anchorDepth;
    });
    const openingPolygons = openSlices.map((slice) => {
      const nearX = geometry.side === 'left' ? slice.near.left : slice.near.right;
      const farX = geometry.side === 'left' ? slice.far.left : slice.far.right;
      const points = [
        { x: nearX, y: slice.near.y },
        { x: farX, y: slice.far.y },
        { x: farX, y: 0 },
        { x: nearX, y: 0 },
      ];
      openingShapes.push({ side: geometry.side, sliceIndex: slice.index, points });
      return `<polygon data-branch-wall-mask-slice="${slice.index}" points="${joinPoints(
        points,
      )}" fill="black" />`;
    });
    defs.push(
      `<mask id="${maskId}" data-junction-mask="true" data-mask-side="${geometry.side}">
        <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="white" />
        ${openingPolygons.join('\n')}
      </mask>`,
    );
  });

  return { defs, maskIds, openingShapes };
}

function buildBranchWallClips(geometries: BranchGeometry[]): {
  defs: string[];
  clipIds: Partial<Record<'left' | 'right', string>>;
} {
  const defs: string[] = [];
  const clipIds: Partial<Record<'left' | 'right', string>> = {};

  geometries.forEach((geometry) => {
    const clipId = `branch-wall-clip-${geometry.side}`;
    clipIds[geometry.side] = clipId;
    const margin = 4;
    const points =
      geometry.side === 'left'
        ? [
            { x: 0, y: HEIGHT },
            { x: geometry.anchorStop.left - margin, y: HEIGHT },
            { x: geometry.farStop.left, y: 0 },
            { x: 0, y: 0 },
          ]
        : [
            { x: geometry.anchorStop.right + margin, y: HEIGHT },
            { x: WIDTH, y: HEIGHT },
            { x: WIDTH, y: 0 },
            { x: geometry.farStop.right, y: 0 },
          ];
    defs.push(
      `<clipPath id="${clipId}" data-role="branch-clip-${geometry.side}">
        <polygon points="${joinPoints(points)}" />
      </clipPath>`,
    );
  });

  return { defs, clipIds };
}

function renderBranchOpeningFills(openings: BranchOpeningShape[]): string[] {
  return openings.map((opening) => {
    return `<polygon data-role="branch-opening-fill-${opening.side}" data-open-slice="${opening.sliceIndex}"
      points="${joinPoints(opening.points)}" fill="${COLOR_BRANCH_OPENING_FILL}" fill-opacity="0.92"
      stroke="${COLOR_WALL_LINE}" stroke-width="0.4" stroke-opacity="0.08" />`;
  });
}

function renderBranchWallGroups(
  branchParts: BranchParts[],
  clipIds: Partial<Record<'left' | 'right', string>>,
): string[] {
  return branchParts.map((part) => {
    const clipId = clipIds[part.side];
    const clipAttr = clipId ? ` clip-path="url(#${clipId})"` : '';
    return `<g data-role="branch-walls-${part.side}"${clipAttr}>
      ${part.innerWall}
      ${part.outerWall}
    </g>`;
  });
}

function renderBranchFloorSeams(branchParts: BranchParts[]): string[] {
  return branchParts.map((part) => {
    const { side, geometry } = part;
    const anchorStop = geometry.anchorStop;
    const anchorWidth = anchorStop.right - anchorStop.left;
    const inset = anchorWidth * BRANCH_MOUTH_INSET;
    const mainInner =
      side === 'left'
        ? { x: anchorStop.left + inset, y: anchorStop.y }
        : { x: anchorStop.right - inset, y: anchorStop.y };
    const mainEdge = {
      x: side === 'left' ? anchorStop.left : anchorStop.right,
      y: anchorStop.y,
    };
    const points = [mainInner, mainEdge, geometry.nearOuter, geometry.nearInner];
    return `<polygon data-role="branch-floor-seam-${side}" points="${joinPoints(
      points,
    )}" fill="url(#corridor-floor-grad)" fill-opacity="0.9" stroke="${COLOR_FLOOR_LINE}" stroke-width="0.45" stroke-opacity="0.08" />`;
  });
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
  const branchParts = buildBranchParts(openings, BRANCH_ANCHOR_DEPTH);
  const branchGeometries = branchParts.map((part) => part.geometry);
  const wallMasks = buildBranchWallMasks(branchGeometries, slices);
  const branchOpeningFills = renderBranchOpeningFills(wallMasks.openingShapes);
  const branchFloorSeams = renderBranchFloorSeams(branchParts);
  const branchWallClips = buildBranchWallClips(branchGeometries);
  const branchWallGroups = renderBranchWallGroups(branchParts, branchWallClips.clipIds);

  // 1. 床（メイン通路）
  parts.push(renderMainFloor(mainFloor));
  parts.push(renderFloorSlices(slices));
  // 2. 左右分岐（床）: 壁より先に描画して壁で手前を隠す
  parts.push(...branchParts.map((part) => part.floor));
  // 2.2 継ぎ目: メイン床と分岐床を繋ぐシーム
  parts.push(...branchFloorSeams);
  // 2.5 開口の奥行きを示すフィル（壁の前、マスク定義より前に置く）
  parts.push(...branchOpeningFills);
  // 3 開口用マスク定義（壁より前に置き、メイン壁をくり抜く）
  const defs = [...wallMasks.defs, ...branchWallClips.defs];
  if (defs.length > 0) {
    parts.push(`<defs>${defs.join('\n')}</defs>`);
  }
  // 4. メイン左右壁
  parts.push(renderCorridorWalls(slices, 'junction', openings, wallMasks.maskIds));
  // 5. 左右分岐（壁）
  parts.push(...branchWallGroups);
  // 6. 正面は壁で塞がず、forward=false のときだけ暗転で閉塞を示す
  if (!openings.forward) {
    parts.push(renderJunctionForwardCap(stops[3]));
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
  const branchParts = buildBranchParts(openings, BRANCH_ANCHOR_DEPTH);
  const branchGeometries = branchParts.map((part) => part.geometry);
  const wallMasks = buildBranchWallMasks(branchGeometries, slices);
  const branchFloorSeams = renderBranchFloorSeams(branchParts);
  const branchWallClips = buildBranchWallClips(branchGeometries);
  const branchWallGroups = renderBranchWallGroups(branchParts, branchWallClips.clipIds);
  const defs = [...wallMasks.defs, ...branchWallClips.defs];

  parts.push(renderMainFloor(mainFloor));
  parts.push(renderFloorSlices(slices));
  parts.push(renderGoalFloorGlow(mainFloor));
  parts.push(...branchParts.map((part) => part.floor));
  parts.push(...branchFloorSeams);
  if (defs.length > 0) {
    parts.push(`<defs>${defs.join('\n')}</defs>`);
  }
  parts.push(renderCorridorWalls(slices, 'goal', openings, wallMasks.maskIds));
  parts.push(...branchWallGroups);
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
