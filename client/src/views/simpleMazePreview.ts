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

// 通路の床と奥の位置
const FLOOR_NEAR_Y = 165; // 手前の床
const FLOOR_FAR_Y = 90; // 奥（4マス先くらいのイメージ）

// 通路の幅（手前と奥）
const CORRIDOR_NEAR_LEFT = 40;
const CORRIDOR_NEAR_RIGHT = WIDTH - 40;
const CORRIDOR_FAR_LEFT = WIDTH / 2 - 35;
const CORRIDOR_FAR_RIGHT = WIDTH / 2 + 35;

// 色
const COLOR_BG = '#000000';
const COLOR_CEILING = '#050813';
const COLOR_FLOOR = '#8c4a32';
const COLOR_FLOOR_DARK = '#3a2014';
const COLOR_WALL = '#6c3a2c';
const COLOR_WALL_DARK = '#3e2118';
const COLOR_PORTAL = '#d3ecff';
const COLOR_PORTAL_FRAME = '#6f7580';

function joinPoints(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// 天井
function renderCeiling(): string {
  return `<rect x="0" y="0" width="${WIDTH}" height="${FLOOR_FAR_Y}" fill="${COLOR_CEILING}" />`;
}

// 通路の床（手前は明るく、奥は暗くなる）
function renderCorridorFloor(): string {
  const pts = [
    { x: CORRIDOR_NEAR_LEFT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_NEAR_RIGHT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_FAR_RIGHT, y: FLOOR_FAR_Y },
    { x: CORRIDOR_FAR_LEFT, y: FLOOR_FAR_Y },
  ];

  const gradId = 'corridor-floor-grad';
  const defs = `
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="${FLOOR_NEAR_Y}" x2="0" y2="${FLOOR_FAR_Y}">
        <stop offset="0%" stop-color="${COLOR_FLOOR}" />
        <stop offset="100%" stop-color="${COLOR_FLOOR_DARK}" />
      </linearGradient>
    </defs>
  `;

  const floor = `<polygon data-floor="corridor" points="${joinPoints(
    pts,
  )}" fill="url(#${gradId})" />`;

  // 4マスより先は真っ黒で良い → 奥の上半分を黒で塗る
  const fadeTop = FLOOR_FAR_Y - 4;
  const farFade = `<rect x="${CORRIDOR_FAR_LEFT}" y="0" width="${
    CORRIDOR_FAR_RIGHT - CORRIDOR_FAR_LEFT
  }" height="${fadeTop}" fill="${COLOR_BG}" />`;

  return `${defs}\n${floor}\n${farFade}`;
}

// 通路両側の壁（視点が通路内になるように高めに）
function renderCorridorWalls(): string {
  const wallHeightNear = 110; // 今の約2倍の高さ
  const wallHeightFar = 80;

  // 左壁
  const leftWallPts = [
    // 下辺（床と接する辺）
    { x: CORRIDOR_NEAR_LEFT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_FAR_LEFT, y: FLOOR_FAR_Y },
    // 上辺
    { x: CORRIDOR_FAR_LEFT, y: FLOOR_FAR_Y - wallHeightFar },
    { x: CORRIDOR_NEAR_LEFT, y: FLOOR_NEAR_Y - wallHeightNear },
  ];

  // 右壁
  const rightWallPts = [
    { x: CORRIDOR_FAR_RIGHT, y: FLOOR_FAR_Y },
    { x: CORRIDOR_NEAR_RIGHT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_NEAR_RIGHT, y: FLOOR_NEAR_Y - wallHeightNear },
    { x: CORRIDOR_FAR_RIGHT, y: FLOOR_FAR_Y - wallHeightFar },
  ];

  const left = `<polygon data-wall-side="left" points="${joinPoints(
    leftWallPts,
  )}" fill="${COLOR_WALL}" />`;
  const right = `<polygon data-wall-side="right" points="${joinPoints(
    rightWallPts,
  )}" fill="${COLOR_WALL}" />`;

  return `${left}\n${right}`;
}

// 正面の行き止まり壁
function renderFrontWall(label: string, depth: 'near' | 'far' = 'near'): string {
  const t = depth === 'near' ? 0.7 : 0.9;
  const y = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t);
  const left = lerp(CORRIDOR_NEAR_LEFT, CORRIDOR_FAR_LEFT, t);
  const right = lerp(CORRIDOR_NEAR_RIGHT, CORRIDOR_FAR_RIGHT, t);
  const top = y - 80;

  const pts = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y },
    { x: left, y },
  ];
  return `<polygon data-forward-block="${label}" points="${joinPoints(
    pts,
  )}" fill="${COLOR_WALL_DARK}" />`;
}

// ゴールの光る出口（通路奥の壁に開いた窓）
function renderGoalPortal(): string {
  const wallBottom = FLOOR_FAR_Y;
  const wallTop = wallBottom - 80;
  const left = CORRIDOR_FAR_LEFT;
  const right = CORRIDOR_FAR_RIGHT;

  const wallPts = [
    { x: left, y: wallTop },
    { x: right, y: wallTop },
    { x: right, y: wallBottom },
    { x: left, y: wallBottom },
  ];

  const portalWidth = (right - left) * 0.4;
  const portalHeight = wallBottom - wallTop - 16;
  const portalLeft = (left + right) / 2 - portalWidth / 2;
  const portalTop = wallTop + 8;

  const wall = `<polygon data-front-wall-fill="true" points="${joinPoints(
    wallPts,
  )}" fill="${COLOR_PORTAL_FRAME}" />`;
  const portal = `<rect data-goal-portal="true" x="${portalLeft}" y="${portalTop}" width="${portalWidth}" height="${portalHeight}" fill="${COLOR_PORTAL}" />`;

  return `${wall}\n${portal}`;
}

// 左右分岐（横に伸びる通路をはっきり描く）
function renderSideBranch(side: 'left' | 'right'): string {
  const isLeft = side === 'left';

  // 分岐が見える奥行き（通路の真ん中あたり）
  const t = 0.55;
  const y = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t);
  const innerX = isLeft
    ? lerp(CORRIDOR_NEAR_LEFT, CORRIDOR_FAR_LEFT, t)
    : lerp(CORRIDOR_NEAR_RIGHT, CORRIDOR_FAR_RIGHT, t);

  const branchDepth = 35;
  const branchWidthNear = 38;
  const branchWidthFar = 26;

  const nearInner = innerX;
  const nearOuter = isLeft ? innerX - branchWidthNear : innerX + branchWidthNear;
  const farY = y - branchDepth;
  const farInner = innerX + (isLeft ? -8 : 8);
  const farOuter = isLeft ? farInner - branchWidthFar : farInner + branchWidthFar;

  // 横通路の床
  const floorPts = [
    { x: nearInner, y: y },
    { x: nearOuter, y: y },
    { x: farOuter, y: farY },
    { x: farInner, y: farY },
  ];
  const floor = `<polygon data-side-corridor="${side}" data-branch-floor="${side}" points="${joinPoints(
    floorPts,
  )}" fill="${COLOR_FLOOR}" />`;

  // 壁に開いた四角い穴（入口）
  const doorHeight = 40;
  const doorTop = y - doorHeight;
  const doorInner = innerX;
  const doorOuter = isLeft ? innerX - (branchWidthNear - 6) : innerX + (branchWidthNear - 6);
  const doorPts = [
    { x: doorInner, y: y },
    { x: doorInner, y: doorTop },
    { x: doorOuter, y: doorTop + 6 },
    { x: doorOuter, y: y - 6 },
  ];

  const hole = `<polygon points="${joinPoints(
    doorPts,
  )}" fill="${COLOR_BG}" fill-opacity="0.95" />`;
  const frame = `<polygon data-branch-entry="${side}" points="${joinPoints(
    doorPts,
  )}" fill="none" stroke="${COLOR_WALL}" stroke-width="2" stroke-opacity="0.9" />`;

  return [floor, hole, frame].join('\n');
}

// スタートビュー（一本道）
function renderStartView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderCeiling());
  parts.push(renderCorridorFloor());
  parts.push(renderCorridorWalls());

  if (!openings.forward) {
    parts.push(renderFrontWall('start', 'near'));
  }
  return parts.join('\n');
}

// 分岐ビュー（正面は壁 + 左右に横通路）
function renderJunctionView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderCeiling());
  parts.push(renderCorridorFloor());
  parts.push(renderCorridorWalls());

  if (openings.left) {
    parts.push(renderSideBranch('left'));
  }
  if (openings.right) {
    parts.push(renderSideBranch('right'));
  }

  // 分岐ポイントは常に突き当たりに見せる
  parts.push(renderFrontWall('junction', 'near'));

  return parts.join('\n');
}

// ゴールビュー（奥の壁に光る出口）
function renderGoalView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderCeiling());
  parts.push(renderCorridorFloor());
  parts.push(renderCorridorWalls());
  parts.push(renderGoalPortal());

  if (openings.left) {
    parts.push(renderSideBranch('left'));
  }
  if (openings.right) {
    parts.push(renderSideBranch('right'));
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
