import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { RoomDurableObject } from '../src/room-do';

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-PREP' };
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
    body: JSON.stringify({ roomId: 'ROOM-PREP', ...payload }),
  });

  const requestWithSocket = Object.assign(request, { webSocket: socket });
  const response = await room.fetch(requestWithSocket);
  expect(response.status).toBe(101);
}

function findErrorMessage(messages: string[]): { type: string; code?: string } | undefined {
  for (const raw of messages) {
    try {
      const parsed = JSON.parse(raw) as { type: string; code?: string };
      if (parsed.type === 'ERR') {
        return parsed;
      }
    } catch {
      // ignore malformed frames in tests
    }
  }
  return undefined;
}

describe('準備フェーズ時間ウィンドウ', () => {
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ポイントは40秒経過後に拒否される', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    const internal = room as unknown as {
      roomState: {
        phase: string;
        phaseStartedAt: number;
        phaseEndsAt?: number;
        owner: { editCooldownUntil: number };
      };
    };

    internal.roomState.phase = 'prep';
    internal.roomState.phaseStartedAt = NOW - 41_000;
    internal.roomState.phaseEndsAt = NOW + 19_000;
    internal.roomState.owner.editCooldownUntil = NOW;

    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'PLACE_POINT',
          cell: { x: 5, y: 5 },
          value: 3,
        },
      }),
    );

    const error = findErrorMessage(ownerSocket.sent);
    expect(error?.code).toBe('POINT_PHASE_CLOSED');
  });

  it('罠は40秒経過前は設置できない', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    const internal = room as unknown as {
      roomState: {
        phase: string;
        phaseStartedAt: number;
        phaseEndsAt?: number;
        mazeSize: number;
        solidCells: Set<string>;
        owner: { editCooldownUntil: number; trapCharges: number; traps: unknown[] };
        player: { physics: { position: { x: number; y: number } } };
      };
    };

    internal.roomState.phase = 'prep';
    internal.roomState.phaseStartedAt = NOW - 10_000;
    internal.roomState.phaseEndsAt = NOW + 50_000;
    internal.roomState.mazeSize = 40;
    internal.roomState.solidCells.clear();
    internal.roomState.owner.editCooldownUntil = NOW;
    internal.roomState.owner.trapCharges = 2;
    internal.roomState.owner.traps = [];
    internal.roomState.player.physics.position = { x: 15.2, y: 15.4 };

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

    const error = findErrorMessage(ownerSocket.sent);
    expect(error?.code).toBe('TRAP_PHASE_LOCKED');
    expect(internal.roomState.owner.traps).toHaveLength(0);
  });

  it('罠は40〜45秒の間は設置できる', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    const internal = room as unknown as {
      roomState: {
        phase: string;
        phaseStartedAt: number;
        phaseEndsAt?: number;
        mazeSize: number;
        solidCells: Set<string>;
        owner: { editCooldownUntil: number; trapCharges: number; traps: { cell: { x: number; y: number } }[] };
        player: { physics: { position: { x: number; y: number } } };
      };
    };

    internal.roomState.phase = 'prep';
    internal.roomState.phaseStartedAt = NOW - 42_000;
    internal.roomState.phaseEndsAt = NOW + 18_000;
    internal.roomState.mazeSize = 40;
    internal.roomState.solidCells.clear();
    internal.roomState.owner.editCooldownUntil = NOW;
    internal.roomState.owner.trapCharges = 2;
    internal.roomState.owner.traps = [];
    internal.roomState.player.physics.position = { x: 20.5, y: 19.1 };

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

    const error = findErrorMessage(ownerSocket.sent);
    expect(error).toBeUndefined();
    expect(internal.roomState.owner.traps).toHaveLength(1);
  });

  it('罠は45秒以降は拒否される', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    const internal = room as unknown as {
      roomState: {
        phase: string;
        phaseStartedAt: number;
        phaseEndsAt?: number;
        mazeSize: number;
        solidCells: Set<string>;
        owner: { editCooldownUntil: number; trapCharges: number; traps: unknown[] };
        player: { physics: { position: { x: number; y: number } } };
      };
    };

    internal.roomState.phase = 'prep';
    internal.roomState.phaseStartedAt = NOW - 46_000;
    internal.roomState.phaseEndsAt = NOW + 14_000;
    internal.roomState.mazeSize = 40;
    internal.roomState.solidCells.clear();
    internal.roomState.owner.editCooldownUntil = NOW;
    internal.roomState.owner.trapCharges = 2;
    internal.roomState.owner.traps = [];
    internal.roomState.player.physics.position = { x: 12.2, y: 18.3 };

    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_EDIT',
        edit: {
          action: 'PLACE_TRAP',
          cell: { x: 6, y: 6 },
        },
      }),
    );

    const error = findErrorMessage(ownerSocket.sent);
    expect(error?.code).toBe('TRAP_PHASE_CLOSED');
    expect(internal.roomState.owner.traps).toHaveLength(0);
  });

  it('予測地点は残り15秒の間のみ設定できる', async () => {
    const room = new RoomDurableObject(new FakeDurableObjectState() as unknown as DurableObjectState);
    const ownerSocket = new MockSocket();
    const playerSocket = new MockSocket();

    await join(room, ownerSocket, { role: 'owner', nick: 'Owner' });
    await join(room, playerSocket, { role: 'player', nick: 'Runner' });

    const internal = room as unknown as {
      roomState: {
        phase: string;
        phaseStartedAt: number;
        phaseEndsAt?: number;
        owner: { predictionMarks: Map<string, unknown> };
      };
    };

    internal.roomState.phase = 'prep';
    internal.roomState.phaseStartedAt = NOW - 30_000;
    internal.roomState.phaseEndsAt = NOW + 30_000;

    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_MRK',
        cell: { x: 8, y: 9 },
      }),
    );

    const earlyError = findErrorMessage(ownerSocket.sent);
    expect(earlyError?.code).toBe('PREDICTION_PHASE_LOCKED');
    expect(internal.roomState.owner.predictionMarks.size).toBe(0);

    // allow in final 15 seconds
    internal.roomState.phaseStartedAt = NOW - 46_000;
    internal.roomState.phaseEndsAt = NOW + 14_000;
    ownerSocket.sent.length = 0;
    ownerSocket.dispatchMessage(
      JSON.stringify({
        type: 'O_MRK',
        cell: { x: 8, y: 9 },
      }),
    );

    const lateError = findErrorMessage(ownerSocket.sent);
    expect(lateError).toBeUndefined();
    expect(internal.roomState.owner.predictionMarks.size).toBe(1);
  });
});
