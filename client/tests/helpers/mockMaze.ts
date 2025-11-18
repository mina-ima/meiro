import type { ServerMazeState } from '../../src/state/sessionStore';

export function createMockMaze(size: 20 | 40 = 40): ServerMazeState {
  const cells: ServerMazeState['cells'] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      cells.push({
        x,
        y,
        walls: {
          top: y === 0,
          right: x === size - 1,
          bottom: y === size - 1,
          left: x === 0,
        },
      });
    }
  }

  return {
    seed: 'test-maze',
    start: { x: 0, y: 0 },
    goal: { x: size - 1, y: size - 1 },
    cells,
  };
}
