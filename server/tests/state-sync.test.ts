import { describe, expect, it } from 'vitest';
import { createInitialRoomState } from '../src/state';
import type { ServerMessage } from '../src/schema/ws';
import { StateComposer } from '../src/logic/state-sync';

function assertStateMessage(message: ServerMessage | null): asserts message is ServerMessage & {
  type: 'STATE';
  payload: {
    seq: number;
    full: boolean;
    snapshot?: Record<string, unknown>;
    changes?: Record<string, unknown>;
  };
} {
  expect(message).not.toBeNull();
  expect(message!.type).toBe('STATE');
  expect(typeof message!.payload).toBe('object');
  expect(typeof message!.payload.seq).toBe('number');
  expect(typeof message!.payload.full).toBe('boolean');
}

describe('StateComposer', () => {
  it('最初の送信では常に全量スナップショットを返す', () => {
    const composer = new StateComposer();
    const room = createInitialRoomState('ROOM', 1_000);

    const message = composer.compose(room);

    assertStateMessage(message);
    expect(message.payload.full).toBe(true);
    expect(message.payload.snapshot).toMatchObject({
      roomId: 'ROOM',
      phase: 'lobby',
    });
  });

  it('差分モードでは変更されたフィールドだけを返す', () => {
    const composer = new StateComposer();
    const room = createInitialRoomState('ROOM', 1_000);

    // 初回で基準スナップショットを作成
    composer.compose(room);

    room.updatedAt = 1_500;
    room.phaseEndsAt = 2_000;

    const diff = composer.compose(room);

    assertStateMessage(diff);
    expect(diff.payload.full).toBe(false);
    expect(diff.payload.changes).toMatchObject({
      updatedAt: 1_500,
      phaseEndsAt: 2_000,
    });
  });

  it('変更がなければ null を返す', () => {
    const composer = new StateComposer();
    const room = createInitialRoomState('ROOM', 1_000);

    composer.compose(room);
    const diff = composer.compose(room);

    expect(diff).toBeNull();
  });

  it('重要イベントでは forceFull 指定で全量スナップショットを返す', () => {
    const composer = new StateComposer();
    const room = createInitialRoomState('ROOM', 1_000);

    composer.compose(room);

    room.phase = 'countdown';
    room.phaseEndsAt = 1_500;

    const full = composer.compose(room, { forceFull: true });

    assertStateMessage(full);
    expect(full.payload.full).toBe(true);
    expect(full.payload.snapshot).toMatchObject({
      phase: 'countdown',
      phaseEndsAt: 1_500,
    });
  });

  it('シーケンス番号が送信のたびに増加する', () => {
    const composer = new StateComposer();
    const room = createInitialRoomState('ROOM', 1_000);

    const first = composer.compose(room);
    const second = composer.compose({ ...room, updatedAt: 1_100 });

    assertStateMessage(first);
    assertStateMessage(second);
    expect(second.payload.seq).toBeGreaterThan(first.payload.seq);
  });

  it('オーナー資源の変化を差分に含める', () => {
    const composer = new StateComposer();
    const room = createInitialRoomState('ROOM', 1_000);

    composer.compose(room);

    room.owner.wallStock = 120;

    const diff = composer.compose(room);

    assertStateMessage(diff);
    expect(diff.payload.changes?.owner).toEqual({
      wallStock: 120,
      wallRemoveLeft: 1,
      trapCharges: 0,
    });
  });
});
