import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetClient } from '../src/net/NetClient';
import * as telemetry from '../src/logging/telemetry';

const ORIGINAL_WEBSOCKET = globalThis.WebSocket;

type MessageHandler = (event: { data?: unknown }) => void;

class FakeWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;

  public static instances: FakeWebSocket[] = [];

  public readyState = FakeWebSocket.CONNECTING;
  public readonly url: string;
  public readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Set<MessageHandler>>();

  constructor(url: string | URL) {
    this.url = url.toString();
    FakeWebSocket.instances.push(this);
  }

  public addEventListener(type: string, handler: MessageHandler): void {
    const handlers = this.listeners.get(type) ?? new Set<MessageHandler>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  public removeEventListener(type: string, handler: MessageHandler): void {
    const handlers = this.listeners.get(type);
    if (!handlers) {
      return;
    }
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.listeners.delete(type);
    }
  }

  public send(data: unknown): void {
    this.sent.push(data);
  }

  public close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.listeners.clear();
  }

  public open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  public emit(type: string, event: { data?: unknown }): void {
    const handlers = this.listeners.get(type);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(event);
    }
  }

  public static latest(): FakeWebSocket | undefined {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  public static reset(): void {
    for (const socket of FakeWebSocket.instances) {
      socket.close();
    }
    FakeWebSocket.instances.length = 0;
  }
}

describe('NetClientの遅延アラート', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    warnSpy = vi.spyOn(telemetry, 'logLatencyWarning').mockImplementation(() => {});
    FakeWebSocket.reset();
    (globalThis as { WebSocket?: typeof WebSocket }).WebSocket =
      FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    warnSpy.mockRestore();
    FakeWebSocket.reset();
    if (ORIGINAL_WEBSOCKET) {
      globalThis.WebSocket = ORIGINAL_WEBSOCKET;
    } else {
      delete (globalThis as { WebSocket?: unknown }).WebSocket;
    }
  });

  it('100msを超える遅延を受信すると警告を発火する', () => {
    const client = new NetClient({
      room: 'ROOM',
      role: 'player',
      nick: 'Runner',
    });

    client.connect();

    const socket = FakeWebSocket.latest();
    expect(socket).toBeDefined();
    socket?.open();

    vi.setSystemTime(500);
    socket?.emit('message', {
      data: JSON.stringify({
        type: 'STATE',
        payload: { full: true, snapshot: { updatedAt: 350 } },
      }),
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(150);

    client.dispose();
  });

  it('100ms以下の遅延では警告しない', () => {
    const client = new NetClient({
      room: 'ROOM',
      role: 'player',
      nick: 'Runner',
    });

    client.connect();

    const socket = FakeWebSocket.latest();
    expect(socket).toBeDefined();
    socket?.open();

    vi.setSystemTime(420);
    socket?.emit('message', {
      data: JSON.stringify({
        type: 'STATE',
        payload: { full: false, changes: { updatedAt: 340 } },
      }),
    });

    expect(warnSpy).not.toHaveBeenCalled();

    client.dispose();
  });
});
