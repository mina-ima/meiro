import type { Env } from './index';
import { RoleSchema } from './schema/ws';
import { validateNickname, validateRoomId } from './logic/validate';
import { getRoomStub } from './logic/room-binding';

const upgradeRequiredHeaders = new Headers({
  Connection: 'Upgrade',
  Upgrade: 'websocket',
});

export async function handleWebSocketRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname !== '/ws') {
    return null;
  }

  if (!isWebSocketUpgrade(request)) {
    return new Response('Upgrade Required', {
      status: 426,
      headers: upgradeRequiredHeaders,
    });
  }

  if (request.method !== 'GET') {
    return new Response('Must use GET for WebSocket upgrades', { status: 400 });
  }

  const role = RoleSchema.parse(url.searchParams.get('role'));
  const roomId = validateRoomId(url.searchParams.get('room') ?? '');
  const nick = validateNickname(url.searchParams.get('nick') ?? '');

  console.log('WS fetch /ws', { url: url.toString(), roomId, role, nick });

  const stub = getRoomStub(env, roomId);
  const fetchWithOriginalRequest = stub.fetch as unknown as (input: Request) => Promise<Response>;

  try {
    return await fetchWithOriginalRequest.call(stub, request);
  } catch (error) {
    console.error('WS error during /ws bootstrap', error);
    return new Response('Failed to establish WebSocket session', {
      status: 500,
    });
  }
}

function isWebSocketUpgrade(request: Request): boolean {
  const upgrade = request.headers.get('upgrade');
  return typeof upgrade === 'string' && upgrade.toLowerCase() === 'websocket';
}
