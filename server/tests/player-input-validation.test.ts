import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { RoomDurableObject } from '../src/room-do';

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-INPUT' };
  public readonly storage = {
    setAlarm: async () => {},
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
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
  }

  dispatchMessage(data: unknown): void {
    const handlers = this.listeners.get('message') ?? [];
    for (const handler of handlers) {
      handler({ data });
    }
  }
}

async function join(
  room: RoomDurableObject,
  socket: MockSocket,
  payload: { role: 'owner' | 'player'; nick: string },
): Promise<void> {
  const request = new Request('https://example/session', {
    method: 'POST',
    body: JSON.stringify({ roomId: 'ROOM-INPUT', ...payload }),
  });

  const requestWithSocket = Object.assign(request, { webSocket: socket });
  const response = await room.fetch(requestWithSocket);
  expect(response.ok).toBe(true);
}

const NOW = 1_700_000_000_000;

describe('プレイヤー入力バリデーション', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('1秒あたりの入力回数が上限を超えると拒否される', async () => {
    const room = new RoomDurableObject(
      new FakeDurableObjectState() as unknown as DurableObjectState,
    );

    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();
    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    const payload = {
      type: 'P_INPUT',
      yaw: 0,
      forward: 1,
      timestamp: NOW,
    };

    for (let i = 0; i < 30; i += 1) {
      playerSocket.dispatchMessage(JSON.stringify(payload));
    }

    playerSocket.sent.length = 0;
    playerSocket.dispatchMessage(JSON.stringify(payload));

    const error = playerSocket.sent.map((entry) => JSON.parse(entry)).find((msg) => msg.type === 'ERR');
    expect(error).toMatchObject({ code: 'INPUT_RATE_LIMIT' });

    room.dispose();
  });

  it('過去すぎるタイムスタンプは拒否される', async () => {
    const room = new RoomDurableObject(
      new FakeDurableObjectState() as unknown as DurableObjectState,
    );

    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();
    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    playerSocket.dispatchMessage(
      JSON.stringify({
        type: 'P_INPUT',
        yaw: 0,
        forward: 1,
        timestamp: NOW - 1_000,
      }),
    );

    const error = playerSocket.sent.map((entry) => JSON.parse(entry)).find((msg) => msg.type === 'ERR');
    expect(error).toMatchObject({ code: 'INPUT_TIMESTAMP_PAST' });

    room.dispose();
  });

  it('未来時刻は現在時刻に補正される', async () => {
    const room = new RoomDurableObject(
      new FakeDurableObjectState() as unknown as DurableObjectState,
    );

    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();
    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    playerSocket.dispatchMessage(
      JSON.stringify({
        type: 'P_INPUT',
        yaw: 0,
        forward: 1,
        timestamp: NOW + 1_000,
      }),
    );

    const internal = room as unknown as {
      roomState: {
        player: {
          input: { clientTimestamp: number };
        };
      };
    };

    expect(internal.roomState.player.input.clientTimestamp).toBe(NOW);
    expect(playerSocket.sent.some((raw) => JSON.parse(raw).type === 'ERR')).toBe(false);

    room.dispose();
  });

  it('直前より過去のタイムスタンプ入力はリプレイとして拒否される', async () => {
    const room = new RoomDurableObject(
      new FakeDurableObjectState() as unknown as DurableObjectState,
    );

    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();
    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    playerSocket.dispatchMessage(
      JSON.stringify({
        type: 'P_INPUT',
        yaw: 0.1,
        forward: 1,
        timestamp: NOW,
      }),
    );

    playerSocket.sent.length = 0;

    playerSocket.dispatchMessage(
      JSON.stringify({
        type: 'P_INPUT',
        yaw: -0.3,
        forward: -1,
        timestamp: NOW - 100,
      }),
    );

    const error = playerSocket.sent
      .map((entry) => JSON.parse(entry))
      .find((msg) => msg.type === 'ERR');

    expect(error).toMatchObject({ code: 'INPUT_TIMESTAMP_REPLAY' });

    const internal = room as unknown as {
      roomState: {
        player: {
          input: { clientTimestamp: number };
        };
      };
    };

    expect(internal.roomState.player.input.clientTimestamp).toBe(NOW);

    room.dispose();
  });
});
