import type { Direction, MazePreviewVariant } from './PlayerView';
import type { ServerMazeCell } from '../state/sessionStore';

type Openings = {
  forward: boolean;
  left: boolean;
  right: boolean;
  backward: boolean;
};

// 描画領域サイズ
const WIDTH = 320;
const HEIGHT = 180;

// 奥行きレベルの基準点
const FLOOR_NEAR_Y = 160; // bottom of the main corridor floor
const FLOOR_FAR_Y = 80; // horizon / far edge of floor

const FLOOR_NEAR_LEFT = 60;
const FLOOR_NEAR_RIGHT = 260;
const FLOOR_FAR_LEFT = 120;
const FLOOR_FAR_RIGHT = 200;

// ベースカラー
const COLOR_BG = '#000000';
const COLOR_CEILING = '#0b0d14';
const COLOR_FLOOR = '#8c4a32';
const COLOR_WALL = '#6c3a2c';
const COLOR_SKY = '#9fd8ff';
const COLOR_SKY_EDGE = '#d3ecff';

// 奥行きレベル数
const DEPTH_LAYERS = 4;
const WALL_HEIGHT = 110;

type DepthSlice = {
  index: number;
  near: { xLeft: number; xRight: number; y: number; t: number };
  far: { xLeft: number; xRight: number; y: number; t: number };
};

type CorridorOutline = {
  floorPoints: { x: number; y: number }[];
  wallPoints: { left: { x: number; y: number }[]; right: { x: number; y: number }[] };
  farY: number;
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function joinPoints(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

// 壁の色の補間（暗くする）
function shadeColor(hex: string, darkness: number): string {
  const t = Math.max(0, Math.min(1, darkness));
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const factor = 1 - t * 0.65;
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(Math.round(r * factor))}${toHex(Math.round(g * factor))}${toHex(Math.round(b * factor))}`;
}

function wallTopY(y: number, t: number): number {
  const rawTop = y - WALL_HEIGHT * (1 - t * 0.35);
  return Math.max(0, rawTop);
}

function createDepthSlices(levels = DEPTH_LAYERS): DepthSlice[] {
  const slices: DepthSlice[] = [];
  for (let i = 0; i < levels; i++) {
    const tNear = i / levels;
    const tFar = (i + 1) / levels;
    const near = {
      xLeft: lerp(FLOOR_NEAR_LEFT, FLOOR_FAR_LEFT, tNear),
      xRight: lerp(FLOOR_NEAR_RIGHT, FLOOR_FAR_RIGHT, tNear),
      y: lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, tNear),
      t: tNear,
    };
    const far = {
      xLeft: lerp(FLOOR_NEAR_LEFT, FLOOR_FAR_LEFT, tFar),
      xRight: lerp(FLOOR_NEAR_RIGHT, FLOOR_FAR_RIGHT, tFar),
      y: lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, tFar),
      t: tFar,
    };
    slices.push({ index: i, near, far });
  }
  return slices;
}

function corridorSliceAt(t: number) {
  const y = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t);
  const xLeft = lerp(FLOOR_NEAR_LEFT, FLOOR_FAR_LEFT, t);
  const xRight = lerp(FLOOR_NEAR_RIGHT, FLOOR_FAR_RIGHT, t);
  return {
    xLeft,
    xRight,
    y,
    t,
    wallTop: wallTopY(y, t),
  };
}

// メイン通路の床と壁の輪郭を1枚にまとめる
function computeCorridorOutline(slices: DepthSlice[]): CorridorOutline | null {
  const first = slices[0];
  const last = slices[slices.length - 1];
  if (!first || !last) return null;

  const bottomLeft = Math.max(0, first.near.xLeft - 36);
  const bottomRight = Math.min(WIDTH, first.near.xRight + 36);
  const farLeft = last.far.xLeft;
  const farRight = last.far.xRight;
  const farY = last.far.y;

  const wallTopNear = wallTopY(first.near.y, first.near.t);
  const wallTopFar = wallTopY(farY, last.far.t);

  const floorPoints = [
    { x: bottomLeft, y: HEIGHT },
    { x: bottomRight, y: HEIGHT },
    { x: farRight, y: farY },
    { x: farLeft, y: farY },
  ];

  const leftWallPoints = [
    { x: 0, y: wallTopNear },
    { x: 0, y: HEIGHT },
    { x: bottomLeft, y: HEIGHT },
    { x: farLeft, y: farY },
    { x: 0, y: farY },
    { x: 0, y: wallTopFar },
  ];

  const rightWallPoints = [
    { x: WIDTH, y: wallTopNear },
    { x: WIDTH, y: HEIGHT },
    { x: bottomRight, y: HEIGHT },
    { x: farRight, y: farY },
    { x: WIDTH, y: farY },
    { x: WIDTH, y: wallTopFar },
  ];

  return {
    floorPoints,
    wallPoints: {
      left: leftWallPoints,
      right: rightWallPoints,
    },
    farY,
  };
}

function renderBaseDefs(): string {
  return `
    <defs>
      <linearGradient id="ceiling-gradient" x1="0" y1="0" x2="0" y2="${FLOOR_FAR_Y}">
        <stop offset="0%" stop-color="${COLOR_CEILING}" />
        <stop offset="100%" stop-color="${COLOR_CEILING}" stop-opacity="0.7" />
      </linearGradient>
      <pattern id="wall-brick-pattern" patternUnits="userSpaceOnUse" width="14" height="12">
        <rect x="0" y="0" width="14" height="12" fill="#ffffff" fill-opacity="0.03" />
        <line x1="0" y1="6" x2="14" y2="6" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1" />
        <line x1="7" y1="0" x2="7" y2="6" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1" />
        <line x1="0" y1="12" x2="14" y2="12" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1" />
      </pattern>
      <pattern id="floor-grid-pattern" patternUnits="userSpaceOnUse" width="18" height="18" patternTransform="skewX(-10)">
        <rect x="0" y="0" width="18" height="18" fill="#ffffff" fill-opacity="0.02" />
        <path d="M0 0 L18 18 M-18 0 L0 18 M0 -18 L18 0" stroke="#ffffff" stroke-opacity="0.16" stroke-width="1" />
      </pattern>
    </defs>
  `;
}

function renderCeiling(): string {
  return `<rect x="0" y="0" width="${WIDTH}" height="${FLOOR_FAR_Y}" fill="url(#ceiling-gradient)" />`;
}

// メイン通路の床を台形1枚で描き、奥行きの陰影を重ねる
function renderFloorLayers(slices: DepthSlice[]): string {
  const outline = computeCorridorOutline(slices);
  if (!outline) return '';

  const gradientId = 'floor-depth-gradient';
  const gradient = `
    <defs>
      <linearGradient id="${gradientId}" x1="0" y1="${HEIGHT}" x2="0" y2="${outline.farY}">
        <stop offset="0%" stop-color="${COLOR_FLOOR}" stop-opacity="0.98" />
        <stop offset="100%" stop-color="${shadeColor(COLOR_FLOOR, 0.4)}" stop-opacity="0.86" />
      </linearGradient>
    </defs>
  `;

  const base = `<polygon data-floor="main" data-floor-layer="main" points="${joinPoints(outline.floorPoints)}" fill="url(#${gradientId})" />`;

  const overlays = slices
    .map((slice) => {
      const shade = shadeColor(COLOR_FLOOR, slice.far.t * 0.5);
      const opacity = Math.max(0, 0.02 - slice.far.t * 0.005);
      return `<polygon data-floor="overlay" data-floor-layer="${slice.index}" points="${joinPoints(
        outline.floorPoints,
      )}" fill="${shade}" fill-opacity="${opacity}" />`;
    })
    .join('\n');

  const pattern = `<polygon data-floor-pattern="main" points="${joinPoints(
    outline.floorPoints,
  )}" fill="url(#floor-grid-pattern)" fill-opacity="0.12" />`;

  return [gradient, base, overlays, pattern].join('\n');
}

// 左右1枚ずつの壁を描き、同じ輪郭に深度の陰影を重ねる
function renderWallLayers(side: 'left' | 'right', slices: DepthSlice[]): string {
  const outline = computeCorridorOutline(slices);
  if (!outline) return '';
  const isLeft = side === 'left';
  const points = isLeft ? outline.wallPoints.left : outline.wallPoints.right;

  const gradientId = `wall-depth-${side}`;
  const gradient = `
    <defs>
      <linearGradient id="${gradientId}" x1="0" y1="${outline.farY}" x2="0" y2="${HEIGHT}">
        <stop offset="0%" stop-color="${shadeColor(COLOR_WALL, 0.5)}" stop-opacity="0.95" />
        <stop offset="100%" stop-color="${COLOR_WALL}" stop-opacity="0.9" />
      </linearGradient>
    </defs>
  `;

  const base = `<polygon data-wall-side="${side}" data-wall-layer="main" points="${joinPoints(
    points,
  )}" fill="url(#${gradientId})" />`;

  const overlays = slices
    .map((slice) => {
      const shade = shadeColor(COLOR_WALL, slice.far.t * 0.75);
      const opacity = Math.max(0, 0.02 - slice.far.t * 0.004);
      return `<polygon data-wall-side="${side}" data-wall-layer="overlay" data-layer-index="${
        slice.index
      }" points="${joinPoints(points)}" fill="${shade}" fill-opacity="${opacity}" />`;
    })
    .join('\n');

  const pattern = `<polygon data-wall-side="${side}" data-wall-layer-pattern="main" points="${joinPoints(
    points,
  )}" fill="url(#wall-brick-pattern)" fill-opacity="0.1" />`;

  return [gradient, base, overlays, pattern].join('\n');
}

// 手前の床を視点直下まで埋める
function renderForegroundFloor(slices: DepthSlice[]): string {
  const outline = computeCorridorOutline(slices);
  if (!outline) return '';
  const base = `<polygon data-floor="foreground" points="${joinPoints(
    outline.floorPoints,
  )}" fill="${COLOR_FLOOR}" fill-opacity="0.03" />`;
  const pattern = `<polygon data-floor-pattern="foreground" points="${joinPoints(
    outline.floorPoints,
  )}" fill="url(#floor-grid-pattern)" fill-opacity="0.02" />`;
  return `${base}\n${pattern}`;
}

// 手前の左右壁を視点直下まで埋める
function renderForegroundWalls(slices: DepthSlice[]): string {
  const outline = computeCorridorOutline(slices);
  if (!outline) return '';
  const leftPoints = outline.wallPoints.left;
  const rightPoints = outline.wallPoints.right;

  const leftWall = `<polygon data-wall-side="left" data-wall-layer="foreground" points="${joinPoints(
    leftPoints,
  )}" fill="${COLOR_WALL}" fill-opacity="0.03" />`;
  const rightWall = `<polygon data-wall-side="right" data-wall-layer="foreground" points="${joinPoints(
    rightPoints,
  )}" fill="${COLOR_WALL}" fill-opacity="0.03" />`;
  const leftPattern = `<polygon data-wall-side="left" data-wall-layer-pattern="foreground" points="${joinPoints(
    leftPoints,
  )}" fill="url(#wall-brick-pattern)" fill-opacity="0.02" />`;
  const rightPattern = `<polygon data-wall-side="right" data-wall-layer-pattern="foreground" points="${joinPoints(
    rightPoints,
  )}" fill="url(#wall-brick-pattern)" fill-opacity="0.02" />`;

  return [leftWall, rightWall, leftPattern, rightPattern].join('\n');
}

function renderStartFade(): string {
  const fadeStart = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, 0.35);
  const fadeId = 'start-depth-fade';
  const floorPoly = [
    { x: FLOOR_NEAR_LEFT, y: FLOOR_NEAR_Y },
    { x: FLOOR_NEAR_RIGHT, y: FLOOR_NEAR_Y },
    { x: FLOOR_FAR_RIGHT, y: FLOOR_FAR_Y },
    { x: FLOOR_FAR_LEFT, y: FLOOR_FAR_Y },
  ];

  return `
    <defs>
      <linearGradient id="${fadeId}" x1="0" y1="${fadeStart}" x2="0" y2="${FLOOR_FAR_Y}">
        <stop offset="0%" stop-color="${COLOR_BG}" stop-opacity="0" />
        <stop offset="100%" stop-color="${COLOR_BG}" stop-opacity="0.9" />
      </linearGradient>
    </defs>
    <polygon data-depth-fade="start" points="${joinPoints(floorPoly)}" fill="url(#${fadeId})" />
  `;
}

function renderForwardWall(t: number, label: string): string {
  const y = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t);
  const left = lerp(FLOOR_NEAR_LEFT, FLOOR_FAR_LEFT, t);
  const right = lerp(FLOOR_NEAR_RIGHT, FLOOR_FAR_RIGHT, t);
  const top = wallTopY(y, t);
  const color = shadeColor(COLOR_WALL, t * 0.8);
  return `<polygon data-forward-block="${label}" points="${joinPoints([
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y },
    { x: left, y },
  ])}" fill="${color}" stroke="#000000" stroke-opacity="0.25" />`;
}

function renderSideBranch(side: 'left' | 'right'): string {
  const isLeft = side === 'left';
  const entryT = 0.46;
  const entry = corridorSliceAt(entryT);
  const farSlice = corridorSliceAt(Math.min(0.95, entryT + 0.18));
  const openingWidth = 52;
  const openingHeight = 32;
  const openingInset = 6;
  const farShift = 18;
  const farNarrowing = 14;
  const farRise = 34;

  const nearY = entry.y;
  const farY = Math.min(farSlice.y, nearY - farRise);

  const openingInnerX = isLeft ? entry.xLeft : entry.xRight;
  const openingOuterX = isLeft ? openingInnerX - openingWidth : openingInnerX + openingWidth;

  const nearInnerX = openingInnerX + (isLeft ? openingInset : -openingInset);
  const nearOuterX = isLeft
    ? openingInnerX - (openingWidth - openingInset)
    : openingInnerX + (openingWidth - openingInset);

  const farInnerX = openingInnerX + (isLeft ? -farShift : farShift);
  const farOuterX = isLeft
    ? farInnerX - (openingWidth - farNarrowing)
    : farInnerX + (openingWidth - farNarrowing);

  const floorPoints = [
    { x: nearInnerX, y: nearY },
    { x: nearOuterX, y: nearY },
    { x: farOuterX, y: farY },
    { x: farInnerX, y: farY },
  ];

  const floorColor = shadeColor(COLOR_FLOOR, 0.22);
  const floor = `<polygon data-side-corridor="${side}" data-branch-floor="${side}" data-branch-index="0" points="${joinPoints(
    floorPoints,
  )}" fill="${floorColor}" fill-opacity="0.9" />`;
  const floorPattern = `<polygon data-side-corridor="${side}" data-branch-floor-pattern="${side}" data-branch-index="0" points="${joinPoints(
    floorPoints,
  )}" fill="url(#floor-grid-pattern)" fill-opacity="0.08" />`;

  const wallTopNear = wallTopY(nearY, entry.t);
  const wallTopFar = wallTopY(farY, farSlice.t);
  const outerWallPoints = isLeft
    ? [
        { x: nearOuterX, y: wallTopNear },
        { x: nearOuterX, y: nearY },
        { x: farOuterX, y: farY },
        { x: farOuterX, y: wallTopFar },
      ]
    : [
        { x: nearOuterX, y: wallTopNear },
        { x: nearOuterX, y: nearY },
        { x: farOuterX, y: farY },
        { x: farOuterX, y: wallTopFar },
      ];

  const innerWallPoints = isLeft
    ? [
        { x: nearInnerX, y: wallTopNear },
        { x: nearInnerX, y: nearY },
        { x: farInnerX, y: farY },
        { x: farInnerX, y: wallTopFar },
      ]
    : [
        { x: nearInnerX, y: wallTopNear },
        { x: nearInnerX, y: nearY },
        { x: farInnerX, y: farY },
        { x: farInnerX, y: wallTopFar },
      ];

  const wallBase = shadeColor(COLOR_WALL, 0.22);
  const outerWall = `<polygon data-side-corridor="${side}" data-branch-wall="${side}" data-branch-position="outer" data-branch-index="0" points="${joinPoints(
    outerWallPoints,
  )}" fill="${wallBase}" fill-opacity="0.82" />`;
  const innerWall = `<polygon data-side-corridor="${side}" data-branch-wall="${side}" data-branch-position="inner" data-branch-index="0" points="${joinPoints(
    innerWallPoints,
  )}" fill="${shadeColor(COLOR_WALL, 0.3)}" fill-opacity="0.8" />`;

  const outerPattern = `<polygon data-side-corridor="${side}" data-branch-wall-pattern="${side}" data-branch-position="outer" data-branch-index="0" points="${joinPoints(
    outerWallPoints,
  )}" fill="url(#wall-brick-pattern)" fill-opacity="0.08" />`;
  const innerPattern = `<polygon data-side-corridor="${side}" data-branch-wall-pattern="${side}" data-branch-position="inner" data-branch-index="0" points="${joinPoints(
    innerWallPoints,
  )}" fill="url(#wall-brick-pattern)" fill-opacity="0.08" />`;

  const openingPoints = [
    { x: openingInnerX, y: nearY + 2 },
    { x: openingInnerX, y: nearY - openingHeight },
    { x: openingOuterX, y: nearY - openingHeight + 6 },
    { x: openingOuterX, y: nearY + 6 },
  ];
  const openingMask = `<polygon points="${joinPoints(openingPoints)}" fill="${COLOR_BG}" fill-opacity="0.85" />`;
  const entryFrame = `<polygon data-side-corridor="${side}" data-branch-entry="${side}" points="${joinPoints(
    openingPoints,
  )}" fill="none" stroke="${shadeColor(COLOR_WALL, 0.1)}" stroke-width="2" stroke-opacity="0.9" />`;

  return [
    openingMask,
    floor,
    floorPattern,
    innerWall,
    innerPattern,
    outerWall,
    outerPattern,
    entryFrame,
  ].join('\n');
}

function renderGoalPortal(slices: DepthSlice[]): string {
  const far = slices[slices.length - 1].far;
  const backWallTop = 0;
  const backWallBottom = far.y;
  const backWallLeft = far.xLeft;
  const backWallRight = far.xRight;
  const backWallWidth = backWallRight - backWallLeft;

  const wallGradientId = 'goal-wall-glow';
  const portalGradientId = 'goal-portal';

  const portalWidth = backWallWidth * 0.55;
  const portalHeight = backWallBottom * 0.7;
  const portalLeft = backWallLeft + (backWallWidth - portalWidth) / 2;
  const portalTop = backWallBottom - portalHeight - 4;

  const defs = `
    <defs>
      <linearGradient id="${wallGradientId}" x1="0" y1="${backWallTop}" x2="0" y2="${backWallBottom}">
        <stop offset="0%" stop-color="${COLOR_SKY_EDGE}" stop-opacity="0.28" />
        <stop offset="100%" stop-color="${shadeColor(COLOR_WALL, 0.45)}" stop-opacity="0.9" />
      </linearGradient>
      <linearGradient id="${portalGradientId}" x1="0" y1="${portalTop}" x2="0" y2="${portalTop + portalHeight}">
        <stop offset="0%" stop-color="${COLOR_SKY_EDGE}" />
        <stop offset="100%" stop-color="${COLOR_SKY}" />
      </linearGradient>
    </defs>
  `;

  const wall = `<polygon data-front-wall-fill="true" points="${joinPoints([
    { x: backWallLeft, y: backWallTop },
    { x: backWallRight, y: backWallTop },
    { x: backWallRight, y: backWallBottom },
    { x: backWallLeft, y: backWallBottom },
  ])}" fill="url(#${wallGradientId})" stroke="#000000" stroke-opacity="0.15" />`;

  const portal = `<rect data-goal-portal="true" x="${portalLeft}" y="${portalTop}" width="${portalWidth}" height="${portalHeight}" fill="url(#${portalGradientId})" stroke="${COLOR_SKY_EDGE}" stroke-opacity="0.6" />`;
  const rimGlow = `<rect data-goal-portal-rim="true" x="${portalLeft - 4}" y="${portalTop - 6}" width="${portalWidth + 8}" height="${portalHeight + 12}" fill="${COLOR_SKY_EDGE}" fill-opacity="0.12" />`;

  return `${defs}\n${wall}\n${rimGlow}\n${portal}`;
}

// start view の簡易3D廊下を描画
function renderStartView(openings: Openings): string {
  const slices = createDepthSlices();
  const parts: string[] = [
    renderBaseDefs(),
    renderCeiling(),
    renderFloorLayers(slices),
    renderWallLayers('left', slices),
    renderWallLayers('right', slices),
    renderForegroundWalls(slices),
    renderForegroundFloor(slices),
  ];
  if (!openings.forward) {
    parts.push(renderForwardWall(0.5, 'start'));
  }
  parts.push(renderStartFade());
  return parts.join('\n');
}

// junction view の分岐を含む3D表現
function renderJunctionView(openings: Openings): string {
  const slices = createDepthSlices();
  const parts: string[] = [
    renderBaseDefs(),
    renderCeiling(),
    renderFloorLayers(slices),
    renderWallLayers('left', slices),
    renderWallLayers('right', slices),
  ];

  if (openings.left) {
    parts.push(renderSideBranch('left'));
  }
  if (openings.right) {
    parts.push(renderSideBranch('right'));
  }
  parts.push(renderForegroundWalls(slices), renderForegroundFloor(slices));
  if (!openings.forward) {
    parts.push(renderForwardWall(0.5, 'junction'));
  }

  return parts.join('\n');
}

// goal view の奥に光る出口を描画
function renderGoalView(openings: Openings): string {
  const slices = createDepthSlices();
  const parts: string[] = [
    renderBaseDefs(),
    renderCeiling(),
    renderFloorLayers(slices),
    renderWallLayers('left', slices),
    renderWallLayers('right', slices),
    renderGoalPortal(slices),
  ];

  if (openings.left) {
    parts.push(renderSideBranch('left'));
  }
  if (openings.right) {
    parts.push(renderSideBranch('right'));
  }
  parts.push(renderForegroundWalls(slices), renderForegroundFloor(slices));
  if (!openings.forward) {
    parts.push(renderForwardWall(0.5, 'goal'));
  }

  return parts.join('\n');
}

export function createSimplePreviewSvg(
  _cell: ServerMazeCell,
  _openDirections: Direction[],
  variant: MazePreviewVariant,
  orientation: Direction,
  openings: Openings,
): string {
  const groupAttrs = [
    `data-view-tilt="0.00"`,
    `data-forward-open="${openings.forward}"`,
    `data-left-open="${openings.left}"`,
    `data-right-open="${openings.right}"`,
    `data-back-open="${openings.backward}"`,
    `data-facing="${orientation}"`,
  ].join(' ');

  let inner = '';
  if (variant === 'start') {
    inner = renderStartView(openings);
  } else if (variant === 'junction') {
    inner = renderJunctionView(openings);
  } else {
    inner = renderGoalView(openings);
  }

  return `
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${COLOR_BG}" />
      <g ${groupAttrs}>
        ${inner}
      </g>
    </svg>
  `;
}
