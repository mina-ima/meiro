import { describe, expect, it } from 'vitest';
import {
  ClientMessageSchema,
  ServerMessageSchema,
  parseClientMessage,
  parseServerMessage,
} from '../src/schema/ws';

describe('ClientMessageSchema', () => {
  it('accepts player input', () => {
    const msg = {
      type: 'P_INPUT',
      yaw: 0.5,
      forward: 1,
      timestamp: Date.now(),
    } as const;

    const parsed = ClientMessageSchema.parse(msg);
    expect(parsed).toEqual(msg);
  });

  it('rejects unknown owner action', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'O_EDIT',
      edit: {
        action: 'INVALID',
        cell: { x: 1, y: 1 },
      },
    });

    expect(result.success).toBe(false);
  });

  it('parses ping control message', () => {
    const parsed = parseClientMessage({ type: 'PING', ts: 100 });
    expect(parsed.type).toBe('PING');
  });
});

describe('ServerMessageSchema', () => {
  it('accepts state broadcast', () => {
    const msg = {
      type: 'STATE',
      payload: { phase: 'lobby' },
    } as const;

    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts debug handshake message', () => {
    const msg = {
      type: 'DEBUG_CONNECTED',
      roomId: 'ROOM-1',
      role: 'owner',
      sessionId: 'session-1',
    } as const;

    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('parses pong control message', () => {
    const parsed = parseServerMessage({ type: 'PONG', ts: 42 });
    expect(parsed.type).toBe('PONG');
  });

  it('accepts fatal error message', () => {
    const msg = {
      type: 'ERROR',
      code: 'INTERNAL_ERROR',
      message: 'Internal error',
    } as const;

    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });
});
