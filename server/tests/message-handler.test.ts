import { describe, expect, it } from 'vitest';
import { createInitialRoomState } from '../src/state';
import { createServerEvents, processClientMessage } from '../src/logic/messages';

const NOW = 1_700_000_000_000;

describe('processClientMessage', () => {
  it('throws on malformed message', () => {
    const room = createInitialRoomState('ROOM', NOW);
    const session = { id: 'owner', nick: 'A', role: 'owner', lastSeenAt: NOW } as const;

    expect(() =>
      processClientMessage(room, session, {
        type: 'O_EDIT',
        edit: { action: 'UNKNOWN' },
      }),
    ).toThrowError();
  });

  it('accepts valid ping', () => {
    const room = createInitialRoomState('ROOM', NOW);
    const session = { id: 'owner', nick: 'A', role: 'owner', lastSeenAt: NOW } as const;

    const message = processClientMessage(room, session, { type: 'PING', ts: NOW });
    expect(message.type).toBe('PING');
  });

  it('produces owner edit events', () => {
    const room = createInitialRoomState('ROOM', NOW);
    const session = { id: 'owner', nick: 'A', role: 'owner', lastSeenAt: NOW } as const;

    const message = processClientMessage(room, session, {
      type: 'O_EDIT',
      edit: {
        action: 'ADD_WALL',
        cell: { x: 1, y: 2 },
        direction: 'north',
      },
    });

    const events = createServerEvents(session, message);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'EV',
      event: 'OWNER_EDIT',
      payload: {
        sessionId: 'owner',
        edit: {
          action: 'ADD_WALL',
          cell: { x: 1, y: 2 },
          direction: 'north',
        },
      },
    });
  });

  it('ignores未知フィールドを含むメッセージ', () => {
    const room = createInitialRoomState('ROOM', NOW);
    const session = { id: 'player', nick: 'P', role: 'player', lastSeenAt: NOW } as const;

    const message = processClientMessage(room, session, {
      type: 'P_INPUT',
      yaw: 0.1,
      forward: 1,
      timestamp: NOW,
      debugExtra: 'ignore-me',
    });

    expect(message).toMatchObject({ type: 'P_INPUT', yaw: 0.1, forward: 1 });
  });
});
