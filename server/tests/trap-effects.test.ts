import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { RoomDurableObject } from '../src/room-do';
import { SERVER_TICK_INTERVAL_MS } from '@meiro/common';
import { attachWebSocket, createWebSocketUpgradeRequest } from './helpers/upgrade-request';

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-TRAP' };
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
  const request = createWebSocketUpgradeRequest({ roomId: 'ROOM-TRAP', ...payload });
  attachWebSocket(request, socket);
  const response = await room.fetch(request);
  expect(response.status).toBe(101);
}

const NOW = 1_700_000_000_000;

describe('RoomDurableObject traps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('プレイヤーが罠を踏むと速度が40%になり、重複で持続時間が延長される', async () => {
    const room = new RoomDurableObject(
      new FakeDurableObjectState() as unknown as DurableObjectState,
    );

    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    const internal = room as unknown as {
      roomState: {
        phase: string;
        phaseEndsAt?: number;
        owner: {
          traps: Array<{ cell: { x: number; y: number }; placedAt: number }>;
        };
        player: {
          trapSlowUntil?: number;
          physics: {
            position: { x: number; y: number };
            angle: number;
            velocity: { x: number; y: number };
          };
        };
      };
    };

    internal.roomState.phase = 'explore';
    internal.roomState.phaseEndsAt = NOW + 60_000;
    internal.roomState.owner.traps = [
      {
        cell: { x: 0, y: 0 },
        placedAt: NOW,
      },
    ];
    internal.roomState.player.physics.position = { x: 0.5, y: 0.5 };
    internal.roomState.player.physics.angle = 0;
    internal.roomState.player.physics.velocity = { x: 0, y: 0 };

    playerSocket.dispatchMessage(
      JSON.stringify({
        type: 'P_INPUT',
        yaw: 0,
        forward: 1,
        timestamp: NOW,
      }),
    );

    vi.advanceTimersByTime(SERVER_TICK_INTERVAL_MS);

    const afterFirstTrapNow = Date.now();
    const firstSlowUntil = internal.roomState.player.trapSlowUntil ?? 0;
    expect(firstSlowUntil).toBeGreaterThan(afterFirstTrapNow);
    const expectedFirstDuration = (internal.roomState.phaseEndsAt! - afterFirstTrapNow) / 5;
    expect(firstSlowUntil - afterFirstTrapNow).toBeCloseTo(expectedFirstDuration, 3);
    expect(internal.roomState.owner.traps.length).toBe(0);

    vi.advanceTimersByTime(SERVER_TICK_INTERVAL_MS);
    const slowedVelocity = internal.roomState.player.physics.velocity.x;
    expect(slowedVelocity).toBeCloseTo(0.8, 6);

    const beforeExtension = internal.roomState.player.trapSlowUntil ?? 0;
    const setupNow = Date.now();
    internal.roomState.owner.traps.push({
      cell: { x: 1, y: 0 },
      placedAt: setupNow,
    });
    internal.roomState.player.physics.position = { x: 1.2, y: 0.5 };
    internal.roomState.player.physics.velocity = { x: 0, y: 0 };

    vi.advanceTimersByTime(SERVER_TICK_INTERVAL_MS);

    const afterSecondTrapNow = Date.now();
    const extendedSlowUntil = internal.roomState.player.trapSlowUntil ?? 0;
    const expectedExtension = (internal.roomState.phaseEndsAt! - afterSecondTrapNow) / 5;
    expect(extendedSlowUntil - beforeExtension).toBeCloseTo(expectedExtension, 3);
    expect(internal.roomState.owner.traps.length).toBe(0);

    room.dispose();
  });

  it('罠の同時設置数は2までで、3つ目はエラーになる', async () => {
    const room = new RoomDurableObject(
      new FakeDurableObjectState() as unknown as DurableObjectState,
    );

    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    const internal = room as unknown as {
      roomState: {
        owner: {
          trapCharges: number;
          traps: Array<{ cell: { x: number; y: number }; placedAt: number }>;
          editCooldownUntil: number;
        };
        player: {
          physics: { position: { x: number; y: number } };
        };
      };
    };

    internal.roomState.owner.trapCharges = 3;
    internal.roomState.owner.traps = [];
    internal.roomState.owner.editCooldownUntil = Date.now();
    internal.roomState.player.physics.position = { x: 100, y: 100 };

    const placeTrap = (cell: { x: number; y: number }) => {
      ownerSocket.dispatchMessage(
        JSON.stringify({
          type: 'O_EDIT',
          edit: {
            action: 'PLACE_TRAP',
            cell,
          },
        }),
      );
    };

    placeTrap({ x: 0, y: 0 });
    internal.roomState.owner.editCooldownUntil = Date.now();
    placeTrap({ x: 1, y: 0 });
    internal.roomState.owner.editCooldownUntil = Date.now();

    expect(internal.roomState.owner.traps.length).toBe(2);
    expect(internal.roomState.owner.trapCharges).toBe(1);

    ownerSocket.sent.length = 0;
    placeTrap({ x: 2, y: 0 });

    const error = ownerSocket.sent.map((raw) => JSON.parse(raw)).find((msg) => msg.type === 'ERR');
    expect(error).toMatchObject({ code: 'LIMIT_REACHED' });
    expect(internal.roomState.owner.traps.length).toBe(2);
    expect(internal.roomState.owner.trapCharges).toBe(1);

    room.dispose();
  });
});
