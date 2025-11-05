import { describe, expect, it, vi } from 'vitest';
import { RoomMetrics } from '../src/logic/metrics';

describe('RoomMetrics alerts', () => {
  it('STATE遅延が100msを超えたらアラートイベントを発火する', () => {
    const emit = vi.fn();
    const metrics = new RoomMetrics('room-1', emit);

    metrics.logStateLatency(120);

    const alertCall = emit.mock.calls.find(
      (call) => call[0]?.type === 'state.latency.alert' && call[0]?.latencyMs === 120,
    );

    expect(alertCall).toBeDefined();
    expect(alertCall?.[0]).toMatchObject({
      type: 'state.latency.alert',
      roomId: 'room-1',
      latencyMs: 120,
      thresholdMs: 100,
    });
  });

  it('100ms以下なら通常のログのみ発火する', () => {
    const emit = vi.fn();
    const metrics = new RoomMetrics('room-2', emit);

    metrics.logStateLatency(100);

    const alertCall = emit.mock.calls.find((call) => call[0]?.type === 'state.latency.alert');
    expect(alertCall).toBeUndefined();

    const sampleCall = emit.mock.calls.find((call) => call[0]?.type === 'state.latency');
    expect(sampleCall).toBeDefined();
  });
});
