import { describe, expect, it } from 'vitest';
import { getRoomStub } from '../src/logic/room-binding';

class FakeDurableObjectStub {
  constructor(public readonly id: FakeDurableObjectId) {}
  fetch = async () => new Response('ok');
}

class FakeDurableObjectId {
  constructor(private readonly name: string) {}
  toString(): string {
    return this.name;
  }
}

class FakeDurableObjectNamespace implements DurableObjectNamespace {
  private stubs = new Map<string, FakeDurableObjectStub>();

  idFromName(name: string): DurableObjectId {
    return new FakeDurableObjectId(name) as unknown as DurableObjectId;
  }

  get(id: DurableObjectId): DurableObjectStub {
    const key = id.toString();
    let stub = this.stubs.get(key);
    if (!stub) {
      stub = new FakeDurableObjectStub(id as unknown as FakeDurableObjectId);
      this.stubs.set(key, stub);
    }

    return stub as unknown as DurableObjectStub;
  }

  idFromString(id: string): DurableObjectId {
    throw new Error(`Not implemented: ${id}`);
  }

  newUniqueId(): DurableObjectId {
    throw new Error('Not implemented');
  }
}

describe('getRoomStub', () => {
  it('同じ roomId では常に同じ Stub を返す', () => {
    const namespace = new FakeDurableObjectNamespace();
    const stubA = getRoomStub({ ROOM: namespace } as never, 'ABCDEF');
    const stubB = getRoomStub({ ROOM: namespace } as never, 'ABCDEF');

    expect(stubA).toBe(stubB);
  });

  it('異なる roomId では異なる Stub を返す', () => {
    const namespace = new FakeDurableObjectNamespace();
    const stubA = getRoomStub({ ROOM: namespace } as never, 'ABCDEF');
    const stubB = getRoomStub({ ROOM: namespace } as never, 'FEDCBA');

    expect(stubA).not.toBe(stubB);
  });
});
