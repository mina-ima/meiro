import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { RoomDurableObject } from '../src/room-do';
import { SERVER_TICK_INTERVAL_MS } from '@meiro/common';
import { attachWebSocket, createWebSocketUpgradeRequest } from './helpers/upgrade-request';

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-DISCONNECT' };
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

  dispatchClose(): void {
    const handlers = this.listeners.get('close') ?? [];
    for (const handler of handlers) {
      handler({});
    }
  }
}

async function join(
  room: RoomDurableObject,
  socket: MockSocket,
  payload: { role: 'owner' | 'player'; nick: string },
): Promise<void> {
  const request = createWebSocketUpgradeRequest({ roomId: 'ROOM-DISCONNECT', ...payload });
  attachWebSocket(request, socket);
  const response = await room.fetch(request);
  expect(response.status).toBe(101);
}

const NOW = 1_700_000_500_000;
const DISCONNECT_TIMEOUT_MS = 60_000;

describe('切断時のポーズ', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('片方が切断すると探索が即座にポーズされ、残り時間が保持される', async () => {
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
        phaseStartedAt: number;
        phaseEndsAt?: number;
        paused: boolean;
        pauseReason?: string;
        pauseExpiresAt?: number;
        pauseRemainingMs?: number;
      };
    };

    internal.roomState.phase = 'explore';
    internal.roomState.phaseStartedAt = NOW;
    internal.roomState.phaseEndsAt = NOW + 120_000;

    playerSocket.dispatchClose();

    expect(internal.roomState.paused).toBe(true);
    expect(internal.roomState.pauseReason).toBe('disconnect');
    expect(internal.roomState.pauseExpiresAt).toBe(NOW + DISCONNECT_TIMEOUT_MS);
    expect(internal.roomState.pauseRemainingMs).toBe(120_000);
    expect(internal.roomState.phaseEndsAt).toBeUndefined();

    room.dispose();
  });

  it('切断中にプレイヤーが復帰すると残り時間を維持したまま再開される', async () => {
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
        phaseStartedAt: number;
        phaseEndsAt?: number;
        paused: boolean;
        pauseReason?: string;
        pauseRemainingMs?: number;
      };
    };

    internal.roomState.phase = 'explore';
    internal.roomState.phaseStartedAt = NOW;
    internal.roomState.phaseEndsAt = NOW + 180_000;

    playerSocket.dispatchClose();

    vi.setSystemTime(NOW + 20_000);

    const rejoinSocket = new MockSocket();
    await join(room, rejoinSocket, { role: 'player', nick: 'Runner2' });

    expect(internal.roomState.paused).toBe(false);
    expect(internal.roomState.pauseReason).toBeUndefined();
    expect(internal.roomState.pauseRemainingMs).toBeUndefined();
    expect(internal.roomState.phaseEndsAt).toBe(Date.now() + 180_000);

    room.dispose();
  });

  it('60秒以内に復帰しなければリザルトへ遷移する', async () => {
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
        paused: boolean;
        pauseReason?: string;
      };
    };

    internal.roomState.phase = 'explore';
    playerSocket.dispatchClose();

    let elapsed = 0;
    while (elapsed < DISCONNECT_TIMEOUT_MS) {
      const step = Math.min(5_000, DISCONNECT_TIMEOUT_MS - elapsed);
      vi.advanceTimersByTime(step);
      elapsed += step;
      if (elapsed < DISCONNECT_TIMEOUT_MS) {
        ownerSocket.dispatchMessage(JSON.stringify({ type: 'PING', ts: Date.now() }));
      }
    }
    vi.advanceTimersByTime(SERVER_TICK_INTERVAL_MS);

    expect(internal.roomState.paused).toBe(false);
    expect(internal.roomState.pauseReason).toBeUndefined();
    expect(internal.roomState.phase).toBe('result');

    room.dispose();
  });
});
