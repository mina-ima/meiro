import { describe, expect, it } from 'vitest';
import { createInitialRoomState } from '../src/state';

describe('RoomState owner resources', () => {
  it('迷路サイズ40では壁資源が140本で初期化される', () => {
    const room = createInitialRoomState('ROOM-ID', 1_000);

    expect(room.owner.wallStock).toBe(140);
    expect(room.owner.wallRemoveLeft).toBe(1);
    expect(room.owner.trapCharges).toBe(1);
    expect(room.owner.editCooldownUntil).toBe(1_000);
    expect(room.owner.predictionMarks.size).toBe(0);
    expect(room.owner.predictionLimit).toBe(3);
    expect(room.owner.predictionHits).toBe(0);
  });

  it('迷路サイズ20では壁資源が48本で初期化される', () => {
    const room = createInitialRoomState('ROOM-ID', 1_000, undefined, { mazeSize: 20 });

    expect(room.owner.wallStock).toBe(48);
    expect(room.owner.wallRemoveLeft).toBe(1);
    expect(room.owner.trapCharges).toBe(1);
    expect(room.owner.editCooldownUntil).toBe(1_000);
    expect(room.owner.predictionMarks.size).toBe(0);
    expect(room.owner.predictionLimit).toBe(3);
    expect(room.owner.predictionHits).toBe(0);
  });
});
