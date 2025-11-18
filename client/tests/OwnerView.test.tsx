import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OwnerView } from '../src/views/OwnerView';
import { MAX_ACTIVE_TRAPS } from '../src/config/spec';
import type { NetClient } from '../src/net/NetClient';

describe('OwnerView', () => {
  it('HUDでは初期設定に必要な罠・予測地点残数・残り時間だけを表示する', () => {
    render(
      <OwnerView
        client={null}
        roomId="ROOM-1"
        trapCharges={2}
        forbiddenDistance={2}
        activePredictions={2}
        predictionLimit={3}
        timeRemaining={75}
        predictionMarks={[{ x: 5, y: 6 }]}
        traps={[{ x: 2, y: 8 }]}
        playerPosition={{ x: 3.5, y: 4.5 }}
        mazeSize={20}
        editCooldownMs={1500}
        phase="explore"
        sessions={[]}
      />,
    );

    const map = screen.getByLabelText('俯瞰マップ');
    const initialViewBox = map.getAttribute('viewBox');
    fireEvent.click(screen.getByRole('button', { name: 'ズームイン' }));
    expect(map.getAttribute('viewBox')).not.toBe(initialViewBox);
    fireEvent.click(screen.getByRole('button', { name: 'プレイヤーにセンタリング' }));
    expect(screen.getByTestId('player-marker')).toBeInTheDocument();
    expect(screen.queryByText(/壁残数/)).not.toBeInTheDocument();
    expect(screen.getByText('罠権利: 2')).toBeInTheDocument();
    expect(screen.getByText('禁止エリア距離: 2')).toBeInTheDocument();
    expect(screen.getByText('編集クールダウン: 1.5秒')).toBeInTheDocument();
    expect(screen.getByText('予測地点: 残り1 / 3')).toBeInTheDocument();
    expect(screen.getByText('設定残り時間: 75秒')).toBeInTheDocument();
  });

  it('罠の同時設置数は上限でクリップされて表示される', () => {
    render(
      <OwnerView
        client={null}
        roomId="ROOM-1"
        trapCharges={1}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={120}
        predictionMarks={[]}
        traps={[
          { x: 1, y: 1 },
          { x: 2, y: 2 },
          { x: 3, y: 3 },
        ]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
        editCooldownMs={0}
        phase="explore"
        sessions={[]}
      />,
    );

    expect(
      screen.getByText(`罠: 設置${MAX_ACTIVE_TRAPS}/${MAX_ACTIVE_TRAPS}`),
    ).toBeInTheDocument();
  });

  it('ロビーでプレイヤー未参加なら参加状況を表示し開始ボタンを無効化する', () => {
    render(
      <OwnerView
        client={null}
        roomId="ROOM-1"
        trapCharges={0}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={0}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
        editCooldownMs={0}
        phase="lobby"
        sessions={[{ id: 'owner', role: 'owner', nick: 'OWNER' }]}
      />,
    );

    expect(screen.getByText('プレイヤー: 未接続')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'ゲーム開始' });
    expect(button).toBeDisabled();
  });

  it('プレイヤー参加後はゲーム開始ボタンからO_STARTメッセージを送信する', () => {
    const send = vi.fn();
    const client = { send } as unknown as NetClient;
    render(
      <OwnerView
        client={client}
        roomId="ROOM-1"
        trapCharges={0}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={0}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
        editCooldownMs={1500}
        phase="lobby"
        sessions={[
          { id: 'owner', role: 'owner', nick: 'OWNER' },
          { id: 'player', role: 'player', nick: 'PLAYER' },
        ]}
      />,
    );

    const button = screen.getByRole('button', { name: 'ゲーム開始' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(send).toHaveBeenCalledWith({ type: 'O_START', mazeSize: 20 });
  });

  it('迷路サイズを選択してから開始ボタンで送信する', () => {
    const send = vi.fn();
    const client = { send } as unknown as NetClient;
    render(
      <OwnerView
        client={client}
        roomId="ROOM-1"
        trapCharges={0}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={0}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
        editCooldownMs={1500}
        phase="lobby"
        sessions={[
          { id: 'owner', role: 'owner', nick: 'OWNER' },
          { id: 'player', role: 'player', nick: 'PLAYER' },
        ]}
      />,
    );

    const select = screen.getByLabelText('迷路サイズ');
    expect(select).toHaveValue('20');
    fireEvent.change(select, { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'ゲーム開始' }));
    expect(send).toHaveBeenCalledWith({ type: 'O_START', mazeSize: 40 });
  });

  it('ルームIDを共有用に表示する', () => {
    render(
      <OwnerView
        client={null}
        roomId="ABC123"
        trapCharges={0}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={0}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
        editCooldownMs={0}
        phase="lobby"
        sessions={[]}
      />,
    );

    expect(screen.getByTestId('room-id')).toHaveTextContent('ABC123');
    expect(screen.getByText(/ルームID/)).toBeInTheDocument();
  });

  it('ゲーム開始前は迷路HUDを隠し、開始後に表示する', () => {
    const { rerender } = render(
      <OwnerView
        client={null}
        roomId="ROOM-1"
        trapCharges={3}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={60}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
        editCooldownMs={500}
        phase="lobby"
        sessions={[]}
      />,
    );

    expect(screen.queryByLabelText('俯瞰マップ')).not.toBeInTheDocument();
    expect(screen.queryByText('罠権利: 3')).not.toBeInTheDocument();

    rerender(
      <OwnerView
        client={null}
        roomId="ROOM-1"
        trapCharges={3}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={60}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
        editCooldownMs={500}
        phase="countdown"
        sessions={[]}
      />,
    );

    expect(screen.getByLabelText('俯瞰マップ')).toBeInTheDocument();
    expect(screen.getByText('罠権利: 3')).toBeInTheDocument();
    expect(screen.getByText('予測地点: 残り3 / 3')).toBeInTheDocument();
  });
});
