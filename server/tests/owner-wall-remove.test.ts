import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const NOW = 1_700_000_000_000;

describe('RoomDurableObject wall removal', () => {
  let room: RoomDurableObject;
  let ownerSocket: MockSocket;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    ownerSocket = new MockSocket();
    await joinOwner(room, ownerSocket);

    const internal = room as unknown as {
      roomState: {
        owner: { editCooldownUntil: number };
        player: { physics: { position: { x: number; y: number } } };
      };
    };
    internal.roomState.owner.editCooldownUntil = Date.now();
    internal.roomState.player.physics.position = { x: 100, y: 100 };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    vi.advanceTimersByTime(1_000);
    const internal = room as unknown as {
      roomState: { owner: { editCooldownUntil: number; wallStock: number; wallRemoveLeft: number } };
    };
    internal.roomState.owner.editCooldownUntil = Date.now();

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

  it('壁追加は在庫を消費し、在庫がない場合はエラーになる', () => {
    const internal = room as unknown as {
      roomState: { owner: { wallStock: number; wallRemoveLeft: number; trapCharges: number; editCooldownUntil: number } };
    };

    internal.roomState.owner.wallStock = 1;
    ownerSocket.sent.length = 0;

    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 3, y: 4 },
          direction: 'north',
        },
      }),
    );

    expect(internal.roomState.owner.wallStock).toBe(0);

    vi.advanceTimersByTime(1_000);
    internal.roomState.owner.editCooldownUntil = Date.now();
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 1, y: 1 },
          direction: 'east',
        },
      }),
    );

    const error = ownerSocket.sent.map((raw) => JSON.parse(raw)).find((message) => message.type === 'ERR');
    expect(error).toMatchObject({ code: 'WALL_STOCK_EMPTY' });
    expect(internal.roomState.owner.wallStock).toBe(0);
  });

  it('罠設置はチャージを消費し、残数が無ければエラーになる', () => {
    const internal = room as unknown as {
      roomState: { owner: { trapCharges: number } };
    };

    internal.roomState.owner.trapCharges = 1;
    ownerSocket.sent.length = 0;

    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'PLACE_TRAP',
          cell: { x: 5, y: 5 },
        },
      }),
    );

    expect(internal.roomState.owner.trapCharges).toBe(0);

    vi.advanceTimersByTime(1_000);
    internal.roomState.owner.editCooldownUntil = Date.now();
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'PLACE_TRAP',
          cell: { x: 6, y: 6 },
        },
      }),
    );

    const error = ownerSocket.sent.map((raw) => JSON.parse(raw)).find((message) => message.type === 'ERR');
    expect(error).toMatchObject({ code: 'TRAP_CHARGE_EMPTY' });
    expect(internal.roomState.owner.trapCharges).toBe(0);
  });

  it('編集クールダウンが1秒間適用される', () => {
    const internal = room as unknown as {
      roomState: { owner: { wallStock: number; editCooldownUntil: number } };
    };
    internal.roomState.owner.wallStock = 2;

    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 3, y: 3 },
          direction: 'north',
        },
      }),
    );

    expect(internal.roomState.owner.wallStock).toBe(1);

    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 4, y: 4 },
          direction: 'east',
        },
      }),
    );

    const cooldownError = ownerSocket.sent
      .map((raw) => JSON.parse(raw))
      .find((message) => message.type === 'ERR');
    expect(cooldownError).toMatchObject({ code: 'EDIT_COOLDOWN' });
    expect(internal.roomState.owner.wallStock).toBe(1);

    vi.advanceTimersByTime(1_000);
    internal.roomState.owner.editCooldownUntil = Date.now();
    ownerSocket.sent.length = 0;

    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 5, y: 5 },
          direction: 'south',
        },
      }),
    );

    expect(internal.roomState.owner.wallStock).toBe(0);
  });

  it('禁止エリア内の編集は拒否される', () => {
    const internal = room as unknown as {
      roomState: {
        owner: { wallStock: number; editCooldownUntil: number };
        player: { physics: { position: { x: number; y: number } } };
      };
    };

    internal.roomState.owner.wallStock = 5;
    internal.roomState.owner.editCooldownUntil = Date.now();
    internal.roomState.player.physics.position = { x: 10.2, y: 10.4 };

    ownerSocket.sent.length = 0;

    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 11, y: 9 },
          direction: 'north',
        },
      }),
    );

    const error = ownerSocket.sent.map((raw) => JSON.parse(raw)).find((message) => message.type === 'ERR');
    expect(error).toMatchObject({ code: 'EDIT_FORBIDDEN' });
    expect(internal.roomState.owner.wallStock).toBe(5);
  });
});
