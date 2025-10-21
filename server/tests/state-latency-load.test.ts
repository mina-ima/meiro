import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '../src/schema/ws';
import { ClientConnection, getMinIntervalMs } from '../src/logic/outbound';

class FakeSocket implements Pick<WebSocket, 'send'> {
  public readonly sentAt: number[] = [];
  public readonly payloads: string[] = [];

  constructor(private readonly now: () => number) {}

  send(data: string): void {
    if (typeof data !== 'string') {
      throw new Error('string payload expected');
    }
    this.payloads.push(data);
    this.sentAt.push(this.now());
  }
}

function createStateMessage(seq: number, updatedAt: number): ServerMessage {
  return {
    type: 'STATE',
    payload: {
      full: true,
      seq,
      snapshot: {
        updatedAt,
        roomId: 'ROOM',
        phase: 'explore',
        paused: false,
      },
    },
  } satisfies ServerMessage;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index];
}

describe('STATEメッセージの負荷特性', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('40接続（20ルーム相当）でもSTATE遅延p95≤150msかつメッセージサイズp95≤2KBを満たす', () => {
    const CONNECTIONS = 40;
    const MESSAGES_PER_CONNECTION = 4;
    const minInterval = getMinIntervalMs();

    const latencies: number[] = [];
    const messageSizes: number[] = [];
    const sockets: FakeSocket[] = [];
    const connections: ClientConnection[] = [];

    for (let i = 0; i < CONNECTIONS; i += 1) {
      const socket = new FakeSocket(() => Date.now());
      sockets.push(socket);
      const connection = new ClientConnection(
        socket,
        () => Date.now(),
        undefined,
        (info) => {
          messageSizes.push(info.bytes);
          if (info.latencyMs != null) {
            latencies.push(info.latencyMs);
          }
        },
      );
      connections.push(connection);
    }

    let sequence = 1;
    for (const connection of connections) {
      for (let j = 0; j < MESSAGES_PER_CONNECTION; j += 1) {
        const message = createStateMessage(sequence, 0);
        connection.enqueue(message, { updatedAt: 0 });
        sequence += 1;
      }
    }

    vi.runOnlyPendingTimers();
    for (let step = 1; step < MESSAGES_PER_CONNECTION; step += 1) {
      vi.advanceTimersByTime(minInterval);
    }

    const expectedSamples = CONNECTIONS * MESSAGES_PER_CONNECTION;
    expect(latencies).toHaveLength(expectedSamples);
    expect(messageSizes).toHaveLength(expectedSamples);

    const latencyP95 = percentile(latencies, 0.95);
    const messageSizeP95 = percentile(messageSizes, 0.95);

    expect(latencyP95).toBeLessThanOrEqual(150);
    expect(messageSizeP95).toBeLessThanOrEqual(2 * 1024);

    for (const connection of connections) {
      connection.dispose();
    }
    sockets.length = 0;
  });
});
