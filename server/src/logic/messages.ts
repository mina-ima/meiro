import { parseClientMessage } from '../schema/ws';
import type { ClientMessage, ServerMessage } from '../schema/ws';
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
    case 'O_START': {
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

export function createServerEvents(
  session: PlayerSession,
  message: ClientMessage,
): ServerMessage[] {
  switch (message.type) {
    case 'P_INPUT':
      return [
        {
          type: 'EV',
          event: 'PLAYER_INPUT',
          payload: {
            sessionId: session.id,
            yaw: message.yaw,
            forward: message.forward,
            timestamp: message.timestamp,
          },
        },
      ];
    case 'O_EDIT':
      return [
        {
          type: 'EV',
          event: 'OWNER_EDIT',
          payload: {
            sessionId: session.id,
            edit: message.edit,
          },
        },
      ];
    case 'O_MRK':
      return [
        {
          type: 'EV',
          event: 'OWNER_MARK',
          payload: {
            sessionId: session.id,
            cell: message.cell,
            active: message.active ?? true,
          },
        },
      ];
    case 'O_CONFIRM':
      return [
        {
          type: 'EV',
          event: 'OWNER_CONFIRM',
          payload: {
            sessionId: session.id,
            targetId: message.targetId,
          },
        },
      ];
    case 'O_CANCEL':
      return [
        {
          type: 'EV',
          event: 'OWNER_CANCEL',
          payload: {
            sessionId: session.id,
            targetId: message.targetId,
          },
        },
      ];
    case 'O_START':
      return [
        {
          type: 'EV',
          event: 'OWNER_START',
          payload: {
            sessionId: session.id,
            mazeSize: message.mazeSize,
          },
        },
      ];
    case 'PING':
      return [];
    default:
      return assertNever(message);
  }
}
