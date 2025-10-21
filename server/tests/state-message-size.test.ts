import { describe, expect, it } from 'vitest';
import { StateComposer } from '../src/logic/state-sync';
import { createInitialRoomState, type RoomState } from '../src/state';

function populateRoomForWorstCase(state: RoomState, now: number): void {
  state.phase = 'explore';
  state.updatedAt = now;
  state.phaseStartedAt = now - 30_000;
  state.phaseEndsAt = now + 4 * 60_000;
  state.countdownDurationMs = 3_000;
  state.prepDurationMs = 60_000;
  state.exploreDurationMs = 8 * 60_000;
  state.targetScore = 120;
  state.targetScoreLocked = true;

  state.sessions.clear();
  const ownerSession = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    role: 'owner' as const,
    nick: 'ABCDEFGHIJ',
  };
  const playerSession = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    role: 'player' as const,
    nick: 'KLMNOPQRST',
  };
  state.sessions.set(ownerSession.id, ownerSession);
  state.sessions.set(playerSession.id, playerSession);

  state.player.physics.position = { x: 39.912345678, y: 0.087654321 };
  state.player.physics.velocity = { x: 1.23456789, y: -0.987654321 };
  state.player.physics.angle = 5.49778714378;
  state.player.trapSlowUntil = now + 5_000;
  state.player.predictionHits = 12;
  state.player.score = 115;

  state.owner.wallStock = 140;
  state.owner.wallRemoveLeft = 1;
  state.owner.trapCharges = 2;
  state.owner.predictionLimit = 3;
  state.owner.predictionHits = 8;
  state.owner.editCooldownUntil = now + 5_000;

  state.owner.predictionMarks.clear();
  for (let i = 0; i < state.owner.predictionLimit; i += 1) {
    const cellX = (i * 11) % state.mazeSize;
    const cellY = (i * 13) % state.mazeSize;
    state.owner.predictionMarks.set(`${cellX}:${cellY}`, {
      cell: { x: cellX, y: cellY },
      createdAt: now - i * 1_000,
    });
  }

  state.owner.traps = [];
  for (let i = 0; i < 2; i += 1) {
    state.owner.traps.push({
      cell: {
        x: (i * 17) % state.mazeSize,
        y: (i * 19) % state.mazeSize,
      },
      placedAt: now - i * 2_000,
    });
  }

  state.points = new Map();
  state.pointTotalValue = 0;
  const pointLimit = 18;
  for (let i = 0; i < pointLimit; i += 1) {
    const cell = {
      x: (i * 7) % state.mazeSize,
      y: (i * 11) % state.mazeSize,
    };
    const value = (i % 3 === 0 ? 5 : i % 3 === 1 ? 3 : 1) as 1 | 3 | 5;
    state.points.set(`${cell.x}:${cell.y}`, {
      cell,
      value,
    });
    state.pointTotalValue += value;
  }
}

describe('STATEメッセージのシリアライズサイズ', () => {
  it('最大級のスナップショットでも軽量化が必要な水準まで収まる', () => {
    const now = 1_700_000_000_000;
    const state = createInitialRoomState('ROOM-ABCDEFGH', now, 8 * 60_000, { mazeSize: 40 });
    populateRoomForWorstCase(state, now);

    const composer = new StateComposer();
    const message = composer.compose(state, { forceFull: true });
    expect(message).toBeTruthy();

    const encoded = JSON.stringify(message);
    expect(encoded.length).toBeLessThanOrEqual(1_200);
  });
});
