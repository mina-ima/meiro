import { describe, expect, it, vi, afterEach } from 'vitest';

const ORIGINAL_WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8787';

describe('AppのWebSocket環境変数', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_WS_URL', ORIGINAL_WS_URL);
  });

  it('VITE_WS_URLが未設定の場合はロード時に例外を投げる', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_WS_URL', '');

    await expect(import('../src/app')).rejects.toThrow(/VITE_WS_URL/i);
  });
});
