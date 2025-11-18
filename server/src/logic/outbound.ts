import type { ServerMessage } from '../schema/ws';

const MAX_MESSAGE_BYTES = 20 * 1024;
const MIN_INTERVAL_MS = 50;

interface MessageMeta {
  updatedAt?: number;
}

interface InternalMessageMeta extends MessageMeta {
  enqueuedAt: number;
}

interface QueueEntry {
  encoded: string;
  meta?: InternalMessageMeta;
  replaceable: boolean;
}

export class MessageSizeExceededError extends Error {
  constructor(size: number) {
    super(`encoded message size ${size} exceeds ${MAX_MESSAGE_BYTES} bytes limit`);
    this.name = 'MessageSizeExceededError';
  }
}

export class ClientConnection {
  private readonly queue: QueueEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextSendAt = 0;
  private closed = false;

  constructor(
    private readonly socket: Pick<WebSocket, 'send'>,
    private readonly now: () => number,
    private readonly onError?: (error: unknown) => void,
    private readonly onMessageSent?: (info: {
      bytes: number;
      immediate: boolean;
      queueDepth: number;
      latencyMs?: number;
      queuedMs?: number;
    }) => void,
  ) {}

  enqueue(message: ServerMessage, meta?: MessageMeta): void {
    this.push(message, false, meta);
  }

  sendImmediate(message: ServerMessage, meta?: MessageMeta): void {
    this.push(message, true, meta);
  }

  dispose(): void {
    this.closed = true;
    this.queue.length = 0;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private push(message: ServerMessage, immediate: boolean, meta?: MessageMeta): void {
    if (this.closed) {
      return;
    }

    const encoded = JSON.stringify(message);
    if (encoded.length > MAX_MESSAGE_BYTES) {
      throw new MessageSizeExceededError(encoded.length);
    }

    const replaceable = !immediate && isStateDiffMessage(message);

    const now = this.now();
    const entryMeta: InternalMessageMeta | undefined = meta
      ? { ...meta, enqueuedAt: now }
      : { enqueuedAt: now };

    if (immediate) {
      this.sendEncoded(encoded, now, true, entryMeta);
      return;
    }

    if (replaceable && this.queue.length > 0) {
      this.dropReplaceableMessages();
    }

    this.queue.push({ encoded, meta: entryMeta, replaceable });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer !== null || this.queue.length === 0 || this.closed) {
      return;
    }

    const delay = Math.max(this.nextSendAt - this.now(), 0);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, delay);
  }

  private flush(): void {
    if (this.closed || this.queue.length === 0) {
      return;
    }

    const now = this.now();
    if (now < this.nextSendAt) {
      this.scheduleFlush();
      return;
    }

    const entry = this.queue.shift();
    if (!entry) {
      return;
    }

    this.sendEncoded(entry.encoded, now, false, entry.meta);

    if (!this.closed && this.queue.length > 0) {
      this.scheduleFlush();
    }
  }

  private sendEncoded(
    encoded: string,
    now: number,
    immediate: boolean,
    meta?: InternalMessageMeta,
  ): void {
    if (this.closed) {
      return;
    }

    try {
      this.socket.send(encoded);
    } catch (error) {
      this.closed = true;
      this.queue.length = 0;
      if (this.onError) {
        this.onError(error);
      } else {
        console.error('failed to send message', error);
      }
      return;
    }

    this.nextSendAt = now + MIN_INTERVAL_MS;

    if (this.onMessageSent) {
      try {
        const info: {
          bytes: number;
          immediate: boolean;
          queueDepth: number;
          latencyMs?: number;
          queuedMs?: number;
        } = {
          bytes: encoded.length,
          immediate,
          queueDepth: this.queue.length,
        };
        if (meta) {
          const queuedMs = now - meta.enqueuedAt;
          if (queuedMs >= 0) {
            info.queuedMs = queuedMs;
          }
          if (meta.updatedAt != null) {
            const latency = now - meta.updatedAt;
            if (latency >= 0) {
              info.latencyMs = latency;
            }
          }
        }
        this.onMessageSent(info);
      } catch (error) {
        console.error('metrics callback failed', error);
      }
    }
  }

  private dropReplaceableMessages(): void {
    if (this.queue.length === 0) {
      return;
    }
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      if (this.queue[i]?.replaceable) {
        this.queue.splice(i, 1);
      }
    }
  }
}

export function getMaxMessageBytes(): number {
  return MAX_MESSAGE_BYTES;
}

export function getMinIntervalMs(): number {
  return MIN_INTERVAL_MS;
}

function isStateDiffMessage(message: ServerMessage): boolean {
  if (message.type !== 'STATE') {
    return false;
  }
  const payload = message.payload as
    | { full?: unknown }
    | { full?: unknown; changes?: Record<string, unknown> }
    | undefined;

  return Boolean(payload && payload.full === false);
}
