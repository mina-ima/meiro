const RECONNECT_DELAY_MS = 2000;

export type PlayerRole = 'owner' | 'player';

export interface ConnectionOptions {
  endpoint: string;
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

  constructor(opts: ConnectionOptions, events: NetClientEvents = {}) {
    this.opts = opts;
    this.events = events;
  }

  connect(): void {
    const { endpoint, room, role, nick } = this.opts;
    const url = new URL(endpoint);
    url.searchParams.set('room', room);
    url.searchParams.set('role', role);
    url.searchParams.set('nick', nick);

    this.socket = new WebSocket(url);

    this.socket.addEventListener('open', () => {
      this.events.onOpen?.();
    });

    this.socket.addEventListener('close', (event) => {
      this.events.onClose?.(event);
      // Simple reconnect loop for early experiments. Backoff/backpressure TBD.
      setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    });

    this.socket.addEventListener('error', (event) => {
      this.events.onError?.(event);
    });

    this.socket.addEventListener('message', (event) => {
      this.events.onMessage?.(parsePayload(event.data));
    });
  }

  send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('NetClient attempted to send while socket not open');
      return;
    }

    this.socket.send(JSON.stringify(payload));
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
