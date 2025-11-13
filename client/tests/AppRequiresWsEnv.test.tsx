import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';

const ORIGINAL_WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8787';

describe('AppのWebSocket環境変数', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_WS_URL', ORIGINAL_WS_URL);
  });

  it('VITE_WS_URLが未設定の場合は設定アラートを表示する', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_WS_URL', '');

    const { App } = await import('../src/app');
    render(<App />);

    expect(
      screen.getByText(/サーバーのエンドポイントが設定されていません/, { exact: false }),
    ).toBeInTheDocument();
  });
});
