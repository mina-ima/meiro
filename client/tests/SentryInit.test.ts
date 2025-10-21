import { beforeEach, describe, expect, it, vi } from 'vitest';

const initMock = vi.fn();
const captureExceptionMock = vi.fn();

vi.mock('@sentry/browser', () => ({
  init: initMock,
  captureException: captureExceptionMock,
}));

async function importModule() {
  return import('../src/logging/sentry');
}

describe('initSentry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('Sentry DSN が設定されている場合は初期化を実行する', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@sentry.example/1');
    vi.stubEnv('VITE_APP_ENV', 'preview');
    vi.stubEnv('VITE_APP_VERSION', '1.2.3');

    const { initSentry } = await importModule();
    initSentry();

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock.mock.calls[0][0]).toMatchObject({
      dsn: 'https://public@sentry.example/1',
      environment: 'preview',
      release: '1.2.3',
    });
  });

  it('Sentry DSN が無い場合は初期化しない', async () => {
    const { initSentry } = await importModule();
    initSentry();

    expect(initMock).not.toHaveBeenCalled();
  });

  it('reportError で例外を Sentry に転送する', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@sentry.example/1');
    const { initSentry, reportError } = await importModule();

    initSentry();
    const error = new Error('boom');
    reportError(error);

    expect(captureExceptionMock).toHaveBeenCalledWith(error);
  });
});
