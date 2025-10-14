const TELEMETRY_PREFIX = '[telemetry]';
const ALERT_WINDOW_MS = 60_000;
const ALERT_COOLDOWN_MS = 60_000;
const FAILURE_ALERT_THRESHOLD = 3;
const RECONNECT_ALERT_THRESHOLD = 3;

type AlertState = {
  failures: number[];
  reconnects: number[];
  lastFailureAlertAt: number;
  lastReconnectAlertAt: number;
};

const alertState: AlertState = {
  failures: [],
  reconnects: [],
  lastFailureAlertAt: -Infinity,
  lastReconnectAlertAt: -Infinity,
};

interface TelemetryEvent {
  type: string;
  detail?: Record<string, unknown>;
}

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function emit(event: TelemetryEvent): void {
  const payload = event.detail ? { ...event.detail } : undefined;
  if (payload) {
    console.info(TELEMETRY_PREFIX, event.type, payload);
  } else {
    console.info(TELEMETRY_PREFIX, event.type);
  }
}

export function logClientInit(info: Record<string, unknown>): void {
  emit({ type: 'client.init', detail: info });
}

export function logConnectionEvent(
  event: 'open' | 'close' | 'error' | 'reconnect',
  detail?: Record<string, unknown>,
): void {
  emit({ type: `client.ws.${event}`, detail });
  trackConnectionAlerts(event, detail);
}

export function logPhaseChange(phase: string, countdownMs?: number): void {
  emit({ type: 'client.phase', detail: { phase, countdownMs } });
}

export function logClientError(code: string): void {
  emit({ type: 'client.error', detail: { code } });
}

export function logRttSample(rttMs: number): void {
  emit({ type: 'client.rtt', detail: { rttMs } });
}

const frameStats = {
  count: 0,
  totalDelta: 0,
  lastLoggedAt: now(),
};

export function recordFrame(deltaMs: number): void {
  frameStats.count += 1;
  frameStats.totalDelta += deltaMs;
  const elapsed = now() - frameStats.lastLoggedAt;
  if (frameStats.count >= 120 || elapsed >= 10_000) {
    const avgDelta = frameStats.totalDelta / Math.max(frameStats.count, 1);
    const fps = avgDelta > 0 ? 1000 / avgDelta : 0;
    emit({
      type: 'client.fps',
      detail: { fps: Number(fps.toFixed(2)), samples: frameStats.count },
    });
    frameStats.count = 0;
    frameStats.totalDelta = 0;
    frameStats.lastLoggedAt = now();
  }
}

export function logLatencyWarning(latencyMs: number): void {
  emit({ type: 'client.latency.alert', detail: { latencyMs } });
}

function trackConnectionAlerts(
  event: 'open' | 'close' | 'error' | 'reconnect',
  detail?: Record<string, unknown>,
): void {
  const nowMs = Date.now();
  switch (event) {
    case 'close': {
      const code = typeof detail?.code === 'number' ? detail.code : null;
      if (code === 1000) {
        return;
      }
      recordFailure(nowMs);
      break;
    }
    case 'error': {
      recordFailure(nowMs);
      break;
    }
    case 'reconnect': {
      recordReconnect(nowMs);
      break;
    }
    default:
      break;
  }
}

function recordFailure(at: number): void {
  pruneOlderThan(alertState.failures, at - ALERT_WINDOW_MS);
  alertState.failures.push(at);
  const span = windowSpan(alertState.failures);

  if (
    alertState.failures.length >= FAILURE_ALERT_THRESHOLD &&
    at - alertState.lastFailureAlertAt >= ALERT_COOLDOWN_MS
  ) {
    alertState.lastFailureAlertAt = at;
    const failures = alertState.failures.length;
    const ratePerMinute = span > 0 ? (failures / span) * 60_000 : failures;
    emit({
      type: 'client.ws.alert',
      detail: {
        failures,
        windowMs: ALERT_WINDOW_MS,
        failureRatePerMinute: Number(ratePerMinute.toFixed(2)),
        lastFailureAt: at,
      },
    });
  }
}

function recordReconnect(at: number): void {
  pruneOlderThan(alertState.reconnects, at - ALERT_WINDOW_MS);
  alertState.reconnects.push(at);

  if (
    alertState.reconnects.length >= RECONNECT_ALERT_THRESHOLD &&
    at - alertState.lastReconnectAlertAt >= ALERT_COOLDOWN_MS
  ) {
    alertState.lastReconnectAlertAt = at;
    emit({
      type: 'client.ws.reconnect.alert',
      detail: {
        attempts: alertState.reconnects.length,
        windowMs: ALERT_WINDOW_MS,
        lastAttemptAt: at,
      },
    });
  }
}

function pruneOlderThan(buffer: number[], minValue: number): void {
  while (buffer.length > 0 && buffer[0] < minValue) {
    buffer.shift();
  }
}

function windowSpan(values: number[]): number {
  if (values.length <= 1) {
    return ALERT_WINDOW_MS;
  }
  const first = values[0];
  const last = values[values.length - 1];
  return Math.max(last - first, 1);
}

export function __resetTelemetryAlertsForTests(): void {
  alertState.failures.length = 0;
  alertState.reconnects.length = 0;
  alertState.lastFailureAlertAt = -Infinity;
  alertState.lastReconnectAlertAt = -Infinity;
}
