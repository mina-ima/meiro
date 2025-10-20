import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { RoomDurableObject } from '../src/room-do';
import { SERVER_TICK_INTERVAL_MS } from '@meiro/common';

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-POINTS' };
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
    body: JSON.stringify({ roomId: 'ROOM-POINTS', ...payload }),
  });

  const requestWithSocket = Object.assign(request, { webSocket: socket });
  const response = await room.fetch(requestWithSocket);
  expect(response.ok).toBe(true);
}

const NOW = 1_700_000_000_000;

describe('ポイント配置とスコアリング', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('不足ポイント補填はターゲットスコアの1点手前でクリップされる', async () => {
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
        phaseStartedAt: number;
        mazeSize: 20 | 40;
        owner: { editCooldownUntil: number };
        player: { score: number };
        pointTotalValue: number;
        targetScore: number;
        targetScoreLocked: boolean;
        pointShortageCompensated: boolean;
      };
      alarm: (alarmTime: number) => Promise<void>;
    };

    internal.roomState.phase = 'prep';
    internal.roomState.phaseStartedAt = NOW;
    internal.roomState.phaseEndsAt = NOW + 60_000;
    internal.roomState.mazeSize = 20;
    internal.roomState.owner.editCooldownUntil = NOW;

    const placePoint = (cell: { x: number; y: number }, value: 1 | 3 | 5) => {
      ownerSocket.dispatchMessage(
        JSON.stringify({
          type: 'O_EDIT',
          edit: {
            action: 'PLACE_POINT',
            cell,
            value,
          },
        }),
      );
      vi.setSystemTime(Date.now() + 1_200);
      internal.roomState.owner.editCooldownUntil = Date.now();
    };

    placePoint({ x: 1, y: 1 }, 5);
    placePoint({ x: 2, y: 1 }, 5);

    expect(internal.roomState.pointTotalValue).toBe(10);

    await internal.alarm(NOW + 60_000);

    expect(internal.roomState.targetScoreLocked).toBe(true);
    expect(internal.roomState.pointShortageCompensated).toBe(true);
    const expectedTarget = Math.ceil(10 * 0.65);
    expect(internal.roomState.targetScore).toBe(expectedTarget);
    const expectedBonus = Math.min(40 - 10, Math.max(0, expectedTarget - 1));
    expect(internal.roomState.player.score).toBe(expectedBonus);
    expect(expectedBonus).toBeLessThan(expectedTarget);

    room.dispose();
  });

  it('ポイント配置が上限を超えると拒否され、ターゲットポイントが再計算される', async () => {
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
        phaseStartedAt: number;
        mazeSize: 20 | 40;
        pointTotalValue: number;
        targetScore: number;
        owner: {
          editCooldownUntil: number;
        };
        points: Map<string, { value: number }>;
      };
    };

    internal.roomState.phase = 'prep';
    internal.roomState.phaseStartedAt = NOW;
    internal.roomState.phaseEndsAt = NOW + 60_000;
    internal.roomState.mazeSize = 20;
    internal.roomState.owner.editCooldownUntil = NOW;

    const placePoint = (cell: { x: number; y: number }, value: 1 | 3 | 5) => {
      ownerSocket.dispatchMessage(
        JSON.stringify({
          type: 'O_EDIT',
          edit: {
            action: 'PLACE_POINT',
            cell,
            value,
          },
        }),
      );
      internal.roomState.owner.editCooldownUntil = Date.now();
    };

    placePoint({ x: 1, y: 1 }, 5);
    vi.setSystemTime(NOW + 1_100);
    placePoint({ x: 2, y: 1 }, 5);
    vi.setSystemTime(NOW + 2_200);
    placePoint({ x: 3, y: 1 }, 3);

    expect(internal.roomState.pointTotalValue).toBe(13);
    expect(internal.roomState.targetScore).toBe(Math.ceil(13 * 0.65));
    expect(internal.roomState.points.size).toBe(3);

    ownerSocket.sent.length = 0;
    vi.setSystemTime(NOW + 3_300);
    placePoint({ x: 4, y: 1 }, 5);
    vi.setSystemTime(NOW + 4_400);
    placePoint({ x: 5, y: 1 }, 5);
    vi.setSystemTime(NOW + 5_500);
    placePoint({ x: 6, y: 1 }, 5);
    vi.setSystemTime(NOW + 6_600);
    placePoint({ x: 7, y: 1 }, 5);
    vi.setSystemTime(NOW + 7_700);
    placePoint({ x: 8, y: 1 }, 5);
    vi.setSystemTime(NOW + 8_800);
    placePoint({ x: 9, y: 1 }, 5);
    vi.setSystemTime(NOW + 9_900);
    placePoint({ x: 10, y: 1 }, 5);
    vi.setSystemTime(NOW + 11_000);
    placePoint({ x: 11, y: 1 }, 5);
    vi.setSystemTime(NOW + 12_100);
    placePoint({ x: 12, y: 1 }, 5);
    vi.setSystemTime(NOW + 13_200);
    placePoint({ x: 13, y: 1 }, 5);
    vi.setSystemTime(NOW + 14_300);
    placePoint({ x: 14, y: 1 }, 5);
    vi.setSystemTime(NOW + 15_400);
    placePoint({ x: 15, y: 1 }, 5);

    const error = ownerSocket.sent
      .map((raw) => JSON.parse(raw))
      .find((message) => message.type === 'ERR');
    expect(error).toMatchObject({ code: 'LIMIT_REACHED' });
    expect(internal.roomState.points.size).toBe(12);

    room.dispose();
  });

  it('準備フェーズ終了時に不足ポイントが初期スコアとして補填される', async () => {
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
        phaseStartedAt: number;
        mazeSize: 20 | 40;
        pointTotalValue: number;
        targetScore: number;
        targetScoreLocked: boolean;
        pointShortageCompensated: boolean;
        owner: { editCooldownUntil: number };
        player: { score: number };
      };
      alarm: (alarmTime: number) => Promise<void>;
    };

    internal.roomState.phase = 'prep';
    internal.roomState.phaseStartedAt = NOW;
    internal.roomState.phaseEndsAt = NOW + 60_000;
    internal.roomState.mazeSize = 20;
    internal.roomState.owner.editCooldownUntil = NOW;

    const placePoint = (cell: { x: number; y: number }, value: 1 | 3 | 5) => {
      ownerSocket.dispatchMessage(
        JSON.stringify({
          type: 'O_EDIT',
          edit: {
            action: 'PLACE_POINT',
            cell,
            value,
          },
        }),
      );
      vi.setSystemTime(Date.now() + 1_200);
      internal.roomState.owner.editCooldownUntil = Date.now();
    };

    placePoint({ x: 1, y: 1 }, 5);
    placePoint({ x: 2, y: 1 }, 5);
    placePoint({ x: 3, y: 1 }, 5);
    placePoint({ x: 4, y: 1 }, 5);
    placePoint({ x: 5, y: 1 }, 5);

    const total = internal.roomState.pointTotalValue;
    expect(total).toBe(25);

    await internal.alarm(NOW + 60_000);

    expect(internal.roomState.targetScoreLocked).toBe(true);
    expect(internal.roomState.pointShortageCompensated).toBe(true);
    expect(internal.roomState.phase).toBe('explore');
    const expectedTarget = Math.ceil(total * 0.65);
    expect(internal.roomState.targetScore).toBe(expectedTarget);
    const expectedBonus = Math.min(40 - total, Math.max(0, expectedTarget - 1));
    expect(internal.roomState.player.score).toBe(expectedBonus);

    room.dispose();
  });

  it('ポイントを取得するとスコアが加算され、規定到達で即リザルトになる', async () => {
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
        points: Map<string, { cell: { x: number; y: number }; value: number }>;
        pointTotalValue: number;
        targetScore: number;
        targetScoreLocked: boolean;
        player: {
          physics: {
            position: { x: number; y: number };
            velocity: { x: number; y: number };
            angle: number;
          };
          score: number;
        };
      };
    };

    internal.roomState.phase = 'explore';
    internal.roomState.phaseStartedAt = NOW;
    internal.roomState.targetScore = 5;
    internal.roomState.targetScoreLocked = true;
    internal.roomState.player.score = 4;
    internal.roomState.points.set('0,0', { cell: { x: 0, y: 0 }, value: 1 });
    internal.roomState.pointTotalValue = 5;
    internal.roomState.player.physics.position = { x: 0.5, y: 0.5 };
    internal.roomState.player.physics.velocity = { x: 0, y: 0 };
    internal.roomState.player.physics.angle = 0;

    vi.advanceTimersByTime(SERVER_TICK_INTERVAL_MS);

    expect(internal.roomState.points.size).toBe(0);
    expect(internal.roomState.player.score).toBe(5);
    expect(internal.roomState.phase).toBe('result');

    room.dispose();
  });

  it('ゴール到達時にゴールボーナスが一度だけ加算される', async () => {
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
        targetScore: number;
        targetScoreLocked: boolean;
        goalCell?: { x: number; y: number };
        player: {
          goalBonusAwarded: boolean;
          score: number;
          physics: {
            position: { x: number; y: number };
            velocity: { x: number; y: number };
            angle: number;
          };
        };
      };
    };

    internal.roomState.phase = 'explore';
    internal.roomState.phaseStartedAt = NOW;
    internal.roomState.targetScore = 10;
    internal.roomState.targetScoreLocked = true;
    internal.roomState.goalCell = { x: 1, y: 1 };
    internal.roomState.player.score = 6;
    internal.roomState.player.physics.position = { x: 1.5, y: 1.5 };
    internal.roomState.player.physics.velocity = { x: 0, y: 0 };
    internal.roomState.player.physics.angle = 0;

    vi.advanceTimersByTime(SERVER_TICK_INTERVAL_MS);

    expect(internal.roomState.player.goalBonusAwarded).toBe(true);
    expect(internal.roomState.player.score).toBe(6 + Math.ceil(10 / 5));
    expect(internal.roomState.phase).toBe('explore');

    vi.advanceTimersByTime(SERVER_TICK_INTERVAL_MS);
    expect(internal.roomState.player.score).toBe(6 + Math.ceil(10 / 5));

    room.dispose();
  });

  it('規定到達時にRESULTイベントが送出され、未達では継続する', () => {
    const room = new RoomDurableObject(
      new FakeDurableObjectState() as unknown as DurableObjectState,
    );

    const internal = room as unknown as {
      roomState: {
        phase: string;
        phaseStartedAt: number;
        targetScore: number;
        targetScoreLocked: boolean;
        player: { score: number };
      };
      evaluateScoreCompletion: (now: number) => void;
      broadcast: (message: unknown) => void;
    };

    const captured: unknown[] = [];
    internal.broadcast = (message: unknown) => {
      captured.push(message);
    };

    internal.roomState.phase = 'explore';
    internal.roomState.phaseStartedAt = NOW - 15_000;
    internal.roomState.targetScoreLocked = true;
    internal.roomState.targetScore = 10;
    internal.roomState.player.score = 9;

    internal.evaluateScoreCompletion(NOW + 30_000);
    expect(internal.roomState.phase).toBe('explore');
    expect(captured).toHaveLength(0);

    internal.roomState.player.score = 10;
    internal.evaluateScoreCompletion(NOW + 45_000);
    expect(internal.roomState.phase).toBe('result');

    type CapturedEvent = {
      type?: string;
      event?: string;
      payload?: {
        reason?: string;
        score?: number;
        target?: number;
      };
    };

    const events = captured.map((value) => value as CapturedEvent);
    const resultEvents = events.filter((event) => event.type === 'EV' && event.event === 'RESULT');
    expect(resultEvents).toHaveLength(1);
    expect(resultEvents[0]?.payload).toMatchObject({
      reason: 'TARGET_REACHED',
      score: 10,
      target: 10,
    });

    room.dispose();
  });
});
