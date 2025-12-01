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

const FLOOR_NEAR_Y = 160; // bottom of the main corridor floor
const FLOOR_FAR_Y = 80; // horizon / far edge of floor

const FLOOR_NEAR_LEFT = 60;
const FLOOR_NEAR_RIGHT = 260;
const FLOOR_FAR_LEFT = 120;
const FLOOR_FAR_RIGHT = 200;

const COLOR_BG = '#000000';
const COLOR_CEILING = '#0b0d14';
const COLOR_FLOOR = '#8c4a32';
const COLOR_WALL = '#6c3a2c';
const COLOR_SKY = '#9fd8ff';
const COLOR_SKY_EDGE = '#d3ecff';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function joinPoints(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

function renderCeiling(): string {
  return `<rect x="0" y="0" width="${WIDTH}" height="${FLOOR_FAR_Y}" fill="${COLOR_CEILING}" />`;
}

function renderMainFloor(): string {
  const pts = [
    { x: FLOOR_NEAR_LEFT, y: FLOOR_NEAR_Y },
    { x: FLOOR_NEAR_RIGHT, y: FLOOR_NEAR_Y },
    { x: FLOOR_FAR_RIGHT, y: FLOOR_FAR_Y },
    { x: FLOOR_FAR_LEFT, y: FLOOR_FAR_Y },
  ];
  return `<polygon data-floor="main" points="${joinPoints(pts)}" fill="${COLOR_FLOOR}" />`;
}

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

function renderStartFade(): string {
  const fadeStart = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, 0.5);
  const fadeId = 'start-depth-fade';
  const floorPoly = [
    { x: FLOOR_NEAR_LEFT, y: FLOOR_NEAR_Y },
    { x: FLOOR_NEAR_RIGHT, y: FLOOR_NEAR_Y },
    { x: FLOOR_FAR_RIGHT, y: FLOOR_FAR_Y },
    { x: FLOOR_FAR_LEFT, y: FLOOR_FAR_Y },
  ];

  return `
    <defs>
      <linearGradient id="${fadeId}" x1="0" y1="${fadeStart}" x2="0" y2="${FLOOR_FAR_Y}">
        <stop offset="0%" stop-color="${COLOR_BG}" stop-opacity="0" />
        <stop offset="100%" stop-color="${COLOR_BG}" stop-opacity="0.95" />
      </linearGradient>
    </defs>
    <polygon data-depth-fade="start" points="${joinPoints(floorPoly)}" fill="url(#${fadeId})" />
  `;
}

function renderSideCorridor(side: 'left' | 'right'): string {
  const sign = side === 'left' ? -1 : 1;
  const tBranch = 0.5;
  const yBranch = lerp(FLOOR_NEAR_Y, FLOOR_FAR_Y, tBranch);
  const xBranch =
    side === 'left'
      ? lerp(FLOOR_NEAR_LEFT, FLOOR_FAR_LEFT, tBranch)
      : lerp(FLOOR_NEAR_RIGHT, FLOOR_FAR_RIGHT, tBranch);

  const sideWidth = 40;
  const sideDepth = 25;

  const p0 = { x: xBranch, y: yBranch };
  const p1 = { x: xBranch + sign * sideWidth, y: yBranch };
  const p2 = { x: xBranch + sign * sideWidth, y: yBranch - sideDepth };
  const p3 = { x: xBranch + sign * (sideWidth * 0.4), y: yBranch - sideDepth };

  const floor = `<polygon data-side-corridor="${side}" points="${joinPoints([
    p0,
    p1,
    p2,
    p3,
  ])}" fill="${COLOR_FLOOR}" opacity="0.95" />`;

  const wallHeight = 36;
  const wall = [
    { x: p3.x, y: p3.y - wallHeight },
    { x: p2.x, y: p2.y - wallHeight },
    { x: p2.x, y: p2.y },
    { x: p3.x, y: p3.y },
  ];
  const wallSvg = `<polygon points="${joinPoints(wall)}" fill="${COLOR_WALL}" />`;

  return `${floor}\n${wallSvg}`;
}

function renderGoalPortal(): string {
  const backWallTop = 10;
  const backWallBottom = FLOOR_FAR_Y;
  const backWallLeft = FLOOR_FAR_LEFT;
  const backWallRight = FLOOR_FAR_RIGHT;
  const backWallWidth = backWallRight - backWallLeft;
  const backWallHeight = backWallBottom - backWallTop;

  const gradientId = 'goal-sky';
  const portalWidth = backWallWidth * 0.85;
  const portalHeight = backWallHeight * 0.85;
  const portalLeft = backWallLeft + (backWallWidth - portalWidth) / 2;
  const portalTop = backWallTop + (backWallHeight - portalHeight) / 2;

  const defs = `
    <defs>
      <linearGradient id="${gradientId}" x1="0" y1="${backWallTop}" x2="0" y2="${backWallBottom}">
        <stop offset="0%" stop-color="${COLOR_SKY_EDGE}" />
        <stop offset="100%" stop-color="${COLOR_SKY}" />
      </linearGradient>
    </defs>
  `;

  const wall = `<rect data-front-wall-fill="true" x="${backWallLeft}" y="${backWallTop}" width="${backWallWidth}" height="${backWallHeight}" fill="url(#${gradientId})" />`;
  const portal = `<rect data-goal-portal="true" x="${portalLeft}" y="${portalTop}" width="${portalWidth}" height="${portalHeight}" fill="${COLOR_SKY_EDGE}" />`;

  return `${defs}\n${wall}\n${portal}`;
}

function renderStartView(): string {
  const ceiling = renderCeiling();
  const walls = renderSideWalls();
  const floor = renderMainFloor();
  const fade = renderStartFade();
  return [ceiling, walls, floor, fade].join('\n');
}

function renderJunctionView(openings: Openings): string {
  const ceiling = renderCeiling();
  const walls = renderSideWalls();
  const floor = renderMainFloor();
  const parts: string[] = [ceiling, walls, floor];

  if (openings.left) {
    parts.push(renderSideCorridor('left'));
  }
  if (openings.right) {
    parts.push(renderSideCorridor('right'));
  }

  return parts.join('\n');
}

function renderGoalView(openings: Openings): string {
  const ceiling = renderCeiling();
  const portal = renderGoalPortal();
  const walls = renderSideWalls();
  const floor = renderMainFloor();
  const parts: string[] = [ceiling, portal, walls, floor];

  if (openings.left) {
    parts.push(renderSideCorridor('left'));
  }
  if (openings.right) {
    parts.push(renderSideCorridor('right'));
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
    inner = renderStartView();
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
