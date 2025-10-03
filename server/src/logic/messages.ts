import { parseClientMessage } from '../schema/ws';
import type { ClientMessage } from '../schema/ws';
import type { RoomState, PlayerSession } from '../state';

export class MessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageValidationError';
  }
}

export function processClientMessage(
  _room: RoomState,
  session: PlayerSession,
  raw: unknown,
): ClientMessage {
  const message = parseClientMessage(raw);

  switch (message.type) {
    case 'P_INPUT': {
      if (session.role !== 'player') {
        throw new MessageValidationError('player input from non-player session');
      }
      return message;
    }
    case 'O_EDIT':
    case 'O_MRK':
    case 'O_CONFIRM':
    case 'O_CANCEL': {
      if (session.role !== 'owner') {
        throw new MessageValidationError('owner action from non-owner session');
      }
      return message;
    }
    case 'PING':
      return message;
    default:
      return assertNever(message);
  }
}

function assertNever(value: never): never {
  throw new MessageValidationError(`unsupported message type: ${String(value)}`);
}
