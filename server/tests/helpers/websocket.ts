class TestWebSocket implements WebSocket {
  public accepted = false;
  public closed = false;
  public readonly sent: string[] = [];
  public closeInfo: { code?: number; reason?: string } | null = null;
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

  accept(): void {
    this.accepted = true;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = true;
    this.closeInfo = { code, reason };
    const handlers = this.listeners.get('close') ?? [];
    for (const handler of handlers) {
      handler({});
    }
  }

  addEventListener(event: string, handler: (event: { data?: unknown }) => void): void {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
  }

  removeEventListener(event: string, handler: (event: { data?: unknown }) => void): void {
    const handlers = this.listeners.get(event);
    if (!handlers) {
      return;
    }
    const index = handlers.indexOf(handler);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
  }

  dispatchEvent(_event: Event): boolean {
    void _event;
    return true;
  }

  dispatchMessage(data: unknown): void {
    const handlers = this.listeners.get('message') ?? [];
    for (const handler of handlers) {
      handler({ data });
    }
  }

  dispatchClose(): void {
    const handlers = this.listeners.get('close') ?? [];
    for (const handler of handlers) {
      handler({});
    }
  }

  get bufferedAmount(): number {
    return 0;
  }

  get extensions(): string {
    return '';
  }

  get protocol(): string {
    return '';
  }

  get readyState(): number {
    return this.accepted && !this.closed ? 1 : 3;
  }

  get url(): string {
    return '';
  }

  binaryType: BinaryType = 'blob';
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
}

const pendingServerSockets: WebSocket[] = [];

function enqueueServerSocket(socket: WebSocket): void {
  pendingServerSockets.push(socket);
}

function installSocketSetter(property: 'webSocket' | 'websocket'): void {
  const descriptor = Object.getOwnPropertyDescriptor(Request.prototype, property);
  if (descriptor && typeof descriptor.set === 'function') {
    return;
  }
  Object.defineProperty(Request.prototype, property, {
    configurable: true,
    get() {
      return undefined;
    },
    set(value: unknown) {
      if (value && typeof (value as WebSocket).accept === 'function') {
        enqueueServerSocket(value as WebSocket);
      }
    },
  });
}

installSocketSetter('webSocket');
installSocketSetter('websocket');

class QueueWebSocketPair implements WebSocketPair {
  0: WebSocket;
  1: WebSocket;

  constructor() {
    const serverSocket = pendingServerSockets.shift() ?? new TestWebSocket();
    const clientSocket = new TestWebSocket();
    this[0] = clientSocket;
    this[1] = serverSocket;
  }
}

(globalThis as typeof globalThis & { WebSocketPair: typeof QueueWebSocketPair }).WebSocketPair =
  QueueWebSocketPair as unknown as typeof WebSocketPair;
