import type { Direction } from './mazeDirection';
import type { MazePreviewVariant } from './PlayerView';
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

// 通路の幅（手前は画面端まで、奥で収束）
const CORRIDOR_NEAR_LEFT = 0;
const CORRIDOR_NEAR_RIGHT = WIDTH; // 320
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

// 視界の深さ（仕様: 4マス）
const VIEW_DEPTH_TILES = 4;

// 通路の床（4マスのグリッド付き）
function renderCorridorFloor(): string {
  const pts = [
    { x: CORRIDOR_NEAR_LEFT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_NEAR_RIGHT, y: FLOOR_NEAR_Y },
    { x: CORRIDOR_FAR_RIGHT, y: FLOOR_FAR_Y },
    { x: CORRIDOR_FAR_LEFT, y: FLOOR_FAR_Y },
  ];

  const floor = `<polygon data-floor="corridor" data-floor-layer="main" points="${joinPoints(pts)}" fill="url(#corridor-floor-grad)" />`;

  // 縦の収束線（通路の幅方向）
  const vanishX = (CORRIDOR_FAR_LEFT + CORRIDOR_FAR_RIGHT) / 2;
  const vanishY = FLOOR_FAR_Y;
  let guideLines = '';
  for (let i = 1; i < 6; i += 1) {
    const t = i / 6;
    const xNear = lerp(CORRIDOR_NEAR_LEFT, CORRIDOR_NEAR_RIGHT, t);
    guideLines += `<line x1="${xNear}" y1="${FLOOR_NEAR_Y}" x2="${vanishX}" y2="${vanishY}" stroke="#000000" stroke-opacity="0.15" stroke-width="1" />`;
  }

  // 横線（マス境界：4マス分の奥行きを均等に分割）
  let tileLines = '';
  for (let i = 1; i <= VIEW_DEPTH_TILES; i += 1) {
    const t = i / VIEW_DEPTH_TILES;
    const y = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t);
    const xL = lerp(CORRIDOR_NEAR_LEFT, CORRIDOR_FAR_LEFT, t);
    const xR = lerp(CORRIDOR_NEAR_RIGHT, CORRIDOR_FAR_RIGHT, t);
    tileLines += `<line x1="${xL}" y1="${y}" x2="${xR}" y2="${y}" stroke="#000000" stroke-opacity="0.15" stroke-width="1" />`;
  }

  return `${floor}\n${guideLines}\n${tileLines}`;
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

// 正面の行き止まり壁（レンガテクスチャ）
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

// 通路の先が暗闇に消えていく表現（正面が開いている場合）
// 分岐ビューの正面壁と同じ深さ（t=0.75）に配置
function renderCorridorFade(): string {
  const t = 0.75;
  const left = lerp(CORRIDOR_NEAR_LEFT, CORRIDOR_FAR_LEFT, t);
  const right = lerp(CORRIDOR_NEAR_RIGHT, CORRIDOR_FAR_RIGHT, t);
  const bottomY = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t);

  return `<polygon points="${joinPoints([
    { x: left, y: 0 },
    { x: right, y: 0 },
    { x: right, y: bottomY },
    { x: left, y: bottomY },
  ])}" fill="${COLOR_BG}" />`;
}

// ゴール：通路の先が外の光に開けている表現
// 分岐ビューの正面壁と同じ深さ（t=0.75）に配置
function renderGoalPortal(): string {
  const t = 0.75;
  const left = lerp(CORRIDOR_NEAR_LEFT, CORRIDOR_FAR_LEFT, t);
  const right = lerp(CORRIDOR_NEAR_RIGHT, CORRIDOR_FAR_RIGHT, t);
  const bottomY = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, t);

  // 通路の奥が外に開けている（空と光）
  const skyGlow = `<polygon points="${joinPoints([
    { x: left, y: 0 },
    { x: right, y: 0 },
    { x: right, y: bottomY },
    { x: left, y: bottomY },
  ])}" fill="${COLOR_PORTAL}" />`;

  // 光が周囲に漏れるグロー効果
  const glowLeft = left - 10;
  const glowRight = right + 10;
  const glowTop = bottomY - 20;
  const glow = `<polygon points="${joinPoints([
    { x: glowLeft, y: glowTop },
    { x: glowRight, y: glowTop },
    { x: right, y: bottomY },
    { x: left, y: bottomY },
  ])}" fill="${COLOR_PORTAL}" opacity="0.12" />`;

  return `${glow}\n${skyGlow}`;
}

// 側面分岐：開口部を通して横通路の両壁・床が見える3D描画
// 参考画像のように、横通路が奥に向かって収束する遠近法表現
function renderSideBranch(side: 'left' | 'right'): string {
  const isLeft = side === 'left';
  const dir = isLeft ? -1 : 1;

  // 開口部の奥行き範囲: 現在セルの真横 (カメラ位置〜1マス先)
  // 0.0..0.25 で「現在いるセルの左/右壁」が開いていることを表現する
  const tNear = 0.0;
  const tFar = 0.25;

  const wallNearEdge = isLeft ? CORRIDOR_NEAR_LEFT : CORRIDOR_NEAR_RIGHT;
  const wallFarEdge = isLeft ? CORRIDOR_FAR_LEFT : CORRIDOR_FAR_RIGHT;

  // 開口部の境界座標（メイン通路の壁上）
  const openNearX = lerp(wallNearEdge, wallFarEdge, tNear);
  const openFarX = lerp(wallNearEdge, wallFarEdge, tFar);
  const openNearFloorY = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, tNear);
  const openFarFloorY = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, tFar);

  // 横通路の消失点（両壁が収束する点）
  const vanishX = openNearX + dir * 90;
  const vanishFloorY = (openNearFloorY + openFarFloorY) / 2 - 18;
  const vanishCeilingY = 12;

  // --- 描画要素 ---

  // 1) メイン通路の壁を手前と奥に分割
  const wallBefore = renderWallSide(side, 0, tNear);
  const wallAfter = renderWallSide(side, tFar, 1);

  // 2) 開口部背景（暗い空間）
  const openingBg = `<polygon data-branch-entry="${side}" points="${joinPoints([
    { x: openNearX, y: 0 },
    { x: openFarX, y: 0 },
    { x: openFarX, y: openFarFloorY },
    { x: openNearX, y: openNearFloorY },
  ])}" fill="${COLOR_BG}" />`;

  // 3) 横通路の手前壁（開口部の手前端から消失点へ収束）
  // 参考画像で最も目立つ壁 - レンガテクスチャで奥に伸びる
  const nearCorridorWall = `<polygon points="${joinPoints([
    { x: openNearX, y: 0 },
    { x: vanishX, y: vanishCeilingY },
    { x: vanishX, y: vanishFloorY },
    { x: openNearX, y: openNearFloorY },
  ])}" fill="url(#wall-brick)" />`;

  // 4) 横通路の奥壁（開口部の奥端から消失点へ収束）
  // 手前壁より暗い色で奥行き感を出す
  const farCorridorWall = `<polygon points="${joinPoints([
    { x: openFarX, y: 0 },
    { x: vanishX, y: vanishCeilingY },
    { x: vanishX, y: vanishFloorY },
    { x: openFarX, y: openFarFloorY },
  ])}" fill="url(#wall-brick-dark)" />`;

  // 5) 横通路の床（手前壁と奥壁の間、消失点に向かって収束）
  const branchFloor = `<polygon data-branch-floor="${side}" points="${joinPoints([
    { x: openNearX, y: openNearFloorY },
    { x: openFarX, y: openFarFloorY },
    { x: vanishX, y: vanishFloorY },
  ])}" fill="${COLOR_FLOOR_DARK}" />`;

  // 6) 壁再開箇所のエッジ（奥端で壁が再開する箇所の影）
  const farEdgeW = isLeft ? 4 : -4;
  const farEdge = `<polygon points="${joinPoints([
    { x: openFarX, y: 0 },
    { x: openFarX + farEdgeW, y: 0 },
    { x: openFarX + farEdgeW, y: openFarFloorY },
    { x: openFarX, y: openFarFloorY },
  ])}" fill="${COLOR_WALL_DARK}" />`;

  // 描画順：奥の壁→床→手前の壁（手前が上に重なる）
  return [wallBefore, openingBg, farCorridorWall, branchFloor, nearCorridorWall, farEdge, wallAfter].join('\n');
}

// スタートビュー
function renderStartView(openings: Openings): string {
  const parts: string[] = [];
  parts.push(renderDefs());
  parts.push(renderCeiling());
  parts.push(renderCorridorFloor());
  parts.push(renderCorridorWalls());

  if (openings.forward) {
    parts.push(renderCorridorFade());
  } else {
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

  if (openings.forward) {
    parts.push(renderCorridorFade());
  } else {
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
