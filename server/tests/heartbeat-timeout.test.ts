import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { RoomDurableObject } from '../src/room-do';
import { SERVER_TICK_INTERVAL_MS } from '@meiro/common';
import { attachWebSocket, createWebSocketUpgradeRequest } from './helpers/upgrade-request';

const NOW = 1_700_001_000_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;
const DISCONNECT_TIMEOUT_MS = 60_000;

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-HEARTBEAT' };
  public readonly storage = {
    setAlarm: async () => {},
  };
}

class MockSocket {
  public readonly sent: string[] = [];
  public accepted = false;
  public closeInfo: { code?: number; reason?: string } | null = null;
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

  accept(): void {
    this.accepted = true;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeInfo = { code, reason };
  }

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
  const request = createWebSocketUpgradeRequest({ roomId: 'ROOM-HEARTBEAT', ...payload });
  attachWebSocket(request, socket);
  const response = await room.fetch(request);
  expect(response.status).toBe(101);
}

describe('ハートビート欠如時の切断処理', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('プレイヤーのハートビートが途切れると即座にポーズと60秒タイマーを開始する', async () => {
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
        paused: boolean;
        pauseReason?: string;
        pauseExpiresAt?: number;
        pauseRemainingMs?: number;
        sessions: Map<unknown, unknown>;
      };
    };

    internal.roomState.phase = 'explore';
    internal.roomState.phaseEndsAt = NOW + 120_000;

    vi.advanceTimersByTime(5_000);
    ownerSocket.dispatchMessage(JSON.stringify({ type: 'PING', ts: Date.now() }));
    const advanceBy = HEARTBEAT_TIMEOUT_MS - 5_000 + SERVER_TICK_INTERVAL_MS;
    vi.advanceTimersByTime(advanceBy);

    expect(playerSocket.closeInfo).toEqual({ code: 4001, reason: 'HEARTBEAT_TIMEOUT' });
    expect(internal.roomState.paused).toBe(true);
    expect(internal.roomState.pauseReason).toBe('disconnect');
    const expectedExpiresAt = NOW + HEARTBEAT_TIMEOUT_MS + DISCONNECT_TIMEOUT_MS;
    expect(internal.roomState.pauseExpiresAt).toBe(expectedExpiresAt);
    expect(internal.roomState.sessions.size).toBe(1);

    room.dispose();
  });
});
