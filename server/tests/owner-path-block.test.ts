import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { SERVER_TICK_INTERVAL_MS } from '@meiro/common';
import { RoomDurableObject } from '../src/room-do';

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-PATH' };
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
    headers: {
      'content-type': 'application/json',
      Upgrade: 'websocket',
    },
    body: JSON.stringify({ roomId: 'ROOM-PATH', ...payload }),
  });

  const requestWithSocket = Object.assign(request, { webSocket: socket });
  const response = await room.fetch(requestWithSocket);
  expect(response.status).toBe(101);
}

const NOW = 1_700_000_000_000;
let infoSpy: ReturnType<typeof vi.spyOn>;

describe('オーナー編集の経路維持検証', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('到達路を塞ぐ壁追加は NO_PATH エラーになる', async () => {
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
        mazeSize: number;
        goalCell?: { x: number; y: number };
        solidCells: Set<string>;
        owner: { wallStock: number; editCooldownUntil: number };
        player: { physics: { position: { x: number; y: number } } };
      };
    };

    internal.roomState.phase = 'prep';
    internal.roomState.mazeSize = 6;
    internal.roomState.goalCell = { x: 4, y: 0 };
    internal.roomState.owner.wallStock = 5;
    internal.roomState.owner.editCooldownUntil = Date.now();
    internal.roomState.player.physics.position = { x: 0.5, y: 0.5 };

    const openCells = new Set(['0,0', '1,0', '2,0', '3,0', '4,0']);
    const solids = new Set<string>();
    for (let y = 0; y < internal.roomState.mazeSize; y += 1) {
      for (let x = 0; x < internal.roomState.mazeSize; x += 1) {
        const key = `${x},${y}`;
        if (openCells.has(key)) {
          continue;
        }
        solids.add(key);
      }
    }
    internal.roomState.solidCells = solids;

    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 3, y: 0 },
          direction: 'north',
        },
      }),
    );

    const error = ownerSocket.sent
      .map((raw) => JSON.parse(raw))
      .find((message) => message.type === 'ERR');

    expect(error).toMatchObject({ code: 'NO_PATH' });
    expect(internal.roomState.owner.wallStock).toBe(5);
    expect(internal.roomState.solidCells.has('3,0')).toBe(false);

    room.dispose();
  });

  it('5000 Tick 連続で経路封鎖しようとしても常に NO_PATH で拒否される', async () => {
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
        mazeSize: number;
        goalCell?: { x: number; y: number };
        solidCells: Set<string>;
        owner: { wallStock: number; editCooldownUntil: number };
        player: { physics: { position: { x: number; y: number } } };
      };
    };

    const openCorridor = new Set(['0,0', '1,0', '2,0', '3,0', '4,0', '5,0']);
    const solids = new Set<string>();
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        const key = `${x},${y}`;
        if (openCorridor.has(key)) {
          continue;
        }
        solids.add(key);
      }
    }

    internal.roomState.phase = 'prep';
    internal.roomState.mazeSize = 6;
    internal.roomState.goalCell = { x: 5, y: 0 };
    internal.roomState.solidCells = solids;
    internal.roomState.owner.wallStock = 60;
    internal.roomState.owner.editCooldownUntil = Date.now();
    internal.roomState.player.physics.position = { x: 0.5, y: 0.5 };

    const attempts = 5_000;
    for (let i = 0; i < attempts; i += 1) {
      ownerSocket.sent.length = 0;
      internal.roomState.owner.editCooldownUntil = Date.now();
      ownerSocket.dispatchMessage(
        JSON.stringify({
          type: 'O_EDIT',
          edit: {
            action: 'ADD_WALL',
            cell: { x: 3, y: 0 },
            direction: 'north',
          },
        }),
      );

      const error = ownerSocket.sent
        .map((raw) => JSON.parse(raw))
        .find((message) => message.type === 'ERR');

      expect(error).toMatchObject({ code: 'NO_PATH' });
      expect(internal.roomState.solidCells.has('3,0')).toBe(false);
      expect(internal.roomState.owner.wallStock).toBe(60);

      vi.advanceTimersByTime(SERVER_TICK_INTERVAL_MS);
    }

    room.dispose();
  });

  it('プレイヤーがタイル境界付近でもマンハッタン距離>2のセルは編集できる', async () => {
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
        mazeSize: number;
        solidCells: Set<string>;
        owner: { wallStock: number; editCooldownUntil: number };
        player: { physics: { position: { x: number; y: number } } };
      };
    };

    internal.roomState.phase = 'prep';
    internal.roomState.mazeSize = 6;
    internal.roomState.solidCells = new Set();
    internal.roomState.owner.wallStock = 3;
    internal.roomState.owner.editCooldownUntil = Date.now();
    internal.roomState.player.physics.position = { x: 0.51, y: 0.51 };
    internal.roomState.goalCell = { x: 5, y: 5 };

    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 2, y: 2 },
          direction: 'north',
        },
      }),
    );

    const error = ownerSocket.sent
      .map((raw) => JSON.parse(raw))
      .find((message) => message.type === 'ERR');

    expect(error).toBeUndefined();
    expect(internal.roomState.solidCells.has('2,2')).toBe(true);
    expect(internal.roomState.owner.wallStock).toBe(2);

    room.dispose();
  });

  it('到達路外の壁追加はキャッシュでBFSを省略する', async () => {
    const events: Array<Record<string, unknown>> = [];
    infoSpy.mockImplementation((...args: unknown[]) => {
      if (args.length >= 2 && args[0] === '[metrics]' && typeof args[1] === 'object') {
        events.push(args[1] as Record<string, unknown>);
      }
    });

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
        mazeSize: number;
        goalCell?: { x: number; y: number };
        solidCells: Set<string>;
        owner: { wallStock: number; editCooldownUntil: number };
        player: { physics: { position: { x: number; y: number } } };
      };
    };

    const corridor = [
      '0,0',
      '1,0',
      '2,0',
      '3,0',
      '4,0',
      '5,0',
      '4,4',
      '4,5',
      '5,4',
      '5,5',
    ];
    const walkable = new Set(corridor);
    const solids = new Set<string>();
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        const key = `${x},${y}`;
        if (walkable.has(key)) {
          continue;
        }
        solids.add(key);
      }
    }

    internal.roomState.phase = 'prep';
    internal.roomState.mazeSize = 6;
    internal.roomState.goalCell = { x: 5, y: 0 };
    internal.roomState.solidCells = solids;
    internal.roomState.owner.wallStock = 10;
    internal.roomState.owner.editCooldownUntil = Date.now();
    internal.roomState.player.physics.position = { x: 0.5, y: 0.5 };

    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 5, y: 5 },
          direction: 'north',
        },
      }),
    );

    const firstPathMetric = events
      .filter((event) => event.type === 'owner.path_check')
      .at(-1);
    expect(firstPathMetric).toMatchObject({ checked: true, blocked: false });
    expect(internal.roomState.solidCells.has('5,5')).toBe(true);

    events.length = 0;
    internal.roomState.owner.editCooldownUntil = Date.now();

    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 4, y: 5 },
          direction: 'north',
        },
      }),
    );

    const secondMetric = events.find((event) => event.type === 'owner.path_check');
    expect(secondMetric).toMatchObject({ checked: false, blocked: false, durationMs: 0 });
    const error = ownerSocket.sent
      .map((raw) => JSON.parse(raw))
      .find((message) => message.type === 'ERR');
    expect(error).toBeUndefined();
    expect(internal.roomState.solidCells.has('4,5')).toBe(true);

    room.dispose();
  });

  it('到達路を塞ぐ同一セルの連打はキャッシュでBFSを省略して拒否する', async () => {
    const events: Array<Record<string, unknown>> = [];
    infoSpy.mockImplementation((...args: unknown[]) => {
      if (args.length >= 2 && args[0] === '[metrics]' && typeof args[1] === 'object') {
        events.push(args[1] as Record<string, unknown>);
      }
    });

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
        mazeSize: number;
        goalCell?: { x: number; y: number };
        solidCells: Set<string>;
        owner: { wallStock: number; editCooldownUntil: number };
        player: { physics: { position: { x: number; y: number } } };
      };
    };

    const openCorridor = new Set(['0,0', '1,0', '2,0', '3,0', '4,0', '5,0']);
    const solids = new Set<string>();
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        const key = `${x},${y}`;
        if (openCorridor.has(key)) {
          continue;
        }
        solids.add(key);
      }
    }

    internal.roomState.phase = 'prep';
    internal.roomState.mazeSize = 6;
    internal.roomState.goalCell = { x: 5, y: 0 };
    internal.roomState.solidCells = solids;
    internal.roomState.owner.wallStock = 10;
    internal.roomState.owner.editCooldownUntil = Date.now();
    internal.roomState.player.physics.position = { x: 0.5, y: 0.5 };

    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 3, y: 0 },
          direction: 'north',
        },
      }),
    );

    let error = ownerSocket.sent
      .map((raw) => JSON.parse(raw))
      .find((message) => message.type === 'ERR');
    expect(error).toMatchObject({ code: 'NO_PATH' });
    const firstMetric = events
      .filter((event) => event.type === 'owner.path_check')
      .at(-1);
    expect(firstMetric).toMatchObject({ checked: true, blocked: true });

    events.length = 0;
    internal.roomState.owner.editCooldownUntil = Date.now();

    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 3, y: 0 },
          direction: 'north',
        },
      }),
    );

    error = ownerSocket.sent
      .map((raw) => JSON.parse(raw))
      .find((message) => message.type === 'ERR');
    expect(error).toMatchObject({ code: 'NO_PATH' });
    const secondMetric = events.find((event) => event.type === 'owner.path_check');
    expect(secondMetric).toMatchObject({ checked: false, blocked: true, durationMs: 0 });

    room.dispose();
  });

  it('経路維持BFSの計測結果がメトリクスに記録される', async () => {
    const events: Array<Record<string, unknown>> = [];
    infoSpy.mockImplementation((...args: unknown[]) => {
      if (args.length >= 2 && args[0] === '[metrics]' && typeof args[1] === 'object') {
        events.push(args[1] as Record<string, unknown>);
      }
    });

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
        mazeSize: number;
        goalCell?: { x: number; y: number };
        solidCells: Set<string>;
        owner: { wallStock: number; editCooldownUntil: number };
        player: { physics: { position: { x: number; y: number } } };
      };
    };

    internal.roomState.phase = 'prep';
    internal.roomState.mazeSize = 6;
    internal.roomState.goalCell = { x: 5, y: 5 };
    internal.roomState.solidCells = new Set();
    internal.roomState.owner.wallStock = 3;
    internal.roomState.owner.editCooldownUntil = Date.now();
    internal.roomState.player.physics.position = { x: 0.5, y: 0.5 };

    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 2, y: 2 },
          direction: 'north',
        },
      }),
    );

    expect(events.some((event) => event.type === 'room.created')).toBe(true);
    const pathMetric = events.find((event) => event.type === 'owner.path_check');
    expect(pathMetric).toBeDefined();
    expect(typeof pathMetric?.durationMs).toBe('number');
    expect(pathMetric?.blocked).toBe(false);
    expect(pathMetric?.checked).toBe(true);

    room.dispose();
  });
});
