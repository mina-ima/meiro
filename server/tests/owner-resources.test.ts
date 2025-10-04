import { describe, expect, it } from 'vitest';
import { createInitialRoomState } from '../src/state';

describe('RoomState owner resources', () => {
  it('迷路サイズ40では壁資源が140本で初期化される', () => {
    const room = createInitialRoomState('ROOM-ID', 1_000);

    expect(room.owner.wallStock).toBe(140);
  });

  it('迷路サイズ20では壁資源が48本で初期化される', () => {
    const room = createInitialRoomState('ROOM-ID', 1_000, undefined, { mazeSize: 20 });

    expect(room.owner.wallStock).toBe(48);
  });
});
