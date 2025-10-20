import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import type { Vector2 } from '@meiro/common';
import { RoomDurableObject } from '../src/room-do';

class FakeDurableObjectState {
  public readonly id = { toString: () => 'ROOM-PREDICT-RATIO' };
  public readonly storage = {
    setAlarm: async () => {},
  };
}

function createRoom(): RoomDurableObject {
  const state = new FakeDurableObjectState() as unknown as DurableObjectState;
  return new RoomDurableObject(state);
}

describe('予測地点ボーナスの比率制御', () => {
  let room: RoomDurableObject;

  beforeEach(() => {
    vi.useFakeTimers();
    room = createRoom();
  });

  function simulateHit(position: Vector2): void {
    const internal = room as unknown as {
      processPredictionBonus(pos: Vector2): boolean;
      roomState: {
        owner: {
          predictionMarks: Map<string, { cell: { x: number; y: number }; createdAt: number }>;
        };
      };
    };

    internal.roomState.owner.predictionMarks.set('0,0', {
      cell: { x: 0, y: 0 },
      createdAt: Date.now(),
    });

    const awarded = internal.processPredictionBonus(position);
    expect(awarded).toBe(true);
  }

  it('ヒットが偏っても最終的に70/30 ±5%に収束する', () => {
    const internal = room as unknown as {
      roomState: {
        owner: {
          wallStock: number;
          trapCharges: number;
          predictionHits: number;
          predictionMarks: Map<string, { cell: { x: number; y: number }; createdAt: number }>;
        };
        player: { predictionHits: number };
      };
    };

    internal.roomState.owner.wallStock = 0;
    internal.roomState.owner.trapCharges = 0;
    internal.roomState.owner.predictionHits = 0;
    internal.roomState.player.predictionHits = 0;
    internal.roomState.owner.predictionMarks.clear();

    vi.spyOn(Math, 'random').mockReturnValue(0.95);

    const TOTAL = 1000;
    for (let i = 0; i < TOTAL; i += 1) {
      simulateHit({ x: 0.1, y: 0.2 });
    }

    const walls = internal.roomState.owner.wallStock;
    const traps = internal.roomState.owner.trapCharges;
    const totalRewards = walls + traps;

    expect(totalRewards).toBe(TOTAL);

    const wallRate = walls / totalRewards;
    expect(wallRate).toBeGreaterThanOrEqual(0.65);
    expect(wallRate).toBeLessThanOrEqual(0.75);
  });
});
