import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { App } from '../src/app';
import { useSessionStore } from '../src/state/sessionStore';
import { resetToastStoreForTest } from '../src/ui/toasts';

describe('DebugHUD 仕様表示', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetToastStoreForTest();
    useSessionStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('仕様で定義された主要な数値が確認できる', () => {
    render(<App />);

    const panel = screen.getByRole('region', { name: 'デバッグHUD' });
    const scope = within(panel);

    expect(scope.getByText(/移動速度/)).toHaveTextContent(/2\.0\s*マス\/秒/);
    expect(scope.getByText(/回転速度/)).toHaveTextContent(/360\s*°\/秒/);
    expect(scope.getByText(/視野角/)).toHaveTextContent(/90°/);
    expect(scope.getByText(/視界距離/)).toHaveTextContent(/4\s*マス/);
    expect(scope.getByText(/ズーム倍率/)).toHaveTextContent(
      /0\.5×.*0\.75×.*1×.*1\.5×.*2×.*3×.*4×/,
    );
    expect(scope.getByText(/編集クールダウン/)).toHaveTextContent(/1\.0\s*秒/);
    expect(scope.getByText(/禁止エリア半径/)).toHaveTextContent(/2\s*マス/);
    expect(scope.getByText(/壁在庫/)).toHaveTextContent(/20x20.*48.*40x40.*140/);
    expect(scope.getByText(/規定ポイント係数/)).toHaveTextContent(/65%/);
    expect(scope.getByText(/ゴールボーナス係数/)).toHaveTextContent(/20%/);
    expect(scope.getByText(/罠速度低下/)).toHaveTextContent(/40%/);
  });
});
