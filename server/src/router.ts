import type { Env } from './index';
import { RoleSchema } from './schema/ws';
import { validateNickname, validateRoomId } from './logic/validate';

export function createFetchHandler(env: Env): ExportedHandlerFetchHandler {
  return async function handle(request) {
    const url = new URL(request.url);

    if (url.pathname !== '/ws' || request.method !== 'GET') {
      return new Response('not found', { status: 404 });
    }

    const role = RoleSchema.parse(url.searchParams.get('role'));
    const roomId = validateRoomId(url.searchParams.get('room') ?? '');
    const nick = validateNickname(url.searchParams.get('nick') ?? '');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
    await stub.fetch('https://internal/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ roomId, nick, role }),
      webSocket: server,
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  };
}
