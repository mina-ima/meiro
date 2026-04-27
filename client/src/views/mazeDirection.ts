import type { ServerMazeCell } from '../state/sessionStore';

export type Direction = 'north' | 'east' | 'south' | 'west';

export const DIRECTION_INFO: Record<
  Direction,
  { wall: keyof ServerMazeCell['walls']; label: string; short: string }
> = {
  north: { wall: 'top', label: '北側', short: '北' },
  east: { wall: 'right', label: '東側', short: '東' },
  south: { wall: 'bottom', label: '南側', short: '南' },
  west: { wall: 'left', label: '西側', short: '西' },
};

export const DIRECTION_SEQUENCE: Direction[] = ['north', 'east', 'south', 'west'];

export const DIRECTION_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
};

export const DIRECTION_LABEL_JA: Record<Direction, string> = {
  north: '北',
  east: '東',
  south: '南',
  west: '西',
};

export function isDirectionOpen(cell: ServerMazeCell, direction: Direction): boolean {
  const wallKey = DIRECTION_INFO[direction].wall;
  return !cell.walls[wallKey];
}

export function rotateDirection(direction: Direction, steps: number): Direction {
  const index = DIRECTION_SEQUENCE.indexOf(direction);
  if (index === -1) {
    return direction;
  }
  const normalized = (index + steps + DIRECTION_SEQUENCE.length) % DIRECTION_SEQUENCE.length;
  return DIRECTION_SEQUENCE[normalized] ?? direction;
}

export function angleToDirection(angle: number): Direction {
  const twoPi = Math.PI * 2;
  const normalized = ((angle % twoPi) + twoPi) % twoPi;
  if (normalized < Math.PI / 4 || normalized >= (7 * Math.PI) / 4) return 'east';
  if (normalized < (3 * Math.PI) / 4) return 'south';
  if (normalized < (5 * Math.PI) / 4) return 'west';
  return 'north';
}

export function computeOpenings(
  cell: ServerMazeCell,
  facing: Direction,
): { forward: boolean; backward: boolean; left: boolean; right: boolean } {
  return {
    forward: isDirectionOpen(cell, facing),
    backward: isDirectionOpen(cell, rotateDirection(facing, 2)),
    left: isDirectionOpen(cell, rotateDirection(facing, -1)),
    right: isDirectionOpen(cell, rotateDirection(facing, 1)),
  };
}

export function getOpenDirections(cell: ServerMazeCell): Direction[] {
  const directions: Direction[] = [];
  (Object.keys(DIRECTION_INFO) as Direction[]).forEach((direction) => {
    if (isDirectionOpen(cell, direction)) {
      directions.push(direction);
    }
  });
  return directions;
}

// 現在セルから forward方向に進んだ際、何マス先で壁にぶつかるかを返す。
// 0 = 現在セルの forward が壁（前進不可）
// N = N マス分は通路、その先で壁
// maxDistance に達した場合は maxDistance を返す（= それ以上は描画しない fade 表現用）
export function computeForwardWallDistance(
  cells: readonly ServerMazeCell[],
  startCell: ServerMazeCell,
  facing: Direction,
  maxDistance: number,
): number {
  const lookup = new Map<string, ServerMazeCell>();
  cells.forEach((c) => lookup.set(`${c.x},${c.y}`, c));
  const vector = DIRECTION_VECTORS[facing];
  let cur: ServerMazeCell | undefined = startCell;
  let dist = 0;
  while (dist < maxDistance && cur) {
    if (!isDirectionOpen(cur, facing)) {
      return dist;
    }
    cur = lookup.get(`${cur.x + vector.dx},${cur.y + vector.dy}`);
    dist += 1;
    if (!cur) {
      return dist;
    }
  }
  return dist;
}
