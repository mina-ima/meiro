import {
  MOVE_SPEED,
  PLAYER_RADIUS,
  SERVER_TICK_INTERVAL_MS,
  SERVER_TICK_INTERVAL_S,
  integrate,
  type PhysicsEnvironment,
  type PhysicsInput,
  type PhysicsState,
  type Vector2,
} from '@meiro/common';
import { createInitialRoomState } from './state';
import type { Role } from './schema/ws';
import { hasLobbyExpired, joinLobby, removeSession, resetLobby } from './logic/lobby';
import { maybeStartCountdown, progressPhase, resetForRematch } from './logic/phases';
import { MessageValidationError, processClientMessage, createServerEvents } from './logic/messages';
import { ClientConnection, MessageSizeExceededError } from './logic/outbound';
import { RoomMetrics } from './logic/metrics';
import { StateComposer } from './logic/state-sync';
import { apply as applyTrapEffect, MAX_ACTIVE_TRAPS, TRAP_SPEED_MULTIPLIER } from './logic/trap';
import type { PlayerInputState, PlayerSession, RoomState } from './state';
import type { ClientMessage, ServerMessage } from './schema/ws';
import { OWNER_EDIT_COOLDOWN_MS, OWNER_FORBIDDEN_DISTANCE } from './config/spec';

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
type OwnerMarkMessage = Extract<ClientMessage, { type: 'O_MRK' }>;

interface PathCheckCacheSeed {
  mazeSize: number;
  startKey: string;
  goalKey: string;
  visited: Set<string>;
}

interface PathCheckCache extends PathCheckCacheSeed {
  revision: number;
}

const PREDICTION_WALL_RATE = 0.7;
const PREDICTION_BONUS_BATCH_SIZE = 10;
const PREDICTION_BONUS_WALLS = Math.round(PREDICTION_BONUS_BATCH_SIZE * PREDICTION_WALL_RATE);
const PREDICTION_BONUS_TRAPS = PREDICTION_BONUS_BATCH_SIZE - PREDICTION_BONUS_WALLS;
const POINT_PLACEMENT_WINDOW_MS = 40_000;
const PREP_TOTAL_DURATION_MS = 60_000;
const TRAP_STAGE_DURATION_MS = 5_000;
const TRAP_STAGE_START_MS = POINT_PLACEMENT_WINDOW_MS;
const TRAP_STAGE_END_MS = TRAP_STAGE_START_MS + TRAP_STAGE_DURATION_MS;
const PREDICTION_STAGE_DURATION_MS =
  PREP_TOTAL_DURATION_MS - POINT_PLACEMENT_WINDOW_MS - TRAP_STAGE_DURATION_MS;
const PREDICTION_STAGE_START_MS = TRAP_STAGE_END_MS;
const PREDICTION_STAGE_END_MS = PREDICTION_STAGE_START_MS + PREDICTION_STAGE_DURATION_MS;
const POINT_REQUIRED_RATE = 0.65;
const POINT_COUNT_LIMITS: Record<20 | 40, number> = { 20: 12, 40: 18 };
const POINT_TOTAL_MINIMUMS: Record<20 | 40, number> = { 20: 40, 40: 60 };
const GOAL_BONUS_DIVISOR = 5;
const ALLOWED_POINT_VALUES = new Set<1 | 3 | 5>([1, 3, 5]);
const DISCONNECT_TIMEOUT_MS = 60_000;
const SESSION_HEARTBEAT_TIMEOUT_MS = 15_000;
const INPUT_RATE_INTERVAL_MS = 1_000;
const MAX_INPUTS_PER_INTERVAL = 30;
const MAX_PAST_INPUT_MS = 500;
const MAX_FUTURE_INPUT_MS = 150;
const MAX_POSITION_DELTA_PER_SECOND = MOVE_SPEED * 1.25;
const MAX_VELOCITY = MOVE_SPEED * 1.25;
const MAX_TICK_DELTA_S = SERVER_TICK_INTERVAL_S * 10;

export class RoomDurableObject {
  private readonly state: DurableObjectState;
  private readonly roomId: string;
  private readonly clients = new Set<WebSocket>();
  private readonly connections = new Map<WebSocket, ClientConnection>();
  private readonly socketSessions = new Map<WebSocket, PlayerSession>();
  private readonly stateComposer = new StateComposer();
  private readonly metrics: RoomMetrics;
  private roomState: RoomState;
  private solidRevision = 0;
  private pathCheckCache: PathCheckCache | null = null;
  private readonly pathBlockCache = new Map<string, number>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt: number;
  private readonly heartbeatTimeoutSockets = new Set<WebSocket>();

  constructor(state: DurableObjectState) {
    this.state = state;
    this.roomId = state.id.toString();
    this.roomState = createInitialRoomState(this.roomId);
    this.tickTimer = setInterval(() => {
      this.handleTick();
    }, SERVER_TICK_INTERVAL_MS);
    this.metrics = new RoomMetrics(this.roomId);
    this.metrics.logRoomCreated(this.roomState.mazeSize);
    this.lastTickAt = Date.now();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/rematch' && request.method === 'POST') {
      const now = Date.now();
      if (!resetForRematch(this.roomState, now)) {
        return Response.json({ error: 'REMATCH_UNAVAILABLE' }, { status: 409 });
      }

      this.resetPathCachesAfterMazeChange();

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
    const connection = new ClientConnection(
      socket,
      () => Date.now(),
      (error) => {
        this.metrics.logSocketError('send-failed');
        console.error('failed to send message', error);
      },
      (info) => {
        this.metrics.logStateMessage(info.bytes, info.immediate, info.queueDepth);
        if (info.latencyMs != null) {
          this.metrics.logStateLatency(info.latencyMs);
        }
      },
    );
    this.connections.set(socket, connection);
    this.socketSessions.set(socket, session);
    session.lastSeenAt = Date.now();
    this.metrics.logSessionJoin(session.role);

    socket.addEventListener('message', (event) => {
      const raw = deserialize(event.data);
      const currentSession = this.roomState.sessions.get(session.id) ?? session;

      try {
        const now = Date.now();
        currentSession.lastSeenAt = now;
        this.socketSessions.set(socket, currentSession);
        this.roomState.sessions.set(currentSession.id, currentSession);
        this.heartbeatTimeoutSockets.delete(socket);

        const message = processClientMessage(this.roomState, currentSession, raw);

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

        if (message.type === 'O_MRK') {
          const accepted = this.handleOwnerMark(message, socket, now);
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
            this.handlePlayerInput(message, socket, now);
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
      this.heartbeatTimeoutSockets.delete(socket);
      this.clients.delete(socket);
      const record = this.socketSessions.get(socket);
      if (record) {
        const now = Date.now();
        removeSession(this.roomState, record.id, now);
        this.handleSessionDisconnected(record, now);
        this.metrics.logSessionLeave(record.role);
      }
      this.socketSessions.delete(socket);

      const tracked = this.connections.get(socket);
      if (tracked) {
        tracked.dispose();
      }
      this.connections.delete(socket);

      this.publishState({ forceFull: true });
    });

    const now = Date.now();
    this.resumeFromPause(now);
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
    this.resetPathCachesAfterMazeChange();
  }

  private createSessionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `${this.roomId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async alarm(alarmTime: number): Promise<void> {
    const now = alarmTime;
    const previousPhase = this.roomState.phase;
    const previousPhaseStartedAt = this.roomState.phaseStartedAt;
    progressPhase(this.roomState, now);
    const currentPhase = this.roomState.phase;
    if (currentPhase !== previousPhase) {
      const duration = previousPhaseStartedAt ? now - previousPhaseStartedAt : 0;
      this.handlePhaseTransition(previousPhase, currentPhase, now, duration);
    }
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

  private handlePhaseTransition(
    previous: RoomState['phase'],
    current: RoomState['phase'],
    now: number,
    previousDuration: number,
  ): void {
    if (previous !== current) {
      this.metrics.logPhaseTransition(previous, current, Math.max(previousDuration, 0));
    }
    if (previous === 'prep' && current === 'explore') {
      this.finalizePointConfiguration(now);
    }
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

    const updatedAt = extractUpdatedAt(message);
    const meta = updatedAt != null ? { updatedAt } : undefined;

    const immediateSockets = options.immediate ? toSocketSet(options.immediate) : null;

    for (const [socket, connection] of this.connections.entries()) {
      const useImmediate = immediateSockets?.has(socket) ?? false;

      try {
        if (useImmediate) {
          connection.sendImmediate(message, meta);
        } else {
          connection.enqueue(message, meta);
        }
      } catch (error) {
        if (error instanceof MessageSizeExceededError) {
          this.metrics.logSocketError('message-too-large');
          console.error('room %s state message too large', this.roomId);
        } else {
          this.metrics.logSocketError('send-failed');
          console.error('room %s failed to send state message', this.roomId, error);
        }
      }
    }
  }

  private handlePlayerInput(
    message: PlayerInputMessage,
    socket: WebSocket,
    receivedAt: number,
  ): void {
    const windowElapsed = receivedAt - this.roomState.player.inputWindowStart;
    if (windowElapsed >= INPUT_RATE_INTERVAL_MS) {
      this.roomState.player.inputWindowStart = receivedAt;
      this.roomState.player.inputCountInWindow = 0;
    }

    if (this.roomState.player.inputCountInWindow >= MAX_INPUTS_PER_INTERVAL) {
      this.metrics.logPlayerInputRejected('rate_limit');
      this.sendError(socket, 'INPUT_RATE_LIMIT', 'Player input rate limit exceeded.');
      return;
    }

    const previousTimestamp = this.roomState.player.input.clientTimestamp;
    const hasAcceptedInput = this.roomState.player.inputSequence > 0;
    if (hasAcceptedInput && message.timestamp < previousTimestamp) {
      this.metrics.logPlayerInputRejected('timestamp_replay');
      this.sendError(
        socket,
        'INPUT_TIMESTAMP_REPLAY',
        'Player input timestamp is older than the last accepted input.',
      );
      return;
    }

    if (message.timestamp < previousTimestamp - MAX_PAST_INPUT_MS) {
      this.metrics.logPlayerInputRejected('timestamp_past');
      this.sendError(socket, 'INPUT_TIMESTAMP_PAST', 'Player input timestamp too old.');
      return;
    }

    let adjustedTimestamp = message.timestamp;
    if (adjustedTimestamp > receivedAt + MAX_FUTURE_INPUT_MS) {
      adjustedTimestamp = receivedAt;
    }

    this.roomState.player.input = {
      forward: clampInput(message.forward),
      turn: clampInput(message.yaw),
      clientTimestamp: adjustedTimestamp,
      receivedAt,
    } satisfies PlayerInputState;

    this.roomState.player.inputSequence += 1;
    this.roomState.player.lastInputReceivedAt = receivedAt;
    this.roomState.player.inputCountInWindow += 1;
  }

  private handleOwnerEdit(message: OwnerEditMessage, socket: WebSocket, now: number): boolean {
    const { owner } = this.roomState;

    if (now < owner.editCooldownUntil) {
      this.metrics.logOwnerEditRejected('EDIT_COOLDOWN');
      const remainingMs = Math.max(0, owner.editCooldownUntil - now);
      this.sendError(socket, 'EDIT_COOLDOWN', 'Edit action is on cooldown.', {
        remainingMs,
      });
      return false;
    }

    const targetCell = message.edit.cell;
    if (
      message.edit.action !== 'PLACE_POINT' &&
      isEditInForbiddenArea(targetCell, this.roomState.player.physics.position)
    ) {
      this.metrics.logOwnerEditRejected('EDIT_FORBIDDEN');
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
          this.metrics.logOwnerEditRejected('WALL_STOCK_EMPTY');
          this.sendError(socket, 'WALL_STOCK_EMPTY', 'No wall stock remaining.');
          return false;
        }
        const mazeSize = this.roomState.mazeSize;
        if (!isWithinMazeBounds(targetCell.x, targetCell.y, mazeSize)) {
          this.metrics.logOwnerEditRejected('DENY_EDIT');
          this.sendError(socket, 'DENY_EDIT', 'Wall cell is outside of the maze bounds.');
          return false;
        }
        const key = solidKey(targetCell.x, targetCell.y);
        if (this.roomState.solidCells.has(key)) {
          this.metrics.logOwnerEditRejected('DENY_EDIT');
          this.sendError(socket, 'DENY_EDIT', 'Wall already exists at the specified cell.');
          return false;
        }
        const placement = this.checkWallPlacement(targetCell);
        if (placement.blocked) {
          this.metrics.logOwnerEditRejected('NO_PATH');
          this.sendError(socket, 'NO_PATH', 'Edit would block the player from reaching the goal.');
          return false;
        }
        this.applyWallAddition(key, placement.cacheSeed ?? null);
        owner.wallStock -= 1;
        owner.editCooldownUntil = now + OWNER_EDIT_COOLDOWN_MS;
        return true;
      }
      case 'DEL_WALL': {
        if (owner.wallRemoveLeft === 0) {
          this.metrics.logOwnerEditRejected('WALL_REMOVE_EXHAUSTED');
          this.sendError(
            socket,
            'WALL_REMOVE_EXHAUSTED',
            'Owner has already used the wall removal ability.',
          );
          return false;
        }

        const mazeSize = this.roomState.mazeSize;
        if (!isWithinMazeBounds(targetCell.x, targetCell.y, mazeSize)) {
          this.metrics.logOwnerEditRejected('DENY_EDIT');
          this.sendError(socket, 'DENY_EDIT', 'Wall cell is outside of the maze bounds.');
          return false;
        }

        const key = solidKey(targetCell.x, targetCell.y);
        if (!this.roomState.solidCells.has(key)) {
          this.metrics.logOwnerEditRejected('DENY_EDIT');
          this.sendError(socket, 'DENY_EDIT', 'No wall exists at the specified cell.');
          return false;
        }

        this.applyWallRemoval(key);
        owner.wallRemoveLeft = 0;
        owner.wallStock += 1;
        owner.editCooldownUntil = now + OWNER_EDIT_COOLDOWN_MS;
        return true;
      }
      case 'PLACE_TRAP': {
        const trapWindow = this.evaluateTrapWindow(now);
        if (trapWindow === 'locked') {
          this.metrics.logOwnerEditRejected('TRAP_PHASE_LOCKED');
          this.sendError(socket, 'TRAP_PHASE_LOCKED', 'Trap placement window has not opened yet.');
          return false;
        }
        if (trapWindow === 'closed') {
          this.metrics.logOwnerEditRejected('TRAP_PHASE_CLOSED');
          this.sendError(socket, 'TRAP_PHASE_CLOSED', 'Trap placement window has closed.');
          return false;
        }

        if (owner.trapCharges <= 0) {
          this.metrics.logOwnerEditRejected('TRAP_CHARGE_EMPTY');
          this.sendError(socket, 'TRAP_CHARGE_EMPTY', 'No trap charges remaining.');
          return false;
        }

        if (owner.traps.length >= MAX_ACTIVE_TRAPS) {
          this.metrics.logOwnerEditRejected('LIMIT_REACHED');
          this.sendError(socket, 'LIMIT_REACHED', 'Trap limit reached.');
          return false;
        }

        if (
          !isTrapPlacementCellValid(targetCell, this.roomState.mazeSize, this.roomState.solidCells)
        ) {
          this.metrics.logOwnerEditRejected('TRAP_INVALID_CELL');
          this.sendError(socket, 'TRAP_INVALID_CELL', 'Trap must be placed on a walkable cell.');
          return false;
        }

        if (this.roomState.points.has(pointKey(targetCell))) {
          this.metrics.logOwnerEditRejected('DENY_EDIT');
          this.sendError(socket, 'DENY_EDIT', 'Cannot overlap trap with a point.');
          return false;
        }

        if (
          owner.traps.some((trap) => trap.cell.x === targetCell.x && trap.cell.y === targetCell.y)
        ) {
          this.metrics.logOwnerEditRejected('DENY_EDIT');
          this.sendError(socket, 'DENY_EDIT', 'Trap already exists at the specified cell.');
          return false;
        }

        owner.trapCharges -= 1;
        owner.traps.push({
          cell: { x: targetCell.x, y: targetCell.y },
          placedAt: now,
        });
        owner.editCooldownUntil = now + OWNER_EDIT_COOLDOWN_MS;
        return true;
      }
      case 'PLACE_POINT': {
        if (!this.canPlacePoint(now)) {
          this.metrics.logOwnerEditRejected('POINT_PHASE_CLOSED');
          this.sendError(socket, 'POINT_PHASE_CLOSED', 'Point placement window has closed.');
          return false;
        }

        const value = message.edit.value;
        if (!ALLOWED_POINT_VALUES.has(value)) {
          this.metrics.logOwnerEditRejected('POINT_VALUE_INVALID');
          this.sendError(socket, 'POINT_VALUE_INVALID', 'Invalid point value.');
          return false;
        }

        if (
          !isTrapPlacementCellValid(targetCell, this.roomState.mazeSize, this.roomState.solidCells)
        ) {
          this.metrics.logOwnerEditRejected('POINT_INVALID_CELL');
          this.sendError(socket, 'POINT_INVALID_CELL', 'Point must be placed on a walkable cell.');
          return false;
        }

        const limit = POINT_COUNT_LIMITS[this.roomState.mazeSize];
        if (this.roomState.points.size >= limit) {
          this.metrics.logOwnerEditRejected('LIMIT_REACHED');
          this.sendError(socket, 'LIMIT_REACHED', 'Point limit reached.');
          return false;
        }

        const key = pointKey(targetCell);
        if (this.roomState.points.has(key)) {
          this.metrics.logOwnerEditRejected('DENY_EDIT');
          this.sendError(socket, 'DENY_EDIT', 'Point already exists at the specified cell.');
          return false;
        }

        if (
          owner.traps.some((trap) => trap.cell.x === targetCell.x && trap.cell.y === targetCell.y)
        ) {
          this.metrics.logOwnerEditRejected('DENY_EDIT');
          this.sendError(socket, 'DENY_EDIT', 'Cannot overlap point with a trap.');
          return false;
        }

        this.roomState.points.set(key, {
          cell: { x: targetCell.x, y: targetCell.y },
          value,
        });
        this.roomState.pointTotalValue += value;
        if (!this.roomState.targetScoreLocked) {
          this.recalculateTargetScore();
        }
        owner.editCooldownUntil = now + OWNER_EDIT_COOLDOWN_MS;
        return true;
      }
      default:
        return true;
    }
  }

  private checkWallPlacement(cell: { x: number; y: number }): {
    blocked: boolean;
    cacheSeed?: PathCheckCacheSeed;
  } {
    const goal = this.roomState.goalCell;
    if (!goal) {
      this.metrics.logOwnerPathCheck(0, false, false);
      return { blocked: false };
    }

    const mazeSize = this.roomState.mazeSize;
    if (!isWithinMazeBounds(cell.x, cell.y, mazeSize)) {
      this.metrics.logOwnerPathCheck(0, false, false);
      return { blocked: false };
    }

    const start = {
      x: Math.floor(this.roomState.player.physics.position.x),
      y: Math.floor(this.roomState.player.physics.position.y),
    };

    if (!isWithinMazeBounds(start.x, start.y, mazeSize)) {
      this.metrics.logOwnerPathCheck(0, false, false);
      return { blocked: false };
    }

    const startKey = solidKey(start.x, start.y);
    const goalKey = solidKey(goal.x, goal.y);
    const cellKey = solidKey(cell.x, cell.y);

    const blockKey = this.makeBlockCacheKey(mazeSize, startKey, goalKey, cellKey);
    const cachedBlockRevision = this.pathBlockCache.get(blockKey);
    if (cachedBlockRevision === this.solidRevision) {
      this.metrics.logOwnerPathCheck(0, true, false);
      return { blocked: true };
    }

    const cache = this.getPathCheckCache(mazeSize, startKey, goalKey);
    if (cache && !cache.visited.has(cellKey)) {
      this.metrics.logOwnerPathCheck(0, false, false);
      return {
        blocked: false,
        cacheSeed: {
          mazeSize,
          startKey,
          goalKey,
          visited: cache.visited,
        },
      };
    }

    const blockedCells = new Set(this.roomState.solidCells);
    blockedCells.add(cellKey);

    const startedAt = Date.now();
    const result = evaluateAccessiblePath(mazeSize, blockedCells, start, goal);
    const durationMs = Math.max(0, Date.now() - startedAt);
    this.metrics.logOwnerPathCheck(durationMs, !result.reachable, true);

    if (!result.reachable) {
      this.pathBlockCache.set(blockKey, this.solidRevision);
      return { blocked: true };
    }

    return {
      blocked: false,
      cacheSeed: {
        mazeSize,
        startKey,
        goalKey,
        visited: result.visited,
      },
    };
  }

  private getPathCheckCache(
    mazeSize: number,
    startKey: string,
    goalKey: string,
  ): PathCheckCache | null {
    const cache = this.pathCheckCache;
    if (!cache) {
      return null;
    }
    if (cache.revision !== this.solidRevision) {
      return null;
    }
    if (cache.mazeSize !== mazeSize) {
      return null;
    }
    if (cache.startKey !== startKey || cache.goalKey !== goalKey) {
      return null;
    }
    return cache;
  }

  private makeBlockCacheKey(
    mazeSize: number,
    startKey: string,
    goalKey: string,
    cellKey: string,
  ): string {
    return `${mazeSize}|${startKey}|${goalKey}|${cellKey}`;
  }

  private applyWallAddition(key: string, cacheSeed: PathCheckCacheSeed | null): void {
    this.roomState.solidCells.add(key);
    this.incrementSolidRevision();
    if (cacheSeed) {
      this.pathCheckCache = {
        ...cacheSeed,
        revision: this.solidRevision,
      };
    } else {
      this.pathCheckCache = null;
    }
  }

  private applyWallRemoval(key: string): void {
    this.roomState.solidCells.delete(key);
    this.incrementSolidRevision();
    this.pathCheckCache = null;
  }

  private resetPathCachesAfterMazeChange(): void {
    this.incrementSolidRevision();
    this.pathCheckCache = null;
  }

  private incrementSolidRevision(): void {
    this.solidRevision += 1;
    this.pathBlockCache.clear();
  }

  private handleOwnerMark(message: OwnerMarkMessage, socket: WebSocket, now: number): boolean {
    const { owner } = this.roomState;
    const key = predictionKey(message.cell);
    const shouldActivate = message.active ?? true;

    if (shouldActivate) {
      const windowState = this.evaluatePredictionWindow(now);
      if (windowState === 'locked') {
        this.sendError(
          socket,
          'PREDICTION_PHASE_LOCKED',
          'Prediction marking is not available yet.',
        );
        return false;
      }
      if (windowState === 'closed') {
        this.sendError(socket, 'PREDICTION_PHASE_CLOSED', 'Prediction marking window has closed.');
        return false;
      }

      if (owner.predictionMarks.has(key)) {
        return true;
      }

      if (owner.predictionMarks.size >= owner.predictionLimit) {
        this.sendError(socket, 'LIMIT_REACHED', 'Prediction mark limit reached.');
        return false;
      }

      owner.predictionMarks.set(key, {
        cell: { x: message.cell.x, y: message.cell.y },
        createdAt: now,
      });
      return true;
    }

    owner.predictionMarks.delete(key);
    return true;
  }

  private handleTick(): void {
    const now = Date.now();
    const deltaMs = Math.max(0, now - this.lastTickAt);
    this.lastTickAt = now;
    const deltaSeconds = Math.min(deltaMs / 1000, MAX_TICK_DELTA_S);

    if (
      this.roomState.phase === 'lobby' &&
      this.roomState.sessions.size > 0 &&
      hasLobbyExpired(this.roomState, now)
    ) {
      this.expireLobby(now);
      this.publishState({ forceFull: true });
      return;
    }
    const heartbeatTriggered = this.checkHeartbeatTimeouts(now);
    const stateChanged = this.checkDisconnectTimeout(now) || heartbeatTriggered;

    if (!this.hasPlayerSession() || this.roomState.paused) {
      if (stateChanged) {
        this.publishState({ forceFull: true });
      }
      return;
    }

    if (this.roomState.phase !== 'explore') {
      if (stateChanged) {
        this.publishState({ forceFull: true });
      }
      return;
    }

    const current = this.roomState.player.physics;
    const input = this.roomState.player.input;
    const environment = this.createPhysicsEnvironment();

    const speedMultiplier = this.roomState.player.trapSlowUntil > now ? TRAP_SPEED_MULTIPLIER : 1;
    const adjustedInput: PhysicsInput = {
      forward: input.forward * speedMultiplier,
      turn: input.turn,
    };

    const stepSeconds = deltaSeconds;
    const rawNext = integrate(current, adjustedInput, { deltaTime: stepSeconds }, environment);
    const maxStepDistance = Math.max(stepSeconds * MAX_POSITION_DELTA_PER_SECOND, FLOAT_EPSILON);
    const sanitized = sanitizePhysicsState(
      current,
      rawNext,
      this.roomState.mazeSize,
      maxStepDistance,
    );
    const next = sanitized.state;

    const rewardApplied = this.processPredictionBonus(next.position);
    const trapTriggered = this.processTrapCollision(next.position, now);
    const pointCollected = this.processPointCollection(next.position, now);
    const goalAchieved = this.processGoalAchievement(next.position, now);
    const changed = physicsStateChanged(current, next);

    this.roomState.player.physics = next;
    if (sanitized.snapped) {
      this.metrics.logPlayerInputRejected('position_snap');
    }

    const phaseAfterUpdate = this.roomState.phase as string;
    const forceFull = stateChanged || phaseAfterUpdate === 'result' || sanitized.snapped;

    if (
      !changed &&
      !rewardApplied &&
      !trapTriggered &&
      !pointCollected &&
      !goalAchieved &&
      !forceFull &&
      !sanitized.snapped
    ) {
      return;
    }

    this.roomState.updatedAt = now;
    this.publishState({ forceFull });
  }

  private processTrapCollision(position: Vector2, now: number): boolean {
    const tileX = Math.floor(position.x);
    const tileY = Math.floor(position.y);
    const index = this.roomState.owner.traps.findIndex(
      (trap) => trap.cell.x === tileX && trap.cell.y === tileY,
    );

    if (index === -1) {
      return false;
    }

    this.roomState.owner.traps.splice(index, 1);

    const { slowUntil } = applyTrapEffect({
      now,
      phaseEndsAt: this.roomState.phaseEndsAt,
      currentSlowUntil: this.roomState.player.trapSlowUntil,
    });
    this.roomState.player.trapSlowUntil = slowUntil;

    return true;
  }

  private processPointCollection(position: Vector2, now: number): boolean {
    if (this.roomState.points.size === 0) {
      return false;
    }

    const tileX = Math.floor(position.x);
    const tileY = Math.floor(position.y);
    const key = pointKey({ x: tileX, y: tileY });
    const point = this.roomState.points.get(key);
    if (!point) {
      return false;
    }

    this.roomState.points.delete(key);
    this.roomState.player.score += point.value;
    this.evaluateScoreCompletion(now);
    return true;
  }

  private processGoalAchievement(position: Vector2, now: number): boolean {
    const goal = this.roomState.goalCell;
    if (!goal || this.roomState.player.goalBonusAwarded) {
      return false;
    }

    const tileX = Math.floor(position.x);
    const tileY = Math.floor(position.y);
    if (tileX !== goal.x || tileY !== goal.y) {
      return false;
    }

    this.roomState.player.goalBonusAwarded = true;
    const bonus = Math.ceil(this.roomState.targetScore / GOAL_BONUS_DIVISOR);
    if (bonus > 0) {
      this.roomState.player.score += bonus;
      this.evaluateScoreCompletion(now);
      return true;
    }

    this.evaluateScoreCompletion(now);
    return true;
  }

  private evaluateScoreCompletion(now: number): void {
    if (this.roomState.phase !== 'explore') {
      return;
    }

    if (!this.roomState.targetScoreLocked) {
      return;
    }

    if (this.roomState.player.score < this.roomState.targetScore) {
      return;
    }

    const previousPhaseStartedAt = this.roomState.phaseStartedAt ?? now;
    this.roomState.phase = 'result';
    this.roomState.phaseEndsAt = undefined;
    this.roomState.phaseStartedAt = now;
    const duration = Math.max(0, now - previousPhaseStartedAt);
    this.metrics.logPhaseTransition('explore', 'result', duration);
    this.broadcast({
      type: 'EV',
      event: 'RESULT',
      at: now,
      payload: {
        reason: 'TARGET_REACHED',
        score: this.roomState.player.score,
        target: this.roomState.targetScore,
      },
    });
  }

  private processPredictionBonus(position: Vector2): boolean {
    const tileX = Math.floor(position.x);
    const tileY = Math.floor(position.y);
    const key = predictionKey({ x: tileX, y: tileY });
    const mark = this.roomState.owner.predictionMarks.get(key);

    if (!mark) {
      return false;
    }

    this.roomState.owner.predictionMarks.delete(key);
    this.roomState.owner.predictionHits += 1;
    this.roomState.player.predictionHits += 1;

    const bonus = this.drawPredictionBonus();
    if (bonus === 'wall') {
      this.roomState.owner.wallStock += 1;
    } else {
      this.roomState.owner.trapCharges += 1;
    }

    return true;
  }

  private drawPredictionBonus(): 'wall' | 'trap' {
    if (this.roomState.owner.predictionBonusDeck.length === 0) {
      this.refillPredictionBonusDeck();
    }
    const deck = this.roomState.owner.predictionBonusDeck;
    const bonus = deck.shift();
    if (!bonus) {
      this.refillPredictionBonusDeck();
      return this.roomState.owner.predictionBonusDeck.shift() ?? 'wall';
    }
    return bonus;
  }

  private refillPredictionBonusDeck(): void {
    const deck: ('wall' | 'trap')[] = [];
    for (let i = 0; i < PREDICTION_BONUS_WALLS; i += 1) {
      deck.push('wall');
    }
    for (let i = 0; i < PREDICTION_BONUS_TRAPS; i += 1) {
      deck.push('trap');
    }

    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }

    this.roomState.owner.predictionBonusDeck = deck;
  }

  private canPlacePoint(now: number): boolean {
    if (this.roomState.phase !== 'prep') {
      return false;
    }

    if (this.roomState.targetScoreLocked) {
      return false;
    }

    const elapsed = this.getPrepElapsed(now);
    return elapsed <= POINT_PLACEMENT_WINDOW_MS;
  }

  private getPrepElapsed(now: number): number {
    const startedAt = this.roomState.phaseStartedAt ?? now;
    return Math.max(0, now - startedAt);
  }

  private evaluateTrapWindow(now: number): 'locked' | 'ok' | 'closed' {
    if (this.roomState.phase !== 'prep') {
      return 'ok';
    }

    const elapsed = this.getPrepElapsed(now);
    if (elapsed < TRAP_STAGE_START_MS) {
      return 'locked';
    }
    if (elapsed >= PREDICTION_STAGE_START_MS) {
      return 'closed';
    }
    return 'ok';
  }

  private evaluatePredictionWindow(now: number): 'locked' | 'ok' | 'closed' {
    if (this.roomState.phase !== 'prep') {
      return 'closed';
    }

    const elapsed = this.getPrepElapsed(now);
    if (elapsed < PREDICTION_STAGE_START_MS) {
      return 'locked';
    }
    if (elapsed >= PREDICTION_STAGE_END_MS) {
      return 'closed';
    }
    return 'ok';
  }

  private recalculateTargetScore(): void {
    const total = this.roomState.pointTotalValue;
    const required = Math.ceil(total * POINT_REQUIRED_RATE);
    this.roomState.targetScore = required;
  }

  private finalizePointConfiguration(now: number): void {
    if (!this.roomState.targetScoreLocked) {
      this.recalculateTargetScore();
      this.roomState.targetScoreLocked = true;
    }

    if (!this.roomState.pointShortageCompensated) {
      const minimum = POINT_TOTAL_MINIMUMS[this.roomState.mazeSize];
      const shortage = Math.max(0, minimum - this.roomState.pointTotalValue);
      let awarded = 0;
      if (shortage > 0) {
        const required = this.roomState.targetScore;
        const bonusCapacity = Math.max(0, required - 1 - this.roomState.player.score);
        const bonus = Math.min(shortage, bonusCapacity);
        if (bonus > 0) {
          this.roomState.player.score += bonus;
          awarded = bonus;
        }
      }
      this.roomState.pointCompensationAward = awarded;
      this.roomState.pointShortageCompensated = true;
    }

    this.roomState.updatedAt = now;
    this.evaluateScoreCompletion(now);
  }

  private hasPlayerSession(): boolean {
    for (const session of this.roomState.sessions.values()) {
      if (session.role === 'player') {
        return true;
      }
    }
    return false;
  }

  private hasOwnerSession(): boolean {
    for (const session of this.roomState.sessions.values()) {
      if (session.role === 'owner') {
        return true;
      }
    }
    return false;
  }

  private handleSessionDisconnected(_session: PlayerSession, now: number): void {
    if (this.roomState.phase === 'lobby' || this.roomState.phase === 'result') {
      return;
    }

    if (this.roomState.paused && this.roomState.pauseReason === 'disconnect') {
      this.roomState.pauseExpiresAt = now + DISCONNECT_TIMEOUT_MS;
      return;
    }

    const ownerPresent = this.hasOwnerSession();
    const playerPresent = this.hasPlayerSession();
    if (ownerPresent && playerPresent) {
      return;
    }

    this.pauseForDisconnect(now);
  }

  private pauseForDisconnect(now: number): void {
    if (this.roomState.paused && this.roomState.pauseReason === 'disconnect') {
      this.roomState.pauseExpiresAt = now + DISCONNECT_TIMEOUT_MS;
      return;
    }

    if (this.roomState.phaseEndsAt != null) {
      const remaining = Math.max(this.roomState.phaseEndsAt - now, 0);
      this.roomState.pauseRemainingMs = remaining;
      this.roomState.phaseEndsAt = undefined;
    } else {
      this.roomState.pauseRemainingMs = undefined;
    }

    this.roomState.paused = true;
    this.roomState.pauseReason = 'disconnect';
    this.roomState.pausePhase = this.roomState.phase;
    this.roomState.pauseExpiresAt = now + DISCONNECT_TIMEOUT_MS;
    this.roomState.updatedAt = now;
  }

  private checkHeartbeatTimeouts(now: number): boolean {
    if (this.roomState.phase === 'lobby') {
      return false;
    }

    let triggered = false;
    for (const socket of Array.from(this.clients)) {
      const session = this.socketSessions.get(socket);
      if (!session) {
        continue;
      }

      if (now - session.lastSeenAt < SESSION_HEARTBEAT_TIMEOUT_MS) {
        continue;
      }

      if (this.heartbeatTimeoutSockets.has(socket)) {
        triggered = true;
        continue;
      }

      this.heartbeatTimeoutSockets.add(socket);
      this.socketSessions.delete(socket);
      this.clients.delete(socket);
      const connection = this.connections.get(socket);
      if (connection) {
        connection.dispose();
      }
      this.connections.delete(socket);
      removeSession(this.roomState, session.id, now);
      this.handleSessionDisconnected(session, now);
      this.metrics.logSessionLeave(session.role);
      try {
        socket.close(4001, 'HEARTBEAT_TIMEOUT');
      } catch (error) {
        console.warn('room %s heartbeat close failed', this.roomId, error);
      }
      triggered = true;
    }
    return triggered;
  }

  private resumeFromPause(now: number): boolean {
    if (!this.roomState.paused || this.roomState.pauseReason !== 'disconnect') {
      return false;
    }

    if (!this.hasOwnerSession() || !this.hasPlayerSession()) {
      return false;
    }

    const remaining = this.roomState.pauseRemainingMs;
    if (remaining != null) {
      this.roomState.phaseEndsAt = now + remaining;
      this.roomState.phaseStartedAt = now;
      void this.schedulePhaseAlarm();
    }

    this.roomState.paused = false;
    this.roomState.pauseReason = undefined;
    this.roomState.pauseExpiresAt = undefined;
    this.roomState.pauseRemainingMs = undefined;
    this.roomState.pausePhase = undefined;
    this.roomState.updatedAt = now;
    return true;
  }

  private checkDisconnectTimeout(now: number): boolean {
    if (!this.roomState.paused || this.roomState.pauseReason !== 'disconnect') {
      return false;
    }

    if (this.hasOwnerSession() && this.hasPlayerSession()) {
      return this.resumeFromPause(now);
    }

    const expiresAt = this.roomState.pauseExpiresAt;
    if (expiresAt != null && now >= expiresAt) {
      this.roomState.paused = false;
      this.roomState.pauseReason = undefined;
      this.roomState.pauseExpiresAt = undefined;
      this.roomState.pauseRemainingMs = undefined;
      this.roomState.pausePhase = undefined;
      if (this.roomState.phase !== 'result') {
        this.roomState.phase = 'result';
        this.roomState.phaseEndsAt = undefined;
        this.roomState.phaseStartedAt = now;
      }
      this.roomState.updatedAt = now;
      return true;
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
    this.metrics.logRoomDisposed();
  }

  private sendError(
    socket: WebSocket,
    code: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const payload: {
      type: 'ERR';
      code: string;
      message: string;
      data?: Record<string, unknown>;
    } = {
      type: 'ERR',
      code,
      message,
    };

    if (data && Object.keys(data).length > 0) {
      payload.data = data;
    }

    socket.send(JSON.stringify(payload));
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

interface SanitizedPhysicsResult {
  state: PhysicsState;
  snapped: boolean;
}

function sanitizePhysicsState(
  previous: PhysicsState,
  next: PhysicsState,
  mazeSize: number,
  maxDistance: number,
): SanitizedPhysicsResult {
  const minPos = PLAYER_RADIUS;
  const maxPos = Math.max(minPos, mazeSize - PLAYER_RADIUS);
  const fallbackPos = clampNumber(mazeSize / 2, minPos, maxPos);

  const safePrevX = sanitizeBasePosition(previous.position.x, minPos, maxPos, fallbackPos);
  const safePrevY = sanitizeBasePosition(previous.position.y, minPos, maxPos, fallbackPos);
  const safePrevAngle = Number.isFinite(previous.angle) ? previous.angle : 0;

  let snapped = false;
  const markSnapped = (): void => {
    snapped = true;
  };

  let positionX = sanitizePositionComponent(
    next.position.x,
    safePrevX,
    minPos,
    maxPos,
    markSnapped,
  );
  let positionY = sanitizePositionComponent(
    next.position.y,
    safePrevY,
    minPos,
    maxPos,
    markSnapped,
  );
  let velocityX = sanitizeVelocityComponent(next.velocity.x, markSnapped);
  let velocityY = sanitizeVelocityComponent(next.velocity.y, markSnapped);
  const angle = sanitizeAngle(next.angle, safePrevAngle, markSnapped);

  const dx = positionX - safePrevX;
  const dy = positionY - safePrevY;
  const allowedDistance = Math.max(maxDistance, FLOAT_EPSILON);
  if (dx * dx + dy * dy > allowedDistance * allowedDistance) {
    positionX = safePrevX;
    positionY = safePrevY;
    velocityX = 0;
    velocityY = 0;
    markSnapped();
  }

  return {
    state: {
      position: { x: positionX, y: positionY },
      velocity: { x: velocityX, y: velocityY },
      angle,
    },
    snapped,
  };
}

function sanitizeBasePosition(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return clampNumber(value, min, max);
}

function sanitizePositionComponent(
  candidate: number,
  fallback: number,
  min: number,
  max: number,
  onSnap: () => void,
): number {
  if (!Number.isFinite(candidate)) {
    onSnap();
    return fallback;
  }
  if (candidate < min || candidate > max) {
    onSnap();
    return clampNumber(candidate, min, max);
  }
  return candidate;
}

function sanitizeVelocityComponent(candidate: number, onSnap: () => void): number {
  if (!Number.isFinite(candidate)) {
    onSnap();
    return 0;
  }
  if (Math.abs(candidate) > MAX_VELOCITY) {
    onSnap();
    return clampNumber(candidate, -MAX_VELOCITY, MAX_VELOCITY);
  }
  return candidate;
}

function sanitizeAngle(candidate: number, fallback: number, onSnap: () => void): number {
  if (!Number.isFinite(candidate)) {
    onSnap();
    return fallback;
  }
  if (candidate < -Math.PI || candidate > Math.PI) {
    onSnap();
    return normalizeRadians(candidate);
  }
  return candidate;
}

function normalizeRadians(value: number): number {
  const twoPi = Math.PI * 2;
  let result = value % twoPi;
  if (result <= -Math.PI) {
    result += twoPi;
  } else if (result > Math.PI) {
    result -= twoPi;
  }
  return result;
}

function clampNumber(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
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

function extractUpdatedAt(message: ServerMessage): number | null {
  if (message.type !== 'STATE') {
    return null;
  }

  const payload = message.payload as {
    full: boolean;
    snapshot?: { updatedAt?: number };
    changes?: { updatedAt?: number };
  };

  if (payload.full) {
    return payload.snapshot?.updatedAt ?? null;
  }

  return payload.changes?.updatedAt ?? null;
}

function pointKey(cell: { x: number; y: number }): string {
  return `${cell.x},${cell.y}`;
}

function predictionKey(cell: { x: number; y: number }): string {
  return `${cell.x},${cell.y}`;
}

function solidKey(x: number, y: number): string {
  return `${x},${y}`;
}

function isWithinMazeBounds(x: number, y: number, mazeSize: number): boolean {
  return x >= 0 && y >= 0 && x < mazeSize && y < mazeSize;
}

interface PathAvailabilityResult {
  reachable: boolean;
  visited: Set<string>;
}

function evaluateAccessiblePath(
  mazeSize: number,
  solidCells: Set<string>,
  start: { x: number; y: number },
  goal: { x: number; y: number },
): PathAvailabilityResult {
  if (!isWithinMazeBounds(goal.x, goal.y, mazeSize)) {
    return { reachable: false, visited: new Set() };
  }
  if (!isWithinMazeBounds(start.x, start.y, mazeSize)) {
    return { reachable: false, visited: new Set() };
  }

  const startKey = solidKey(start.x, start.y);
  const goalKey = solidKey(goal.x, goal.y);

  if (solidCells.has(startKey) || solidCells.has(goalKey)) {
    return { reachable: false, visited: new Set() };
  }

  const visited = new Set<string>([startKey]);
  const queue: Array<{ x: number; y: number }> = [start];
  const neighbors = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (current.x === goal.x && current.y === goal.y) {
      return { reachable: true, visited };
    }

    for (const { dx, dy } of neighbors) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!isWithinMazeBounds(nx, ny, mazeSize)) {
        continue;
      }
      const key = solidKey(nx, ny);
      if (solidCells.has(key) || visited.has(key)) {
        continue;
      }
      visited.add(key);
      queue.push({ x: nx, y: ny });
    }
  }

  return { reachable: false, visited };
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
  const playerCellX = Math.floor(playerPosition.x);
  const playerCellY = Math.floor(playerPosition.y);
  const distance = Math.abs(cell.x - playerCellX) + Math.abs(cell.y - playerCellY);
  return distance <= OWNER_FORBIDDEN_DISTANCE;
}
