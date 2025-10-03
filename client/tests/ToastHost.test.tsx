import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueErrorToast,
  resetToastStoreForTest,
  ToastHost,
} from '../src/ui/toasts';

describe('ToastHost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetToastStoreForTest();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  it('ERR.code ごとの文言を表示する', () => {
    render(<ToastHost />);

    act(() => {
      enqueueErrorToast('ROOM_FULL');
    });

    expect(screen.getByRole('status', { name: 'エラー通知' })).toHaveTextContent(
      'ルームが満員です。別のルームIDを使用してください。',
    );
  });

  it('数秒後にトーストを自動で閉じる', () => {
    render(<ToastHost />);

    act(() => {
      enqueueErrorToast('INVALID_NAME');
    });
    expect(
      screen.getByText('ニックネームが不正です。使用可能な文字で入力してください。'),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(
      screen.queryByText('ニックネームが不正です。使用可能な文字で入力してください。'),
    ).not.toBeInTheDocument();
  });

  it('未知のERR.codeには汎用メッセージを使う', () => {
    render(<ToastHost />);

    act(() => {
      enqueueErrorToast('SOMETHING_ELSE');
    });

    expect(screen.getByRole('status', { name: 'エラー通知' })).toHaveTextContent(
      '不明なエラーが発生しました。時間をおいて再試行してください。',
    );
  });

  it('複数のエラーを順に投入した場合でも全て表示する', () => {
    render(<ToastHost />);

    act(() => {
      enqueueErrorToast('ROOM_FULL');
      enqueueErrorToast('INVALID_NAME');
    });

    expect(
      screen.getByText('ルームが満員です。別のルームIDを使用してください。'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('ニックネームが不正です。使用可能な文字で入力してください。'),
    ).toBeInTheDocument();
  });
});
