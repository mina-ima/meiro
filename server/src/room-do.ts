import { createInitialRoomState } from './state';
import type { Role } from './schema/ws';

interface SessionPayload {
  roomId: string;
  nick: string;
  role: Role;
}

interface WebSocketRequest extends Request {
  webSocket?: WebSocket;
}

export class RoomDurableObject {
  private readonly state: DurableObjectState;
  private readonly roomId: string;
  private readonly clients = new Set<WebSocket>();

  constructor(state: DurableObjectState) {
    this.state = state;
    this.roomId = state.id.toString();
    this.state.storage.put('meta', createInitialRoomState(this.roomId));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      this.registerSocket(server, 'upgrade');
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === 'POST') {
      const payload = (await request.json()) as SessionPayload;
      const { webSocket } = request as WebSocketRequest;
      if (!webSocket) {
        return new Response('WebSocket required', { status: 400 });
      }

      webSocket.accept();
      this.registerSocket(webSocket, payload.nick);
      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  }

  private registerSocket(socket: WebSocket, nick = 'unknown'): void {
    this.clients.add(socket);

    socket.addEventListener('message', (event) => {
      socket.send(event.data);
    });

    socket.addEventListener('close', () => {
      this.clients.delete(socket);
    });

    socket.send(JSON.stringify({ type: 'STATE', payload: { roomId: this.roomId, nick } }));
  }
}
