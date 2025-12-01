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

function renderFloorLayers(slices: DepthSlice[]): string {
  return slices
    .map((slice) => {
      const near = slice.near;
      const far = slice.far;
      const color = shadeColor(COLOR_FLOOR, far.t);
      const opacity = 0.92 - far.t * 0.25;
      const base = `<polygon data-floor="main" data-floor-layer="${slice.index}" points="${joinPoints([
        { x: near.xLeft, y: near.y },
        { x: near.xRight, y: near.y },
        { x: far.xRight, y: far.y },
        { x: far.xLeft, y: far.y },
      ])}" fill="${color}" fill-opacity="${opacity}" />`;
      const pattern = `<polygon data-floor-layer-pattern="${slice.index}" points="${joinPoints([
        { x: near.xLeft, y: near.y },
        { x: near.xRight, y: near.y },
        { x: far.xRight, y: far.y },
        { x: far.xLeft, y: far.y },
      ])}" fill="url(#floor-grid-pattern)" fill-opacity="${0.25 - far.t * 0.1}" />`;
      return `${base}\n${pattern}`;
    })
    .join('\n');
}

function renderWallLayers(side: 'left' | 'right', slices: DepthSlice[]): string {
  const isLeft = side === 'left';
  return slices
    .map((slice) => {
      const near = slice.near;
      const far = slice.far;
      const topNear = wallTopY(near.y, near.t);
      const topFar = wallTopY(far.y, far.t);
      const color = shadeColor(COLOR_WALL, far.t * 0.9);
      const opacity = 0.94 - far.t * 0.3;
      const nearX = isLeft ? 0 : WIDTH;
      const points = [
        { x: nearX, y: topNear },
        { x: nearX, y: near.y },
        { x: isLeft ? near.xLeft : near.xRight, y: near.y },
        { x: isLeft ? far.xLeft : far.xRight, y: far.y },
        { x: nearX, y: far.y },
        { x: nearX, y: topFar },
      ];
      const base = `<polygon data-wall-side="${side}" data-wall-layer="${side}" data-layer-index="${slice.index}" points="${joinPoints(points)}" fill="${color}" fill-opacity="${opacity}" />`;
      const pattern = `<polygon data-wall-side="${side}" data-wall-layer-pattern="${side}" data-layer-index="${slice.index}" points="${joinPoints(points)}" fill="url(#wall-brick-pattern)" fill-opacity="${0.24 - far.t * 0.12}" />`;
      return `${base}\n${pattern}`;
    })
    .join('\n');
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
  const direction = isLeft ? -1 : 1;
  const steps = 3;
  const anchorT = 0.55;
  const anchor = {
    x: isLeft ? lerp(FLOOR_NEAR_LEFT, FLOOR_FAR_LEFT, anchorT) : lerp(FLOOR_NEAR_RIGHT, FLOOR_FAR_RIGHT, anchorT),
    y: lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, anchorT),
  };
  const corridor: { x: number; y: number; width: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    corridor.push({
      x: anchor.x + direction * 70 * s,
      y: anchor.y - 18 * s,
      width: lerp(42, 26, s),
    });
  }

  const parts: string[] = [];
  for (let i = 0; i < steps; i++) {
    const near = corridor[i];
    const far = corridor[i + 1];
    const nearLeft = near.x - (isLeft ? near.width : 0);
    const nearRight = near.x + (isLeft ? 0 : near.width);
    const farLeft = far.x - (isLeft ? far.width : 0);
    const farRight = far.x + (isLeft ? 0 : far.width);
    const t = (i + 1) / steps;
    const baseColor = shadeColor(COLOR_FLOOR, t * 0.7);
    const floor = `<polygon data-side-corridor="${side}" data-branch-floor="${side}" data-branch-index="${i}" points="${joinPoints([
      { x: nearLeft, y: near.y },
      { x: nearRight, y: near.y },
      { x: farRight, y: far.y },
      { x: farLeft, y: far.y },
    ])}" fill="${baseColor}" fill-opacity="${0.9 - t * 0.25}" />`;
    const floorPattern = `<polygon data-side-corridor="${side}" data-branch-floor-pattern="${side}" data-branch-index="${i}" points="${joinPoints([
      { x: nearLeft, y: near.y },
      { x: nearRight, y: near.y },
      { x: farRight, y: far.y },
      { x: farLeft, y: far.y },
    ])}" fill="url(#floor-grid-pattern)" fill-opacity="${0.22 - t * 0.08}" />`;

    const outerWallX = isLeft ? nearLeft : nearRight;
    const outerWallFarX = isLeft ? farLeft : farRight;
    const innerWallX = isLeft ? nearRight : nearLeft;
    const innerWallFarX = isLeft ? farRight : farLeft;
    const topNear = wallTopY(near.y, t * 0.6);
    const topFar = wallTopY(far.y, t * 0.6);
    const wallColor = shadeColor(COLOR_WALL, t * 0.8);

    const outerWall = `<polygon data-side-corridor="${side}" data-branch-wall="${side}" data-branch-position="outer" data-branch-index="${i}" points="${joinPoints([
      { x: outerWallX, y: topNear },
      { x: outerWallX, y: near.y },
      { x: outerWallFarX, y: far.y },
      { x: outerWallFarX, y: topFar },
    ])}" fill="${wallColor}" fill-opacity="${0.9 - t * 0.22}" />`;
    const outerPattern = `<polygon data-side-corridor="${side}" data-branch-wall-pattern="${side}" data-branch-position="outer" data-branch-index="${i}" points="${joinPoints([
      { x: outerWallX, y: topNear },
      { x: outerWallX, y: near.y },
      { x: outerWallFarX, y: far.y },
      { x: outerWallFarX, y: topFar },
    ])}" fill="url(#wall-brick-pattern)" fill-opacity="${0.22 - t * 0.1}" />`;

    const innerWall = `<polygon data-side-corridor="${side}" data-branch-wall="${side}" data-branch-position="inner" data-branch-index="${i}" points="${joinPoints([
      { x: innerWallX, y: topNear },
      { x: innerWallX, y: near.y },
      { x: innerWallFarX, y: far.y },
      { x: innerWallFarX, y: topFar },
    ])}" fill="${shadeColor(COLOR_WALL, t * 0.6)}" fill-opacity="${0.85 - t * 0.2}" />`;
    const innerPattern = `<polygon data-side-corridor="${side}" data-branch-wall-pattern="${side}" data-branch-position="inner" data-branch-index="${i}" points="${joinPoints([
      { x: innerWallX, y: topNear },
      { x: innerWallX, y: near.y },
      { x: innerWallFarX, y: far.y },
      { x: innerWallFarX, y: topFar },
    ])}" fill="url(#wall-brick-pattern)" fill-opacity="${0.2 - t * 0.09}" />`;

    parts.push(floor, floorPattern, innerWall, innerPattern, outerWall, outerPattern);
  }

  return parts.join('\n');
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
    renderWallLayers('left', slices),
    renderWallLayers('right', slices),
    renderFloorLayers(slices),
  ];
  if (!openings.forward) {
    parts.push(renderForwardWall(0.22, 'start'));
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
    renderWallLayers('left', slices),
    renderWallLayers('right', slices),
    renderFloorLayers(slices),
  ];

  if (openings.left) {
    parts.push(renderSideBranch('left'));
  }
  if (openings.right) {
    parts.push(renderSideBranch('right'));
  }
  if (!openings.forward) {
    parts.push(renderForwardWall(0.28, 'junction'));
  }

  return parts.join('\n');
}

// goal view の奥に光る出口を描画
function renderGoalView(openings: Openings): string {
  const slices = createDepthSlices();
  const parts: string[] = [
    renderBaseDefs(),
    renderCeiling(),
    renderWallLayers('left', slices),
    renderWallLayers('right', slices),
    renderFloorLayers(slices),
    renderGoalPortal(slices),
  ];

  if (openings.left) {
    parts.push(renderSideBranch('left'));
  }
  if (openings.right) {
    parts.push(renderSideBranch('right'));
  }
  if (!openings.forward) {
    parts.push(renderForwardWall(0.3, 'goal'));
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
