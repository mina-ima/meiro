import type { Direction, MazePreviewVariant } from './PlayerView';
import type { ServerMazeCell } from '../state/sessionStore';

const WIDTH = 320;
const HEIGHT = 180;

// 画像アセットの読み込み（透過PNG）。実画像が差し替わる前はプレースホルダーが使われる。
import floor_d1 from '../assets/preview_tiles/floor_d1.png';
import floor_d2 from '../assets/preview_tiles/floor_d2.png';
import floor_d3 from '../assets/preview_tiles/floor_d3.png';
import floor_d4 from '../assets/preview_tiles/floor_d4.png';
import left_open_d1 from '../assets/preview_tiles/left_open_d1.png';
import left_open_d2 from '../assets/preview_tiles/left_open_d2.png';
import left_open_d3 from '../assets/preview_tiles/left_open_d3.png';
import left_open_d4 from '../assets/preview_tiles/left_open_d4.png';
import left_closed_d1 from '../assets/preview_tiles/left_closed_d1.png';
import left_closed_d2 from '../assets/preview_tiles/left_closed_d2.png';
import left_closed_d3 from '../assets/preview_tiles/left_closed_d3.png';
import left_closed_d4 from '../assets/preview_tiles/left_closed_d4.png';
import right_open_d1 from '../assets/preview_tiles/right_open_d1.png';
import right_open_d2 from '../assets/preview_tiles/right_open_d2.png';
import right_open_d3 from '../assets/preview_tiles/right_open_d3.png';
import right_open_d4 from '../assets/preview_tiles/right_open_d4.png';
import right_closed_d1 from '../assets/preview_tiles/right_closed_d1.png';
import right_closed_d2 from '../assets/preview_tiles/right_closed_d2.png';
import right_closed_d3 from '../assets/preview_tiles/right_closed_d3.png';
import right_closed_d4 from '../assets/preview_tiles/right_closed_d4.png';
import front_dead_d1 from '../assets/preview_tiles/front_dead_d1.png';
import front_dead_d2 from '../assets/preview_tiles/front_dead_d2.png';
import front_dead_d3 from '../assets/preview_tiles/front_dead_d3.png';
import front_dead_d4 from '../assets/preview_tiles/front_dead_d4.png';
import opening_fill_left_d1 from '../assets/preview_tiles/opening_fill_left_d1.png';
import opening_fill_left_d2 from '../assets/preview_tiles/opening_fill_left_d2.png';
import opening_fill_left_d3 from '../assets/preview_tiles/opening_fill_left_d3.png';
import opening_fill_left_d4 from '../assets/preview_tiles/opening_fill_left_d4.png';
import opening_fill_right_d1 from '../assets/preview_tiles/opening_fill_right_d1.png';
import opening_fill_right_d2 from '../assets/preview_tiles/opening_fill_right_d2.png';
import opening_fill_right_d3 from '../assets/preview_tiles/opening_fill_right_d3.png';
import opening_fill_right_d4 from '../assets/preview_tiles/opening_fill_right_d4.png';

const PLACEHOLDER_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PvNbywAAAABJRU5ErkJggg==';

const TILE_ASSETS: Record<string, string | undefined> = {
  floor_d1,
  floor_d2,
  floor_d3,
  floor_d4,
  left_open_d1,
  left_open_d2,
  left_open_d3,
  left_open_d4,
  left_closed_d1,
  left_closed_d2,
  left_closed_d3,
  left_closed_d4,
  right_open_d1,
  right_open_d2,
  right_open_d3,
  right_open_d4,
  right_closed_d1,
  right_closed_d2,
  right_closed_d3,
  right_closed_d4,
  front_dead_d1,
  front_dead_d2,
  front_dead_d3,
  front_dead_d4,
  opening_fill_left_d1,
  opening_fill_left_d2,
  opening_fill_left_d3,
  opening_fill_left_d4,
  opening_fill_right_d1,
  opening_fill_right_d2,
  opening_fill_right_d3,
  opening_fill_right_d4,
};

type Openings = {
  forward: boolean;
  left: boolean;
  right: boolean;
  backward: boolean;
};

type Depth = 1 | 2 | 3 | 4;

type DepthState = {
  leftOpen: boolean;
  rightOpen: boolean;
  frontOpen: boolean;
};

type PreviewState = Record<Depth, DepthState>;

type TileEntry = {
  key: string;
  depth: Depth;
  role: 'floor' | 'left' | 'right' | 'front' | 'opening_fill_left' | 'opening_fill_right';
};

const DEPTHS_NEAR_TO_FAR: Depth[] = [1, 2, 3, 4];
const DEPTHS_FAR_TO_NEAR: Depth[] = [4, 3, 2, 1];
const SIDE_OPEN_MAX_DEPTH_WHEN_FORWARD_OPEN: Depth = 2;
const SIDE_OPEN_MAX_DEPTH_WHEN_FORWARD_BLOCKED: Depth = 1;
const FRONT_OPEN_MAX_DEPTH_WHEN_FORWARD_OPEN: Depth = 4;

function buildPreviewState(openings: Openings): PreviewState {
  // 前方が開いている場合のみ、左右の開口をdepth=2まで伸ばす。
  // 正面の見通せる最大depthも決めておき、そこを超えたらfrontDeadで打ち切る。
  const state = {} as PreviewState;
  const sideOpenLimit = openings.forward
    ? SIDE_OPEN_MAX_DEPTH_WHEN_FORWARD_OPEN
    : SIDE_OPEN_MAX_DEPTH_WHEN_FORWARD_BLOCKED;
  const frontOpenLimit = openings.forward ? FRONT_OPEN_MAX_DEPTH_WHEN_FORWARD_OPEN : 0;

  for (const depth of DEPTHS_NEAR_TO_FAR) {
    state[depth] = {
      leftOpen: openings.left && depth <= sideOpenLimit,
      rightOpen: openings.right && depth <= sideOpenLimit,
      frontOpen: depth <= frontOpenLimit && openings.forward,
    };
  }

  return state as PreviewState;
}

function buildTileEntries(previewState: PreviewState): TileEntry[] {
  const entries: TileEntry[] = [];

  const stopDepth = DEPTHS_NEAR_TO_FAR.find((depth) => !previewState[depth].frontOpen);
  const maxRenderDepth = (stopDepth ?? DEPTHS_NEAR_TO_FAR[DEPTHS_NEAR_TO_FAR.length - 1]) as Depth;

  for (const depth of DEPTHS_FAR_TO_NEAR) {
    if (depth > maxRenderDepth) {
      continue;
    }
    const state = previewState[depth];
    entries.push({ key: `floor_d${depth}`, role: 'floor', depth });

    if (state.leftOpen) {
      entries.push({ key: `opening_fill_left_d${depth}`, role: 'opening_fill_left', depth });
      entries.push({ key: `left_open_d${depth}`, role: 'left', depth });
    } else {
      entries.push({ key: `left_closed_d${depth}`, role: 'left', depth });
    }

    if (state.rightOpen) {
      entries.push({ key: `opening_fill_right_d${depth}`, role: 'opening_fill_right', depth });
      entries.push({ key: `right_open_d${depth}`, role: 'right', depth });
    } else {
      entries.push({ key: `right_closed_d${depth}`, role: 'right', depth });
    }

    if (!state.frontOpen) {
      entries.push({ key: `front_dead_d${depth}`, role: 'front', depth });
    }
  }

  return entries;
}

function getTileSrc(key: string): string {
  return TILE_ASSETS[key] ?? PLACEHOLDER_DATA_URL;
}

function renderTile(entry: TileEntry): string {
  const src = getTileSrc(entry.key);
  return `<img data-tile-key="${entry.key}" data-tile-role="${entry.role}" data-depth="${entry.depth}" src="${src}" alt="${entry.key}" style="position:absolute;left:0;top:0;width:100%;height:100%;" />`;
}

function renderPreview(
  openings: Openings,
  variant: MazePreviewVariant,
  orientation: Direction,
): string {
  const previewState = buildPreviewState(openings);
  const tiles = buildTileEntries(previewState).map(renderTile).join('\n');
  return `
    <div data-preview-style="fancy" data-preview-variant="${variant}" data-facing="${orientation}" style="position:relative;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:#050608;">
      ${tiles}
    </div>
  `;
}

export function createFancyMazePreviewSvg(
  _cell: ServerMazeCell,
  _openDirections: Direction[],
  variant: MazePreviewVariant,
  orientation: Direction,
  openings: Openings,
): string {
  return renderPreview(openings, variant, orientation);
}
