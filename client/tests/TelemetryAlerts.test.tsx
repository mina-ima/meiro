import { render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as telemetry from '../src/logging/telemetry';

type ConnectionEventKind = 'open' | 'close' | 'error' | 'reconnect';

type ConnectionEventSpec = {
  at: number;
  kind: ConnectionEventKind;
  detail?: Record<string, unknown>;
};

function resetTelemetryAlertState() {
  const maybeReset =
    (telemetry as { __resetTelemetryAlertsForTests?: () => void }).__resetTelemetryAlertsForTests;
  maybeReset?.();
}

function TelemetryFeeder({ events }: { events: ConnectionEventSpec[] }) {
  useEffect(() => {
    for (const event of events) {
      vi.setSystemTime(event.at);
      switch (event.kind) {
        case 'open':
          telemetry.logConnectionEvent('open', event.detail);
          break;
        case 'close':
          telemetry.logConnectionEvent('close', event.detail);
          break;
        case 'error':
          telemetry.logConnectionEvent('error', event.detail);
          break;
        case 'reconnect':
          telemetry.logConnectionEvent('reconnect', event.detail);
          break;
        default: {
          const never: never = event.kind;
          throw new Error(`Unsupported event: ${never}`);
        }
      }
    }
  }, [events]);

  return null;
}

describe('Telemetry alerts', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    resetTelemetryAlertState();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetTelemetryAlertState();
  });

  it('WS失敗率が閾値を超えるとアラートを出す', () => {
    render(
      <TelemetryFeeder
        events={[
          { at: 1000, kind: 'close', detail: { code: 1011 } },
          { at: 5000, kind: 'error' },
          { at: 10000, kind: 'close', detail: { code: 1006 } },
        ]}
      />,
    );

    const alertCall = infoSpy.mock.calls.find(
      (call) => call[0] === '[telemetry]' && call[1] === 'client.ws.alert',
    );

    expect(alertCall).toBeDefined();
    expect(alertCall?.[2]).toMatchObject({
      failures: 3,
      windowMs: 60000,
    });
  });

  it('短時間に再接続が続くとアラートを出す', () => {
    render(
      <TelemetryFeeder
        events={[
          { at: 2000, kind: 'reconnect', detail: { attempt: 1 } },
          { at: 4000, kind: 'reconnect', detail: { attempt: 2 } },
          { at: 6000, kind: 'reconnect', detail: { attempt: 3 } },
        ]}
      />,
    );

    const alertCall = infoSpy.mock.calls.find(
      (call) => call[0] === '[telemetry]' && call[1] === 'client.ws.reconnect.alert',
    );

    expect(alertCall).toBeDefined();
    expect(alertCall?.[2]).toMatchObject({
      attempts: 3,
      windowMs: 60000,
    });
  });
});
