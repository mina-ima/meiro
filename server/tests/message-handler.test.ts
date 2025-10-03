import { describe, expect, it } from 'vitest';
import { createInitialRoomState } from '../src/state';
import { processClientMessage } from '../src/logic/messages';

const NOW = 1_700_000_000_000;

describe('processClientMessage', () => {
  it('throws on malformed message', () => {
    const room = createInitialRoomState('ROOM', NOW);
    const session = { id: 'owner', nick: 'A', role: 'owner' } as const;

    expect(() =>
      processClientMessage(room, session, {
        type: 'O_EDIT',
        edit: { action: 'UNKNOWN' },
      }),
    ).toThrowError();
  });

  it('accepts valid ping', () => {
    const room = createInitialRoomState('ROOM', NOW);
    const session = { id: 'owner', nick: 'A', role: 'owner' } as const;

    const message = processClientMessage(room, session, { type: 'PING', ts: NOW });
    expect(message.type).toBe('PING');
  });
});
