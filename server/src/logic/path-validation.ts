import type { MazeDirection, MazeGenerationResult } from './maze';

export interface WallModification {
  x: number;
  y: number;
  direction: MazeDirection;
  type: 'add' | 'remove';
}

const OFFSETS: Record<MazeDirection, { dx: number; dy: number; opposite: MazeDirection }> = {
  top: { dx: 0, dy: -1, opposite: 'bottom' },
  right: { dx: 1, dy: 0, opposite: 'left' },
  bottom: { dx: 0, dy: 1, opposite: 'top' },
  left: { dx: -1, dy: 0, opposite: 'right' },
};

export function maintainsPathAfterEdits(
  maze: MazeGenerationResult,
  edits: WallModification[],
): boolean {
  if (maze.start.x === maze.goal.x && maze.start.y === maze.goal.y) {
    return true;
  }

  const cells = cloneCells(maze);
  applyModifications(cells, maze.size, edits);
  return hasPath(cells, maze.size, maze.start, maze.goal);
}

function cloneCells(maze: MazeGenerationResult): MazeGenerationResult['cells'] {
  return maze.cells.map((cell) => ({
    x: cell.x,
    y: cell.y,
    walls: { ...cell.walls },
  }));
}

function applyModifications(
  cells: MazeGenerationResult['cells'],
  size: MazeGenerationResult['size'],
  edits: WallModification[],
): void {
  for (const edit of edits) {
    if (!isWithinBounds(edit.x, edit.y, size)) {
      continue;
    }

    const index = toIndex(edit.x, edit.y, size);
    const cell = cells[index];
    const offset = OFFSETS[edit.direction];
    const newValue = edit.type === 'add';
    cell.walls[edit.direction] = newValue;

    const nx = edit.x + offset.dx;
    const ny = edit.y + offset.dy;
    if (!isWithinBounds(nx, ny, size)) {
      continue;
    }

    const neighbor = cells[toIndex(nx, ny, size)];
    neighbor.walls[offset.opposite] = newValue;
  }
}

function hasPath(
  cells: MazeGenerationResult['cells'],
  size: MazeGenerationResult['size'],
  start: { x: number; y: number },
  goal: { x: number; y: number },
): boolean {
  const startIndex = toIndex(start.x, start.y, size);
  const goalIndex = toIndex(goal.x, goal.y, size);
  const visited = new Set<number>([startIndex]);
  const queue: number[] = [startIndex];

  while (queue.length > 0) {
    const currentIndex = queue.shift();
    if (currentIndex === undefined) {
      break;
    }

    if (currentIndex === goalIndex) {
      return true;
    }

    const cell = cells[currentIndex];

    for (const direction of Object.keys(OFFSETS) as MazeDirection[]) {
      if (cell.walls[direction]) {
        continue;
      }

      const offset = OFFSETS[direction];
      const nx = cell.x + offset.dx;
      const ny = cell.y + offset.dy;
      if (!isWithinBounds(nx, ny, size)) {
        continue;
      }

      const neighborIndex = toIndex(nx, ny, size);
      if (visited.has(neighborIndex)) {
        continue;
      }

      visited.add(neighborIndex);
      queue.push(neighborIndex);
    }
  }

  return false;
}

function toIndex(x: number, y: number, size: number): number {
  return y * size + x;
}

function isWithinBounds(x: number, y: number, size: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}
