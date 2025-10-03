import { z } from 'zod';

export const RoleSchema = z.enum(['owner', 'player']);

const CoordinateSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
  })
  .strict();

const WallDirectionSchema = z.enum(['north', 'east', 'south', 'west']);

const OwnerEditPayloadSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('ADD_WALL'),
      cell: CoordinateSchema,
      direction: WallDirectionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('DEL_WALL'),
      cell: CoordinateSchema,
      direction: WallDirectionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('PLACE_TRAP'),
      cell: CoordinateSchema,
    })
    .strict(),
]);

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('P_INPUT'),
      yaw: z.number(),
      forward: z.number(),
      timestamp: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal('O_EDIT'),
      edit: OwnerEditPayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('O_MRK'),
      cell: CoordinateSchema,
      active: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('O_CONFIRM'),
      targetId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('O_CANCEL'),
      targetId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('PING'),
      ts: z.number(),
    })
    .strict(),
]);

const StatePayloadSchema = z.record(z.string(), z.unknown());

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('STATE'),
      payload: StatePayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('EV'),
      event: z.string(),
      payload: StatePayloadSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('ERR'),
      code: z.string(),
      message: z.string(),
      data: StatePayloadSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('PING'),
      ts: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal('PONG'),
      ts: z.number(),
    })
    .strict(),
]);

export type Role = z.infer<typeof RoleSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type OwnerEditPayload = z.infer<typeof OwnerEditPayloadSchema>;

export function parseClientMessage(input: unknown): ClientMessage {
  return ClientMessageSchema.parse(input);
}

export function parseServerMessage(input: unknown): ServerMessage {
  return ServerMessageSchema.parse(input);
}
