import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { RoomDurableObject } from '../src/room-do';

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-SESSION' };
  public readonly storage = {
    setAlarm: async () => {},
  };
}

class MockSocket {
  public accepted = false;
  public closed = false;
  public readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

  accept(): void {
    this.accepted = true;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    const handlers = this.listeners.get('close') ?? [];
    for (const handler of handlers) {
      handler({});
    }
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
}

interface PairRecord {
  client: MockSocket;
  server: MockSocket;
}

const createdPairs: PairRecord[] = [];

class FakeWebSocketPair implements WebSocketPair {
  0: MockSocket;
  1: MockSocket;

  constructor() {
    this[0] = new MockSocket();
    this[1] = new MockSocket();
    createdPairs.push({ client: this[0], server: this[1] });
  }
}

function createUpgradeRequest(params: { role: 'owner' | 'player'; nick: string; pathname?: string }) {
  const url = new URL(`https://example${params.pathname ?? '/ws'}`);
  url.searchParams.set('room', 'ROOM-SESSION');
  url.searchParams.set('role', params.role);
  url.searchParams.set('nick', params.nick);
  return new Request(url, {
    method: 'GET',
    headers: {
      Upgrade: 'websocket',
    },
  });
}

function hasMessage(socket: MockSocket, type: string): boolean {
  return socket.sent.some((raw) => {
    try {
      const parsed = JSON.parse(raw) as { type?: string };
      return parsed?.type === type;
    } catch {
      return false;
    }
  });
}

describe('Room WebSocket handling', () => {
  const originalWebSocketPair = globalThis.WebSocketPair;

  beforeAll(() => {
    (globalThis as typeof globalThis & { WebSocketPair: typeof FakeWebSocketPair }).WebSocketPair =
      FakeWebSocketPair as unknown as typeof WebSocketPair;
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { WebSocketPair: typeof FakeWebSocketPair }).WebSocketPair =
      originalWebSocketPair as typeof WebSocketPair;
  });

  beforeEach(() => {
    createdPairs.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('accepts upgrades for both roles and emits DEBUG_CONNECTED/STATE frames', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);

    const ownerResponse = await room.fetch(createUpgradeRequest({ role: 'owner', nick: 'Owner' }));
    expect(ownerResponse.status).toBe(101);
    const ownerPair = createdPairs[0];
    expect(ownerPair.server.accepted).toBe(true);
    expect(hasMessage(ownerPair.server, 'DEBUG_CONNECTED')).toBe(true);
    expect(hasMessage(ownerPair.server, 'STATE')).toBe(true);

    const playerResponse = await room.fetch(createUpgradeRequest({ role: 'player', nick: 'Runner' }));
    expect(playerResponse.status).toBe(101);
    const playerPair = createdPairs[1];
    expect(playerPair.server.accepted).toBe(true);
    expect(hasMessage(playerPair.server, 'DEBUG_CONNECTED')).toBe(true);
    expect(hasMessage(playerPair.server, 'STATE')).toBe(true);

    room.dispose();
  });

  it('accepts Durable Object routed paths that include the object identifier', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);

    const response = await room.fetch(
      createUpgradeRequest({ role: 'owner', nick: 'Owner', pathname: '/ROOM-SESSION/ws' }),
    );

    expect(response.status).toBe(101);
    const pair = createdPairs[0];
    expect(pair.server.accepted).toBe(true);
    expect(hasMessage(pair.server, 'DEBUG_CONNECTED')).toBe(true);
    expect(hasMessage(pair.server, 'STATE')).toBe(true);

    room.dispose();
  });
});
