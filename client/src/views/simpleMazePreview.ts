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

// 床と地平線の位置
const FLOOR_NEAR_Y = 160; // 手前の床のY
const FLOOR_FAR_Y = 90; // 奥の床のY（地平線）

// メイン通路（黒い部分）の幅
const CORRIDOR_NEAR_LEFT = 120;
const CORRIDOR_NEAR_RIGHT = 200;
const CORRIDOR_FAR_LEFT = 150;
const CORRIDOR_FAR_RIGHT = 170;

// 床全体（茶色）の幅
const FLOOR_NEAR_LEFT = 40;
const FLOOR_NEAR_RIGHT = 280;
const FLOOR_FAR_LEFT = 110;
const FLOOR_FAR_RIGHT = 210;

// 色
const COLOR_BG = '#000000';
const COLOR_CEILING = '#050813';
const COLOR_FLOOR = '#8c4a32';
const COLOR_CORRIDOR = '#050508';
const COLOR_WALL = '#6c3a2c';
const COLOR_INNER_WALL = '#7a4230';
const COLOR_PORTAL = '#d3ecff';
const COLOR_PORTAL_FRAME = '#6f7580';

function joinPoints(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

// 天井
function renderCeiling(): string {
  return `<rect x="0" y="0" width="${WIDTH}" height="${FLOOR_FAR_Y}" fill="${COLOR_CEILING}" />`;
}

// 茶色い床（全体）
function renderMainFloor(): string {
  const pts = [
    { x: FLOOR_NEAR_LEFT, y: FLOOR_NEAR_Y },
    { x: FLOOR_NEAR_RIGHT, y: FLOOR_NEAR_Y },
    { x: FLOOR_FAR_RIGHT, y: FLOOR_FAR_Y },
    { x: FLOOR_FAR_LEFT, y: FLOOR_FAR_Y },
  ];
  return `<polygon data-floor="main" points="${joinPoints(pts)}" fill="${COLOR_FLOOR}" />`;
}

// 黒いメイン通路
function renderCorridorFloor(): string {
  const pts = [
    { x: CORRIDOR_NEAR_LEFT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_NEAR_RIGHT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_FAR_RIGHT, y: FLOOR_FAR_Y },
    { x: CORRIDOR_FAR_LEFT, y: FLOOR_FAR_Y },
  ];
  return `<polygon data-floor="corridor" points="${joinPoints(pts)}" fill="${COLOR_CORRIDOR}" />`;
}
// メイン通路の左右の内側壁（通路の壁）
// 通路の黒い床の両側に、縦長の四角い壁が立っているように見せる
// メイン通路の左右の内側壁（通路の壁）
// 通路の黒い床の両側に、縦長の台形が立っているように見せる
function renderCorridorWalls(): string {
  // 手前と奥で少しだけ高さを変える（軽い遠近感）
  const wallHeightNear = 60;
  const wallHeightFar = 45;

  // 左側の通路壁
  const leftWallPts = [
    // 下辺（床に接している辺：通路の左端）
    { x: CORRIDOR_NEAR_LEFT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_FAR_LEFT, y: FLOOR_FAR_Y },
    // 上辺（少し上に持ち上げた辺）
    { x: CORRIDOR_FAR_LEFT, y: FLOOR_FAR_Y - wallHeightFar },
    { x: CORRIDOR_NEAR_LEFT, y: FLOOR_NEAR_Y - wallHeightNear },
  ];

  // 右側の通路壁（左右を入れ替え）
  const rightWallPts = [
    { x: CORRIDOR_FAR_RIGHT, y: FLOOR_FAR_Y },
    { x: CORRIDOR_NEAR_RIGHT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_NEAR_RIGHT, y: FLOOR_NEAR_Y - wallHeightNear },
    { x: CORRIDOR_FAR_RIGHT, y: FLOOR_FAR_Y - wallHeightFar },
  ];

  const leftWall = `<polygon data-inner-wall="left" points="${joinPoints(
    leftWallPts,
  )}" fill="${COLOR_INNER_WALL}" />`;
  const rightWall = `<polygon data-inner-wall="right" points="${joinPoints(
    rightWallPts,
  )}" fill="${COLOR_INNER_WALL}" />`;

  return `${leftWall}\n${rightWall}`;
}


// 外側の左右の大きな壁
function renderSideWalls(): string {
  const leftWall = [
    { x: 0, y: 0 },
    { x: 0, y: HEIGHT },
    { x: FLOOR_NEAR_LEFT, y: FLOOR_NEAR_Y },
    { x: FLOOR_FAR_LEFT, y: FLOOR_FAR_Y },
    { x: 0, y: FLOOR_FAR_Y },
  ];
  const rightWall = [
    { x: FLOOR_NEAR_RIGHT, y: FLOOR_NEAR_Y },
    { x: WIDTH, y: HEIGHT },
    { x: WIDTH, y: 0 },
    { x: WIDTH, y: FLOOR_FAR_Y },
    { x: FLOOR_FAR_RIGHT, y: FLOOR_FAR_Y },
  ];

  return [
    `<polygon data-wall-side="left" points="${joinPoints(leftWall)}" fill="${COLOR_WALL}" />`,
    `<polygon data-wall-side="right" points="${joinPoints(rightWall)}" fill="${COLOR_WALL}" />`,
  ].join('\n');
}

// 前方の行き止まり壁
function renderFrontWall(depth: 'near' | 'far', label: string): string {
  const t = depth === 'near' ? 0.55 : 0.8;
  const y = FLOOR_NEAR_Y - (FLOOR_NEAR_Y - FLOOR_FAR_Y) * t;
  const left = CORRIDOR_NEAR_LEFT + (CORRIDOR_FAR_LEFT - CORRIDOR_NEAR_LEFT) * t;
  const right = CORRIDOR_NEAR_RIGHT + (CORRIDOR_FAR_RIGHT - CORRIDOR_NEAR_RIGHT) * t;

  const top = y - 45;
  const pts = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y },
    { x: left, y },
  ];
  return `<polygon data-forward-block="${label}" points="${joinPoints(pts)}" fill="${COLOR_WALL}" />`;
}

// ゴールの光る出口
function renderGoalPortal(): string {
  const t = 0.82;
  const y = FLOOR_NEAR_Y - (FLOOR_NEAR_Y - FLOOR_FAR_Y) * t;
  const left = CORRIDOR_NEAR_LEFT + (CORRIDOR_FAR_LEFT - CORRIDOR_NEAR_LEFT) * t;
  const right = CORRIDOR_NEAR_RIGHT + (CORRIDOR_FAR_RIGHT - CORRIDOR_NEAR_RIGHT) * t;

  const wallTop = y - 55;
  const wallBottom = y + 6;
  const wallPts = [
    { x: left - 22, y: wallTop },
    { x: right + 22, y: wallTop },
    { x: right + 22, y: wallBottom },
    { x: left - 22, y: wallBottom },
  ];

  const portalWidth = (right - left) * 0.7;
  const portalHeight = 40;
  const portalLeft = (left + right) / 2 - portalWidth / 2;
  const portalTop = wallTop + 10;

  const wall = `<polygon data-front-wall-fill="true" points="${joinPoints(
    wallPts,
  )}" fill="${COLOR_PORTAL_FRAME}" />`;
  const portal = `<rect data-goal-portal="true" x="${portalLeft}" y="${portalTop}" width="${portalWidth}" height="${portalHeight}" fill="${COLOR_PORTAL}" />`;

  return `${wall}\n${portal}`;
}

// 左右分岐の床と入口を、横に伸びる短い廊下としてシンプルに描く
function renderSideBranch(side: 'left' | 'right'): string {
  const isLeft = side === 'left';

  // 分岐が見える位置（メイン通路の中ほど）
  const baseT = 0.55;
  const baseY = FLOOR_NEAR_Y - (FLOOR_NEAR_Y - FLOOR_FAR_Y) * baseT;
  const farY = baseY - 22; // 少し奥に下がる

  // この高さでの内側壁の位置（通路の内側）
  const innerWallX = isLeft
    ? FLOOR_NEAR_LEFT + (FLOOR_FAR_LEFT - FLOOR_NEAR_LEFT) * baseT
    : FLOOR_NEAR_RIGHT + (FLOOR_FAR_RIGHT - FLOOR_NEAR_RIGHT) * baseT;

  // 入口幅（手前と奥で少し狭くする）
  const doorWidthNear = 40;
  const doorWidthFar = 26;

  const nearInnerX = innerWallX; // メイン通路側
  const nearOuterX = isLeft ? innerWallX - doorWidthNear : innerWallX + doorWidthNear;
  const farInnerX = innerWallX + (isLeft ? -8 : 8);
  const farOuterX = isLeft ? farInnerX - doorWidthFar : farInnerX + doorWidthFar;

  // 横通路の床（台形）
  const floorPts = [
    { x: nearInnerX, y: baseY },
    { x: nearOuterX, y: baseY },
    { x: farOuterX, y: farY },
    { x: farInnerX, y: farY },
  ];
  const floor = `<polygon data-side-corridor="${side}" data-branch-floor="${side}" points="${joinPoints(
    floorPts,
  )}" fill="${COLOR_FLOOR}" />`;

  // 壁の開口部（穴があいている感じにする）
  const doorHeight = 32;
  const doorTopY = baseY - doorHeight;
  const doorInnerX = innerWallX;
  const doorOuterX = isLeft ? innerWallX - (doorWidthNear - 4) : innerWallX + (doorWidthNear - 4);

  const doorPts = [
    { x: doorInnerX, y: baseY },
    { x: doorInnerX, y: doorTopY },
    { x: doorOuterX, y: doorTopY + 4 },
    { x: doorOuterX, y: baseY - 4 },
  ];

  const doorHole = `<polygon points="${joinPoints(
    doorPts,
  )}" fill="${COLOR_BG}" fill-opacity="0.9" />`;
  const doorFrame = `<polygon data-branch-entry="${side}" points="${joinPoints(
    doorPts,
  )}" fill="none" stroke="${COLOR_WALL}" stroke-width="1.5" stroke-opacity="0.9" />`;

  return [floor, doorHole, doorFrame].join('\n');
}

// スタートビュー（一本道）
// スタートビュー（一本道）
function renderStartView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderCeiling());
  parts.push(renderSideWalls());
  parts.push(renderMainFloor());
  // 先に床（黒い通路）を描いてから、通路壁を上に重ねる
  parts.push(renderCorridorFloor());
  parts.push(renderCorridorWalls());

  if (!openings.forward) {
    parts.push(renderFrontWall('near', 'start'));
  }
  return parts.join('\n');
}


// 分岐ビュー（十字路/T字路）
// 分岐ビュー（十字路/T字路）
function renderJunctionView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderCeiling());
  parts.push(renderSideWalls());
  parts.push(renderMainFloor());
  parts.push(renderCorridorFloor());
  parts.push(renderCorridorWalls());

  if (openings.left) {
    parts.push(renderSideBranch('left'));
  }
  if (openings.right) {
    parts.push(renderSideBranch('right'));
  }
  if (!openings.forward) {
    parts.push(renderFrontWall('near', 'junction'));
  }

  return parts.join('\n');
}


// ゴールビュー（出口 + 必要なら左右分岐）
// ゴールビュー（出口 + 必要なら左右分岐）
function renderGoalView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderCeiling());
  parts.push(renderSideWalls());
  parts.push(renderMainFloor());
  parts.push(renderCorridorFloor());
  parts.push(renderCorridorWalls());
  parts.push(renderGoalPortal());

  if (openings.left) {
    parts.push(renderSideBranch('left'));
  }
  if (openings.right) {
    parts.push(renderSideBranch('right'));
  }
  if (!openings.forward) {
    parts.push(renderFrontWall('near', 'goal'));
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
