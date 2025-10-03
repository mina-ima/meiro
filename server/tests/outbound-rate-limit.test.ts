import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '../src/schema/ws';
import { ClientConnection, MessageSizeExceededError } from '../src/logic/outbound';

class FakeSocket implements WebSocket {
  public readonly sentPayloads: string[] = [];
  public readonly recordedAt: number[] = [];

  constructor(private readonly now: () => number) {}

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (typeof data !== 'string') {
      throw new Error('string payload expected');
    }
    this.sentPayloads.push(data);
    this.recordedAt.push(this.now());
  }

  // Unused WebSocket interface members for the mock implementation.
  get binaryType(): BinaryType {
    throw new Error('not implemented');
  }
  set binaryType(_value: BinaryType) {
    throw new Error('not implemented');
  }
  get bufferedAmount(): number {
    return 0;
  }
  get extensions(): string {
    return '';
  }
  get protocol(): string {
    return '';
  }
  get readyState(): number {
    return 1;
  }
  get url(): string {
    return '';
  }
  close(): void {
    throw new Error('not implemented');
  }
  addEventListener(): void {
    throw new Error('not implemented');
  }
  removeEventListener(): void {
    throw new Error('not implemented');
  }
  dispatchEvent(): boolean {
    throw new Error('not implemented');
  }
}

function createMessage(event: string, payload: Record<string, unknown> | undefined = undefined): ServerMessage {
  return {
    type: 'EV',
    event,
    payload,
  };
}

describe('ClientConnection', () => {
  it('enforces a 20Hz send cap by spacing queued messages at >=50ms intervals', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const now = () => Date.now();
    const socket = new FakeSocket(now);
    const connection = new ClientConnection(socket, now);

    connection.enqueue(createMessage('A'));
    connection.enqueue(createMessage('B'));
    connection.enqueue(createMessage('C'));

    vi.advanceTimersByTime(0);
    expect(socket.sentPayloads).toHaveLength(1);
    expect(socket.recordedAt[0]).toBe(0);

    vi.advanceTimersByTime(49);
    expect(socket.sentPayloads).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(socket.sentPayloads).toHaveLength(2);
    expect(socket.recordedAt[1]).toBeGreaterThanOrEqual(50);

    vi.advanceTimersByTime(50);
    expect(socket.sentPayloads).toHaveLength(3);
    expect(socket.recordedAt[2]).toBeGreaterThanOrEqual(100);
  });

  it('rejects messages that would exceed the 2KB limit', () => {
    const socket = new FakeSocket(() => 0);
    const connection = new ClientConnection(socket, () => 0);

    const bigPayload = 'x'.repeat(2900);
    const message = createMessage('BIG', { blob: bigPayload });

    expect(() => connection.enqueue(message)).toThrow(MessageSizeExceededError);
    expect(socket.sentPayloads).toHaveLength(0);
  });
});
