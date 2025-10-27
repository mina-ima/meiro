import { describe, expect, it } from 'vitest';
import { createInitialRoomState } from '../src/state';
import type { MazeGenerationResult } from '../src/logic/maze';

describe('createInitialRoomState の迷路初期化', () => {
  it.each([20, 40] as const)('%d×%d の迷路を生成し最短距離が4L以上になる', (mazeSize) => {
    const state = createInitialRoomState('ROOM-MAZE', 1_700_000_000_000, 5 * 60 * 1000, {
      mazeSize,
      mazeSeed: `test-${mazeSize}`,
    });

    const maze: MazeGenerationResult = state.maze;
    expect(maze.size).toBe(mazeSize);

    const goalCell = state.goalCell;
    expect(goalCell).toBeDefined();
    expect(goalCell).toEqual(maze.goal);

    const shortest = shortestPathLength(maze.start, maze.goal, maze);
    expect(shortest).toBeGreaterThanOrEqual(mazeSize * 4);
  });
});

function shortestPathLength(
  start: { x: number; y: number },
  goal: { x: number; y: number },
  maze: MazeGenerationResult,
): number {
  if (start.x === goal.x && start.y === goal.y) {
    return 0;
  }

  const visited = new Set<number>();
  const queue: Array<{ index: number; length: number }> = [];

  const startIndex = indexOf(start, maze.size);
  const goalIndex = indexOf(goal, maze.size);

  visited.add(startIndex);
  queue.push({ index: startIndex, length: 0 });

  while (queue.length > 0) {
    const { index, length } = queue.shift()!;
    if (index === goalIndex) {
      return length;
    }

    const cell = maze.cells[index];
    for (const neighbor of neighborsOf(cell, maze)) {
      if (visited.has(neighbor.index)) {
        continue;
      }
      visited.add(neighbor.index);
      queue.push({ index: neighbor.index, length: length + 1 });
    }
  }

  throw new Error('goal is not reachable');
}

function neighborsOf(
  cell: MazeGenerationResult['cells'][number],
  maze: MazeGenerationResult,
): Array<{ index: number }> {
  const { x, y, walls } = cell;
  const result: Array<{ index: number }> = [];

  if (!walls.top && y > 0) {
    result.push({ index: indexOf({ x, y: y - 1 }, maze.size) });
  }
  if (!walls.right && x < maze.size - 1) {
    result.push({ index: indexOf({ x: x + 1, y }, maze.size) });
  }
  if (!walls.bottom && y < maze.size - 1) {
    result.push({ index: indexOf({ x, y: y + 1 }, maze.size) });
  }
  if (!walls.left && x > 0) {
    result.push({ index: indexOf({ x: x - 1, y }, maze.size) });
  }

  return result;
}

function indexOf(point: { x: number; y: number }, size: number): number {
  return point.y * size + point.x;
}
