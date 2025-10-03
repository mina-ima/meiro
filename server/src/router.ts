import type { Env } from './index';
import { RoleSchema } from './schema/ws';
import { validateNickname, validateRoomId } from './logic/validate';
import { defaultRoomIdGenerator } from './logic/room-id';
import { getRoomStub } from './logic/room-binding';

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/rooms' && request.method === 'POST') {
    const roomId = defaultRoomIdGenerator.generate();
    return Response.json({ roomId });
  }

  if (url.pathname !== '/ws' || request.method !== 'GET') {
    return new Response('not found', { status: 404 });
  }

  const role = RoleSchema.parse(url.searchParams.get('role'));
  const roomId = validateRoomId(url.searchParams.get('room') ?? '');
  const nick = validateNickname(url.searchParams.get('nick') ?? '');

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  const stub = getRoomStub(env, roomId);
  await (
    stub.fetch as unknown as (
      input: RequestInfo | URL,
      init?: RequestInit & { webSocket?: WebSocket },
    ) => Promise<Response>
  )('https://internal/session', {
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
}
