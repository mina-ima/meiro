import type { Env } from '../index';

export interface RoomStub {
  fetch: typeof fetch;
}

export function getRoomStub(env: Env, roomId: string): RoomStub {
  const id = env.ROOM.idFromName(roomId);
  return env.ROOM.get(id);
}
