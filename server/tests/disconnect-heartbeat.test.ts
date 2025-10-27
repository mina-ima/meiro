import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { RoomDurableObject } from '../src/room-do';

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-HEARTBEAT' };
  public readonly storage = {
    setAlarm: async () => {},
  };
}

type MessageHandler = (event: { data?: unknown }) => void;
type CloseHandler = (event: { code?: number; reason?: string }) => void;

class HeartbeatMockSocket {
  public accepted = false;
  public closeCalled = false;
  public closeCode?: number;
  public closeReason?: string;
  public readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<MessageHandler | CloseHandler>>();

  accept(): void {
    this.accepted = true;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalled = true;
    this.closeCode = code;
    this.closeReason = reason;
    const handlers = this.listeners.get('close') ?? new Set<CloseHandler>();
    for (const handler of handlers) {
      (handler as CloseHandler)({ code, reason });
    }
  }

  addEventListener(type: 'message', handler: MessageHandler): void;
  addEventListener(type: 'close', handler: CloseHandler): void;
  addEventListener(type: string, handler: MessageHandler | CloseHandler): void {
    const handlers = this.listeners.get(type) ?? new Set();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, handler: MessageHandler | CloseHandler): void {
    const handlers = this.listeners.get(type);
    if (!handlers) {
      return;
    }
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.listeners.delete(type);
    }
  }

  dispatchMessage(data: unknown): void {
    const handlers = this.listeners.get('message') ?? new Set<MessageHandler>();
    for (const handler of handlers) {
      (handler as MessageHandler)({ data });
    }
  }
}

async function join(
  room: RoomDurableObject,
  socket: HeartbeatMockSocket,
  payload: { role: 'owner' | 'player'; nick: string },
): Promise<void> {
  const request = new Request('https://example/session', {
    method: 'POST',
    body: JSON.stringify({ roomId: 'ROOM-HEARTBEAT', ...payload }),
  });

  const requestWithSocket = Object.assign(request, { webSocket: socket });
  const response = await room.fetch(requestWithSocket);
  expect(response.ok).toBe(true);
}

const NOW = 1_700_001_000_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;
const DISCONNECT_TIMEOUT_MS = 60_000;

describe('ハートビート監視による切断検知', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('プレイヤーがハートビートを止めると切断ポーズが発生する', async () => {
    const room = new RoomDurableObject(
      new FakeDurableObjectState() as unknown as DurableObjectState,
    );

    const ownerSocket = new HeartbeatMockSocket();
    const playerSocket = new HeartbeatMockSocket();

    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    const internal = room as unknown as {
      roomState: {
        paused: boolean;
        pauseReason?: string;
        pauseExpiresAt?: number;
      };
    };

    expect(internal.roomState.paused).toBe(false);

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + 5);

    expect(playerSocket.closeCalled).toBe(true);

    const expectedPauseExpiresAt = NOW + HEARTBEAT_TIMEOUT_MS + DISCONNECT_TIMEOUT_MS;

    expect(internal.roomState.paused).toBe(true);
    expect(internal.roomState.pauseReason).toBe('disconnect');
    expect(internal.roomState.pauseExpiresAt).toBe(expectedPauseExpiresAt);

    room.dispose();
  });
});
