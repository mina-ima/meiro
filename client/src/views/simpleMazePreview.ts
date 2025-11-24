// client/src/views/simpleMazePreview.ts
// できるだけシンプルな「通路＋分岐＋ゴール」の一人称ビューを描画するモジュール
// 壁と床の形状と明るさ重視で、模様は最低限にしています。

import type { Direction, MazePreviewVariant } from './PlayerView';
import type { ServerMazeCell } from '../state/sessionStore';

export type OpenFlags = {
  forward: boolean;
  left: boolean;
  right: boolean;
  backward: boolean;
};

const WIDTH = 320;
const HEIGHT = 180;

const BG = '#000000';
const FLOOR_BASE = '#9a4a3a';
const WALL_COLOR = '#7a2a1a';
const SKY_TOP = '#6ec3ff';
const SKY_BOTTOM = '#ffffff';

// 汎用座標型
type Point = { x: number; y: number };

// 通路の寸法
type Dims = {
  width: number;
  height: number;
  bottomY: number;
  horizonY: number;
  leftNearX: number;
  rightNearX: number;
  leftFarX: number;
  rightFarX: number;
  centerX: number;
};

type SideOpeningGeometry = {
  side: 'left' | 'right';
  tBranch: number;
  xBranch: number;
  yBranch: number;
  floor: [Point, Point, Point, Point];
  door: { x: number; y: number; width: number; height: number };
};

// --------------------------------------------------
// エントリーポイント
// --------------------------------------------------

export function createSimplePreviewSvg(
  _cell: ServerMazeCell,
  _openDirections: Direction[],
  variant: MazePreviewVariant,
  orientation: Direction,
  openings: OpenFlags,
): string {
  const dims = computeDims();

  const leftOpening = openings.left ? createSideOpeningGeometry(dims, 'left') : null;
  const rightOpening = openings.right ? createSideOpeningGeometry(dims, 'right') : null;

  const floor = buildMainFloor(dims, variant);
  const sideWalls = buildSideWalls(dims, { leftOpening, rightOpening });
  const branches = buildBranches(dims, { openings, leftOpening, rightOpening });
  const front = buildFront(dims, variant, openings);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}" />
      <g
        data-view-tilt="0.00"
        data-floor="main"
        data-forward-open="${openings.forward}"
        data-left-open="${openings.left}"
        data-right-open="${openings.right}"
        data-back-open="${openings.backward}"
        data-facing="${orientation}"
      >
        ${floor}
        ${sideWalls}
        ${branches}
        ${front}
      </g>
    </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

// --------------------------------------------------
// 基本寸法
// --------------------------------------------------

function computeDims(): Dims {
  const width = WIDTH;
  const height = HEIGHT;

  const bottomY = Math.round(height * 0.99); // 床の最手前
  const horizonY = Math.round(height * 0.55); // 床と奥壁がぶつかるライン

  const centerX = width / 2;

  // すべてのビューで床形状は同じにする
  const nearWidth = width * 0.98;
  const farWidth = nearWidth * 0.4;

  const leftNearX = Math.round(centerX - nearWidth / 2);
  const rightNearX = Math.round(centerX + nearWidth / 2);
  const leftFarX = Math.round(centerX - farWidth / 2);
  const rightFarX = Math.round(centerX + farWidth / 2);

  return {
    width,
    height,
    bottomY,
    horizonY,
    leftNearX,
    rightNearX,
    leftFarX,
    rightFarX,
    centerX,
  };
}

// --------------------------------------------------
// 床（本線）
// --------------------------------------------------

function buildMainFloor(d: Dims, variant: MazePreviewVariant): string {
  const baseFloor: Point[] = [
    { x: d.leftNearX, y: d.bottomY },
    { x: d.rightNearX, y: d.bottomY },
    { x: d.rightFarX, y: d.horizonY },
    { x: d.leftFarX, y: d.horizonY },
  ];

  const parts: string[] = [];
  parts.push(poly(baseFloor, FLOOR_BASE, 1, 'data-floor="main"'));

  // スタートだけ奥を暗くするフェード（手前半分は残す）
  if (variant === 'start') {
    const fadeId = 'depth-fade-start';
    const fadeStartT = 0.52; // 0.0=手前, 1.0=奥
    const yStart = lerp(d.bottomY, d.horizonY, fadeStartT);
    const yEnd = d.horizonY;

    parts.push(`
      <defs>
        <linearGradient id="${fadeId}" x1="0" y1="${yStart}" x2="0" y2="${yEnd}">
          <stop offset="0%" stop-color="${BG}" stop-opacity="0" />
          <stop offset="100%" stop-color="${BG}" stop-opacity="0.95" />
        </linearGradient>
      </defs>
    `);

    parts.push(poly(baseFloor, `url(#${fadeId})`, 1, 'data-depth-fade="start"'));
  }

  return parts.join('\n');
}

// --------------------------------------------------
// 側壁（本線）
// --------------------------------------------------

function buildSideWalls(
  d: Dims,
  {
    leftOpening,
    rightOpening,
  }: { leftOpening: SideOpeningGeometry | null; rightOpening: SideOpeningGeometry | null },
): string {
  const parts: string[] = [];

  const wallHeight = d.bottomY - d.horizonY;
  const ceilY = Math.round(d.horizonY - wallHeight * 0.6);

  const buildWall = (side: 'left' | 'right', opening: SideOpeningGeometry | null) => {
    const nearX = side === 'left' ? d.leftNearX : d.rightNearX;
    const farX = side === 'left' ? d.leftFarX : d.rightFarX;

    if (opening) {
      const { xBranch, yBranch } = opening;
      const wall: Point[] = [
        { x: nearX, y: d.bottomY },
        { x: nearX, y: ceilY },
        { x: xBranch, y: ceilY },
        { x: xBranch, y: yBranch },
      ];
      parts.push(poly(wall, WALL_COLOR, 1, `data-wall-side="${side}"`));
      return;
    }

    const wall: Point[] = [
      { x: nearX, y: d.bottomY },
      { x: nearX, y: ceilY },
      { x: farX, y: ceilY },
      { x: farX, y: d.horizonY },
    ];
    parts.push(poly(wall, WALL_COLOR, 1, `data-wall-side="${side}"`));
  };

  buildWall('left', leftOpening);
  buildWall('right', rightOpening);

  return parts.join('\n');
}

// --------------------------------------------------
// 分岐（枝道）
// --------------------------------------------------

function buildBranches(
  d: Dims,
  {
    openings,
    leftOpening,
    rightOpening,
  }: {
    openings: OpenFlags;
    leftOpening: SideOpeningGeometry | null;
    rightOpening: SideOpeningGeometry | null;
  },
): string {
  const parts: string[] = [];

  // 分岐がない場合は何もしない
  if (!openings.left && !openings.right && !openings.forward && !openings.backward) {
    return '';
  }

  const buildSideCorridor = (side: 'left' | 'right', opening: SideOpeningGeometry | null) => {
    if (!opening) {
      return;
    }

    const corridor: string[] = [];
    corridor.push(`<g data-side-corridor="${side}">`);
    corridor.push(poly(opening.floor, FLOOR_BASE, 0.95));
    corridor.push('</g>');

    const door = opening.door;
    parts.push(
      `<rect data-doorway="${side}" x="${door.x}" y="${door.y}" width="${door.width}" height="${door.height}" fill="${BG}" stroke="${BG}" stroke-opacity="0.12"/>`,
    );
    parts.push(corridor.join('\n'));
  };

  buildSideCorridor('left', leftOpening);
  buildSideCorridor('right', rightOpening);

  return parts.join('\n');
}

// --------------------------------------------------
// 正面（ゴール or 壁 or暗がり）
// --------------------------------------------------

function buildFront(d: Dims, variant: MazePreviewVariant, openings: OpenFlags): string {
  const parts: string[] = [];

  const wallWidth = d.rightFarX - d.leftFarX;
  const wallTop = 0;
  const wallBottom = d.horizonY;
  const wallHeight = wallBottom - wallTop;

  if (variant === 'goal') {
    // ゴールは奥面ほぼ全部が青空
    const skyId = 'goal-sky';
    const portalId = 'goal-portal';
    parts.push(`
      <defs>
        <linearGradient id="${skyId}" x1="0" y1="${wallTop}" x2="0" y2="${wallBottom}">
          <stop offset="0%" stop-color="${SKY_TOP}" stop-opacity="0.98" />
          <stop offset="100%" stop-color="${SKY_BOTTOM}" stop-opacity="0.98" />
        </linearGradient>
        <linearGradient id="${portalId}" x1="0" y1="${wallTop}" x2="0" y2="${wallBottom}">
          <stop offset="0%" stop-color="${SKY_BOTTOM}" stop-opacity="0.95" />
          <stop offset="100%" stop-color="${SKY_TOP}" stop-opacity="0.85" />
        </linearGradient>
      </defs>
    `);
    parts.push(
      `<g data-front-wall="goal" data-forward-open="false">` +
        `<rect data-front-wall-fill="true" x="${d.leftFarX}" y="${wallTop}" width="${wallWidth}" height="${wallHeight}" fill="url(#${skyId})" opacity="1"/>` +
        (() => {
          const portalW = wallWidth * 0.84;
          const portalH = wallHeight * 0.82;
          const px = d.centerX - portalW / 2;
          const py = wallTop + wallHeight * 0.09;
          return `<rect data-goal-portal="true" x="${px}" y="${py}" width="${portalW}" height="${portalH}" fill="url(#${portalId})" opacity="0.95"/>`;
        })() +
        `</g>`,
    );
    return parts.join('\n');
  }

  // スタートは奥に壁を描かず、暗い奥行きだけを示す
  if (variant === 'start') {
    parts.push(
      '<g data-front-wall="open" data-forward-extension="false" data-forward-fade="false"></g>',
    );
    return parts.join('\n');
  }

  // 前方が開いている場合：暗い穴だけ（奥の分岐があることを示す）
  if (openings.forward) {
    const fadeId = 'depth-fade-forward';
    const depthT = 0.85;
    const yExt = Math.max(wallTop, lerp(d.horizonY, d.horizonY - wallHeight, depthT));
    const extension: Point[] = [
      { x: d.leftFarX, y: d.horizonY },
      { x: d.rightFarX, y: d.horizonY },
      { x: d.centerX + (d.rightFarX - d.centerX) * 0.35, y: yExt },
      { x: d.centerX - (d.centerX - d.leftFarX) * 0.35, y: yExt },
    ];
    parts.push(`
      <defs>
        <linearGradient id="${fadeId}" x1="0" y1="${yExt}" x2="0" y2="${d.horizonY}">
          <stop offset="0%" stop-color="${BG}" stop-opacity="0.95" />
          <stop offset="100%" stop-color="${BG}" stop-opacity="0" />
        </linearGradient>
      </defs>
    `);
    parts.push(
      `<g data-front-wall="open" data-forward-extension="true" data-forward-fade="true">` +
        poly(extension, `url(#${fadeId})`, 1, 'data-forward-extension-shape="true"') +
        `</g>`,
    );
    return parts.join('\n');
  }

  // dead end：普通のレンガ壁
  parts.push(
    `<g data-front-wall="closed" data-forward-open="false">` +
      `<rect data-front-wall-fill="true" x="${d.leftFarX}" y="${wallTop}" width="${wallWidth}" height="${wallHeight}" fill="${WALL_COLOR}" opacity="0.96"/>` +
      `</g>`,
  );
  return parts.join('\n');
}

// --------------------------------------------------
// 枝道ジオメトリ
// --------------------------------------------------

function createSideOpeningGeometry(d: Dims, side: 'left' | 'right'): SideOpeningGeometry {
  const tBranch = 0.58;
  const yBranch = lerp(d.bottomY, d.horizonY, tBranch);
  const nearX = side === 'left' ? d.leftNearX : d.rightNearX;
  const farX = side === 'left' ? d.leftFarX : d.rightFarX;
  const xBranch = lerp(nearX, farX, tBranch);

  const sideSign = side === 'left' ? -1 : 1;
  const sideWidth = d.width * 0.25;
  const lift = (d.bottomY - d.horizonY) * 0.3;
  const yFar = clamp(yBranch - lift, d.horizonY + 2, yBranch - 1);

  const nearInner: Point = { x: xBranch, y: yBranch };
  const nearOuter: Point = { x: xBranch + sideSign * sideWidth, y: yBranch };
  const farOuter: Point = { x: xBranch + sideSign * sideWidth * 0.9, y: yFar };
  const farInner: Point = { x: xBranch + sideSign * sideWidth * 0.3, y: yFar };

  const doorHeight = Math.min((d.bottomY - d.horizonY) * 0.18, 16);
  const doorWidth = d.width * 0.07;
  const doorX = side === 'left' ? xBranch : xBranch - doorWidth;
  const doorY = yBranch - doorHeight;

  return {
    side,
    tBranch,
    xBranch,
    yBranch,
    floor: [nearInner, nearOuter, farOuter, farInner],
    door: { x: doorX, y: doorY, width: doorWidth, height: doorHeight },
  };
}

// --------------------------------------------------
// SVG ユーティリティ
// --------------------------------------------------

function poly(points: Point[], fill: string, opacity = 1, extra = ''): string {
  const d = points.map((p) => `${p.x},${p.y}`).join(' ');
  const attr = extra ? ' ' + extra : '';
  return `<polygon${attr} points="${d}" fill="${fill}" opacity="${opacity}"/>`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(v, min));
}
