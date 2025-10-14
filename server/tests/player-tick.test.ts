import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { RoomDurableObject } from '../src/room-do';
import { SERVER_TICK_INTERVAL_MS, PLAYER_RADIUS } from '@meiro/common';

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-TEST' };
  public readonly storage = {
    setAlarm: async () => {
      // alarmは本テストでは未使用だが、DOのインターフェース互換のため実装。
    },
  };
}

class MockSocket {
  public accepted = false;
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

  accept(): void {
    this.accepted = true;
  }

  send(): void {
    // 今回のテストでは送信内容を利用しない。
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

async function join(
  room: RoomDurableObject,
  socket: MockSocket,
  payload: { role: 'owner' | 'player'; nick: string },
): Promise<Response> {
  const request = new Request('https://example/session', {
    method: 'POST',
    body: JSON.stringify({ roomId: 'ROOM-TEST', ...payload }),
  });

  const requestWithSocket = Object.assign(request, { webSocket: socket });
  return room.fetch(requestWithSocket);
}

describe('RoomDurableObject プレイヤー物理挙動', () => {
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    let callCount = 0;
    if (typeof crypto.randomUUID === 'function') {
      vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
        callCount += 1;
        return callCount === 1 ? 'session-owner' : 'session-player';
      });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('20Hz刻みで入力を積分し、壁を貫通しない', async () => {
    const room = new RoomDurableObject(
      new FakeDurableObjectState() as unknown as DurableObjectState,
    );

    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    const internalRoom = room as unknown as {
      roomState: {
        phase: string;
        player: {
          position: { x: number; y: number };
          angle: number;
        };
        solidCells: Set<string>;
      };
    };

    internalRoom.roomState.phase = 'explore';
    internalRoom.roomState.player.position = { x: 0.5, y: 0.5 };
    internalRoom.roomState.player.angle = 0;
    internalRoom.roomState.solidCells = new Set(['1,0']);

    playerSocket.dispatchMessage(
      JSON.stringify({
        type: 'P_INPUT',
        yaw: 0,
        forward: 1,
        timestamp: NOW,
      }),
    );

    vi.advanceTimersByTime(SERVER_TICK_INTERVAL_MS * 4);

    const { position } = internalRoom.roomState.player;
    expect(position.x).toBeLessThanOrEqual(1 - PLAYER_RADIUS + 1e-6);
    expect(position.y).toBeCloseTo(0.5, 6);

    room.dispose();
  });

  it('迷路外に逸脱したプレイヤー位置を境界内にスナップする', async () => {
    const room = new RoomDurableObject(
      new FakeDurableObjectState() as unknown as DurableObjectState,
    );

    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    const internalRoom = room as unknown as {
      roomState: {
        phase: string;
        mazeSize: number;
        player: {
          physics: {
            position: { x: number; y: number };
            velocity: { x: number; y: number };
          };
        };
      };
    };

    internalRoom.roomState.phase = 'explore';
    internalRoom.roomState.player.physics.position = { x: -5, y: internalRoom.roomState.mazeSize + 5 };
    internalRoom.roomState.player.physics.velocity = { x: 100, y: 100 };

    vi.advanceTimersByTime(SERVER_TICK_INTERVAL_MS);

    const { position } = internalRoom.roomState.player.physics;
    const min = PLAYER_RADIUS;
    const max = internalRoom.roomState.mazeSize - PLAYER_RADIUS;

    expect(position.x).toBeGreaterThanOrEqual(min - 1e-6);
    expect(position.x).toBeLessThanOrEqual(max + 1e-6);
    expect(position.y).toBeGreaterThanOrEqual(min - 1e-6);
    expect(position.y).toBeLessThanOrEqual(max + 1e-6);

    room.dispose();
  });
});
