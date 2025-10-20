import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import type { Role } from '../src/schema/ws';
import { RoomDurableObject } from '../src/room-do';
import { LOBBY_TIMEOUT_MS } from '../src/logic/lobby';

vi.mock('../src/logic/outbound', async () => {
  const actual = await vi.importActual<typeof import('../src/logic/outbound')>(
    '../src/logic/outbound',
  );

  class MockClientConnection {
    constructor(
      _socket: Pick<WebSocket, 'send'>,
      _now: () => number,
      _onError?: (error: unknown) => void,
      _onMessageSent?: (info: { bytes: number; immediate: boolean; queueDepth: number }) => void,
    ) {
      void _socket;
      void _now;
      void _onError;
      void _onMessageSent;
    }

    enqueue(): void {}

    sendImmediate(): void {}

    dispose(): void {}
  }

  return {
    ...actual,
    ClientConnection: MockClientConnection,
  };
});

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-1' };
  public readonly storage = {
    setAlarm: async (_date: Date) => {
      void _date;
    },
  };
}

class MockSocket {
  public accepted = false;
  public closed = false;
  public closeCode: number | undefined;
  public closeReason: string | undefined;
  public readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

  accept(): void {
    this.accepted = true;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    const handlers = this.listeners.get('close') ?? [];
    for (const handler of handlers) {
      handler({ code, reason });
    }
  }

  addEventListener(event: string, handler: (event: { data?: unknown }) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  dispatchMessage(data: unknown): void {
    const handlers = this.listeners.get('message') ?? [];
    for (const handler of handlers) {
      handler({ data });
    }
  }
}

async function joinRoom(
  room: RoomDurableObject,
  socket: MockSocket,
  payload: { roomId: string; role: Role; nick: string },
): Promise<Response> {
  const request = new Request('https://example/session', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const requestWithSocket = Object.assign(request, { webSocket: socket });
  return room.fetch(requestWithSocket);
}

describe('RoomDurableObject lobby expiration', () => {
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    if (typeof crypto.randomUUID === 'function') {
      vi.spyOn(crypto, 'randomUUID').mockImplementation(() => 'session-owner');
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ロビーが5分経過すると自動的に解散し、接続をROOM_EXPIREDで終了する', async () => {
    const state = new FakeDurableObjectState() as unknown as DurableObjectState;
    const room = new RoomDurableObject(state);
    const socket = new MockSocket();

    const response = await joinRoom(room, socket, {
      roomId: 'ROOM-1',
      role: 'owner',
      nick: 'Owner',
    });

    expect(response.ok).toBe(true);
    expect(socket.closed).toBe(false);

    vi.advanceTimersByTime(LOBBY_TIMEOUT_MS + 1);

    expect(socket.closed).toBe(true);
    expect(socket.closeCode).toBe(4000);
    expect(socket.closeReason).toBe('ROOM_EXPIRED');

    const internal = room as unknown as {
      roomState: { sessions: Map<string, unknown>; phase: string };
    };

    expect(internal.roomState.sessions.size).toBe(0);
    expect(internal.roomState.phase).toBe('lobby');

    const anotherSocket = new MockSocket();
    const joinAfterReset = await joinRoom(room, anotherSocket, {
      roomId: 'ROOM-1',
      role: 'owner',
      nick: 'NewOwner',
    });

    expect(joinAfterReset.ok).toBe(true);
    room.dispose();
  });
});
