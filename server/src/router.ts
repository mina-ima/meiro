import type { Env } from './index';
import { validateRoomId } from './logic/validate';
import { getDefaultRoomIdGenerator } from './logic/room-id';
import { getRoomStub } from './logic/room-binding';

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const corsHeaders = createCorsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (url.pathname === '/rooms' && request.method === 'POST') {
    const roomId = getDefaultRoomIdGenerator().generate();
    return Response.json(
      { roomId },
      {
        headers: corsHeaders,
      },
    );
  }

  const rematchMatch = url.pathname.match(/^\/rooms\/(\w{6})\/rematch$/i);
  if (rematchMatch && request.method === 'POST') {
    const roomId = validateRoomId(rematchMatch[1]);
    const stub = getRoomStub(env, roomId);
    return (
      stub.fetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    )('https://internal/rematch', {
      method: 'POST',
    });
  }

  return new Response('not found', { status: 404, headers: corsHeaders });
}

function createCorsHeaders(request: Request): Headers {
  const origin = request.headers.get('Origin');
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  });

  const allowedOrigin = resolveAllowedOrigin(origin);
  headers.set('Access-Control-Allow-Origin', allowedOrigin);

  if (allowedOrigin !== '*') {
    headers.set('Vary', 'Origin');
  }

  return headers;
}

function resolveAllowedOrigin(origin: string | null): string {
  if (!origin) {
    return '*';
  }

  try {
    const { protocol } = new URL(origin);
    if (protocol === 'http:' || protocol === 'https:') {
      return origin;
    }
  } catch {
    // fall through
  }

  return '*';
}
