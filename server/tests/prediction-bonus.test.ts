import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { SERVER_TICK_INTERVAL_MS } from '@meiro/common';
import { RoomDurableObject } from '../src/room-do';

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-PREDICT' };
  public readonly storage = {
    setAlarm: async () => {},
  };
}

class MockSocket {
  public readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

  accept(): void {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {}

  addEventListener(event: string, handler: (event: { data?: unknown }) => void): void {
    const entries = this.listeners.get(event) ?? [];
    entries.push(handler);
    this.listeners.set(event, entries);
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
    headers: {
      'content-type': 'application/json',
      Upgrade: 'websocket',
    },
    body: JSON.stringify({ roomId: 'ROOM-PREDICT', ...payload }),
  });

  const requestWithSocket = Object.assign(request, { webSocket: socket });
  const response = await room.fetch(requestWithSocket);
  expect(response.status).toBe(101);
}

describe('予測地点ボーナス', () => {
  const NOW = 1_700_000_000_000;
  let room: RoomDurableObject;
  let ownerSocket: MockSocket;
  let playerSocket: MockSocket;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    ownerSocket = new MockSocket();
    playerSocket = new MockSocket();

    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Player' });

    const internal = room as unknown as {
      roomState: {
        phase: string;
        owner: { wallStock: number; trapCharges: number; editCooldownUntil: number };
        player: { physics: { position: { x: number; y: number }; velocity: { x: number; y: number } } };
      };
    };

    internal.roomState.phase = 'explore';
    internal.roomState.owner.wallStock = 0;
    internal.roomState.owner.trapCharges = 0;
    internal.roomState.owner.editCooldownUntil = Date.now();
    internal.roomState.player.physics.position = { x: 10.2, y: 10.6 };
    internal.roomState.player.physics.velocity = { x: 0, y: 0 };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function placePrediction(cell: { x: number; y: number }): void {
    const internal = room as unknown as {
      roomState: {
        phase: string;
        phaseStartedAt: number;
        phaseEndsAt?: number;
      };
    };

    const prepStartedAt = NOW - 46_000;
    internal.roomState.phase = 'prep';
    internal.roomState.phaseStartedAt = prepStartedAt;
    internal.roomState.phaseEndsAt = prepStartedAt + 60_000;

    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_MRK',
        cell,
      }),
    );

    internal.roomState.phase = 'explore';
    internal.roomState.phaseStartedAt = NOW;
    internal.roomState.phaseEndsAt = undefined;
  }

  it('プレイヤーが予測地点を通過すると70%で壁資源が増える', () => {
    placePrediction({ x: 11, y: 11 });

    const internal = room as unknown as {
      roomState: {
        player: {
          physics: { position: { x: number; y: number } };
          predictionHits: number;
        };
        owner: { wallStock: number; predictionBonusDeck: ('wall' | 'trap')[] };
      };
    };

    internal.roomState.owner.predictionBonusDeck = ['wall'];
    internal.roomState.player.physics.position = { x: 11.3, y: 11.4 };

    vi.advanceTimersByTime(SERVER_TICK_INTERVAL_MS);

    expect(internal.roomState.owner.wallStock).toBe(1);
    expect(internal.roomState.player.predictionHits).toBe(1);
  });

  it('プレイヤーが予測地点を通過すると30%で罠権利が増える', () => {
    placePrediction({ x: 7, y: 8 });

    const internal = room as unknown as {
      roomState: {
        player: {
          physics: { position: { x: number; y: number } };
          predictionHits: number;
        };
        owner: { trapCharges: number; predictionBonusDeck: ('wall' | 'trap')[] };
      };
    };

    internal.roomState.owner.predictionBonusDeck = ['trap'];
    internal.roomState.player.physics.position = { x: 7.2, y: 8.7 };

    vi.advanceTimersByTime(SERVER_TICK_INTERVAL_MS);

    expect(internal.roomState.owner.trapCharges).toBe(1);
    expect(internal.roomState.player.predictionHits).toBe(1);
  });
});
