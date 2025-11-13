import { z } from 'zod';

export const RoleSchema = z.enum(['owner', 'player']);

const CoordinateSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
  })
  .passthrough();

const WallDirectionSchema = z.enum(['north', 'east', 'south', 'west']);

const OwnerEditPayloadSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('ADD_WALL'),
      cell: CoordinateSchema,
      direction: WallDirectionSchema,
    })
    .passthrough(),
  z
    .object({
      action: z.literal('DEL_WALL'),
      cell: CoordinateSchema,
      direction: WallDirectionSchema,
    })
    .passthrough(),
  z
    .object({
      action: z.literal('PLACE_TRAP'),
      cell: CoordinateSchema,
    })
    .passthrough(),
  z
    .object({
      action: z.literal('PLACE_POINT'),
      cell: CoordinateSchema,
      value: z.union([z.literal(1), z.literal(3), z.literal(5)]),
    })
    .passthrough(),
]);

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('P_INPUT'),
      yaw: z.number(),
      forward: z.number(),
      timestamp: z.number(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('O_EDIT'),
      edit: OwnerEditPayloadSchema,
    })
    .passthrough(),
  z
    .object({
      type: z.literal('O_MRK'),
      cell: CoordinateSchema,
      active: z.boolean().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('O_CONFIRM'),
      targetId: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('O_CANCEL'),
      targetId: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('O_START'),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('PING'),
      ts: z.number(),
    })
    .passthrough(),
]);

const StatePayloadSchema = z.record(z.string(), z.unknown());

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('STATE'),
      payload: StatePayloadSchema,
    })
    .passthrough(),
  z
    .object({
      type: z.literal('DEBUG_CONNECTED'),
      roomId: z.string(),
      role: RoleSchema,
      sessionId: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('EV'),
      event: z.string(),
      payload: StatePayloadSchema.optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('ERR'),
      code: z.string(),
      message: z.string(),
      data: StatePayloadSchema.optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('ERROR'),
      code: z.string(),
      message: z.string(),
      data: StatePayloadSchema.optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('PING'),
      ts: z.number(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('PONG'),
      ts: z.number(),
    })
    .passthrough(),
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
