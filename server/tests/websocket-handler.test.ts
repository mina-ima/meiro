import handler, { type Env } from '../src';
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

type WorkerResponseInit = ResponseInit & { webSocket?: WebSocket };

const OriginalResponse = globalThis.Response;

class TestResponse extends OriginalResponse {
  constructor(body?: BodyInit | null, init?: WorkerResponseInit) {
    if (!init) {
      super(body);
      return;
    }

    const { webSocket, ...rest } = init;
    const baseInit = rest as ResponseInit;
    const requestedStatus = baseInit.status;
    const sanitizedInit =
      requestedStatus === 101 ? { ...baseInit, status: 200 } : baseInit;

    super(body, sanitizedInit);

    if (requestedStatus === 101) {
      Object.defineProperty(this, 'status', {
        configurable: true,
        enumerable: true,
        value: 101,
        writable: false,
      });
    }

    if (webSocket) {
      Object.defineProperty(this, 'webSocket', {
        configurable: true,
        enumerable: false,
        value: webSocket,
        writable: false,
      });
    }
  }

  static json(data: unknown, init?: WorkerResponseInit): Response {
    return OriginalResponse.json(data, init);
  }
}

interface RecordedRequest {
  input: RequestInfo | URL;
  init?: RequestInit & { webSocket?: WebSocket | undefined };
}

class RecordingDurableObjectStub implements DurableObjectStub {
  public readonly calls: RecordedRequest[] = [];

  async fetch(input: RequestInfo | URL, init?: RequestInit & { webSocket?: WebSocket }): Promise<Response> {
    this.calls.push({ input, init });
    return new Response('ok');
  }
}

class RecordingDurableObjectNamespace implements DurableObjectNamespace {
  public readonly stub = new RecordingDurableObjectStub();

  idFromName(name: string): DurableObjectId {
    return name as unknown as DurableObjectId;
  }

  idFromString(id: string): DurableObjectId {
    return id as unknown as DurableObjectId;
  }

  newUniqueId(): DurableObjectId {
    throw new Error('not implemented');
  }

  get(id: DurableObjectId): DurableObjectStub {
    void id;
    return this.stub as unknown as DurableObjectStub;
  }
}

type PairRecord = { client: WebSocket; server: WebSocket };

const recordedPairs: PairRecord[] = [];

function createFakeSocket(label: string): WebSocket {
  const noop = () => void label;
  return {
    label,
    accept: noop,
    close: noop,
    send: noop,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    readyState: 0,
    url: '',
    protocol: '',
    extensions: '',
    bufferedAmount: 0,
    binaryType: 'blob',
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,
  } as unknown as WebSocket;
}

class FakeWebSocketPair implements WebSocketPair {
  0: WebSocket;
  1: WebSocket;

  constructor() {
    this[0] = createFakeSocket('client');
    this[1] = createFakeSocket('server');
    recordedPairs.push({ client: this[0], server: this[1] });
  }
}

function createEnv(): { env: Env; namespace: RecordingDurableObjectNamespace } {
  const namespace = new RecordingDurableObjectNamespace();
  const env = { ROOM: namespace as unknown as DurableObjectNamespace } as Env;
  return { env, namespace };
}

describe('WebSocket upgrade handling', () => {
  const originalWebSocketPair = globalThis.WebSocketPair;

  beforeAll(() => {
    recordedPairs.length = 0;
    (globalThis as Record<string, unknown>).WebSocketPair = FakeWebSocketPair;
    (globalThis as typeof globalThis & { Response: typeof TestResponse }).Response =
      TestResponse as typeof Response;
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { Response: typeof OriginalResponse }).Response =
      OriginalResponse;
    (globalThis as Record<string, unknown>).WebSocketPair = originalWebSocketPair;
  });

  beforeEach(() => {
    recordedPairs.length = 0;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates /ws upgrades to the Durable Object session handler', async () => {
    const { env, namespace } = createEnv();
    const request = new Request('https://example.com/ws?room=abc234&role=owner&nick=ALICE', {
      method: 'GET',
      headers: {
        Upgrade: 'websocket',
      },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const response = await handler.fetch(request, env, {} as ExecutionContext);

    expect(response.status).toBe(101);
    expect(namespace.stub.calls).toHaveLength(1);
    const call = namespace.stub.calls[0];
    expect(call.input).toBe('https://internal/session');
    expect(call.init?.webSocket).toBe(recordedPairs[0]?.server);
    expect(logSpy).toHaveBeenCalledWith(
      'WS fetch /ws',
      expect.objectContaining({ roomId: 'ABC234', role: 'owner', nick: 'ALICE' }),
    );
  });

  it('rejects /ws requests that are not WebSocket upgrades', async () => {
    const { env, namespace } = createEnv();
    const request = new Request('https://example.com/ws?room=abc234&role=owner&nick=BOB');

    const response = await handler.fetch(request, env, {} as ExecutionContext);

    expect(response.status).toBe(426);
    expect(await response.text()).toContain('Upgrade Required');
    expect(namespace.stub.calls).toHaveLength(0);
  });
});
