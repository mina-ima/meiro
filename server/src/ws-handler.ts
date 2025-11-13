import type { Env } from './index';
import { RoleSchema } from './schema/ws';
import { validateNickname, validateRoomId } from './logic/validate';
import { getRoomStub } from './logic/room-binding';

type WebSocketInit = RequestInit & { webSocket?: WebSocket };

const upgradeRequiredHeaders = new Headers({
  Connection: 'Upgrade',
  Upgrade: 'websocket',
});

export async function handleWebSocketRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname !== '/ws' || request.method !== 'GET') {
    return null;
  }

  if (!isWebSocketUpgrade(request)) {
    return new Response('Upgrade Required', {
      status: 426,
      headers: upgradeRequiredHeaders,
    });
  }

  const role = RoleSchema.parse(url.searchParams.get('role'));
  const roomId = validateRoomId(url.searchParams.get('room') ?? '');
  const nick = validateNickname(url.searchParams.get('nick') ?? '');

  console.log('WS fetch /ws', { url: url.toString(), roomId, role, nick });

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  const stub = getRoomStub(env, roomId);

  try {
    await (
      stub.fetch as unknown as (input: RequestInfo | URL, init?: WebSocketInit) => Promise<Response>
    )('https://internal/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Upgrade: 'websocket',
      },
      webSocket: server,
      body: JSON.stringify({ roomId, nick, role }),
    });
  } catch (error) {
    console.error('WS error during /ws bootstrap', error);
    try {
      server.close(1011, 'internal error');
    } catch (closeError) {
      console.error('WS error closing DO socket', closeError);
    }

    try {
      client.close(1011, 'internal error');
    } catch (clientError) {
      console.error('WS error closing client socket', clientError);
    }

    return new Response('Failed to establish WebSocket session', {
      status: 500,
    });
  }

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

function isWebSocketUpgrade(request: Request): boolean {
  const upgrade = request.headers.get('upgrade');
  return typeof upgrade === 'string' && upgrade.toLowerCase() === 'websocket';
}
