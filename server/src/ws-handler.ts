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

  let sessionResponse: Response;
  try {
    sessionResponse = await (
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
    closeSockets(client, server, 1011, 'internal error');

    return new Response('Failed to establish WebSocket session', {
      status: 500,
    });
  }

  if (sessionResponse.status !== 101) {
    console.error('Durable Object rejected WebSocket upgrade', {
      roomId,
      status: sessionResponse.status,
    });
    closeSockets(client, server, 1011, 'upgrade rejected');
    return new Response(sessionResponse.body, {
      status: sessionResponse.status,
      headers: cloneHeaders(sessionResponse.headers),
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

function closeSockets(client: WebSocket, server: WebSocket, code: number, reason: string): void {
  safeClose(server, code, reason, 'DO socket');
  safeClose(client, code, reason, 'client socket');
}

function safeClose(socket: WebSocket, code: number, reason: string, label: string): void {
  try {
    socket.close(code, reason);
  } catch (error) {
    console.error(`WS error closing ${label}`, error);
  }
}

function cloneHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    headers.set(key, value);
  });
  return headers;
}
