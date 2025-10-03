import { createInitialRoomState } from './state';
import type { Role } from './schema/ws';
import { hasLobbyExpired, joinLobby, removeSession, resetLobby } from './logic/lobby';
import type { PlayerSession } from './state';

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
  private readonly socketSessions = new Map<WebSocket, PlayerSession>();
  private lobbyState = createInitialRoomState('');

  constructor(state: DurableObjectState) {
    this.state = state;
    this.roomId = state.id.toString();
    this.lobbyState = createInitialRoomState(this.roomId);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'POST') {
      const payload = (await request.json()) as SessionPayload;
      const { webSocket } = request as WebSocketRequest;
      if (!webSocket) {
        return new Response('WebSocket required', { status: 400 });
      }

      const now = Date.now();

      if (hasLobbyExpired(this.lobbyState, now)) {
        this.expireLobby(now);
        return Response.json({ error: 'ROOM_EXPIRED' }, { status: 410 });
      }

      const joinResult = joinLobby(
        this.lobbyState,
        { nick: payload.nick, role: payload.role },
        now,
        () => this.createSessionId(),
      );

      if (joinResult.kind === 'full') {
        return Response.json({ error: 'ROOM_FULL' }, { status: 409 });
      }

      if (joinResult.kind === 'expired') {
        this.expireLobby(now);
        return Response.json({ error: 'ROOM_EXPIRED' }, { status: 410 });
      }

      webSocket.accept();
      this.registerSocket(webSocket, joinResult.session);
      return Response.json({ ok: true, sessionId: joinResult.session.id });
    }

    return new Response('not found', { status: 404 });
  }

  private registerSocket(socket: WebSocket, session: PlayerSession): void {
    this.clients.add(socket);
    this.socketSessions.set(socket, session);

    socket.addEventListener('message', (event) => {
      socket.send(event.data);
    });

    socket.addEventListener('close', () => {
      this.clients.delete(socket);
      const record = this.socketSessions.get(socket);
      if (record) {
        removeSession(this.lobbyState, record.id, Date.now());
      }
      this.socketSessions.delete(socket);
    });

    socket.send(
      JSON.stringify({
        type: 'STATE',
        payload: { roomId: this.roomId, nick: session.nick, role: session.role },
      }),
    );
  }

  private expireLobby(now: number): void {
    for (const socket of this.clients) {
      socket.close(4000, 'ROOM_EXPIRED');
    }
    this.clients.clear();
    this.socketSessions.clear();
    resetLobby(this.lobbyState, now);
  }

  private createSessionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `${this.roomId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
