import { describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { RoomDurableObject } from '../src/room-do';
import type { RoomState } from '../src/state';

describe('RoomDurableObject phase alarm scheduling', () => {
  it('phaseEndsAt が不正な値のときはアラームを設定しない', async () => {
    const setAlarm = vi.fn().mockImplementation(() => {
      throw new Error('invalid date');
    });

    class MockDurableObjectState {
      public readonly id = { toString: () => 'ROOM-1' };
      public readonly storage = { setAlarm };
    }

    const room = new RoomDurableObject(
      new MockDurableObjectState() as unknown as DurableObjectState,
    );
    const internals = room as unknown as {
      roomState: RoomState;
      schedulePhaseAlarm(): Promise<void>;
    };
    internals.roomState.phaseEndsAt = 'invalid-date' as unknown as number;

    await expect(internals.schedulePhaseAlarm()).resolves.toBeUndefined();
    expect(setAlarm).not.toHaveBeenCalled();
  });
});
