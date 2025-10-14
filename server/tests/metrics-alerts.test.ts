import { describe, expect, it, vi } from 'vitest';
import { RoomMetrics } from '../src/logic/metrics';

describe('RoomMetrics alerts', () => {
  it('STATE遅延が200msを超えたらアラートイベントを発火する', () => {
    const emit = vi.fn();
    const metrics = new RoomMetrics('room-1', emit);

    metrics.logStateLatency(250);

    const alertCall = emit.mock.calls.find(
      (call) => call[0]?.type === 'state.latency.alert' && call[0]?.latencyMs === 250,
    );

    expect(alertCall).toBeDefined();
    expect(alertCall?.[0]).toMatchObject({
      type: 'state.latency.alert',
      roomId: 'room-1',
      latencyMs: 250,
      thresholdMs: 200,
    });
  });

  it('200ms以下なら通常のログのみ発火する', () => {
    const emit = vi.fn();
    const metrics = new RoomMetrics('room-2', emit);

    metrics.logStateLatency(180);

    const alertCall = emit.mock.calls.find((call) => call[0]?.type === 'state.latency.alert');
    expect(alertCall).toBeUndefined();

    const sampleCall = emit.mock.calls.find((call) => call[0]?.type === 'state.latency');
    expect(sampleCall).toBeDefined();
  });
});
