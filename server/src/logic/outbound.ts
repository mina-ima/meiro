import type { ServerMessage } from '../schema/ws';

const MAX_MESSAGE_BYTES = 2 * 1024;
const MIN_INTERVAL_MS = 50;

export class MessageSizeExceededError extends Error {
  constructor(size: number) {
    super(`encoded message size ${size} exceeds ${MAX_MESSAGE_BYTES} bytes limit`);
    this.name = 'MessageSizeExceededError';
  }
}

export class ClientConnection {
  private readonly queue: string[] = [];
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
    }) => void,
  ) {}

  enqueue(message: ServerMessage): void {
    this.push(message, false);
  }

  sendImmediate(message: ServerMessage): void {
    this.push(message, true);
  }

  dispose(): void {
    this.closed = true;
    this.queue.length = 0;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private push(message: ServerMessage, immediate: boolean): void {
    if (this.closed) {
      return;
    }

    const encoded = JSON.stringify(message);
    if (encoded.length > MAX_MESSAGE_BYTES) {
      throw new MessageSizeExceededError(encoded.length);
    }

    if (immediate) {
      this.sendEncoded(encoded, this.now(), true);
      return;
    }

    this.queue.push(encoded);
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

    const encoded = this.queue.shift();
    if (!encoded) {
      return;
    }

    this.sendEncoded(encoded, now, false);

    if (!this.closed && this.queue.length > 0) {
      this.scheduleFlush();
    }
  }

  private sendEncoded(encoded: string, now: number, immediate: boolean): void {
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
        this.onMessageSent({ bytes: encoded.length, immediate, queueDepth: this.queue.length });
      } catch (error) {
        console.error('metrics callback failed', error);
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
