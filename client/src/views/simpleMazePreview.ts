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

// 床と奥の位置
const FLOOR_NEAR_Y = HEIGHT; // 手前の床は画面下端まで
const FLOOR_FAR_Y = 70; // 奥（消失点）

// 通路の幅（手前と奥）
const CORRIDOR_NEAR_LEFT = 30;
const CORRIDOR_NEAR_RIGHT = WIDTH - 30; // 290
const CORRIDOR_FAR_LEFT = WIDTH / 2 - 30; // 130
const CORRIDOR_FAR_RIGHT = WIDTH / 2 + 30; // 190

// 色（新しいカラーパレット：理想の3D迷路に近い配色）
const COLOR_BG = '#202830';
const COLOR_SKY = '#8898a8';
const COLOR_SKY_HORIZON = '#b8c8c0';
const COLOR_FLOOR = '#586878';
const COLOR_FLOOR_DARK = '#384048';
const COLOR_WALL = '#a08868';
const COLOR_WALL_SHADOW = '#786050';
const COLOR_WALL_DARK = '#504038';
const COLOR_PORTAL = '#d3ecff';
const COLOR_PORTAL_FRAME = '#6f7580';

function joinPoints(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// パターン定義
function renderDefs(): string {
  return `
    <defs>
      <pattern id="wall-brick" patternUnits="userSpaceOnUse" width="16" height="12">
        <rect x="0" y="0" width="16" height="12" fill="${COLOR_WALL}" />
        <line x1="0" y1="6" x2="16" y2="6" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1" />
        <line x1="8" y1="0" x2="8" y2="6" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1" />
        <line x1="0" y1="12" x2="16" y2="12" stroke="#000000" stroke-opacity="0.08" stroke-width="1" />
      </pattern>
      <pattern id="wall-brick-dark" patternUnits="userSpaceOnUse" width="16" height="12">
        <rect x="0" y="0" width="16" height="12" fill="${COLOR_WALL_SHADOW}" />
        <line x1="0" y1="6" x2="16" y2="6" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1" />
        <line x1="8" y1="0" x2="8" y2="6" stroke="#ffffff" stroke-opacity="0.04" stroke-width="1" />
      </pattern>
      <linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="${FLOOR_FAR_Y}">
        <stop offset="0%" stop-color="${COLOR_SKY}" />
        <stop offset="100%" stop-color="${COLOR_SKY_HORIZON}" />
      </linearGradient>
      <linearGradient id="corridor-floor-grad" x1="0" y1="${FLOOR_NEAR_Y}" x2="0" y2="${FLOOR_FAR_Y}">
        <stop offset="0%" stop-color="${COLOR_FLOOR}" />
        <stop offset="100%" stop-color="${COLOR_FLOOR_DARK}" />
      </linearGradient>
    </defs>
  `;
}

// 天井（空のグラデーション）
function renderCeiling(): string {
  return `<rect x="0" y="0" width="${WIDTH}" height="${FLOOR_FAR_Y}" fill="url(#sky-grad)" />`;
}

// 通路の床
function renderCorridorFloor(): string {
  const pts = [
    { x: CORRIDOR_NEAR_LEFT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_NEAR_RIGHT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_FAR_RIGHT, y: FLOOR_FAR_Y },
    { x: CORRIDOR_FAR_LEFT, y: FLOOR_FAR_Y },
  ];

  const floor = `<polygon data-floor="corridor" data-floor-layer="main" points="${joinPoints(pts)}" fill="url(#corridor-floor-grad)" />`;

  const vanishX = (CORRIDOR_FAR_LEFT + CORRIDOR_FAR_RIGHT) / 2;
  const vanishY = FLOOR_FAR_Y;
  let guideLines = '';
  for (let i = 1; i < 6; i += 1) {
    const t = i / 6;
    const xNear = lerp(CORRIDOR_NEAR_LEFT, CORRIDOR_NEAR_RIGHT, t);
    guideLines += `<line x1="${xNear}" y1="${FLOOR_NEAR_Y}" x2="${vanishX}" y2="${vanishY}" stroke="#000000" stroke-opacity="0.2" stroke-width="1" />`;
  }

  return `${floor}\n${guideLines}`;
}

// 通路の壁（片側）
function renderWallSide(side: 'left' | 'right', t1 = 0, t2 = 1): string {
  const isLeft = side === 'left';
  const nearX = isLeft ? CORRIDOR_NEAR_LEFT : CORRIDOR_NEAR_RIGHT;
  const farX = isLeft ? CORRIDOR_FAR_LEFT : CORRIDOR_FAR_RIGHT;

  const x1 = lerp(nearX, farX, t1);
  const y1 = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t1);
  const x2 = lerp(nearX, farX, t2);
  const y2 = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t2);

  const pts = isLeft
    ? [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
        { x: x2, y: 0 },
        { x: x1, y: 0 },
      ]
    : [
        { x: x2, y: y2 },
        { x: x1, y: y1 },
        { x: x1, y: 0 },
        { x: x2, y: 0 },
      ];

  return `<polygon data-wall-side="${side}" data-wall-layer="main" points="${joinPoints(pts)}" fill="url(#wall-brick)" />`;
}

// 通路両側の壁（完全な壁）
function renderCorridorWalls(): string {
  return `${renderWallSide('left')}\n${renderWallSide('right')}`;
}

// 正面の行き止まり壁
function renderFrontWall(label: string, depth: 'near' | 'far' = 'near'): string {
  const t = depth === 'near' ? 0.7 : 0.9;
  const bottomY = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t);
  const left = lerp(CORRIDOR_NEAR_LEFT, CORRIDOR_FAR_LEFT, t);
  const right = lerp(CORRIDOR_NEAR_RIGHT, CORRIDOR_FAR_RIGHT, t);

  const pts = [
    { x: left, y: 0 },
    { x: right, y: 0 },
    { x: right, y: bottomY },
    { x: left, y: bottomY },
  ];

  return `<polygon data-forward-block="${label}" points="${joinPoints(pts)}" fill="url(#wall-brick-dark)" />`;
}

// ゴールの光る出口
function renderGoalPortal(): string {
  const left = CORRIDOR_FAR_LEFT;
  const right = CORRIDOR_FAR_RIGHT;

  const wallPts = [
    { x: left, y: 0 },
    { x: right, y: 0 },
    { x: right, y: FLOOR_FAR_Y },
    { x: left, y: FLOOR_FAR_Y },
  ];

  const portalWidth = (right - left) * 0.45;
  const portalHeight = FLOOR_FAR_Y - 18;
  const portalLeft = (left + right) / 2 - portalWidth / 2;
  const portalTop = 9;

  const wall = `<polygon points="${joinPoints(wallPts)}" fill="${COLOR_PORTAL_FRAME}" />`;
  const portal = `<rect x="${portalLeft}" y="${portalTop}" width="${portalWidth}" height="${portalHeight}" fill="${COLOR_PORTAL}" rx="2" />`;
  const glow = `<rect x="${portalLeft - 3}" y="${portalTop - 3}" width="${portalWidth + 6}" height="${portalHeight + 6}" fill="${COLOR_PORTAL}" opacity="0.15" rx="4" />`;

  return `${wall}\n${glow}\n${portal}`;
}

// 側面分岐：壁に全高の開口部を作り、奥行きのある横通路を描画
function renderSideBranch(side: 'left' | 'right'): string {
  const isLeft = side === 'left';

  // 開口部の奥行き範囲（通路の手前～奥）
  const t1 = 0.28;
  const t2 = 0.62;

  const nearX_wall = isLeft ? CORRIDOR_NEAR_LEFT : CORRIDOR_NEAR_RIGHT;
  const farX_wall = isLeft ? CORRIDOR_FAR_LEFT : CORRIDOR_FAR_RIGHT;

  // 開口部の壁上の座標
  const openNearX = lerp(nearX_wall, farX_wall, t1);
  const openFarX = lerp(nearX_wall, farX_wall, t2);
  const openNearFloorY = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t1);
  const openFarFloorY = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t2);

  // 1) 開口部の背景（壁を覆い隠す暗い空間）
  const openingBg = `<polygon data-branch-entry="${side}" points="${joinPoints([
    { x: openNearX, y: 0 },
    { x: openFarX, y: 0 },
    { x: openFarX, y: openFarFloorY },
    { x: openNearX, y: openNearFloorY },
  ])}" fill="${COLOR_BG}" />`;

  // 2) 横通路の奥の壁
  const branchDir = isLeft ? -1 : 1;
  const branchExtent = 65;
  const farWallNearX = openNearX + branchDir * branchExtent * 0.75;
  const farWallFarX = openFarX + branchDir * branchExtent * 0.45;
  const farWallNearFloorY = openNearFloorY - 18;
  const farWallFarFloorY = openFarFloorY - 12;

  const farWall = `<polygon points="${joinPoints([
    { x: farWallNearX, y: 0 },
    { x: farWallFarX, y: 0 },
    { x: farWallFarX, y: farWallFarFloorY },
    { x: farWallNearX, y: farWallNearFloorY },
  ])}" fill="url(#wall-brick-dark)" />`;

  // 3) 横通路の床
  const branchFloor = `<polygon data-branch-floor="${side}" points="${joinPoints([
    { x: openNearX, y: openNearFloorY },
    { x: openFarX, y: openFarFloorY },
    { x: farWallFarX, y: farWallFarFloorY },
    { x: farWallNearX, y: farWallNearFloorY },
  ])}" fill="${COLOR_FLOOR_DARK}" />`;

  // 4) 開口部の奥エッジ（壁の断面＝奥行き感を出す）
  const edgeWidth = isLeft ? 4 : -4;
  const edgePts = [
    { x: openFarX, y: 0 },
    { x: openFarX + edgeWidth, y: 0 },
    { x: openFarX + edgeWidth, y: openFarFloorY },
    { x: openFarX, y: openFarFloorY },
  ];
  const edge = `<polygon points="${joinPoints(edgePts)}" fill="${COLOR_WALL_DARK}" />`;

  // 5) 開口部の手前エッジ
  const nearEdgeWidth = isLeft ? 3 : -3;
  const nearEdgePts = [
    { x: openNearX, y: 0 },
    { x: openNearX + nearEdgeWidth, y: 0 },
    { x: openNearX + nearEdgeWidth, y: openNearFloorY },
    { x: openNearX, y: openNearFloorY },
  ];
  const nearEdge = `<polygon points="${joinPoints(nearEdgePts)}" fill="${COLOR_WALL_SHADOW}" />`;

  // 壁を開口部の前後に分割して描画
  const wallBefore = renderWallSide(side, 0, t1);
  const wallAfter = renderWallSide(side, t2, 1);

  return [wallBefore, openingBg, farWall, branchFloor, edge, nearEdge, wallAfter].join('\n');
}

// スタートビュー
function renderStartView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderDefs());
  parts.push(renderCeiling());
  parts.push(renderCorridorFloor());
  parts.push(renderCorridorWalls());

  if (!openings.forward) {
    parts.push(renderFrontWall('start', 'near'));
  }

  return parts.join('\n');
}

// 分岐ビュー
function renderJunctionView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderDefs());
  parts.push(renderCeiling());
  parts.push(renderCorridorFloor());

  // 分岐がある側は壁を分割して開口部を描画、ない側は完全な壁
  if (openings.left) {
    parts.push(renderSideBranch('left'));
  } else {
    parts.push(renderWallSide('left'));
  }

  if (openings.right) {
    parts.push(renderSideBranch('right'));
  } else {
    parts.push(renderWallSide('right'));
  }

  if (!openings.forward) {
    parts.push(renderFrontWall('junction', 'near'));
  }

  return parts.join('\n');
}

// ゴールビュー
function renderGoalView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderDefs());
  parts.push(renderCeiling());
  parts.push(renderCorridorFloor());

  if (openings.left) {
    parts.push(renderSideBranch('left'));
  } else {
    parts.push(renderWallSide('left'));
  }

  if (openings.right) {
    parts.push(renderSideBranch('right'));
  } else {
    parts.push(renderWallSide('right'));
  }

  parts.push(renderGoalPortal());

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
