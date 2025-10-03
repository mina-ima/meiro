import { createInitialRoomState } from './state';
import type { Role } from './schema/ws';
import { hasLobbyExpired, joinLobby, removeSession, resetLobby } from './logic/lobby';
import { maybeStartCountdown, progressPhase, resetForRematch } from './logic/phases';
import { MessageValidationError, processClientMessage } from './logic/messages';
import type { PlayerSession, RoomState } from './state';

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
  private roomState: RoomState;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.roomId = state.id.toString();
    this.roomState = createInitialRoomState(this.roomId);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/rematch' && request.method === 'POST') {
      const now = Date.now();
      if (!resetForRematch(this.roomState, now)) {
        return Response.json({ error: 'REMATCH_UNAVAILABLE' }, { status: 409 });
      }

      for (const [socket, session] of this.socketSessions.entries()) {
        const updated = this.roomState.sessions.get(session.id);
        if (!updated) {
          continue;
        }
        this.socketSessions.set(socket, updated);
        try {
          socket.send(
            JSON.stringify({
              type: 'EV',
              event: 'REMATCH_READY',
              payload: { role: updated.role },
            }),
          );
        } catch (error) {
          console.warn('failed to notify rematch', error);
        }
      }

      if (maybeStartCountdown(this.roomState, now)) {
        await this.schedulePhaseAlarm();
      }

      return Response.json({ ok: true });
    }

    if (url.pathname === '/session' && request.method === 'POST') {
      const payload = (await request.json()) as SessionPayload;
      const { webSocket } = request as WebSocketRequest;
      if (!webSocket) {
        return new Response('WebSocket required', { status: 400 });
      }

      const now = Date.now();

      if (hasLobbyExpired(this.roomState, now)) {
        this.expireLobby(now);
        return Response.json({ error: 'ROOM_EXPIRED' }, { status: 410 });
      }

      const joinResult = joinLobby(
        this.roomState,
        { nick: payload.nick, role: payload.role },
        now,
        () => this.createSessionId(),
      );

      if (joinResult.kind === 'full') {
        return Response.json({ error: 'ROOM_FULL' }, { status: 409 });
      }

      if (joinResult.kind === 'role_taken') {
        return Response.json({ error: 'ROLE_TAKEN' }, { status: 409 });
      }

      if (joinResult.kind === 'expired') {
        this.expireLobby(now);
        return Response.json({ error: 'ROOM_EXPIRED' }, { status: 410 });
      }

      webSocket.accept();
      this.registerSocket(webSocket, joinResult.session);
      if (maybeStartCountdown(this.roomState, now)) {
        console.log('room %s countdown started', this.roomId);
        await this.schedulePhaseAlarm();
      }
      return Response.json({ ok: true, sessionId: joinResult.session.id });
    }

    return new Response('not found', { status: 404 });
  }

  private registerSocket(socket: WebSocket, session: PlayerSession): void {
    this.clients.add(socket);
    this.socketSessions.set(socket, session);

    socket.addEventListener('message', (event) => {
      const raw = deserialize(event.data);
      const currentSession = this.roomState.sessions.get(session.id) ?? session;

      try {
        const message = processClientMessage(this.roomState, currentSession, raw);

        if (message.type === 'PING') {
          socket.send(JSON.stringify({ type: 'PONG', ts: message.ts }));
        }
      } catch (error) {
        if (error instanceof MessageValidationError) {
          socket.send(
            JSON.stringify({
              type: 'ERR',
              code: 'INVALID_MESSAGE',
              message: error.message,
            }),
          );
          return;
        }

        console.error('room %s unexpected error handling message', this.roomId, error);
        socket.send(
          JSON.stringify({
            type: 'ERR',
            code: 'INTERNAL_ERROR',
            message: 'Internal error',
          }),
        );
      }
    });

    socket.addEventListener('close', () => {
      this.clients.delete(socket);
      const record = this.socketSessions.get(socket);
      if (record) {
        removeSession(this.roomState, record.id, Date.now());
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
    resetLobby(this.roomState, now);
  }

  private createSessionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `${this.roomId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async alarm(alarmTime: number): Promise<void> {
    const now = alarmTime;
    progressPhase(this.roomState, now);
    console.log('room %s phase -> %s', this.roomId, this.roomState.phase);
    await this.schedulePhaseAlarm();
  }

  private async schedulePhaseAlarm(): Promise<void> {
    if (!this.roomState.phaseEndsAt) {
      return;
    }

    await this.state.storage.setAlarm(new Date(this.roomState.phaseEndsAt));
  }
}

function deserialize(data: unknown): unknown {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch (error) {
      throw new MessageValidationError(`invalid JSON payload: ${(error as Error).message}`);
    }
  }

  return data;
}
