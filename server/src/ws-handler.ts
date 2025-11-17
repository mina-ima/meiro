import type { Env } from './index';
import { RoleSchema } from './schema/ws';
import { validateNickname, validateRoomId } from './logic/validate';
import { getRoomStub } from './logic/room-binding';

type DurableObjectFetch = (
  input: RequestInfo | URL,
  init?: WebSocketRequestInit,
) => Promise<Response>;

type WebSocketRequestInit = RequestInit & {
  webSocket?: WebSocket;
};

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
  const clientSocket = pair[0];
  const serverSocket = pair[1];

  const stub = getRoomStub(env, roomId);

  const connectUrl = new URL('https://do/connect');
  connectUrl.searchParams.set('room', roomId);
  connectUrl.searchParams.set('role', role);
  connectUrl.searchParams.set('nick', nick);

  let sessionResponse: Response;
  try {
    const connectInit: WebSocketRequestInit & { websocket?: WebSocket } = {
      method: 'GET',
      headers: request.headers,
      webSocket: serverSocket,
      websocket: serverSocket,
    };
    console.log('WS delegate /connect', {
      url: connectUrl.toString(),
      hasWebSocket: Boolean(connectInit.webSocket),
    });
    const fetchWithSocket = stub.fetch as unknown as DurableObjectFetch;
    sessionResponse = await fetchWithSocket.call(stub, connectUrl.toString(), connectInit);
  } catch (error) {
    console.error('WS error during /ws bootstrap', error);
    closeSockets(clientSocket, serverSocket, 1011, 'internal error');

    return new Response('Failed to establish WebSocket session', {
      status: 500,
    });
  }

  if (sessionResponse.status !== 101) {
    console.error('Durable Object rejected WebSocket upgrade', {
      roomId,
      status: sessionResponse.status,
    });
    closeSockets(clientSocket, serverSocket, 1011, 'upgrade rejected');
    return new Response(sessionResponse.body, {
      status: sessionResponse.status,
      headers: cloneHeaders(sessionResponse.headers),
    });
  }

  return new Response(null, {
    status: 101,
    webSocket: clientSocket,
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
