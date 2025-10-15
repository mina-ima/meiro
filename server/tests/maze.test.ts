import { describe, expect, it } from 'vitest';
import { generateMaze } from '../src/logic/maze';

interface Vec2 {
  x: number;
  y: number;
}

describe('generateMaze', () => {
  it.each([20, 40] as const)('%d×%d の迷路は連結で最短路が4L以上', (size) => {
    const maze = generateMaze({ size, seed: `${size}-basic` });

    expect(maze.cells).toHaveLength(size * size);
    expect(isWithinBounds(maze.start, size)).toBe(true);
    expect(isWithinBounds(maze.goal, size)).toBe(true);
    expect(maze.start).not.toEqual(maze.goal);

    const reachable = exploreReachable(maze.start, maze);
    expect(reachable.size).toBe(size * size);

    const shortest = shortestPathLength(maze.start, maze.goal, maze);
    expect(shortest).toBeGreaterThanOrEqual(size * 4);
  });

  it('1,000通りの生成で常に連結かつ最短路が4L以上になる', () => {
    const attempts = 1_000;
    for (const size of [20, 40] as const) {
      for (let i = 0; i < attempts; i += 1) {
        const maze = generateMaze({ size, seed: `${size}-property-${i}` });
        const reachable = exploreReachable(maze.start, maze);
        expect(reachable.size).toBe(size * size);
        const shortest = shortestPathLength(maze.start, maze.goal, maze);
        expect(shortest).toBeGreaterThanOrEqual(size * 4);
      }
    }
  });
});

function isWithinBounds({ x, y }: Vec2, size: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function exploreReachable(start: Vec2, maze: ReturnType<typeof generateMaze>): Set<string> {
  const visited = new Set<string>();
  const queue: Vec2[] = [start];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    const key = keyOf(current);
    if (visited.has(key)) {
      continue;
    }

    visited.add(key);
    for (const next of neighborsOf(current, maze)) {
      if (!visited.has(keyOf(next))) {
        queue.push(next);
      }
    }
  }

  return visited;
}

function shortestPathLength(start: Vec2, goal: Vec2, maze: ReturnType<typeof generateMaze>): number {
  if (start.x === goal.x && start.y === goal.y) {
    return 0;
  }

  const visited = new Set<string>([keyOf(start)]);
  const queue: Array<{ point: Vec2; length: number }> = [{ point: start, length: 0 }];

  while (queue.length > 0) {
    const { point, length } = queue.shift()!;
    if (point.x === goal.x && point.y === goal.y) {
      return length;
    }

    for (const next of neighborsOf(point, maze)) {
      const key = keyOf(next);
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);
      queue.push({ point: next, length: length + 1 });
    }
  }

  throw new Error('goal is not reachable');
}

function neighborsOf(point: Vec2, maze: ReturnType<typeof generateMaze>): Vec2[] {
  const { x, y } = point;
  const cell = maze.cells[y * maze.size + x];
  const neighbors: Vec2[] = [];

  if (!cell.walls.top && y > 0) {
    neighbors.push({ x, y: y - 1 });
  }
  if (!cell.walls.right && x < maze.size - 1) {
    neighbors.push({ x: x + 1, y });
  }
  if (!cell.walls.bottom && y < maze.size - 1) {
    neighbors.push({ x, y: y + 1 });
  }
  if (!cell.walls.left && x > 0) {
    neighbors.push({ x: x - 1, y });
  }

  return neighbors;
}

function keyOf({ x, y }: Vec2): string {
  return `${x},${y}`;
}
