export type MazeDirection = 'top' | 'right' | 'bottom' | 'left';

export interface MazeCell {
  x: number;
  y: number;
  walls: Record<MazeDirection, boolean>;
}

export interface MazeGenerationResult {
  size: 20 | 40;
  seed: string;
  cells: MazeCell[];
  start: { x: number; y: number };
  goal: { x: number; y: number };
}

export interface MazeConfig {
  size: 20 | 40;
  seed?: string;
  maxAttempts?: number;
}

const MIN_PATH_FACTOR = 4;
const DEFAULT_ATTEMPTS = 50;

export function generateMaze(config: MazeConfig): MazeGenerationResult {
  const size = config.size;
  const seed = config.seed ?? createSeed();
  const rng = createRng(seed);
  const maxAttempts = config.maxAttempts ?? DEFAULT_ATTEMPTS;
  const minPath = size * MIN_PATH_FACTOR;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const cells = carveMaze(size, rng);
    const startGoal = chooseStartGoal(cells, size, rng, minPath);

    if (!startGoal) {
      continue;
    }

    const { start, goal, distance } = startGoal;
    if (distance >= minPath) {
      return {
        size,
        seed,
        cells,
        start,
        goal,
      };
    }
  }

  throw new Error(`failed to generate maze satisfying constraints for size=${size}`);
}

const OFFSETS: Record<MazeDirection, { dx: number; dy: number; opposite: MazeDirection }> = {
  top: { dx: 0, dy: -1, opposite: 'bottom' },
  right: { dx: 1, dy: 0, opposite: 'left' },
  bottom: { dx: 0, dy: 1, opposite: 'top' },
  left: { dx: -1, dy: 0, opposite: 'right' },
};

function carveMaze(size: number, rng: () => number): MazeCell[] {
  const cells: MazeCell[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      cells.push({
        x,
        y,
        walls: {
          top: true,
          right: true,
          bottom: true,
          left: true,
        },
      });
    }
  }

  const stack: MazeCell[] = [];
  const visited = new Set<number>();
  const startIndex = Math.floor(rng() * cells.length);
  stack.push(cells[startIndex]);
  visited.add(startIndex);

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbors = shuffle(directions(), rng)
      .map((direction) => {
        const offset = OFFSETS[direction];
        const nx = current.x + offset.dx;
        const ny = current.y + offset.dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
          return null;
        }
        const index = ny * size + nx;
        if (visited.has(index)) {
          return null;
        }
        return { direction, cell: cells[index], index };
      })
      .filter(
        (entry): entry is { direction: MazeDirection; cell: MazeCell; index: number } =>
          entry !== null,
      );

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }

    const next = neighbors[0];
    removeWall(current, next.cell, next.direction);
    visited.add(next.index);
    stack.push(next.cell);
  }

  return cells;
}

function directions(): MazeDirection[] {
  return ['top', 'right', 'bottom', 'left'];
}

function removeWall(a: MazeCell, b: MazeCell, direction: MazeDirection): void {
  const offset = OFFSETS[direction];
  a.walls[direction] = false;
  b.walls[offset.opposite] = false;
}

function chooseStartGoal(
  cells: MazeCell[],
  size: number,
  rng: () => number,
  minPath: number,
): { start: { x: number; y: number }; goal: { x: number; y: number }; distance: number } | null {
  const shuffledIndices = shuffle(
    Array.from({ length: cells.length }, (_, index) => index),
    rng,
  );

  for (const index of shuffledIndices) {
    const start = cells[index];
    const distances = shortestDistancesFrom(start, cells, size);
    const viable = distances
      .map((distance, i) => ({ distance, cell: cells[i] }))
      .filter((entry) => entry.distance >= minPath);

    if (viable.length === 0) {
      continue;
    }

    const choice = viable[Math.floor(rng() * viable.length)];
    return {
      start: { x: start.x, y: start.y },
      goal: { x: choice.cell.x, y: choice.cell.y },
      distance: choice.distance,
    };
  }

  return null;
}

function shortestDistancesFrom(start: MazeCell, cells: MazeCell[], size: number): number[] {
  const distances = Array<number>(cells.length).fill(Infinity);
  const queue: Array<{ cell: MazeCell; distance: number }> = [{ cell: start, distance: 0 }];
  distances[start.y * size + start.x] = 0;

  while (queue.length > 0) {
    const { cell, distance } = queue.shift()!;

    for (const direction of directions()) {
      if (cell.walls[direction]) {
        continue;
      }
      const offset = OFFSETS[direction];
      const nx = cell.x + offset.dx;
      const ny = cell.y + offset.dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
        continue;
      }

      const neighborIndex = ny * size + nx;
      if (distances[neighborIndex] !== Infinity) {
        continue;
      }

      distances[neighborIndex] = distance + 1;
      queue.push({ cell: cells[neighborIndex], distance: distance + 1 });
    }
  }

  return distances;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copied = items.slice();
  for (let i = copied.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copied[i], copied[j]] = [copied[j], copied[i]];
  }
  return copied;
}

function createRng(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function hashSeed(seed: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeed(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2);
}
