import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import type { Role } from '../src/schema/ws';
import { RoomDurableObject } from '../src/room-do';

vi.mock('../src/logic/outbound', async () => {
  const actual = await vi.importActual<typeof import('../src/logic/outbound')>(
    '../src/logic/outbound',
  );

  class MockClientConnection {
    constructor(
      _socket: Pick<WebSocket, 'send'>,
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
      void _socket;
      void _now;
      void _onError;
      void _onMessageSent;
    }

    enqueue(_message?: unknown, _meta?: unknown): void {
      void _message;
      void _meta;
    }

    sendImmediate(_message?: unknown, _meta?: unknown): void {
      void _message;
      void _meta;
    }

    dispose(): void {}
  }

  return {
    ...actual,
    ClientConnection: MockClientConnection,
  };
});

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-COOLDOWN' };
  public readonly storage = {
    setAlarm: async (_date: Date) => {
      void _date;
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

describe('owner edit cooldown', () => {
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    if (typeof crypto.randomUUID === 'function') {
      let counter = 0;
      vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
        counter += 1;
        return `mock-session-${counter}`;
      });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('EDIT_COOLDOWNエラーで残りクールダウン時間を通知する', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await joinRoom(room, ownerSocket, {
      roomId: 'ROOM-COOLDOWN',
      role: 'owner',
      nick: 'Owner',
    });
    await joinRoom(room, playerSocket, {
      roomId: 'ROOM-COOLDOWN',
      role: 'player',
      nick: 'Player',
    });

    const internal = room as unknown as {
      roomState: {
        owner: { wallStock: number; editCooldownUntil: number };
        phase: string;
        mazeSize: number;
        goalCell?: { x: number; y: number };
        player: { physics: { position: { x: number; y: number } } };
        solidCells: Set<string>;
      };
    };

    internal.roomState.phase = 'prep';
    internal.roomState.owner.wallStock = 5;
    internal.roomState.owner.editCooldownUntil = Date.now();
    internal.roomState.mazeSize = 6;
    internal.roomState.goalCell = { x: 5, y: 5 };
    internal.roomState.player.physics.position = { x: 10.2, y: 10.4 };

    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 1, y: 1 },
          direction: 'east',
        },
      }),
    );

    const afterFirstEditStock = internal.roomState.owner.wallStock;
    const hasWall = internal.roomState.solidCells.has('1,1');
    expect(hasWall).toBe(true);
    expect(afterFirstEditStock).toBe(4);

    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 2, y: 1 },
          direction: 'east',
        },
      }),
    );

    const errorMessage = ownerSocket.sent
      .map((raw) => JSON.parse(raw) as { type: string; code?: string; data?: { remainingMs?: number } })
      .find((message) => message.type === 'ERR');

    expect(errorMessage).toBeDefined();
    expect(errorMessage?.code).toBe('EDIT_COOLDOWN');
    expect(errorMessage?.data?.remainingMs).toBeGreaterThan(0);
    expect(errorMessage?.data?.remainingMs).toBeLessThanOrEqual(1_000);
    expect(internal.roomState.owner.wallStock).toBe(afterFirstEditStock);
  });
});
