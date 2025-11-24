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

// 色はシンプルでOK（レンガ模様にはこだわらない）
const COLOR_FLOOR = '#8c4a32';
const COLOR_WALL = '#7a3825';
const COLOR_SKY = '#9fd8ff';
const COLOR_BG = '#000000';

// 共通で使う通路のジオメトリ（スクリーン座標）
const BOTTOM_Y = 160;
const TOP_Y = 80;
const LEFT_NEAR_X = 60;
const RIGHT_NEAR_X = 260;
const LEFT_FAR_X = 110;
const RIGHT_FAR_X = 210;

// 分岐が始まる深さ（0=手前,1=遠端）
const BRANCH_T = 0.5; // 通路の奥行きの中間くらい

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function joinPoints(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

// メインの通路床（手前から奥まで）
function renderMainFloor(): string {
  const pts = [
    { x: LEFT_NEAR_X, y: BOTTOM_Y },
    { x: RIGHT_NEAR_X, y: BOTTOM_Y },
    { x: RIGHT_FAR_X, y: TOP_Y },
    { x: LEFT_FAR_X, y: TOP_Y },
  ];
  return `<polygon data-floor="main" points="${joinPoints(pts)}" fill="${COLOR_FLOOR}" />`;
}

// サイドの壁（分岐なしのときの基本形）
function renderSideWalls(): string {
  const leftWall = [
    { x: 0, y: 0 },
    { x: 0, y: BOTTOM_Y },
    { x: LEFT_NEAR_X, y: BOTTOM_Y },
    { x: LEFT_FAR_X, y: TOP_Y },
    { x: 0, y: TOP_Y },
  ];
  const rightWall = [
    { x: RIGHT_NEAR_X, y: BOTTOM_Y },
    { x: WIDTH, y: BOTTOM_Y },
    { x: WIDTH, y: 0 },
    { x: WIDTH, y: TOP_Y },
    { x: RIGHT_FAR_X, y: TOP_Y },
  ];
  return [
    `<polygon data-wall-side="left" points="${joinPoints(leftWall)}" fill="${COLOR_WALL}" />`,
    `<polygon data-wall-side="right" points="${joinPoints(rightWall)}" fill="${COLOR_WALL}" />`,
  ].join('\n');
}

// 分岐用：左右どちらかに伸びる枝道の床
function renderSideCorridor(side: 'left' | 'right'): string {
  const sign = side === 'left' ? -1 : 1;
  const yBranch = lerp(BOTTOM_Y, TOP_Y, BRANCH_T);

  // 本線の床上での「角」の位置（内側のエッジ）
  const xInner =
    side === 'left'
      ? lerp(LEFT_NEAR_X, LEFT_FAR_X, BRANCH_T)
      : lerp(RIGHT_NEAR_X, RIGHT_FAR_X, BRANCH_T);

  const width = 40;
  const depth = 30;

  const p0 = { x: xInner, y: yBranch }; // 角の内側（本線との接点）
  const p1 = { x: xInner + sign * width, y: yBranch }; // 枝道の手前外側
  const p2 = { x: xInner + sign * (width * 0.9), y: yBranch - depth }; // 奥の外側
  const p3 = { x: xInner + sign * (width * 0.4), y: yBranch - depth }; // 奥の内側

  const floor = `<polygon data-side-corridor="${side}" points="${joinPoints([
    p0,
    p1,
    p2,
    p3,
  ])}" fill="${COLOR_FLOOR}" />`;

  // 枝道の内側の壁（奥の縦の面）
  const wallHeight = 40;
  const wall = [
    { x: p3.x, y: p3.y - wallHeight },
    { x: p2.x, y: p2.y - wallHeight },
    { x: p2.x, y: p2.y },
    { x: p3.x, y: p3.y },
  ];
  const wallSvg = `<polygon points="${joinPoints(wall)}" fill="${COLOR_WALL}" />`;

  return `${floor}\n${wallSvg}`;
}

// ゴールの空（ポータル）。奥の壁のほぼ全体を空にする
function renderGoalPortal(): string {
  const wallTop = 10;
  const wallBottom = TOP_Y;
  const wallLeft = LEFT_FAR_X;
  const wallRight = RIGHT_FAR_X;
  const wallWidth = wallRight - wallLeft;
  const wallHeight = wallBottom - wallTop;

  const skyId = 'goal-sky';

  const base = `<rect data-front-wall-fill="true" x="${wallLeft}" y="${wallTop}" width="${wallWidth}" height="${wallHeight}" fill="${COLOR_SKY}" />`;

  const portalWidth = wallWidth * 0.85;
  const portalHeight = wallHeight * 0.85;
  const portalLeft = wallLeft + (wallWidth - portalWidth) / 2;
  const portalTop = wallTop + (wallHeight - portalHeight) / 2;

  const gradient = `
    <defs>
      <linearGradient id="${skyId}" x1="0" y1="${wallTop}" x2="0" y2="${wallBottom}">
        <stop offset="0%" stop-color="${COLOR_SKY}" stop-opacity="1" />
        <stop offset="100%" stop-color="white" stop-opacity="1" />
      </linearGradient>
    </defs>
  `;

  const portal = `<rect data-goal-portal="true" x="${portalLeft}" y="${portalTop}" width="${portalWidth}" height="${portalHeight}" fill="url(#${skyId})" />`;

  return `${gradient}\n${base}\n${portal}`;
}

// 奥の暗がり（スタートなどで使う）。床の奥半分だけを暗くする。
function renderDepthFade(): string {
  const fadeTop = TOP_Y;
  const fadeBottom = lerp(BOTTOM_Y, TOP_Y, 0.5);
  const fadeId = 'depth-fade';

  const poly = [
    { x: LEFT_NEAR_X, y: fadeBottom },
    { x: RIGHT_NEAR_X, y: fadeBottom },
    { x: RIGHT_FAR_X, y: fadeTop },
    { x: LEFT_FAR_X, y: fadeTop },
  ];

  return `
    <defs>
      <linearGradient id="${fadeId}" x1="0" y1="${fadeBottom}" x2="0" y2="${fadeTop}">
        <stop offset="0%" stop-color="${COLOR_BG}" stop-opacity="0" />
        <stop offset="60%" stop-color="${COLOR_BG}" stop-opacity="0.7" />
        <stop offset="100%" stop-color="${COLOR_BG}" stop-opacity="0.98" />
      </linearGradient>
    </defs>
    <polygon data-depth-fade="start" points="${joinPoints(poly)}" fill="url(#${fadeId})" />
  `;
}

// 各ビューごとの描画本体（<g>の中身）
function renderStartView(): string {
  const floor = renderMainFloor();
  const walls = renderSideWalls();
  const fade = renderDepthFade();
  return [floor, walls, fade].join('\n');
}

function renderJunctionView(openings: Openings): string {
  const floor = renderMainFloor();
  const walls = renderSideWalls();
  const parts: string[] = [floor, walls];

  if (openings.left) {
    parts.push(renderSideCorridor('left'));
  }
  if (openings.right) {
    parts.push(renderSideCorridor('right'));
  }

  // junction の場合、前方は開いている前提なので奥の壁は描かない
  return parts.join('\n');
}

function renderGoalView(openings: Openings): string {
  const floor = renderMainFloor();
  const walls = renderSideWalls();
  const portal = renderGoalPortal();
  const parts: string[] = [floor, walls, portal];

  // ゴール手前に分岐がある場合も、枝道を表示する
  if (openings.left) {
    parts.push(renderSideCorridor('left'));
  }
  if (openings.right) {
    parts.push(renderSideCorridor('right'));
  }

  return parts.join('\n');
}

// メインエクスポート関数（PlayerView.tsx から呼ばれる）
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
    inner = renderStartView();
  } else if (variant === 'junction') {
    inner = renderJunctionView(openings);
  } else {
    // goal
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
