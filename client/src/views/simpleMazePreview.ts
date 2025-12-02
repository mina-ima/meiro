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
const CORRIDOR_NEAR_LEFT = 110;
const CORRIDOR_NEAR_RIGHT = 210;
const CORRIDOR_FAR_LEFT = 145;
const CORRIDOR_FAR_RIGHT = 175;

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

// 左右の壁（1枚ずつ）
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
    { x: left - 20, y: wallTop },
    { x: right + 20, y: wallTop },
    { x: right + 20, y: wallBottom },
    { x: left - 20, y: wallBottom },
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

// 左右の分岐通路（横に伸びる短い廊下）
function renderSideBranch(side: 'left' | 'right'): string {
  const isLeft = side === 'left';

  // 分岐の起点（メイン通路上）
  const baseY = FLOOR_NEAR_Y - 8;
  const farY = baseY - 32;

  const entryX = isLeft ? CORRIDOR_NEAR_LEFT : CORRIDOR_NEAR_RIGHT;
  const innerX = entryX; // メイン通路側
  const outerX = isLeft ? entryX - 42 : entryX + 42;

  const farInnerX = isLeft ? innerX - 20 : innerX + 20;
  const farOuterX = isLeft ? outerX - 20 : outerX + 20;

  // 床
  const floorPts = [
    { x: innerX, y: baseY },
    { x: outerX, y: baseY },
    { x: farOuterX, y: farY },
    { x: farInnerX, y: farY },
  ];
  const floor = `<polygon data-side-corridor="${side}" data-branch-floor="${side}" points="${joinPoints(
    floorPts,
  )}" fill="${COLOR_FLOOR}" />`;

  const wallHeight = 50;

  // 外側の壁
  const outerWallPts = [
    { x: outerX, y: baseY },
    { x: outerX, y: baseY - wallHeight },
    { x: farOuterX, y: farY - wallHeight },
    { x: farOuterX, y: farY },
  ];
  const outerWall = `<polygon data-side-corridor="${side}" data-branch-wall="${side}" data-branch-position="outer" points="${joinPoints(
    outerWallPts,
  )}" fill="${COLOR_WALL}" />`;

  // 内側の壁（メイン通路側）
  const innerWallPts = [
    { x: innerX, y: baseY },
    { x: innerX, y: baseY - wallHeight },
    { x: farInnerX, y: farY - wallHeight },
    { x: farInnerX, y: farY },
  ];
  const innerWall = `<polygon data-side-corridor="${side}" data-branch-wall="${side}" data-branch-position="inner" points="${joinPoints(
    innerWallPts,
  )}" fill="${COLOR_WALL}" />`;

  // 入口の縁取り（開口部が分かるように）
  const frameHeight = 30;
  const frameTopY = baseY - frameHeight;
  const entryFramePts = [
    { x: innerX, y: baseY },
    { x: innerX, y: frameTopY },
    { x: outerX, y: frameTopY - 4 },
    { x: outerX, y: baseY - 4 },
  ];
  const entryFrame = `<polygon data-branch-entry="${side}" points="${joinPoints(
    entryFramePts,
  )}" fill="rgba(0,0,0,0.2)" />`;

  return [floor, innerWall, outerWall, entryFrame].join('\n');
}

// スタートビュー（一本道）
function renderStartView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderCeiling());
  parts.push(renderSideWalls());
  parts.push(renderMainFloor());
  parts.push(renderCorridorFloor());

  if (!openings.forward) {
    parts.push(renderFrontWall('near', 'start'));
  }
  return parts.join('\n');
}

// 分岐ビュー（十字路/T字路）
function renderJunctionView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderCeiling());
  parts.push(renderSideWalls());
  parts.push(renderMainFloor());
  parts.push(renderCorridorFloor());

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
function renderGoalView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderCeiling());
  parts.push(renderSideWalls());
  parts.push(renderMainFloor());
  parts.push(renderCorridorFloor());
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
