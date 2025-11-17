import handler, { type Env } from '../src';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

interface RecordedRequest {
  input: RequestInfo | URL;
  init?: RequestInit;
}

class RecordingDurableObjectStub implements DurableObjectStub {
  public readonly calls: RecordedRequest[] = [];
  public response: Response = new Response('delegated', { status: 200 });

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    this.calls.push({ input, init });
    return this.response;
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

function createEnv(): { env: Env; namespace: RecordingDurableObjectNamespace } {
  const namespace = new RecordingDurableObjectNamespace();
  const env = { ROOM: namespace as unknown as DurableObjectNamespace } as Env;
  return { env, namespace };
}

describe('WebSocket upgrade handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates /ws upgrades to the Durable Object using the original request', async () => {
    const { env, namespace } = createEnv();
    const request = new Request('https://example.com/ws?room=abc234&role=owner&nick=ALICE', {
      method: 'GET',
      headers: {
        Upgrade: 'websocket',
      },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stubResponse = new Response('proxied', { status: 200 });
    namespace.stub.response = stubResponse;

    const response = await handler.fetch(request, env, {} as ExecutionContext);

    expect(response).toBe(stubResponse);
    expect(namespace.stub.calls).toHaveLength(1);
    expect(namespace.stub.calls[0]?.input).toBe(request);
    expect(namespace.stub.calls[0]?.init).toBeUndefined();
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
    expect(await response.text()).toContain('Upgrade');
    expect(namespace.stub.calls).toHaveLength(0);
  });

  it('bubbles DO errors as-is when the Durable Object rejects the upgrade', async () => {
    const { env, namespace } = createEnv();
    namespace.stub.response = new Response('do failed', { status: 500 });

    const request = new Request('https://example.com/ws?room=abc234&role=owner&nick=FAIL', {
      method: 'GET',
      headers: {
        Upgrade: 'websocket',
      },
    });

    const response = await handler.fetch(request, env, {} as ExecutionContext);

    expect(response).toBe(namespace.stub.response);
    expect(await response.text()).toBe('do failed');
    expect(namespace.stub.calls).toHaveLength(1);
  });
});
