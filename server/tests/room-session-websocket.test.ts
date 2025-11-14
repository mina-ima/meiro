import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
}

interface ConnectOptions {
  method?: 'GET' | 'POST';
  pathname?: string;
}

async function connect(
  room: RoomDurableObject,
  socket: MockSocket,
  payload: { role: 'owner' | 'player'; nick: string },
  options?: ConnectOptions,
): Promise<Response> {
  const targetPath = options?.pathname ?? '/connect';
  const desiredMethod = options?.method ?? 'GET';
  const initMethod = desiredMethod === 'GET' ? 'POST' : desiredMethod;

  const request = new Request(`https://example${targetPath}`, {
    method: initMethod,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ roomId: 'ROOM-SESSION', ...payload }),
  });
  const requestWithSocket = Object.assign(request, { webSocket: socket });

  if (desiredMethod !== initMethod) {
    const proxied = new Proxy(requestWithSocket, {
      get(target, property, receiver) {
        if (property === 'method') {
          return desiredMethod;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    return room.fetch(proxied as Request);
  }

  return room.fetch(requestWithSocket);
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

const NOW = 1_700_000_000_000;

describe('Room WebSocket handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('accepts the upgrade and emits DEBUG_CONNECTED and STATE frames for each role', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);

    const ownerSocket = new MockSocket();
    const ownerResponse = await connect(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    expect(ownerResponse.status).toBe(101);
    expect(ownerSocket.accepted).toBe(true);
    expect(hasMessage(ownerSocket, 'DEBUG_CONNECTED')).toBe(true);
    expect(hasMessage(ownerSocket, 'STATE')).toBe(true);

    const playerSocket = new MockSocket();
    const playerResponse = await connect(room, playerSocket, { role: 'player', nick: 'Runner' });
    expect(playerResponse.status).toBe(101);
    expect(playerSocket.accepted).toBe(true);
    expect(hasMessage(playerSocket, 'DEBUG_CONNECTED')).toBe(true);
    expect(hasMessage(playerSocket, 'STATE')).toBe(true);

    room.dispose();
  });

  it('accepts Upgrade requests when the URL contains the Durable Object identifier prefix', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);

    const socket = new MockSocket();
    const response = await connect(
      room,
      socket,
      { role: 'owner', nick: 'Owner' },
      { pathname: '/ROOM-SESSION/connect' },
    );

    expect(response.status).toBe(101);
    expect(socket.accepted).toBe(true);
    expect(hasMessage(socket, 'DEBUG_CONNECTED')).toBe(true);
    expect(hasMessage(socket, 'STATE')).toBe(true);

    room.dispose();
  });

  it('accepts the legacy /session path for backward compatibility', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);

    const socket = new MockSocket();
    const response = await connect(
      room,
      socket,
      { role: 'owner', nick: 'Owner' },
      { pathname: '/ROOM-SESSION/session' },
    );

    expect(response.status).toBe(101);
    expect(socket.accepted).toBe(true);
    expect(hasMessage(socket, 'DEBUG_CONNECTED')).toBe(true);
    expect(hasMessage(socket, 'STATE')).toBe(true);

    room.dispose();
  });

  it('accepts the session upgrade when the Worker falls back to POST', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);

    const socket = new MockSocket();
    const response = await connect(
      room,
      socket,
      { role: 'owner', nick: 'Owner' },
      { method: 'POST' },
    );

    expect(response.status).toBe(101);
    expect(socket.accepted).toBe(true);
    expect(hasMessage(socket, 'DEBUG_CONNECTED')).toBe(true);
    expect(hasMessage(socket, 'STATE')).toBe(true);

    room.dispose();
  });
});
