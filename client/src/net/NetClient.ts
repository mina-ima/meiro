import { logConnectionEvent, logRttSample, logLatencyWarning } from '../logging/telemetry';
import { LATENCY_WARNING_THRESHOLD_MS } from '../config/spec';
import { getRequiredWsBase } from '../config/env';

const RECONNECT_DELAY_MS = 2000;
const PING_INTERVAL_MS = 5000;

export type PlayerRole = 'owner' | 'player';

export interface ConnectionOptions {
  room: string;
  role: PlayerRole;
  nick: string;
}

export interface NetClientEvents {
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
  onMessage?: (data: unknown) => void;
}

/**
 * Thin wrapper around WebSocket API. Keeps reconnection policy isolated so both
 * Owner/Player views can remain focused on rendering.
 */
export class NetClient {
  private socket?: WebSocket;
  private readonly opts: ConnectionOptions;
  private readonly events: NetClientEvents;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pendingPingTimestamp: number | null = null;
  private reconnectAttempts = 0;

  constructor(opts: ConnectionOptions, events: NetClientEvents = {}) {
    this.opts = opts;
    this.events = events;
  }

  connect(): void {
    if (typeof WebSocket === 'undefined') {
      console.warn('WebSocket API is not available in the current environment.');
      return;
    }

    this.disposed = false;
    this.stopPingLoop();
    const { room, role, nick } = this.opts;
    let url: URL;
    try {
      url = buildWebSocketUrl(getRequiredWsBase(), room, role, nick);
    } catch (error) {
      console.error('Failed to construct WebSocket URL', error);
      this.events.onError?.(new Event('error'));
      return;
    }

    this.socket = new WebSocket(url);

    this.socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      logConnectionEvent('open', { room, role });
      this.startPingLoop();
      this.events.onOpen?.();
    });

    this.socket.addEventListener('close', (event) => {
      logConnectionEvent('close', { code: event.code, reason: event.reason });
      this.stopPingLoop();
      this.events.onClose?.(event);
      // Simple reconnect loop for early experiments. Backoff/backpressure TBD.
      if (this.disposed) {
        return;
      }
      this.reconnectAttempts += 1;
      logConnectionEvent('reconnect', { attempt: this.reconnectAttempts });
      this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    });

    this.socket.addEventListener('error', (event) => {
      logConnectionEvent('error');
      this.events.onError?.(event);
    });

    this.socket.addEventListener('message', (event) => {
      const data = parsePayload(event.data);
      if (isRecord(data) && data.type === 'PONG' && typeof data.ts === 'number') {
        if (this.pendingPingTimestamp != null) {
          logRttSample(Date.now() - this.pendingPingTimestamp);
        }
        this.pendingPingTimestamp = null;
        return;
      }

      if (isStateMessage(data)) {
        const updatedAt = extractUpdatedAtClient(data);
        if (updatedAt != null) {
          const latency = Date.now() - updatedAt;
          if (latency > LATENCY_WARNING_THRESHOLD_MS) {
            logLatencyWarning(latency);
          }
        }
      }

      this.events.onMessage?.(data);
    });
  }

  send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('NetClient attempted to send while socket not open');
      return;
    }

    this.socket.send(JSON.stringify(payload));
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPingLoop();

    if (this.socket) {
      try {
        this.socket.close(1000, 'client-dispose');
      } catch (error) {
        console.warn('Failed to close WebSocket cleanly', error);
      }
      this.socket = undefined;
    }
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const ts = Date.now();
      try {
        this.socket.send(JSON.stringify({ type: 'PING', ts }));
        this.pendingPingTimestamp = ts;
      } catch {
        logConnectionEvent('error', { reason: 'ping-send-failed' });
        this.pendingPingTimestamp = null;
      }
    }, PING_INTERVAL_MS);
  }

  private stopPingLoop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.pendingPingTimestamp = null;
  }
}

function parsePayload(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to parse payload', error);
    return raw;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStateMessage(value: unknown): value is { type: 'STATE'; payload: unknown } {
  return isRecord(value) && value.type === 'STATE';
}

function extractUpdatedAtClient(message: { type: 'STATE'; payload: unknown }): number | null {
  if (!isRecord(message.payload)) {
    return null;
  }

  if (message.payload.full === true && isRecord(message.payload.snapshot)) {
    const value = message.payload.snapshot.updatedAt;
    return typeof value === 'number' ? value : null;
  }

  if (message.payload.full === false && isRecord(message.payload.changes)) {
    const value = message.payload.changes.updatedAt;
    return typeof value === 'number' ? value : null;
  }

  return null;
}

function buildWebSocketUrl(base: string, room: string, role: PlayerRole, nick: string): URL {
  const origin = normalizeWebSocketOrigin(base);
  const url = new URL('/ws', origin);
  url.searchParams.set('room', room);
  url.searchParams.set('role', role);
  url.searchParams.set('nick', nick);
  return url;
}

function normalizeWebSocketOrigin(base: string): URL {
  const trimmed = base.trim();
  if (!trimmed) {
    throw new Error('WebSocket endpoint is not defined');
  }

  const url = new URL(trimmed);
  if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  } else if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  }

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Unsupported WebSocket protocol: ${url.protocol}`);
  }

  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}
