import { z } from 'zod';

export const NicknameSchema = z
  .string()
  .min(2)
  .max(10)
  .regex(/^[A-Z0-9_-]+$/i, 'Nickname must be alphanumeric with - _ allowed');

export const RoomIdSchema = z
  .string()
  .length(6)
  .regex(/^[A-HJ-NP-Z2-9]{6}$/i, 'Room ID must be base32 without O/I/0/1');

export type Nickname = z.infer<typeof NicknameSchema>;
export type RoomId = z.infer<typeof RoomIdSchema>;

export function validateRoomId(roomId: string): RoomId {
  return RoomIdSchema.parse(roomId.toUpperCase());
}

export function validateNickname(nick: string): Nickname {
  return NicknameSchema.parse(nick);
}
