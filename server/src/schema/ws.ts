import { z } from 'zod';

export const RoleSchema = z.enum(['owner', 'player']);

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object(
    {
      type: z.literal('P_INPUT'),
      yaw: z.number(),
      forward: z.number(),
      timestamp: z.number(),
    },
    {},
  ),
  z.object(
    {
      type: z.literal('O_EDIT'),
      action: z.enum(['ADD_WALL', 'DEL_WALL', 'PLACE_TRAP']),
      payload: z.record(z.string(), z.any()).optional(),
    },
    {},
  ),
]);

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('STATE'), payload: z.record(z.string(), z.any()) }, {}),
  z.object(
    { type: z.literal('EV'), event: z.string(), payload: z.record(z.string(), z.any()).optional() },
    {},
  ),
  z.object({ type: z.literal('ERR'), code: z.string(), message: z.string() }, {}),
  z.object({ type: z.literal('PONG'), ts: z.number() }, {}),
]);

export type Role = z.infer<typeof RoleSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
