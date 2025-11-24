// client/src/views/simpleMazePreview.ts
// できるだけシンプルな「通路＋分岐＋ゴール」の一人称ビューを描画するモジュール
// 壁と床の形状と明るさ重視で、模様は最低限にしています。

import { mixHexColors, type Direction, type MazePreviewVariant } from './PlayerView';
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
  const dims = computeDims(variant);

  const floor = buildMainFloor(dims, variant);
  const sideWalls = buildSideWalls(dims, openings);
  const branches = buildBranches(dims, openings);
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

function computeDims(variant: MazePreviewVariant): Dims {
  const width = WIDTH;
  const height = HEIGHT;

  const bottomY = Math.round(height * 0.9);      // 床の最手前
  const horizonY = Math.round(height * 0.45);    // 床と奥壁がぶつかるライン

  const centerX = width / 2;

  // すべてのビューで床形状は同じにする
  const nearWidth = width * 0.8;
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

  const floorColor = FLOOR_BASE;

  const parts: string[] = [];
  parts.push(poly(baseFloor, floorColor, 1, 'data-floor="main"'));

  // スタートだけ奥を暗くするフェード（4マス先から暗くなるイメージ）
  if (variant === 'start') {
    const fadeId = 'start-depth-fade';
    const fadeStartT = 0.6; // 0.0=手前, 1.0=奥
    const yStart = lerp(d.bottomY, d.horizonY, fadeStartT);
    const yEnd = d.horizonY;

    parts.push(`
      <defs>
        <linearGradient id="${fadeId}" x1="0" y1="${yStart}" x2="0" y2="${yEnd}">
          <stop offset="0%" stop-color="${BG}" stop-opacity="0" />
          <stop offset="40%" stop-color="${BG}" stop-opacity="0.4" />
          <stop offset="100%" stop-color="${BG}" stop-opacity="0.98" />
        </linearGradient>
      </defs>
    `);

    parts.push(
      poly(baseFloor, `url(#${fadeId})`, 1, 'data-depth-fade="start"'),
    );
  }

  return parts.join('\n');
}

// --------------------------------------------------
// 側壁（本線）
// --------------------------------------------------

function buildSideWalls(d: Dims, openings: OpenFlags): string {
  const parts: string[] = [];

  const wallHeight = d.horizonY - d.bottomY;
  const ceilY = d.horizonY - wallHeight * 0.6;

  // 左側
  {
    const nearX = d.leftNearX;
    const farX = d.leftFarX;
    // 分岐がある側でも壁は基本的に手前から分岐の手前まで描画する
    const wall: Point[] = [
      { x: nearX, y: d.bottomY },
      { x: nearX, y: ceilY },
      { x: farX, y: ceilY },
      { x: farX, y: d.horizonY },
    ];
    parts.push(poly(wall, WALL_COLOR, 1, 'data-wall-side="left"'));
  }

  // 右側
  {
    const nearX = d.rightNearX;
    const farX = d.rightFarX;
    const wall: Point[] = [
      { x: nearX, y: d.bottomY },
      { x: nearX, y: ceilY },
      { x: farX, y: ceilY },
      { x: farX, y: d.horizonY },
    ];
    parts.push(poly(wall, WALL_COLOR, 1, 'data-wall-side="right"'));
  }

  return parts.join('\n');
}

// --------------------------------------------------
// 分岐（枝道）
// --------------------------------------------------

function buildBranches(d: Dims, openings: OpenFlags): string {
  const parts: string[] = [];

  // 分岐がない場合は何もしない
  if (!openings.left && !openings.right && !openings.forward && !openings.backward) {
    return '';
  }

  // 分岐が始まる奥行き（0.0=手前, 1.0=奥）
  const tBranch = 0.55;
  const yBranch = lerp(d.bottomY, d.horizonY, tBranch);
  const xLeftAtBranch = lerp(d.leftNearX, d.leftFarX, tBranch);
  const xRightAtBranch = lerp(d.rightNearX, d.rightFarX, tBranch);

  const sideDepthT = 0.8;
  const ySideFar = lerp(d.bottomY, d.horizonY, sideDepthT);
  const sideLen = (d.rightNearX - d.leftNearX) * 0.6;

  // 左側に分岐
  if (openings.left) {
    const nearA: Point = { x: xLeftAtBranch, y: yBranch };
    const nearB: Point = { x: xLeftAtBranch, y: yBranch }; // 少し厚みを持たせるなら調整
    const farA: Point = { x: xLeftAtBranch - sideLen, y: ySideFar };
    const farB: Point = { x: xLeftAtBranch - sideLen, y: ySideFar + 1 };

    const floorPoly: Point[] = [nearA, nearB, farB, farA];
    parts.push(poly(floorPoly, FLOOR_BASE, 0.95, 'data-side-corridor="left"'));
  }

  // 右側に分岐
  if (openings.right) {
    const nearA: Point = { x: xRightAtBranch, y: yBranch };
    const nearB: Point = { x: xRightAtBranch, y: yBranch };
    const farA: Point = { x: xRightAtBranch + sideLen, y: ySideFar };
    const farB: Point = { x: xRightAtBranch + sideLen, y: ySideFar + 1 };

    const floorPoly: Point[] = [nearB, nearA, farA, farB];
    parts.push(poly(floorPoly, FLOOR_BASE, 0.95, 'data-side-corridor="right"'));
  }

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
    parts.push(`
      <defs>
        <linearGradient id="${skyId}" x1="0" y1="${wallTop}" x2="0" y2="${wallBottom}">
          <stop offset="0%" stop-color="${SKY_TOP}" stop-opacity="0.98" />
          <stop offset="100%" stop-color="${SKY_BOTTOM}" stop-opacity="0.98" />
        </linearGradient>
      </defs>
    `);
    parts.push(
      `<rect data-front-wall-fill="true" x="${d.leftFarX}" y="${wallTop}" width="${wallWidth}" height="${wallHeight}" fill="url(#${skyId})" opacity="1"/>`,
    );
    // さらに内側に一段明るいポータル
    const portalW = wallWidth * 0.8;
    const portalH = wallHeight * 0.8;
    const px = d.centerX - portalW / 2;
    const py = wallTop + wallHeight * 0.1;
    parts.push(
      `<rect data-goal-portal="true" x="${px}" y="${py}" width="${portalW}" height="${portalH}" fill="${SKY_BOTTOM}" opacity="0.9"/>`,
    );
    return parts.join('\n');
  }

  // 前方が開いている場合：暗い穴だけ（奥の分岐があることを示す）
  if (openings.forward) {
    const holeW = wallWidth * 0.35;
    const holeH = wallHeight * 0.6;
    const hx = d.centerX - holeW / 2;
    const hy = wallBottom - holeH;
    parts.push(
      `<rect x="${hx}" y="${hy}" width="${holeW}" height="${holeH}" fill="${BG}" opacity="0.95"/>`,
    );
    return parts.join('\n');
  }

  // dead end：普通のレンガ壁
  parts.push(
    `<rect data-front-wall-fill="true" x="${d.leftFarX}" y="${wallTop}" width="${wallWidth}" height="${wallHeight}" fill="${WALL_COLOR}" opacity="0.96"/>`,
  );
  return parts.join('\n');
}

// --------------------------------------------------
// SVG ユーティリティ
// --------------------------------------------------

function poly(points: Point[], fill: string, opacity = 1, extra = ''): string {
  const d = points.map((p) => `${p.x},${p.y}`).join(' ');
  const attr = extra ? ' ' + extra : '';
  return `<polygon${attr} points="${d}" fill="${fill}" opacity="${opacity}"/>`;
}

function line(from: Point, to: Point, stroke: string, width = 1, opacity = 1): string {
  return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}"/>`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(v, min));
}
