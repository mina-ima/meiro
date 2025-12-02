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
const FLOOR_NEAR_Y = 165; // 手前の床
const FLOOR_FAR_Y = 95; // 奥（4マス先くらいのイメージ）

// 通路の幅（手前と奥）
const CORRIDOR_NEAR_LEFT = 40;
const CORRIDOR_NEAR_RIGHT = WIDTH - 40; // 280
const CORRIDOR_FAR_LEFT = WIDTH / 2 - 35; // 125
const CORRIDOR_FAR_RIGHT = WIDTH / 2 + 35; // 195

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

// パターン定義（レンガ・床の模様）
function renderDefs(): string {
  return `
    <defs>
      <!-- 壁用レンガパターン -->
      <pattern id="wall-brick" patternUnits="userSpaceOnUse" width="16" height="12">
        <rect x="0" y="0" width="16" height="12" fill="${COLOR_WALL}" />
        <line x1="0" y1="6" x2="16" y2="6" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1" />
        <line x1="8" y1="0" x2="8" y2="6" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1" />
      </pattern>

      <!-- 床用のタイルっぽいグリッド -->
      <pattern id="floor-grid" patternUnits="userSpaceOnUse" width="18" height="18">
        <rect x="0" y="0" width="18" height="18" fill="${COLOR_FLOOR}" />
        <path d="M0 18 L18 0" stroke="#000000" stroke-opacity="0.25" stroke-width="1" />
        <path d="M-18 18 L18 -18" stroke="#000000" stroke-opacity="0.12" stroke-width="1" />
      </pattern>

      <!-- 通路床の奥行きグラデーション -->
      <linearGradient id="corridor-floor-grad" x1="0" y1="${FLOOR_NEAR_Y}" x2="0" y2="${FLOOR_FAR_Y}">
        <stop offset="0%" stop-color="${COLOR_FLOOR}" />
        <stop offset="100%" stop-color="${COLOR_FLOOR_DARK}" />
      </linearGradient>
    </defs>
  `;
}

// 天井
function renderCeiling(): string {
  return `<rect x="0" y="0" width="${WIDTH}" height="${FLOOR_FAR_Y}" fill="${COLOR_CEILING}" />`;
}

// 通路の床（手前は明るく、奥は暗く）＋奥に収束する線
function renderCorridorFloor(): string {
  const pts = [
    { x: CORRIDOR_NEAR_LEFT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_NEAR_RIGHT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_FAR_RIGHT, y: FLOOR_FAR_Y },
    { x: CORRIDOR_FAR_LEFT, y: FLOOR_FAR_Y },
  ];

  // すでに renderDefs で corridor-floor-grad を定義している前提
  const floor = `<polygon data-floor="corridor" points="${joinPoints(
    pts,
  )}" fill="url(#corridor-floor-grad)" />`;

  // 奥に収束するガイドライン（床のタイルっぽい線）
  const vanishX = (CORRIDOR_FAR_LEFT + CORRIDOR_FAR_RIGHT) / 2;
  const vanishY = FLOOR_FAR_Y;
  const numLines = 6;
  let guideLines = '';

  for (let i = 1; i < numLines; i += 1) {
    const t = i / numLines;
    const xNear = lerp(CORRIDOR_NEAR_LEFT, CORRIDOR_NEAR_RIGHT, t);
    guideLines += `<line x1="${xNear}" y1="${FLOOR_NEAR_Y}" x2="${vanishX}" y2="${vanishY}" stroke="#000000" stroke-opacity="0.3" stroke-width="1" />`;
  }

  // 4マスより先は真っ黒で良い → 奥の上半分を黒で塗る
  const fadeTop = FLOOR_FAR_Y - 4;
  const farFade = `<rect x="${CORRIDOR_FAR_LEFT}" y="0" width="${
    CORRIDOR_FAR_RIGHT - CORRIDOR_FAR_LEFT
  }" height="${fadeTop}" fill="${COLOR_BG}" />`;

  return `${floor}\n${guideLines}\n${farFade}`;
}


// 通路両側の壁（床から画面上端まで）＋レンガ模様
function renderCorridorWalls(): string {
  // 左側の壁
  const leftWallPts = [
    { x: CORRIDOR_NEAR_LEFT, y: FLOOR_NEAR_Y }, // 手前・床
    { x: CORRIDOR_FAR_LEFT, y: FLOOR_FAR_Y }, // 奥・床
    { x: CORRIDOR_FAR_LEFT, y: 0 }, // 奥・上端
    { x: CORRIDOR_NEAR_LEFT, y: 0 }, // 手前・上端
  ];

  // 右側の壁
  const rightWallPts = [
    { x: CORRIDOR_FAR_RIGHT, y: FLOOR_FAR_Y },
    { x: CORRIDOR_NEAR_RIGHT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_NEAR_RIGHT, y: 0 },
    { x: CORRIDOR_FAR_RIGHT, y: 0 },
  ];

  const leftWall = `<polygon data-wall-side="left" points="${joinPoints(
    leftWallPts,
  )}" fill="url(#wall-brick)" />`;
  const rightWall = `<polygon data-wall-side="right" points="${joinPoints(
    rightWallPts,
  )}" fill="url(#wall-brick)" />`;

  return `${leftWall}\n${rightWall}`;
}

// 正面の行き止まり壁（床から画面上端まで）
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

  return `<polygon data-forward-block="${label}" points="${joinPoints(
    pts,
  )}" fill="${COLOR_WALL_DARK}" />`;
}

// ゴールの光る出口（通路奥の壁に開いた窓）
function renderGoalPortal(): string {
  // 壁を画面上端から、奥の床までぴったり
  const wallTop = 0;
  const wallBottom = FLOOR_FAR_Y;
  const left = CORRIDOR_FAR_LEFT;
  const right = CORRIDOR_FAR_RIGHT;

  const wallPts = [
    { x: left, y: wallTop },
    { x: right, y: wallTop },
    { x: right, y: wallBottom },
    { x: left, y: wallBottom },
  ];

  const portalWidth = (right - left) * 0.45;
  const portalHeight = wallBottom - wallTop - 18;
  const portalLeft = (left + right) / 2 - portalWidth / 2;
  const portalTop = wallTop + 9;

  const wall = `<polygon data-front-wall-fill="true" points="${joinPoints(
    wallPts,
  )}" fill="${COLOR_PORTAL_FRAME}" />`;
  const portal = `<rect data-goal-portal="true" x="${portalLeft}" y="${portalTop}" width="${portalWidth}" height="${portalHeight}" fill="${COLOR_PORTAL}" />`;

  return `${wall}\n${portal}`;
}



// 左右分岐（横に伸びる通路）
// 床面から天井まで壁がなく開いていて、その先に横通路の床と側面が見えるようにする
function renderSideBranch(side: 'left' | 'right'): string {
  const isLeft = side === 'left';

  // 分岐が見える奥行き（通路の真ん中付近）
  const t = 0.55;
  const baseY = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t);
  const innerX = isLeft
    ? lerp(CORRIDOR_NEAR_LEFT, CORRIDOR_FAR_LEFT, t)
    : lerp(CORRIDOR_NEAR_RIGHT, CORRIDOR_FAR_RIGHT, t);

  // 横通路の奥行きと幅
  const branchDepth = 40;
  const nearWidth = 50;
  const farWidth = 35;

  const nearInner = innerX;
  const nearOuter = isLeft ? innerX - nearWidth : innerX + nearWidth;

  const farY = baseY - branchDepth;
  const farInner = innerX + (isLeft ? -10 : 10);
  const farOuter = isLeft ? farInner - farWidth : farInner + farWidth;

  // 1) 横通路の床
  const floorPts = [
    { x: nearInner, y: baseY },
    { x: nearOuter, y: baseY },
    { x: farOuter, y: farY },
    { x: farInner, y: farY },
  ];
  const floor = `<polygon data-side-corridor="${side}" data-branch-floor="${side}" points="${joinPoints(
    floorPts,
  )}" fill="${COLOR_FLOOR}" />`;

  // 床にも少しだけ収束線
  const vanishX = isLeft ? farOuter : farInner;
  let branchGuides = '';
  const branchLines = 3;
  for (let i = 1; i < branchLines; i += 1) {
    const s = i / branchLines;
    const xNear = lerp(nearInner, nearOuter, s);
    branchGuides += `<line x1="${xNear}" y1="${baseY}" x2="${vanishX}" y2="${farY}" stroke="#000000" stroke-opacity="0.25" stroke-width="1" />`;
  }

  // 2) 横通路の左右の壁（床から天井まで）
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
  )}" fill="url(#wall-brick)" />`;
  const outerWall = `<polygon data-branch-wall="${side}" data-branch-position="outer" points="${joinPoints(
    outerWallPts,
  )}" fill="url(#wall-brick)" />`;

  return [floor, branchGuides, innerWall, outerWall].join('\n');
}



// スタートビュー（一本道）
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

// 分岐ビュー（正面は壁 + 左右に横通路）
function renderJunctionView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderDefs());
  parts.push(renderCeiling());
  parts.push(renderCorridorFloor());
  parts.push(renderCorridorWalls());

  if (openings.left) {
    parts.push(renderSideBranch('left'));
  }
  if (openings.right) {
    parts.push(renderSideBranch('right'));
  }

  // 分岐ポイントでは、その先は見えない想定 → 必ず前壁で塞ぐ
  parts.push(renderFrontWall('junction', 'near'));

  return parts.join('\n');
}

// ゴールビュー（奥の壁に光る出口）
function renderGoalView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderDefs());
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
