import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PlayerView } from '../src/views/PlayerView';
import { useSessionStore, type ServerMazeState } from '../src/state/sessionStore';
import { createMockMaze } from './helpers/mockMaze';

const baseProps = {
  points: 0,
  targetPoints: 100,
  predictionHits: 0,
  timeRemaining: 120,
} as const;

describe('PlayerView 準備プレビュー', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    act(() => {
      useSessionStore.getState().reset();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      useSessionStore.getState().reset();
    });
  });

  it('準備フェーズ中に迷路データ由来のスタート映像が表示される', () => {
    const maze = prepareMaze({
      start: { x: 5, y: 3 },
      goal: { x: 17, y: 11 },
    });
    initializePrepPreviewState(maze);

    render(<PlayerView {...baseProps} phase="prep" />);

    const group = screen.getByRole('group', { name: '準備中プレビュー' });
    expect(group).toBeInTheDocument();
    expect(screen.getByText('スタート地点プレビュー')).toBeInTheDocument();
    expect(screen.getByText(/北|東|南|西/)).toBeInTheDocument();
    expect(
      screen.queryByText((content) => /\(\d+\s*,\s*\d+\)/.test(content)),
    ).not.toBeInTheDocument();
  });

  it('プレビューには必ずゴール映像が含まれる', () => {
    const maze = prepareMaze({
      start: { x: 1, y: 2 },
      goal: { x: 18, y: 16 },
    });
    initializePrepPreviewState(maze);

    render(<PlayerView {...baseProps} phase="prep" />);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('ゴール直前プレビュー')).toBeInTheDocument();
    expect(screen.getByAltText('ゴールプレビュー映像')).toBeInTheDocument();
  });

  it('探索フェーズではキャンバスのみが表示される', () => {
    render(<PlayerView {...baseProps} phase="explore" />);

    expect(screen.getByLabelText('レイキャスト表示')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '準備中プレビュー' })).not.toBeInTheDocument();
  });

  it('プレビュー画像はレンガ調で傾き情報を含む', () => {
    const maze = prepareMaze({
      start: { x: 3, y: 2 },
      goal: { x: 16, y: 14 },
    });
    initializePrepPreviewState(maze);

    render(<PlayerView {...baseProps} phase="prep" />);

    const image = screen.getByAltText('スタート地点プレビュー映像') as HTMLImageElement;
    const decodedSvg = decodeSvgDataUri(image.getAttribute('src'));

    expect(decodedSvg).toContain('#8c1c1c');
    expect(decodedSvg).toContain('data-view-tilt');
    expect(decodedSvg).not.toContain('wireframe-door');
  });

  it('プレビューの傾きは常に0で正面を維持する', () => {
    const maze = prepareMaze({
      start: { x: 2, y: 1 },
      goal: { x: 19, y: 18 },
    });
    initializePrepPreviewState(maze);

    render(<PlayerView {...baseProps} phase="prep" />);

    const image = screen.getByRole('img') as HTMLImageElement;
    const firstTilt = extractTilt(image.getAttribute('src'));

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    const secondTilt = extractTilt(image.getAttribute('src'));
    expect(firstTilt).toBe('0.00');
    expect(secondTilt).toBe('0.00');
  });

  it('分岐クリップでは左右の開口部がSVGに含まれる', () => {
    const maze = createJunctionPreviewMaze();
    initializePrepPreviewState(maze);

    render(<PlayerView {...baseProps} phase="prep" />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    const image = screen.getByAltText('迷路分岐プレビュー映像') as HTMLImageElement;
    const svg = decodeSvgDataUri(image.getAttribute('src'));

    expect(svg).toContain('data-forward-open="true"');
    expect(svg).toContain('data-left-open="true"');
    expect(svg).toContain('data-right-open="true"');
    expect((svg.match(/data-side-corridor="left"/g) ?? []).length).toBeGreaterThan(0);
    expect((svg.match(/data-side-corridor="right"/g) ?? []).length).toBeGreaterThan(0);
  });

  it('袋小路のクリップでは前方が完全に閉じられる', () => {
    const maze = createForwardBlockedPreviewMaze();
    initializePrepPreviewState(maze);

    render(<PlayerView {...baseProps} phase="prep" />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    const image = screen.getByAltText('迷路分岐プレビュー映像') as HTMLImageElement;
    const svg = decodeSvgDataUri(image.getAttribute('src'));

    expect(svg).toContain('data-forward-open="false"');
    expect(svg).toContain('data-front-wall="closed"');
  });

  it('一直線の通路では左右の開口部が描かれない', () => {
    const maze = createStraightPreviewMaze();
    initializePrepPreviewState(maze);

    render(<PlayerView {...baseProps} phase="prep" />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    const image = screen.getByAltText('迷路分岐プレビュー映像') as HTMLImageElement;
    const svg = decodeSvgDataUri(image.getAttribute('src'));

    expect(svg).toContain('data-left-open="false"');
    expect(svg).toContain('data-right-open="false"');
    expect(svg).not.toContain('data-side-corridor="left"');
    expect(svg).not.toContain('data-side-corridor="right"');
  });

  it('分岐クリップの側面ドアは通路中盤に配置される', () => {
    const maze = createJunctionPreviewMaze();
    initializePrepPreviewState(maze);

    render(<PlayerView {...baseProps} phase="prep" />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    const image = screen.getByAltText('迷路分岐プレビュー映像') as HTMLImageElement;
    const svg = decodeSvgDataUri(image.getAttribute('src'));
    const door = extractDoorRect(svg, 'left');
    const floor = extractBaseFloorQuad(svg);

    expect(door).not.toBeNull();
    expect(floor).not.toBeNull();
    if (!door || !floor) {
      return;
    }

    const floorBottom = Math.max(...floor.map((point) => point.y));
    const floorTop = Math.min(...floor.map((point) => point.y));
    const doorBottom = door.y + door.height;
    const depthRatio = (floorBottom - doorBottom) / (floorBottom - floorTop);

    expect(depthRatio).toBeGreaterThan(0.55);
    expect(depthRatio).toBeLessThan(0.7);
  });

  it('分岐クリップで前方が開いている場合は奥壁が描かれない', () => {
    const maze = createJunctionPreviewMaze();
    initializePrepPreviewState(maze);

    render(<PlayerView {...baseProps} phase="prep" />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    const image = screen.getByAltText('迷路分岐プレビュー映像') as HTMLImageElement;
    const svg = decodeSvgDataUri(image.getAttribute('src'));
    const frontWallGroup = extractFrontWallGroup(svg);

    expect(frontWallGroup).toContain('data-front-wall="open"');
    expect(frontWallGroup).toContain('data-forward-extension="true"');
    expect(frontWallGroup).toContain('data-forward-fade="true"');
    expect(frontWallGroup).not.toMatch(/data-front-wall-fill/);
    expect(frontWallGroup).not.toMatch(/<rect[^>]*>/);
  });

  it('スタートクリップは奥壁を描かず暗く消えていく', () => {
    const maze = createDarkStartMaze();
    initializePrepPreviewState(maze);

    render(<PlayerView {...baseProps} phase="prep" />);

    const image = screen.getByAltText('スタート地点プレビュー映像') as HTMLImageElement;
    const svg = decodeSvgDataUri(image.getAttribute('src'));
    const frontWallGroup = extractFrontWallGroup(svg);

    expect(frontWallGroup).toContain('data-front-wall="open"');
    expect(frontWallGroup).not.toMatch(/data-front-wall-fill/);
    expect(svg).toMatch(/data-depth-fade="start"/);
  });

  it('分岐クリップでは開いている側の壁が角で途切れる', () => {
    const maze = createJunctionPreviewMaze();
    initializePrepPreviewState(maze);

    render(<PlayerView {...baseProps} phase="prep" />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    const image = screen.getByAltText('迷路分岐プレビュー映像') as HTMLImageElement;
    const svg = decodeSvgDataUri(image.getAttribute('src'));
    const door = extractDoorRect(svg, 'left');
    const wall = extractWallPolygon(svg, 'left');

    expect(door).not.toBeNull();
    expect(wall).not.toBeNull();
    if (!door || !wall) {
      return;
    }

    const doorEdgeX = door.x;
    const doorBottomY = door.y + door.height;
    const matchingCorner = wall.points.find(
      (point) => Math.abs(point.x - doorEdgeX) < 1 && point.y >= doorBottomY - 1,
    );

    expect(matchingCorner).toBeDefined();
    expect(wall.points.some((point) => point.y <= door.y)).toBe(true);
  });

  it('ゴールクリップには青空のようなポータルが描かれる', () => {
    const maze = createJunctionPreviewMaze();
    initializePrepPreviewState(maze);

    render(<PlayerView {...baseProps} phase="prep" />);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    const image = screen.getByAltText('ゴールプレビュー映像') as HTMLImageElement;
    const svg = decodeSvgDataUri(image.getAttribute('src'));

    expect(svg).toMatch(/data-goal-portal="true"/);
    expect(svg).toMatch(/#6ec3ff/i);
    expect(svg).toMatch(/#ffffff/i);
  });
});

function decodeSvgDataUri(src: string | null): string {
  if (!src) {
    return '';
  }
  const [, encodedSvg] = src.split(',', 2);
  return decodeURIComponent(encodedSvg ?? '');
}

function extractTilt(src: string | null): string {
  const decoded = decodeSvgDataUri(src);
  const match = decoded.match(/data-view-tilt="([^"]+)"/);
  if (!match) {
    return '';
  }
  return match[1];
}

function extractDoorRect(svg: string, side: 'left' | 'right') {
  const match = svg.match(new RegExp(`<rect[^>]*data-doorway="${side}"[^>]*>`));
  if (!match) {
    return null;
  }
  const attributes = Object.fromEntries(
    Array.from(match[0].matchAll(/([a-zA-Z-]+)="([^"]+)"/g)).map(([, key, value]) => [key, value]),
  );
  const parse = (value?: string) => (value ? Number.parseFloat(value) : NaN);
  const x = parse(attributes.x);
  const y = parse(attributes.y);
  const width = parse(attributes.width);
  const height = parse(attributes.height);
  if ([x, y, width, height].some((value) => Number.isNaN(value))) {
    return null;
  }
  return { x, y, width, height };
}

function extractBaseFloorQuad(svg: string) {
  const match = svg.match(/<polygon[^>]*points="([^"]+)"[^>]*fill="#8c1c1c"[^>]*>/);
  if (!match) {
    return null;
  }
  const [, pointsText] = match;
  const coords = pointsText
    .trim()
    .split(/\s+/)
    .map((point) => point.split(',').map((value) => Number.parseFloat(value)))
    .filter((pair) => pair.length === 2 && pair.every((value) => Number.isFinite(value)));
  if (coords.length !== 4) {
    return null;
  }
  return coords.map(([x, y]) => ({ x, y }));
}

function extractFrontWallGroup(svg: string): string {
  const match = svg.match(/<g[^>]*data-front-wall="open"[^>]*>[\s\S]*?<\/g>/);
  return match ? match[0] : '';
}

function extractWallPolygon(svg: string, side: 'left' | 'right') {
  const match = svg.match(new RegExp(`<polygon[^>]*data-wall-side="${side}"[^>]*>`));
  if (!match) {
    return null;
  }
  const pointsMatch = match[0].match(/points="([^"]+)"/);
  if (!pointsMatch) {
    return null;
  }
  const points = pointsMatch[1]
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map((value) => Number.parseFloat(value)))
    .filter((coords) => coords.length === 2 && coords.every((value) => Number.isFinite(value)))
    .map(([x, y]) => ({ x, y }));
  return { points };
}

function initializePrepPreviewState(maze: ReturnType<typeof prepareMaze>) {
  act(() => {
    useSessionStore.setState((state) => ({
      ...state,
      maze,
      mazeSize: 20,
      phase: 'prep',
      player: {
        ...state.player,
        position: { x: maze.start.x + 0.5, y: maze.start.y + 0.5 },
      },
    }));
  });
}

function prepareMaze(overrides: { start: { x: number; y: number }; goal: { x: number; y: number } }) {
  const maze = createMockMaze(20);
  return {
    ...maze,
    start: { ...overrides.start },
    goal: { ...overrides.goal },
  };
}

function createJunctionPreviewMaze(): ServerMazeState {
  const start = createCell(5, 5, { top: true, right: false, bottom: true, left: true });
  const junction = createCell(6, 5, { top: false, right: false, bottom: false, left: false });
  const east = createCell(7, 5, { top: true, right: true, bottom: true, left: false });
  const north = createCell(6, 4, { top: true, right: true, bottom: false, left: true });
  const south = createCell(6, 6, { top: false, right: true, bottom: true, left: true });
  return {
    seed: 'junction-maze',
    start: { x: start.x, y: start.y },
    goal: { x: east.x, y: east.y },
    cells: [start, junction, east, north, south],
  };
}

function createDarkStartMaze(): ServerMazeState {
  const start = createCell(5, 5, { top: true, right: true, bottom: true, left: true });
  return {
    seed: 'dark-start',
    start: { x: start.x, y: start.y },
    goal: { x: start.x, y: start.y },
    cells: [start],
  };
}

function createForwardBlockedPreviewMaze(): ServerMazeState {
  const start = createCell(5, 5, { top: true, right: false, bottom: true, left: true });
  const junction = createCell(6, 5, { top: false, right: true, bottom: false, left: false });
  const north = createCell(6, 4, { top: true, right: true, bottom: false, left: true });
  const south = createCell(6, 6, { top: false, right: true, bottom: true, left: true });
  return {
    seed: 'blocked-maze',
    start: { x: start.x, y: start.y },
    goal: { x: north.x, y: north.y },
    cells: [start, junction, north, south],
  };
}

function createStraightPreviewMaze(): ServerMazeState {
  const start = createCell(5, 5, { top: true, right: false, bottom: true, left: true });
  const corridor = createCell(6, 5, { top: true, right: false, bottom: true, left: false });
  const east = createCell(7, 5, { top: true, right: true, bottom: true, left: false });
  return {
    seed: 'straight-maze',
    start: { x: start.x, y: start.y },
    goal: { x: east.x, y: east.y },
    cells: [start, corridor, east],
  };
}

function createCell(
  x: number,
  y: number,
  walls: { top: boolean; right: boolean; bottom: boolean; left: boolean },
): ServerMazeState['cells'][number] {
  return { x, y, walls };
}
