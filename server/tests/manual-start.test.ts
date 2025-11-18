import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { RoomDurableObject } from '../src/room-do';
import type { Role } from '../src/schema/ws';
import { attachWebSocket, createWebSocketUpgradeRequest } from './helpers/upgrade-request';

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
  const request = createWebSocketUpgradeRequest(payload);
  attachWebSocket(request, socket);
  const response = await room.fetch(request);
  expect(response.status).toBe(101);
  return response;
}

function parseLastError(socket: MockSocket): { type?: string; code?: string } | null {
  for (let i = socket.sent.length - 1; i >= 0; i -= 1) {
    try {
      const message = JSON.parse(socket.sent[i] ?? '');
      if (message?.type === 'ERR') {
        return message;
      }
    } catch {
      // ignore parse errors
    }
  }
  return null;
}

const NOW = 1_700_000_000_000;

describe('オーナー手動開始', () => {
  let randomSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    if (typeof crypto.randomUUID === 'function') {
      const ids = ['session-owner', 'session-player', 'session-extra'];
      randomSpy = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
        return ids.shift() ?? `session-${Date.now()}`;
      });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    if (randomSpy) {
      randomSpy.mockRestore();
      randomSpy = null;
    }
    vi.restoreAllMocks();
  });

  it('プレイヤーが参加してもオーナーが開始するまでロビーのまま', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await joinRoom(room, ownerSocket, { roomId: 'ROOM-1', role: 'owner', nick: 'OWNER' });
    await joinRoom(room, playerSocket, { roomId: 'ROOM-1', role: 'player', nick: 'PLAYER' });

    const state = room as unknown as {
      roomState: { phase: string };
    };
    expect(state.roomState.phase).toBe('lobby');
  });

  it('オーナーがO_STARTを送るとカウントダウンが始まる', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await joinRoom(room, ownerSocket, { roomId: 'ROOM-1', role: 'owner', nick: 'OWNER' });
    await joinRoom(room, playerSocket, { roomId: 'ROOM-1', role: 'player', nick: 'PLAYER' });

    ownerSocket.dispatchMessage(JSON.stringify({ type: 'O_START', mazeSize: 40 }));

    const state = room as unknown as {
      roomState: { phase: string; phaseEndsAt?: number };
    };
    expect(state.roomState.phase).toBe('countdown');
    expect(state.roomState.phaseEndsAt).toBe(NOW + 3_000);
  });

  it('プレイヤー未参加でO_STARTを送るとエラーを返す', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const ownerSocket = new MockSocket();

    await joinRoom(room, ownerSocket, { roomId: 'ROOM-1', role: 'owner', nick: 'OWNER' });

    ownerSocket.dispatchMessage(JSON.stringify({ type: 'O_START', mazeSize: 40 }));

    const state = room as unknown as {
      roomState: { phase: string };
    };
    expect(state.roomState.phase).toBe('lobby');
    const error = parseLastError(ownerSocket);
    expect(error?.code).toBe('START_WAITING_FOR_PLAYER');
  });

  it('O_STARTで指定した迷路サイズに合わせて迷路とオーナー状態を初期化する', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await joinRoom(room, ownerSocket, { roomId: 'ROOM-1', role: 'owner', nick: 'OWNER' });
    await joinRoom(room, playerSocket, { roomId: 'ROOM-1', role: 'player', nick: 'PLAYER' });

    const internal = room as unknown as {
      roomState: { mazeSize: number; owner: { wallStock: number } };
    };
    expect(internal.roomState.mazeSize).toBe(40);

    ownerSocket.dispatchMessage(JSON.stringify({ type: 'O_START', mazeSize: 20 }));

    expect(internal.roomState.mazeSize).toBe(20);
    expect(internal.roomState.owner.wallStock).toBe(48);
  });
});
