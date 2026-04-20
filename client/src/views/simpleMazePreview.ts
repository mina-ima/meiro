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

// 側面分岐：壁の切れ目から横通路が見える3D描画
// 参考画像のように、壁のエッジ面（厚み）が見える自然な3D表現
function renderSideBranch(side: 'left' | 'right'): string {
  const isLeft = side === 'left';
  const dir = isLeft ? -1 : 1;

  // 開口部の奥行き範囲
  const tNear = 0.25;
  const tFar = 0.60;

  const wallNearEdge = isLeft ? CORRIDOR_NEAR_LEFT : CORRIDOR_NEAR_RIGHT;
  const wallFarEdge = isLeft ? CORRIDOR_FAR_LEFT : CORRIDOR_FAR_RIGHT;

  // 開口部の境界座標
  const openNearX = lerp(wallNearEdge, wallFarEdge, tNear);
  const openFarX = lerp(wallNearEdge, wallFarEdge, tFar);
  const openNearFloorY = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, tNear);
  const openFarFloorY = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, tFar);

  // 壁のエッジ面の奥行き（壁の厚みを表現する重要な3D要素）
  const wallDepth = 18 * dir;
  const edgeInnerX = openNearX + wallDepth;
  const edgeInnerFloorY = openNearFloorY - 8;

  // 横通路の奥壁の位置
  const sideDepth = 70 * dir;
  const farWallX = openNearX + sideDepth;
  const farWallFloorY = openNearFloorY - 25;

  // --- 描画順序：奥から手前へ ---

  // 1) 壁を手前と奥に分割
  const wallBefore = renderWallSide(side, 0, tNear);
  const wallAfter = renderWallSide(side, tFar, 1);

  // 2) 開口部背景（暗い空間）
  const openingBg = `<polygon data-branch-entry="${side}" points="${joinPoints([
    { x: openNearX, y: 0 },
    { x: openFarX, y: 0 },
    { x: openFarX, y: openFarFloorY },
    { x: openNearX, y: openNearFloorY },
  ])}" fill="${COLOR_BG}" />`;

  // 3) 横通路の奥壁（開口部を通して見える正面の壁）
  const farWall = `<polygon points="${joinPoints([
    { x: farWallX, y: 0 },
    { x: edgeInnerX, y: 0 },
    { x: edgeInnerX, y: edgeInnerFloorY },
    { x: farWallX, y: farWallFloorY },
  ])}" fill="url(#wall-brick-dark)" />`;

  // 4) 横通路の床
  const branchFloor = `<polygon data-branch-floor="${side}" points="${joinPoints([
    { x: openNearX, y: openNearFloorY },
    { x: openFarX, y: openFarFloorY },
    { x: edgeInnerX, y: edgeInnerFloorY },
    { x: farWallX, y: farWallFloorY },
  ])}" fill="${COLOR_FLOOR_DARK}" />`;

  // 5) 壁のエッジ面（壁の厚み＝3D奥行きの決定的な要素）
  // 参考画像で見える「壁の断面」を再現
  const wallEdge = `<polygon points="${joinPoints([
    { x: openNearX, y: 0 },
    { x: edgeInnerX, y: 0 },
    { x: edgeInnerX, y: edgeInnerFloorY },
    { x: openNearX, y: openNearFloorY },
  ])}" fill="${COLOR_WALL_SHADOW}" />`;

  // 6) 奥の開口エッジ（壁が再開する箇所の薄い影）
  const farEdgeW = isLeft ? 3 : -3;
  const farEdge = `<polygon points="${joinPoints([
    { x: openFarX, y: 0 },
    { x: openFarX + farEdgeW, y: 0 },
    { x: openFarX + farEdgeW, y: openFarFloorY },
    { x: openFarX, y: openFarFloorY },
  ])}" fill="${COLOR_WALL_DARK}" />`;

  return [wallBefore, openingBg, farWall, branchFloor, wallEdge, farEdge, wallAfter].join('\n');
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
