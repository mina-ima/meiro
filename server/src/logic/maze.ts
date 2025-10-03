export interface MazeCell {
  x: number;
  y: number;
  walls: Record<'top' | 'right' | 'bottom' | 'left', boolean>;
}

export interface MazeConfig {
  size: 20 | 40;
}

/**
 * Placeholder maze generator. Produces a grid with all passages open so we can
 * iterate quickly on the rest of the pipeline. Real implementation will
 * integrate棒倒し/穴掘り法.
 */
export function generateMaze(config: MazeConfig): MazeCell[] {
  const dimension = config.size;
  const cells: MazeCell[] = [];

  for (let y = 0; y < dimension; y += 1) {
    for (let x = 0; x < dimension; x += 1) {
      cells.push({
        x,
        y,
        walls: {
          top: false,
          right: false,
          bottom: false,
          left: false,
        },
      });
    }
  }

  return cells;
}
