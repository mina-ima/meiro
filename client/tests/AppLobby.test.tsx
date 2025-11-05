import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { useSessionStore } from '../src/state/sessionStore';

class StubWebSocket {
  public static instances: StubWebSocket[] = [];
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;

  public readyState = StubWebSocket.CONNECTING;
  public url: string;
  private listeners: Record<string, ((event: Event) => void)[]> = {};

  constructor(url: string | URL) {
    this.url = typeof url === 'string' ? url : url.toString();
    StubWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((fn) => fn !== listener);
  }

  dispatchEvent(type: string, event: Event = new Event(type)) {
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }

  send() {}

  close() {
    this.readyState = StubWebSocket.CLOSED;
    this.dispatchEvent('close', new Event('close'));
  }

  static latest(): StubWebSocket | undefined {
    return StubWebSocket.instances[StubWebSocket.instances.length - 1];
  }

  static reset() {
    StubWebSocket.instances.length = 0;
  }
}

describe('App lobby interactions', () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    useSessionStore.getState().reset();
    StubWebSocket.reset();
    (globalThis as { WebSocket?: typeof WebSocket }).WebSocket =
      StubWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }

    if (originalWebSocket) {
      globalThis.WebSocket = originalWebSocket;
    } else {
      delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    }
  });

  it('creates a new room as owner after entering nickname', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roomId: 'RM42QX' }),
    } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<App />);

    const nicknameInput = screen.getByLabelText('ニックネーム');
    await user.clear(nicknameInput);
    await user.type(nicknameInput, 'TARO');

    const createButton = screen.getByRole('button', { name: '新しいルームを作成' });
    await user.click(createButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/rooms$/),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    await waitFor(() =>
      expect(
        screen.getByText(/役割（オーナー）として接続を初期化しています。/),
      ).toBeInTheDocument(),
    );

    const socket = StubWebSocket.latest();
    expect(socket?.url).toMatch(/room=RM42QX/);
    expect(socket?.url).toMatch(/role=owner/);
    expect(socket?.url).toMatch(/nick=TARO/);
  });

  it('joins an existing room as player with the provided code', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<App />);

    await user.clear(screen.getByLabelText('ニックネーム'));
    await user.type(screen.getByLabelText('ニックネーム'), 'MIKU');

    const roomCodeInput = screen.getByLabelText('ルームコード');
    await user.type(roomCodeInput, 'abc2d3');

    const playerRadio = screen.getByLabelText('プレイヤー');
    await user.click(playerRadio);

    await user.click(screen.getByRole('button', { name: 'ルームに参加' }));

    await waitFor(() =>
      expect(
        screen.getByText(/役割（プレイヤー）として接続を初期化しています。/),
      ).toBeInTheDocument(),
    );

    expect(fetchSpy).not.toHaveBeenCalled();

    const socket = StubWebSocket.latest();
    expect(socket?.url).toMatch(/room=ABC2D3/);
    expect(socket?.url).toMatch(/role=player/);
    expect(socket?.url).toMatch(/nick=MIKU/);
  });
});
