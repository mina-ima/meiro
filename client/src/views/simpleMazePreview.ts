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

// 通路両側の壁（床から画面上端まで）
function renderCorridorWalls(): string {
  // 左側の壁：黒い通路の左端に沿って、床から画面上端まで
  const leftWallPts = [
    { x: CORRIDOR_NEAR_LEFT, y: FLOOR_NEAR_Y }, // 手前・床
    { x: CORRIDOR_FAR_LEFT, y: FLOOR_FAR_Y },   // 奥・床
    { x: CORRIDOR_FAR_LEFT, y: 0 },             // 奥・上端
    { x: CORRIDOR_NEAR_LEFT, y: 0 },            // 手前・上端
  ];

  // 右側の壁
  const rightWallPts = [
    { x: CORRIDOR_FAR_RIGHT, y: FLOOR_FAR_Y },   // 奥・床
    { x: CORRIDOR_NEAR_RIGHT, y: FLOOR_NEAR_Y }, // 手前・床
    { x: CORRIDOR_NEAR_RIGHT, y: 0 },            // 手前・上端
    { x: CORRIDOR_FAR_RIGHT, y: 0 },             // 奥・上端
  ];

  const left = `<polygon data-wall-side="left" points="${joinPoints(
    leftWallPts,
  )}" fill="${COLOR_WALL}" />`;
  const right = `<polygon data-wall-side="right" points="${joinPoints(
    rightWallPts,
  )}" fill="${COLOR_WALL}" />`;

  return `${left}\n${right}`;
}

// 正面の行き止まり壁（床から画面上端まで）
function renderFrontWall(label: string, depth: 'near' | 'far' = 'near'): string {
  const t = depth === 'near' ? 0.7 : 0.9;
  const bottomY = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t);
  const left = lerp(CORRIDOR_NEAR_LEFT, CORRIDOR_FAR_LEFT, t);
  const right = lerp(CORRIDOR_NEAR_RIGHT, CORRIDOR_FAR_RIGHT, t);

  const pts = [
    { x: left, y: 0 },       // 上端
    { x: right, y: 0 },
    { x: right, y: bottomY }, // 床との接点
    { x: left, y: bottomY },
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

// 左右分岐（横に伸びる通路）を描く
// 床面から天井まで壁がなく開いていて、奥に伸びる床と側面の壁が見えるようにする
function renderSideBranch(side: 'left' | 'right'): string {
  const isLeft = side === 'left';

  // 分岐が見える位置（奥行き）：通路のだいたい真ん中
  const t = 0.55;
  const baseY = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t);
  const innerX = isLeft
    ? lerp(CORRIDOR_NEAR_LEFT, CORRIDOR_FAR_LEFT, t)
    : lerp(CORRIDOR_NEAR_RIGHT, CORRIDOR_FAR_RIGHT, t);

  // 横通路の奥行きと幅
  const branchDepth = 40;
  const nearWidth = 45;
  const farWidth = 30;

  const nearInner = innerX;
  const nearOuter = isLeft ? innerX - nearWidth : innerX + nearWidth;

  const farY = baseY - branchDepth;
  const farInner = innerX + (isLeft ? -10 : 10);
  const farOuter = isLeft ? farInner - farWidth : farInner + farWidth;

  // 1) 横通路の床（台形）
  const floorPts = [
    { x: nearInner, y: baseY },
    { x: nearOuter, y: baseY },
    { x: farOuter, y: farY },
    { x: farInner, y: farY },
  ];
  const floor = `<polygon data-side-corridor="${side}" data-branch-floor="${side}" points="${joinPoints(
    floorPts,
  )}" fill="${COLOR_FLOOR}" />`;

  // 2) 分岐通路の左右の壁（床から天井まで）
  const innerWallPts = [
    { x: nearInner, y: baseY },
    { x: farInner, y: farY },
    { x: farInner, y: 0 },
    { x: nearInner, y: 0 },
  ];
  const outerWallPts = [
    { x: nearOuter, y: baseY },
    { x: farOuter, y: farY },
    { x: farOuter, y: 0 },
    { x: nearOuter, y: 0 },
  ];

  const innerWall = `<polygon data-branch-wall="${side}" data-branch-position="inner" points="${joinPoints(
    innerWallPts,
  )}" fill="${COLOR_WALL}" />`;
  const outerWall = `<polygon data-branch-wall="${side}" data-branch-position="outer" points="${joinPoints(
    outerWallPts,
  )}" fill="${COLOR_WALL_DARK}" />`;

  // 3) メイン通路側の「入口の縁取り」だけ残す（穴だけに見えないよう控えめに）
  const doorTop = baseY - 40;
  const doorInner = innerX;
  const doorOuter = isLeft ? innerX - (nearWidth - 6) : innerX + (nearWidth - 6);
  const doorPts = [
    { x: doorInner, y: baseY },
    { x: doorInner, y: doorTop },
    { x: doorOuter, y: doorTop + 6 },
    { x: doorOuter, y: baseY - 6 },
  ];
  const frame = `<polygon data-branch-entry="${side}" points="${joinPoints(
    doorPts,
  )}" fill="none" stroke="${COLOR_WALL}" stroke-width="2" stroke-opacity="0.8" />`;

  return [floor, innerWall, outerWall, frame].join('\n');
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
