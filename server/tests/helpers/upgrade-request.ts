export interface WebSocketUpgradeParams {
  roomId: string;
  role: 'owner' | 'player';
  nick: string;
  pathname?: string;
}

export function createWebSocketUpgradeRequest(params: WebSocketUpgradeParams): Request {
  const url = new URL(`https://example${params.pathname ?? '/ws'}`);
  url.searchParams.set('room', params.roomId);
  url.searchParams.set('role', params.role);
  url.searchParams.set('nick', params.nick);

  return new Request(url, {
    method: 'GET',
    headers: {
      Upgrade: 'websocket',
    },
  });
}

export function attachWebSocket(request: Request, socket: unknown): void {
  (request as Request & { webSocket?: unknown }).webSocket = socket;
}
