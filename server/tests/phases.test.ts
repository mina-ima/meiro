import { describe, expect, it } from 'vitest';
import { createInitialRoomState } from '../src/state';
import { startCountdown, progressPhase, DEFAULT_EXPLORE_DURATION_MS } from '../src/logic/phases';

const NOW = 1_700_000_000_000;

describe('phase progression', () => {
  it('lobbyからカウントダウン開始', () => {
    const state = createInitialRoomState('ROOM', NOW);
    startCountdown(state, NOW);

    expect(state.phase).toBe('countdown');
    expect(state.phaseEndsAt).toBe(NOW + 3_000);
  });

  it('カウントダウン終了で準備フェーズに遷移', () => {
    const state = createInitialRoomState('ROOM', NOW);
    startCountdown(state, NOW);

    progressPhase(state, NOW + 3_001);

    expect(state.phase).toBe('prep');
    expect(state.phaseEndsAt).toBe(NOW + 3_001 + 60_000);
  });

  it('準備終了で探索→完了まで進む', () => {
    const state = createInitialRoomState('ROOM', NOW);
    startCountdown(state, NOW);

    progressPhase(state, NOW + 3_000);
    progressPhase(state, NOW + 3_000 + 60_000);
    expect(state.phase).toBe('explore');
    expect(state.phaseEndsAt).toBe(NOW + 3_000 + 60_000 + DEFAULT_EXPLORE_DURATION_MS);

    progressPhase(state, NOW + 3_000 + 60_000 + DEFAULT_EXPLORE_DURATION_MS + 1);
    expect(state.phase).toBe('result');
    expect(state.phaseEndsAt).toBeUndefined();
  });

  it('ロビー以外でstartCountdownすると例外', () => {
    const state = createInitialRoomState('ROOM', NOW);
    startCountdown(state, NOW);

    expect(() => startCountdown(state, NOW + 100)).toThrow();
  });
});
