import { describe, expect, it } from 'vitest';
import type { MazeDirection, MazeGenerationResult } from '../src/logic/maze';
import { maintainsPathAfterEdits } from '../src/logic/path-validation';

describe('maintainsPathAfterEdits', () => {
  it('経路と無関係な壁の追加では到達路が維持される', () => {
    const maze = createCorridorMaze(6);

    const result = maintainsPathAfterEdits(maze, [
      { x: 2, y: 0, direction: 'bottom', type: 'add' },
    ]);

    expect(result).toBe(true);
  });

  it('単一路線を塞ぐ壁の追加では到達路が失われる', () => {
    const maze = createCorridorMaze(6);

    const result = maintainsPathAfterEdits(maze, [
      { x: 3, y: 0, direction: 'right', type: 'add' },
    ]);

    expect(result).toBe(false);
  });

  it('既存の壁を削除する操作は常に到達路を維持する', () => {
    const maze = createCorridorMaze(6);

    const result = maintainsPathAfterEdits(maze, [
      { x: 1, y: 1, direction: 'right', type: 'remove' },
    ]);

    expect(result).toBe(true);
  });
});

function createCorridorMaze(length: number): MazeGenerationResult {
  const size: MazeGenerationResult['size'] = 20;
  const totalCells = size * size;
  const cells: MazeGenerationResult['cells'] = Array.from({ length: totalCells }, (_, index) => {
    const x = index % size;
    const y = Math.floor(index / size);
    return {
      x,
      y,
      walls: {
        top: true,
        right: true,
        bottom: true,
        left: true,
      } satisfies Record<MazeDirection, boolean>,
    };
  });

  for (let x = 0; x < length - 1; x += 1) {
    openPassage(cells, size, x, 0, 'right');
  }

  return {
    size,
    seed: 'corridor',
    cells,
    start: { x: 0, y: 0 },
    goal: { x: length - 1, y: 0 },
  };
}

function openPassage(
  cells: MazeGenerationResult['cells'],
  size: number,
  x: number,
  y: number,
  direction: MazeDirection,
): void {
  const offsets: Record<MazeDirection, { dx: number; dy: number; opposite: MazeDirection }> = {
    top: { dx: 0, dy: -1, opposite: 'bottom' },
    right: { dx: 1, dy: 0, opposite: 'left' },
    bottom: { dx: 0, dy: 1, opposite: 'top' },
    left: { dx: -1, dy: 0, opposite: 'right' },
  };

  const current = cells[y * size + x];
  current.walls[direction] = false;

  const offset = offsets[direction];
  const nx = x + offset.dx;
  const ny = y + offset.dy;
  if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
    return;
  }

  const neighbor = cells[ny * size + nx];
  neighbor.walls[offset.opposite] = false;
}
