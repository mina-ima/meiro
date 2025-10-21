import * as Sentry from '@sentry/browser';

let initialized = false;

function resolveEnvironment(): string | undefined {
  const env = import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE;
  return typeof env === 'string' && env.length > 0 ? env : undefined;
}

function resolveRelease(): string | undefined {
  const release = import.meta.env.VITE_APP_VERSION ?? import.meta.env.VITE_COMMIT_SHA;
  return typeof release === 'string' && release.length > 0 ? release : undefined;
}

export function initSentry(): void {
  if (initialized) {
    return;
  }

  const dsn = import.meta.env.VITE_SENTRY_DSN;

  if (typeof dsn !== 'string' || dsn.length === 0) {
    return;
  }

  Sentry.init({
    dsn,
    environment: resolveEnvironment(),
    release: resolveRelease(),
    autoSessionTracking: false,
    tracesSampleRate: 0,
  });

  initialized = true;
}

export function reportError(error: unknown): void {
  if (!initialized) {
    return;
  }

  if (error instanceof Error) {
    Sentry.captureException(error);
    return;
  }

  Sentry.captureException(new Error(typeof error === 'string' ? error : 'Unknown error'));
}
