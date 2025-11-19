import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PlayerView } from '../src/views/PlayerView';
import { useSessionStore } from '../src/state/sessionStore';
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

  it('プレビュー画像は床グリッドを排し、前方の通路ハイライトを強調する', () => {
    const maze = prepareMaze({
      start: { x: 3, y: 2 },
      goal: { x: 16, y: 14 },
    });
    initializePrepPreviewState(maze);

    render(<PlayerView {...baseProps} phase="prep" />);

    const image = screen.getByAltText('スタート地点プレビュー映像') as HTMLImageElement;
    const src = image.getAttribute('src') ?? '';

    expect(src).toContain('data:image/svg+xml;utf8,');

    const [, encodedSvg] = src.split(',', 2);
    const decodedSvg = decodeURIComponent(encodedSvg ?? '');

    expect(decodedSvg).toContain('#ef4444');
    expect(decodedSvg).toContain('wireframe-door');
    expect(decodedSvg).not.toContain('#0f172a');
  });
});

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
