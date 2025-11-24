// client/src/views/simpleMazePreview.ts
// シンプルな一人称視点の迷路プレビューを描画するモジュール

import { mixHexColors, type Direction, type MazePreviewVariant } from './PlayerView';
import type { ServerMazeCell } from '../state/sessionStore';

// プレビュー画像の解像度（PlayerView 側の <img> と一致させる）
const WIDTH = 320;
const HEIGHT = 180;

// 基本色（レンガ模様は簡略化）
const BG = '#000000';
const FLOOR_NEAR = '#8c1c1c';
const FLOOR_FAR = '#2b0b0b';
const WALL_COLOR = '#7a2a1a';
const SKY_TOP = '#6ec3ff';
const SKY_BOTTOM = '#ffffff';

// 開口情報（プレイヤーから見た前/左/右/後ろ）
export type OpenFlags = {
  forward: boolean;
  left: boolean;
  right: boolean;
  backward: boolean;
};

// 2D座標
type Point = { x: number; y: number };

// 通路全体の寸法
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
  const branches = buildSideCorridors(dims, openings);
  const front = buildFrontWall(dims, variant, openings);

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
// 基本ジオメトリ
// --------------------------------------------------

function computeDims(variant: MazePreviewVariant): Dims {
  const width = WIDTH;
  const height = HEIGHT;

  const isStart = variant === 'start';
  const isGoal = variant === 'goal';

  // 画面下端ギリギリに床が来るようにする
  const bottomY = Math.round(height * 0.96);
  const horizonY = Math.round(height * (isStart ? 0.40 : 0.45));

  const centerX = width / 2;

  // 手前の床の幅（スタートは画面全幅、それ以外は少し狭め）
  const nearWidth = isStart ? width * 1.0 : width * 0.7;
  const farWidth = nearWidth * (isGoal ? 0.5 : 0.4);

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
// メインの床
// --------------------------------------------------

function buildMainFloor(dims: Dims, variant: MazePreviewVariant): string {
  const { bottomY, horizonY, leftNearX, rightNearX, leftFarX, rightFarX } = dims;

  const baseFloor: Point[] = [
    { x: leftNearX, y: bottomY },
    { x: rightNearX, y: bottomY },
    { x: rightFarX, y: horizonY },
    { x: leftFarX, y: horizonY },
  ];

  const baseColor =
    variant === 'goal'
      ? mixHexColors(FLOOR_NEAR, '#e5f2ff', 0.4)
      : FLOOR_NEAR;

  const polygons: string[] = [];
  polygons.push(poly(baseFloor, baseColor, 1.0, `data-floor="main"`));

  // 奥に行くほど暗くするストライプ（少ない本数でOK）
  const stripeDepths = [0.15, 0.3, 0.45, 0.6, 0.8];
  stripeDepths.forEach((t) => {
    const y = lerp(bottomY, horizonY, t);
    const leftX = lerp(leftNearX, leftFarX, t);
    const rightX = lerp(rightNearX, rightFarX, t);
    const fade = clamp((t - 0.4) / 0.4, 0, 1);
    const stroke = mixHexColors('#ffffff', FLOOR_FAR, 0.8);
    const alpha =
      variant === 'start'
        ? 0.7 * (1 - fade * 0.9)
        : 0.7 * (1 - fade * 0.5);
    polygons.push(
      line({ x: leftX, y }, { x: rightX, y }, stroke, 1.2, alpha),
    );
  });

  // 奥の暗がりオーバーレイ（スタートは4マス目以降を暗くするイメージ）
  if (variant === 'start') {
    const fadeId = 'start-depth-fade';
    const fadeFrom = lerp(bottomY, horizonY, 0.45);
    const fadeTo = horizonY;
    polygons.push(`
      <defs>
        <linearGradient id="${fadeId}" x1="0" y1="${fadeFrom}" x2="0" y2="${horizonY}">
          <stop offset="0%" stop-color="${BG}" stop-opacity="0" />
          <stop offset="45%" stop-color="${BG}" stop-opacity="0.2" />
          <stop offset="100%" stop-color="${BG}" stop-opacity="0.95" />
        </linearGradient>
      </defs>
    `);
    polygons.push(
      poly(baseFloor, `url(#${fadeId})`, 1.0, 'data-depth-fade="start"'),
    );
  }

  return polygons.join('\n');
}

// --------------------------------------------------
// 側面の壁（本線）
// --------------------------------------------------

function buildSideWalls(dims: Dims, openings: OpenFlags): string {
  const { bottomY, horizonY, leftNearX, rightNearX, leftFarX, rightFarX } = dims;
  const pieces: string[] = [];

  // 左側の壁
  {
    const leftBottom: Point = { x: leftNearX, y: bottomY };
    const leftTop: Point = { x: leftFarX, y: horizonY };
    const rightBottom: Point = { x: leftNearX + 1, y: bottomY }; // 厚みを少しだけ
    const rightTop: Point = { x: leftFarX + 1, y: horizonY };

    const wall = [leftBottom, rightBottom, rightTop, leftTop];
    pieces.push(poly(wall, WALL_COLOR, 1.0, 'data-wall-side="left"'));
  }

  // 右側の壁
  {
    const rightBottom: Point = { x: rightNearX, y: bottomY };
    const rightTop: Point = { x: rightFarX, y: horizonY };
    const leftBottom: Point = { x: rightNearX - 1, y: bottomY };
    const leftTop: Point = { x: rightFarX - 1, y: horizonY };

    const wall = [leftBottom, rightBottom, rightTop, leftTop];
    pieces.push(poly(wall, WALL_COLOR, 1.0, 'data-wall-side="right"'));
  }

  return pieces.join('\n');
}

// --------------------------------------------------
// 分岐用の枝道（横に伸びる床）
// --------------------------------------------------

function buildSideCorridors(dims: Dims, openings: OpenFlags): string {
  const { bottomY, horizonY, leftNearX, rightNearX, leftFarX, rightFarX } = dims;

  const pieces: string[] = [];

  // 分岐が始まる奥行き（0=手前,1=奥）: 0.55 あたりを「4マス先」イメージ
  const branchDepth = 0.55;
  const branchY = lerp(bottomY, horizonY, branchDepth);
  const mainLeftX = lerp(leftNearX, leftFarX, branchDepth);
  const mainRightX = lerp(rightNearX, rightFarX, branchDepth);

  const sideFloorDepth = 0.8;
  const sideY = lerp(bottomY, horizonY, sideFloorDepth);
  const sideOffset = (rightNearX - leftNearX) * 0.5; // 横に伸びる長さ

  // 左に分岐があるとき：左側の壁を切って、左方向に床を伸ばす
  if (openings.left) {
    const nearA: Point = { x: mainLeftX, y: branchY };
    const nearB: Point = { x: mainLeftX - 1, y: branchY }; // 枝道入り口少し太く
    const farA: Point = { x: mainLeftX - sideOffset, y: sideY };
    const farB: Point = { x: mainLeftX - sideOffset - 1, y: sideY };

    const floor = [nearA, nearB, farB, farA];
    pieces.push(poly(floor, FLOOR_NEAR, 0.9, 'data-side-corridor="left"'));

    // 枝道の内側の壁（上側）
    const innerWallTop: Point = { x: farA.x, y: sideY - 20 };
    const innerWall = [farA, farB, { x: farB.x, y: sideY - 20 }, innerWallTop];
    pieces.push(poly(innerWall, WALL_COLOR, 0.9, ''));
  }

  // 右に分岐があるとき：右側
  if (openings.right) {
    const nearA: Point = { x: mainRightX, y: branchY };
    const nearB: Point = { x: mainRightX + 1, y: branchY };
    const farA: Point = { x: mainRightX + sideOffset, y: sideY };
    const farB: Point = { x: mainRightX + sideOffset + 1, y: sideY };

    const floor = [nearB, nearA, farA, farB];
    pieces.push(poly(floor, FLOOR_NEAR, 0.9, 'data-side-corridor="right"'));

    const innerWallTop: Point = { x: farA.x, y: sideY - 20 };
    const innerWall = [farA, farB, { x: farB.x, y: sideY - 20 }, innerWallTop];
    pieces.push(poly(innerWall, WALL_COLOR, 0.9, ''));
  }

  return pieces.join('\n');
}

// --------------------------------------------------
// 正面（奥の壁 / ポータル）
// --------------------------------------------------

function buildFrontWall(dims: Dims, variant: MazePreviewVariant, openings: OpenFlags): string {
  const { horizonY, leftFarX, rightFarX, centerX } = dims;
  const pieces: string[] = [];

  // ゴール：全面を空色で埋める
  if (variant === 'goal') {
    const wallHeight = Math.max(40, HEIGHT * 0.6);
    const wallTop = Math.max(0, horizonY - wallHeight);
    const wallWidth = rightFarX - leftFarX;

    const skyId = `goal-sky-${WIDTH}-${HEIGHT}`;
    pieces.push(`
      <defs>
        <linearGradient id="${skyId}" x1="0" y1="${wallTop}" x2="0" y2="${horizonY}">
          <stop offset="0%" stop-color="${SKY_TOP}" stop-opacity="0.98" />
          <stop offset="100%" stop-color="${SKY_BOTTOM}" stop-opacity="0.98" />
        </linearGradient>
      </defs>
    `);

    const skyRect = `<rect data-front-wall-fill="true" x="${leftFarX}" y="${wallTop}" width="${wallWidth}" height="${wallHeight}" fill="url(#${skyId})" opacity="1" />`;
    pieces.push(skyRect);

    return pieces.join('\n');
  }

  // 前方に進める場合：奥に暗い穴だけ見える
  if (openings.forward) {
    const holeWidth = (rightFarX - leftFarX) * 0.4;
    const holeHeight = HEIGHT * 0.25;
    const holeLeft = centerX - holeWidth / 2;
    const holeTop = horizonY - holeHeight;
    const hole = `<rect x="${holeLeft}" y="${holeTop}" width="${holeWidth}" height="${holeHeight}" fill="${BG}" opacity="0.95" />`;
    pieces.push(hole);
    return pieces.join('\n');
  }

  // デッドエンド：普通の壁
  const wallHeight = Math.max(40, HEIGHT * 0.6);
  const wallTop = Math.max(0, horizonY - wallHeight);
  const wallWidth = rightFarX - leftFarX;
  const wall = `<rect data-front-wall-fill="true" x="${leftFarX}" y="${wallTop}" width="${wallWidth}" height="${wallHeight}" fill="${WALL_COLOR}" opacity="0.95" />`;
  pieces.push(wall);

  return pieces.join('\n');
}

// --------------------------------------------------
// SVG ヘルパー
// --------------------------------------------------

function poly(points: Point[], fill: string, opacity = 1, extra = ''): string {
  const d = points.map((p) => `${p.x},${p.y}`).join(' ');
  const attr = extra ? ` ${extra}` : '';
  return `<polygon${attr} points="${d}" fill="${fill}" opacity="${opacity}"/>`;
}

function line(from: Point, to: Point, stroke: string, width = 1, opacity = 1): string {
  return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}"/>`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}
