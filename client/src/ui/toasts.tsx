import { useSyncExternalStore } from 'react';

const TOAST_DURATION_MS = 3500;

const ERROR_MESSAGES: Record<string, string> = {
  ROOM_FULL: 'ルームが満員です。別のルームIDを使用してください。',
  INVALID_NAME: 'ニックネームが不正です。使用可能な文字で入力してください。',
  INVALID_ROOM: 'ルームコードが不正です。6文字の英数字で入力してください。',
  NETWORK_ERROR: 'ネットワークエラーが発生しました。接続を確認してください。',
};

const DEFAULT_ERROR_MESSAGE = '不明なエラーが発生しました。時間をおいて再試行してください。';

interface ToastEntry {
  id: number;
  code: string;
  message: string;
}

type Listener = () => void;

class ToastStore {
  #toasts: ToastEntry[] = [];
  #listeners = new Set<Listener>();
  #timers = new Map<number, ReturnType<typeof setTimeout>>();
  #nextId = 1;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): ToastEntry[] => this.#toasts;

  enqueue = (code: string): void => {
    const id = this.#nextId;
    this.#nextId += 1;

    const message = ERROR_MESSAGES[code] ?? DEFAULT_ERROR_MESSAGE;
    const toast: ToastEntry = { id, code, message };
    this.#toasts = [...this.#toasts, toast];
    this.#notify();

    const timer = setTimeout(() => {
      this.dismiss(id);
    }, TOAST_DURATION_MS);
    this.#timers.set(id, timer);
  };

  enqueueCustom = (message: string): void => {
    const id = this.#nextId;
    this.#nextId += 1;

    const toast: ToastEntry = { id, code: 'INFO', message };
    this.#toasts = [...this.#toasts, toast];
    this.#notify();

    const timer = setTimeout(() => {
      this.dismiss(id);
    }, TOAST_DURATION_MS);
    this.#timers.set(id, timer);
  };

  dismiss = (id: number): void => {
    const timer = this.#timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.#timers.delete(id);
    }

    const next = this.#toasts.filter((toast) => toast.id !== id);
    if (next.length === this.#toasts.length) {
      return;
    }

    this.#toasts = next;
    this.#notify();
  };

  reset = (): void => {
    this.#toasts = [];
    this.#nextId = 1;
    for (const timer of this.#timers.values()) {
      clearTimeout(timer);
    }
    this.#timers.clear();
    this.#notify();
  };

  #notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

const store = new ToastStore();

export function enqueueErrorToast(code: string): void {
  store.enqueue(code);
}

export function enqueueInfoToast(message: string): void {
  store.enqueueCustom(message);
}

export function resetToastStoreForTest(): void {
  store.reset();
}

export function ToastHost() {
  const toasts = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div role="status" aria-label="エラー通知" aria-live="assertive">
      <ul>
        {toasts.map((toast) => (
          <li key={toast.id}>{toast.message}</li>
        ))}
      </ul>
    </div>
  );
}

// テスト専用に内部状態へ直接アクセスが必要な場合に備えてエクスポート。
export type { ToastEntry };
