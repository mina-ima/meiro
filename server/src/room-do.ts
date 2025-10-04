import {
  SERVER_TICK_INTERVAL_MS,
  SERVER_TICK_INTERVAL_S,
  integrate,
  type PhysicsEnvironment,
  type PhysicsState,
} from '@meiro/common';
import { createInitialRoomState } from './state';
import type { Role } from './schema/ws';
import { hasLobbyExpired, joinLobby, removeSession, resetLobby } from './logic/lobby';
import { maybeStartCountdown, progressPhase, resetForRematch } from './logic/phases';
import { MessageValidationError, processClientMessage, createServerEvents } from './logic/messages';
import { ClientConnection, MessageSizeExceededError } from './logic/outbound';
import { StateComposer } from './logic/state-sync';
import type { PlayerInputState, PlayerSession, RoomState } from './state';
import type { ClientMessage, ServerMessage } from './schema/ws';

interface SessionPayload {
  roomId: string;
  nick: string;
  role: Role;
}

interface PublishStateOptions {
  forceFull?: boolean;
  immediate?: WebSocket | WebSocket[] | Set<WebSocket>;
}

interface WebSocketRequest extends Request {
  webSocket?: WebSocket;
}

type PlayerInputMessage = Extract<ClientMessage, { type: 'P_INPUT' }>;
type OwnerEditMessage = Extract<ClientMessage, { type: 'O_EDIT' }>;

const EDIT_COOLDOWN_MS = 1_000;
const FORBIDDEN_MANHATTAN_DISTANCE = 2;

export class RoomDurableObject {
  private readonly state: DurableObjectState;
  private readonly roomId: string;
  private readonly clients = new Set<WebSocket>();
  private readonly connections = new Map<WebSocket, ClientConnection>();
  private readonly socketSessions = new Map<WebSocket, PlayerSession>();
  private readonly stateComposer = new StateComposer();
  private roomState: RoomState;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.roomId = state.id.toString();
    this.roomState = createInitialRoomState(this.roomId);
    this.tickTimer = setInterval(() => {
      this.handleTick();
    }, SERVER_TICK_INTERVAL_MS);
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
        const connection = this.connections.get(socket);
        if (!connection) {
          continue;
        }
        try {
          connection.enqueue({
            type: 'EV',
            event: 'REMATCH_READY',
            payload: { role: updated.role },
          });
        } catch (error) {
          if (error instanceof MessageSizeExceededError) {
            console.warn('rematch notification too large for room %s', this.roomId);
          } else {
            console.warn('failed to notify rematch for room %s', this.roomId, error);
          }
        }
      }

      if (maybeStartCountdown(this.roomState, now)) {
        await this.schedulePhaseAlarm();
        this.publishState({ forceFull: true });
      }

      this.publishState({ forceFull: true });
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
        this.publishState({ forceFull: true });
      }
      return Response.json({ ok: true, sessionId: joinResult.session.id });
    }

    return new Response('not found', { status: 404 });
  }

  private registerSocket(socket: WebSocket, session: PlayerSession): void {
    this.clients.add(socket);
    const connection = new ClientConnection(socket, () => Date.now());
    this.connections.set(socket, connection);
    this.socketSessions.set(socket, session);

    socket.addEventListener('message', (event) => {
      const raw = deserialize(event.data);
      const currentSession = this.roomState.sessions.get(session.id) ?? session;

      try {
        const message = processClientMessage(this.roomState, currentSession, raw);
        const now = Date.now();

        if (message.type === 'PING') {
          socket.send(JSON.stringify({ type: 'PONG', ts: message.ts }));
          return;
        }

        if (message.type === 'O_EDIT') {
          const accepted = this.handleOwnerEdit(message, socket, now);
          if (!accepted) {
            return;
          }
        }

        this.roomState.updatedAt = now;

        const events = createServerEvents(currentSession, message);
        if (events.length > 0) {
          for (const eventMessage of events) {
            this.broadcast(eventMessage);
          }
        }

        switch (message.type) {
          case 'P_INPUT':
            this.handlePlayerInput(message, now);
            break;
          case 'O_EDIT':
          case 'O_CONFIRM':
            this.publishState({ forceFull: true });
            break;
          case 'O_MRK':
          case 'O_CANCEL':
            this.publishState({ forceFull: false });
            break;
          default:
            break;
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

      const tracked = this.connections.get(socket);
      if (tracked) {
        tracked.dispose();
      }
      this.connections.delete(socket);

      this.publishState({ forceFull: true });
    });

    this.publishState({ forceFull: true, immediate: socket });
  }

  private expireLobby(now: number): void {
    for (const socket of this.clients) {
      socket.close(4000, 'ROOM_EXPIRED');
      const connection = this.connections.get(socket);
      connection?.dispose();
    }
    this.clients.clear();
    this.connections.clear();
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
    this.publishState({ forceFull: true });
  }

  private async schedulePhaseAlarm(): Promise<void> {
    if (!this.roomState.phaseEndsAt) {
      return;
    }

    await this.state.storage.setAlarm(new Date(this.roomState.phaseEndsAt));
  }

  private broadcast(message: ServerMessage): void {
    for (const connection of this.connections.values()) {
      try {
        connection.enqueue(message);
      } catch (error) {
        if (error instanceof MessageSizeExceededError) {
          console.error('room %s broadcast message too large', this.roomId);
        } else {
          console.error('room %s failed to queue message', this.roomId, error);
        }
      }
    }
  }

  private publishState(options: PublishStateOptions = {}): void {
    const message = this.stateComposer.compose(this.roomState, {
      forceFull: options.forceFull,
    });

    if (!message) {
      return;
    }

    const immediateSockets = options.immediate ? toSocketSet(options.immediate) : null;

    for (const [socket, connection] of this.connections.entries()) {
      const sender = immediateSockets?.has(socket)
        ? connection.sendImmediate.bind(connection)
        : connection.enqueue.bind(connection);

      try {
        sender(message);
      } catch (error) {
        if (error instanceof MessageSizeExceededError) {
          console.error('room %s state message too large', this.roomId);
        } else {
          console.error('room %s failed to send state message', this.roomId, error);
        }
      }
    }
  }

  private handlePlayerInput(message: PlayerInputMessage, receivedAt: number): void {
    this.roomState.player.input = {
      forward: clampInput(message.forward),
      turn: clampInput(message.yaw),
      clientTimestamp: message.timestamp,
      receivedAt,
    } satisfies PlayerInputState;
  }

  private handleOwnerEdit(message: OwnerEditMessage, socket: WebSocket, now: number): boolean {
    const { owner } = this.roomState;

    if (now < owner.editCooldownUntil) {
      this.sendError(socket, 'EDIT_COOLDOWN', 'Edit action is on cooldown.');
      return false;
    }

    const targetCell = message.edit.cell;
    if (isEditInForbiddenArea(targetCell, this.roomState.player.physics.position)) {
      this.sendError(
        socket,
        'EDIT_FORBIDDEN',
        'Cell is within the forbidden distance from player.',
      );
      return false;
    }

    switch (message.edit.action) {
      case 'ADD_WALL': {
        if (owner.wallStock <= 0) {
          this.sendError(socket, 'WALL_STOCK_EMPTY', 'No wall stock remaining.');
          return false;
        }
        owner.wallStock -= 1;
        owner.editCooldownUntil = now + EDIT_COOLDOWN_MS;
        return true;
      }
      case 'DEL_WALL': {
        if (owner.wallRemoveLeft === 0) {
          this.sendError(
            socket,
            'WALL_REMOVE_EXHAUSTED',
            'Owner has already used the wall removal ability.',
          );
          return false;
        }
        owner.wallRemoveLeft = 0;
        owner.wallStock += 1;
        owner.editCooldownUntil = now + EDIT_COOLDOWN_MS;
        return true;
      }
      case 'PLACE_TRAP': {
        if (owner.trapCharges <= 0) {
          this.sendError(socket, 'TRAP_CHARGE_EMPTY', 'No trap charges remaining.');
          return false;
        }
        if (
          !isTrapPlacementCellValid(targetCell, this.roomState.mazeSize, this.roomState.solidCells)
        ) {
          this.sendError(socket, 'TRAP_INVALID_CELL', 'Trap must be placed on a walkable cell.');
          return false;
        }
        owner.trapCharges -= 1;
        owner.editCooldownUntil = now + EDIT_COOLDOWN_MS;
        return true;
      }
      default:
        return true;
    }
  }

  private handleTick(): void {
    if (this.roomState.phase !== 'explore' || !this.hasPlayerSession()) {
      return;
    }

    const current = this.roomState.player.physics;
    const input = this.roomState.player.input;
    const environment = this.createPhysicsEnvironment();

    const next = integrate(current, input, { deltaTime: SERVER_TICK_INTERVAL_S }, environment);
    const changed = physicsStateChanged(current, next);

    this.roomState.player.physics = next;

    if (!changed) {
      return;
    }

    this.roomState.updatedAt = Date.now();
    this.publishState({ forceFull: false });
  }

  private hasPlayerSession(): boolean {
    for (const session of this.roomState.sessions.values()) {
      if (session.role === 'player') {
        return true;
      }
    }
    return false;
  }

  private createPhysicsEnvironment(): PhysicsEnvironment {
    const solids = this.roomState.solidCells;
    return {
      isSolid(tileX: number, tileY: number): boolean {
        return solids.has(solidKey(tileX, tileY));
      },
    };
  }

  public dispose(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    socket.send(
      JSON.stringify({
        type: 'ERR',
        code,
        message,
      }),
    );
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

function toSocketSet(source: PublishStateOptions['immediate']): Set<WebSocket> {
  if (!source) {
    return new Set();
  }

  if (source instanceof Set) {
    return source;
  }

  if (Array.isArray(source)) {
    return new Set(source);
  }

  return new Set([source]);
}

const INPUT_MIN = -1;
const INPUT_MAX = 1;
const FLOAT_EPSILON = 1e-4;

function clampInput(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < INPUT_MIN) {
    return INPUT_MIN;
  }
  if (value > INPUT_MAX) {
    return INPUT_MAX;
  }
  return value;
}

function physicsStateChanged(a: PhysicsState, b: PhysicsState): boolean {
  return (
    differs(a.position.x, b.position.x) ||
    differs(a.position.y, b.position.y) ||
    differs(a.angle, b.angle) ||
    differs(a.velocity.x, b.velocity.x) ||
    differs(a.velocity.y, b.velocity.y)
  );
}

function differs(a: number, b: number, epsilon = FLOAT_EPSILON): boolean {
  return Math.abs(a - b) > epsilon;
}

function solidKey(x: number, y: number): string {
  return `${x},${y}`;
}

function isTrapPlacementCellValid(
  cell: { x: number; y: number },
  mazeSize: number,
  solidCells: Set<string>,
): boolean {
  if (cell.x < 0 || cell.y < 0 || cell.x >= mazeSize || cell.y >= mazeSize) {
    return false;
  }

  return !solidCells.has(solidKey(cell.x, cell.y));
}

function isEditInForbiddenArea(
  cell: { x: number; y: number },
  playerPosition: { x: number; y: number },
): boolean {
  const playerCellX = Math.round(playerPosition.x);
  const playerCellY = Math.round(playerPosition.y);
  const distance = Math.abs(cell.x - playerCellX) + Math.abs(cell.y - playerCellY);
  return distance <= FORBIDDEN_MANHATTAN_DISTANCE;
}
