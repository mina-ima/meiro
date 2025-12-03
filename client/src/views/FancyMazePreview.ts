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
const COLOR_FLOOR = '#7b5b3a';
const COLOR_FLOOR_FAR = '#3e2a18';
const COLOR_FLOOR_LINE = '#d8c6aa';
const COLOR_WALL = '#8a5f3f';
const COLOR_WALL_FAR = '#3c2417';
const COLOR_WALL_LINE = '#e6d4bd';
const COLOR_BRANCH_FLOOR = '#6b4a30';
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
    const fill = mixColor(COLOR_FLOOR, COLOR_FLOOR_FAR, t * 0.8);
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
    // junction/goal でも壁スライスは素直に描き、後段の openings.* に応じたマスクで切り欠きを作る
    if (isBranchingVariant && openings) {
      parts.push(renderWallSlice('left', slice));
      parts.push(renderWallSlice('right', slice));
      return;
    }
    parts.push(renderWallSlice('left', slice));
    parts.push(renderWallSlice('right', slice));
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

function renderSideBranch(side: 'left' | 'right', slices: SliceGeometry[]): string {
  // junction 用の左右分岐: slice2 の床ラインから左右に 90 度曲がる横通路を描く
  // 分岐床は本線床より手前に出さず、メイン通路の壁端から穴を開けて奥に2層の床＋壁を重ねる
  const isLeft = side === 'left';
  const direction = isLeft ? -1 : 1;
  const anchorSlice = slices[1];
  const anchorX = isLeft ? anchorSlice.near.left : anchorSlice.near.right;
  const floorY = anchorSlice.near.y;
  const corridorWidth = anchorSlice.near.right - anchorSlice.near.left;
  const vanish = {
    x: isLeft ? -WIDTH * 0.32 - 20 : WIDTH + WIDTH * 0.32 + 20,
    y: Math.max(FLOOR_VANISH_Y, floorY - 14),
  };

  const depthBase = Math.max(20, (anchorSlice.near.y - anchorSlice.far.y) * 1.25);
  const nearWidth0 = corridorWidth * 0.58;
  const nearWidth1 = nearWidth0 * 0.76;
  const layers = [
    {
      nearWidth: nearWidth0,
      depth: depthBase,
      innerRatio: 0.36,
      bend: 0.08,
    },
    {
      nearWidth: nearWidth1,
      depth: depthBase + 12,
      innerRatio: 0.42,
      bend: 0.12,
    },
  ];

  const parts: string[] = [];
  layers.forEach((layer, idx) => {
    const nearYOffset = idx === 0 ? 0 : Math.min(6, layer.depth * 0.18);
    const nearY = floorY - nearYOffset;
    const nearInner = { x: anchorX, y: nearY };
    const nearOuter = { x: anchorX + direction * layer.nearWidth, y: nearY };

    const farY = nearY - layer.depth;
    const farInnerBase = anchorX + direction * (layer.nearWidth * layer.innerRatio + 10 + idx * 5);
    const farInner = {
      x: lerp(farInnerBase, vanish.x, layer.bend + idx * 0.02),
      y: farY,
    };
    const farOuterTarget = anchorX + direction * (layer.nearWidth + 16 + idx * 5);
    const farOuter = {
      x: lerp(farOuterTarget, vanish.x, layer.bend + 0.22 + idx * 0.06),
      y: farY,
    };

    const floorPoints = [nearInner, nearOuter, farOuter, farInner];
    const floorFill = mixColor(COLOR_BRANCH_FLOOR, COLOR_BG, 0.16 + idx * 0.14);
    parts.push(
      `<polygon data-branch="${side}" data-layer="floor" data-slice="${idx + 1}" points="${joinPoints(
        floorPoints,
      )}" fill="${floorFill}" />`,
    );

    const wallHeightNear = 46 - idx * 6;
    const wallHeightFar = Math.max(18, wallHeightNear - 12 - idx * 2);
    const innerWall = [
      nearInner,
      farInner,
      { x: farInner.x, y: Math.max(0, farY - wallHeightFar) },
      { x: nearInner.x, y: Math.max(0, nearY - wallHeightNear) },
    ];
    const outerWall = [
      nearOuter,
      farOuter,
      {
        x: farOuter.x,
        y: Math.max(0, farY - Math.max(14, wallHeightFar * 0.82)),
      },
      {
        x: nearOuter.x,
        y: Math.max(0, nearY - Math.max(16, wallHeightNear * 0.9)),
      },
    ];
    const innerWallFill = mixColor(COLOR_BRANCH_WALL, COLOR_BG, 0.26 + idx * 0.08);
    const outerWallFill = mixColor(COLOR_BRANCH_WALL, COLOR_BG, 0.34 + idx * 0.08);
    parts.push(
      `<polygon data-branch-wall="${side}" data-branch-position="inner" data-slice="${idx + 1}" points="${joinPoints(
        innerWall,
      )}" fill="${innerWallFill}" fill-opacity="${0.72 - idx * 0.08}" />`,
    );
    parts.push(
      `<polygon data-branch-wall="${side}" data-branch-position="outer" data-slice="${idx + 1}" points="${joinPoints(
        outerWall,
      )}" fill="${outerWallFill}" fill-opacity="${0.64 - idx * 0.08}" />`,
    );

    const guideCount = 2 + idx;
    for (let g = 1; g <= guideCount; g += 1) {
      const u = g / (guideCount + 1);
      const x = lerp(nearInner.x, nearOuter.x, u);
      parts.push(
        `<line data-branch-guide="${side}" data-slice="${idx + 1}" x1="${x}" y1="${nearY}" x2="${vanish.x}" y2="${vanish.y}" stroke="${COLOR_BRANCH_GUIDE}" stroke-opacity="${0.3 - idx * 0.08}" stroke-width="0.9" />`,
      );
    }
  });

  return parts.join('\n');
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

  const anchorSlice = slices[1];
  const anchorLeft = anchorSlice.near.left;
  const anchorRight = anchorSlice.near.right;
  const anchorY = anchorSlice.near.y;
  const cutWidth = Math.max(2, Math.min(4.5, (anchorRight - anchorLeft) * 0.02));
  const hasSideBranch = openings.left || openings.right;
  const maskWidth = Math.min(5.5, cutWidth + 2.5);

  // openings.* が true の側だけ壁を切り欠き、消した壁の代わりに分岐通路の床と壁を差し込む
  const branchCuts: string[] = [];
  const branchMasks: string[] = [];
  if (openings.left) {
    branchCuts.push(
      `<polygon data-overlay="branch-cut-left" points="${joinPoints([
        { x: anchorLeft - cutWidth * 0.2, y: 0 },
        { x: anchorLeft + cutWidth * 0.9, y: 0 },
        { x: anchorLeft + cutWidth * 0.45, y: anchorY },
        { x: anchorLeft - cutWidth * 0.75, y: anchorY },
      ])}" fill="${COLOR_BG}" />`,
    );
    branchMasks.push(
      `<polygon data-overlay="junction-mask-left" points="${joinPoints([
        { x: anchorLeft - maskWidth * 1.1, y: 0 },
        { x: anchorLeft - maskWidth * 0.35, y: 0 },
        { x: anchorLeft - maskWidth * 0.35, y: anchorY },
        { x: anchorLeft - maskWidth * 1.1, y: anchorY },
      ])}" fill="${COLOR_BG}" />`,
    );
  }
  if (openings.right) {
    branchCuts.push(
      `<polygon data-overlay="branch-cut-right" points="${joinPoints([
        { x: anchorRight - cutWidth * 0.9, y: 0 },
        { x: anchorRight + cutWidth * 0.2, y: 0 },
        { x: anchorRight + cutWidth * 0.75, y: anchorY },
        { x: anchorRight - cutWidth * 0.45, y: anchorY },
      ])}" fill="${COLOR_BG}" />`,
    );
    branchMasks.push(
      `<polygon data-overlay="junction-mask-right" points="${joinPoints([
        { x: anchorRight + maskWidth * 0.35, y: 0 },
        { x: anchorRight + maskWidth * 1.1, y: 0 },
        { x: anchorRight + maskWidth * 1.1, y: anchorY },
        { x: anchorRight + maskWidth * 0.35, y: anchorY },
      ])}" fill="${COLOR_BG}" />`,
    );
  }

  if (variant === 'junction') {
    // junction: 分岐している側だけ細い帯をマスクし、そこに横通路の床と壁を差し込む
    if (hasSideBranch) {
      parts.push(...branchCuts, ...branchMasks);
      if (openings.left) {
        parts.push(renderSideBranch('left', slices));
      }
      if (openings.right) {
        parts.push(renderSideBranch('right', slices));
      }
    }
    if (!openings.forward) {
      parts.push(renderFrontWall(stops, 3, variant));
    }
  } else if (variant === 'goal') {
    if (hasSideBranch) {
      parts.push(...branchCuts, ...branchMasks);
      if (openings.left) {
        parts.push(renderSideBranch('left', slices));
      }
      if (openings.right) {
        parts.push(renderSideBranch('right', slices));
      }
    }
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
