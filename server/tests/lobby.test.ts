import { describe, expect, it } from 'vitest';
import {
  joinLobby,
  removeSession,
  resetLobby,
  hasLobbyExpired,
  LOBBY_TIMEOUT_MS,
} from '../src/logic/lobby';
import { createInitialRoomState } from '../src/state';

const NOW = Date.now();

function createState() {
  return createInitialRoomState('ROOM', NOW);
}

describe('lobby logic', () => {
  it('joins until capacity is reached', () => {
    const state = createState();
    const first = joinLobby(state, { nick: 'A', role: 'owner' }, NOW, () => 's1');
    const second = joinLobby(state, { nick: 'B', role: 'player' }, NOW, () => 's2');
    const third = joinLobby(state, { nick: 'C', role: 'player' }, NOW, () => 's3');

    expect(first.kind).toBe('joined');
    expect(second.kind).toBe('joined');
    expect(third.kind).toBe('full');
    expect(state.sessions.size).toBe(2);
  });

  it('expires after timeout window', () => {
    const state = createState();
    const later = NOW + LOBBY_TIMEOUT_MS + 1;
    expect(hasLobbyExpired(state, later)).toBe(true);
    const result = joinLobby(state, { nick: 'A', role: 'owner' }, later, () => 's4');
    expect(result.kind).toBe('expired');
  });

  it('removes sessions and resets lobby', () => {
    const state = createState();
    const joinResult = joinLobby(state, { nick: 'A', role: 'owner' }, NOW, () => 'session');
    if (joinResult.kind !== 'joined') {
      throw new Error('Expected join');
    }

    expect(removeSession(state, joinResult.session.id, NOW + 1000)).toBe(true);
    expect(state.sessions.size).toBe(0);

    resetLobby(state, NOW + 2000);
    expect(state.sessions.size).toBe(0);
    expect(state.createdAt).toBe(NOW + 2000);
  });
});
