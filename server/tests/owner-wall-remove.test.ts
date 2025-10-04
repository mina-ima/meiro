import { beforeEach, describe, expect, it } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { RoomDurableObject } from '../src/room-do';

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-REMOVE' };
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

async function joinOwner(room: RoomDurableObject, socket: MockSocket): Promise<void> {
  const request = new Request('https://example/session', {
    method: 'POST',
    body: JSON.stringify({ roomId: 'ROOM-REMOVE', nick: 'Owner', role: 'owner' }),
  });

  const requestWithSocket = Object.assign(request, { webSocket: socket });
  const response = await room.fetch(requestWithSocket);
  expect(response.ok).toBe(true);
}

describe('RoomDurableObject wall removal', () => {
  let room: RoomDurableObject;
  let ownerSocket: MockSocket;

  beforeEach(async () => {
    room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    ownerSocket = new MockSocket();
    await joinOwner(room, ownerSocket);
  });

  it('削除権は1回のみで壁資源を返却する', () => {
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'DEL_WALL',
          cell: { x: 1, y: 1 },
          direction: 'north',
        },
      }),
    );

    const state = (room as unknown as { roomState: { owner: { wallStock: number; wallRemoveLeft: number } } })
      .roomState.owner;

    expect(state.wallRemoveLeft).toBe(0);
    expect(state.wallStock).toBe(141);
  });

  it('2回目の壁削除はエラーになり状態が変化しない', () => {
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'DEL_WALL',
          cell: { x: 1, y: 1 },
          direction: 'north',
        },
      }),
    );

    ownerSocket.sent.length = 0;

    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'DEL_WALL',
          cell: { x: 2, y: 2 },
          direction: 'east',
        },
      }),
    );

    const sentError = ownerSocket.sent
      .map((raw) => JSON.parse(raw))
      .find((message) => message.type === 'ERR');

    expect(sentError).toMatchObject({ code: 'WALL_REMOVE_EXHAUSTED' });

    const state = (room as unknown as { roomState: { owner: { wallStock: number; wallRemoveLeft: number } } })
      .roomState.owner;

    expect(state.wallRemoveLeft).toBe(0);
    expect(state.wallStock).toBe(141);
  });
});
