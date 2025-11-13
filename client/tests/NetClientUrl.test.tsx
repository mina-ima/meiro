import { render, cleanup, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import { NetClient } from '../src/net/NetClient';

const ORIGINAL_WEBSOCKET = globalThis.WebSocket;

class CaptureWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;

  public static instances: CaptureWebSocket[] = [];

  public readyState = CaptureWebSocket.CONNECTING;
  public url: string;

  constructor(url: string | URL) {
    this.url = url.toString();
    CaptureWebSocket.instances.push(this);
  }

  public addEventListener(): void {}
  public removeEventListener(): void {}
  public send(): void {}
  public close(): void {
    this.readyState = CaptureWebSocket.CLOSED;
  }

  public static latest(): CaptureWebSocket | undefined {
    return CaptureWebSocket.instances[CaptureWebSocket.instances.length - 1];
  }

  public static reset(): void {
    CaptureWebSocket.instances.length = 0;
  }
}

function NetClientHarness({ base }: { base: string }) {
  useEffect(() => {
    const client = new NetClient({
      base,
      room: 'ROOM42',
      role: 'owner',
      nick: 'Architect',
    });
    client.connect();
    return () => client.dispose();
  }, []);

  return null;
}

describe('NetClient URL composition', () => {
  beforeEach(() => {
    CaptureWebSocket.reset();
    (globalThis as { WebSocket?: typeof WebSocket }).WebSocket =
      CaptureWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    cleanup();
    CaptureWebSocket.reset();
    if (ORIGINAL_WEBSOCKET) {
      globalThis.WebSocket = ORIGINAL_WEBSOCKET;
    } else {
      delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    }
  });

  it('appends /ws when the endpoint provides only the origin', async () => {
    render(<NetClientHarness base="wss://example.com" />);

    await waitFor(() => {
      expect(CaptureWebSocket.latest()?.url).toBe(
        'wss://example.com/ws?room=ROOM42&role=owner&nick=Architect',
      );
    });
  });

  it('normalizes paths and ensures consistent query ordering', async () => {
    render(<NetClientHarness base="https://example.com/game/ws/" />);

    await waitFor(() => {
      expect(CaptureWebSocket.latest()?.url).toBe(
        'wss://example.com/ws?room=ROOM42&role=owner&nick=Architect',
      );
    });
  });
});
