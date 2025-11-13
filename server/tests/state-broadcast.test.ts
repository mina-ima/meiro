import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import type { Role } from '../src/schema/ws';

vi.mock('../src/logic/outbound', async () => {
  const actual = await vi.importActual<typeof import('../src/logic/outbound')>(
    '../src/logic/outbound',
  );

  class MockClientConnection {
    public readonly sentImmediate: unknown[] = [];
    public readonly enqueued: unknown[] = [];

    constructor(
      private readonly socket: Pick<WebSocket, 'send'>,
      _now: () => number,
      _onError?: (error: unknown) => void,
      _onMessageSent?: (info: {
        bytes: number;
        immediate: boolean;
        queueDepth: number;
        latencyMs?: number;
        queuedMs?: number;
      }) => void,
    ) {
      void this.socket;
      void _now;
      void _onError;
      void _onMessageSent;
    }

    enqueue(message: unknown, _meta?: unknown): void {
      this.enqueued.push(message);
      void _meta;
    }

    sendImmediate(message: unknown, _meta?: unknown): void {
      this.sentImmediate.push(message);
      void _meta;
    }

    dispose(): void {}
  }

  return {
    ...actual,
    ClientConnection: MockClientConnection,
  };
});

import { RoomDurableObject } from '../src/room-do';

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-1' };
  public readonly storage = {
    setAlarm: async (date: Date) => {
      void date;
    },
  };
}

class MockSocket {
  public accepted = false;
  public readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

  accept(): void {
    this.accepted = true;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {}

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

describe('RoomDurableObject state broadcast', () => {
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    if (typeof crypto.randomUUID === 'function') {
      vi.spyOn(crypto, 'randomUUID').mockReturnValue('session-owner');
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('新規参加時にSTATEメッセージの全量スナップショットを即時送信する', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const socket = new MockSocket();

    const response = await joinRoom(room, socket, {
      roomId: 'ROOM-1',
      role: 'owner',
      nick: 'Owner',
    });

    expect(response.ok).toBe(true);

    const connections = (room as unknown as { connections: Map<MockSocket, { sentImmediate: unknown[] }> })
      .connections;
    const connection = connections.get(socket);

    expect(connection).toBeDefined();
    expect(connection?.sentImmediate).toHaveLength(1);

    const message = connection?.sentImmediate[0] as { type: string; payload: { full?: boolean } };
    expect(message?.type).toBe('STATE');
    expect(message?.payload.full).toBe(true);
  });

  it('状態更新時に差分STATEメッセージをブロードキャストする', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const socket = new MockSocket();

    await joinRoom(room, socket, {
      roomId: 'ROOM-1',
      role: 'owner',
      nick: 'Owner',
    });

    const connections = (room as unknown as {
      connections: Map<MockSocket, { sentImmediate: unknown[]; enqueued: unknown[] }>;
    }).connections;
    const connection = connections.get(socket);
    expect(connection).toBeDefined();

    vi.setSystemTime(NOW + 1234);

    const internal = room as unknown as {
      roomState: {
        phase: string;
        phaseStartedAt: number;
        phaseEndsAt?: number;
      };
    };
    internal.roomState.phase = 'prep';
    internal.roomState.phaseStartedAt = NOW - 46_000;
    internal.roomState.phaseEndsAt = NOW + 14_000;

    expect(() =>
      socket.dispatchMessage(
        JSON.stringify({
          type: 'O_MRK',
          cell: { x: 1, y: 2 },
        }),
      ),
    ).not.toThrow();

    const diffMessage = connection?.enqueued.at(-1) as {
      type: string;
      payload?: { full?: boolean; changes?: Record<string, unknown> };
    };

    expect(diffMessage?.type).toBe('STATE');
    expect(diffMessage?.payload?.full).toBe(false);
    expect(diffMessage?.payload?.changes).toHaveProperty('updatedAt', NOW + 1234);
  });

  it('編集確定イベントでは全量スナップショットを送信する', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const socket = new MockSocket();

    await joinRoom(room, socket, {
      roomId: 'ROOM-1',
      role: 'owner',
      nick: 'Owner',
    });

    const connections = (room as unknown as {
      connections: Map<MockSocket, { enqueued: unknown[] }>;
    }).connections;
    const connection = connections.get(socket);
    expect(connection).toBeDefined();

    vi.setSystemTime(NOW + 2345);

    socket.dispatchMessage(
      JSON.stringify({
        type: 'O_CONFIRM',
        targetId: 'edit-1',
      }),
    );

    const message = connection?.enqueued.at(-1) as {
      type: string;
      payload?: { full?: boolean };
    };

    expect(message?.type).toBe('STATE');
    expect(message?.payload?.full).toBe(true);
  });

  it('カウントダウン開始時も新規参加者には即時スナップショットを1度だけ送信する', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await joinRoom(room, ownerSocket, {
      roomId: 'ROOM-1',
      role: 'owner',
      nick: 'Owner',
    });

    const response = await joinRoom(room, playerSocket, {
      roomId: 'ROOM-1',
      role: 'player',
      nick: 'Player',
    });

    expect(response.ok).toBe(true);

    const connections = (room as unknown as {
      connections: Map<MockSocket, { sentImmediate: unknown[]; enqueued: unknown[] }>;
    }).connections;

    const ownerConnection = connections.get(ownerSocket);
    const playerConnection = connections.get(playerSocket);

    expect(playerConnection?.sentImmediate).toHaveLength(1);
    expect(playerConnection?.enqueued).toHaveLength(0);

    expect(ownerConnection?.enqueued.at(-1)).toMatchObject({
      type: 'STATE',
      payload: expect.objectContaining({ full: true }),
    });
  });

  it('既存プレイヤーがいる状態でオーナーが接続した場合でもプレイヤーへ全量STATEを配信し、オーナーには1度だけ即時送信する', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const playerSocket = new MockSocket();
    const ownerSocket = new MockSocket();

    await joinRoom(room, playerSocket, {
      roomId: 'ROOM-1',
      role: 'player',
      nick: 'Player',
    });

    const response = await joinRoom(room, ownerSocket, {
      roomId: 'ROOM-1',
      role: 'owner',
      nick: 'Owner',
    });

    expect(response.ok).toBe(true);

    const connections = (room as unknown as {
      connections: Map<MockSocket, { sentImmediate: unknown[]; enqueued: unknown[] }>;
    }).connections;

    const ownerConnection = connections.get(ownerSocket);
    const playerConnection = connections.get(playerSocket);

    expect(ownerConnection?.sentImmediate).toHaveLength(1);
    expect(ownerConnection?.enqueued).toHaveLength(0);
    expect(playerConnection?.enqueued.at(-1)).toMatchObject({
      type: 'STATE',
      payload: expect.objectContaining({ full: true }),
    });
  });
});
