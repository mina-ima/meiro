import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OwnerView } from '../src/views/OwnerView';
import { MAX_ACTIVE_TRAPS } from '../src/config/spec';
import type { NetClient } from '../src/net/NetClient';

describe('OwnerView', () => {
  it('HUDに壁残数・罠権利・クールダウン・禁止エリア・予測地点数を表示する', () => {
    render(
      <OwnerView
        client={null}
        roomId="ROOM-1"
        wallCount={12}
        trapCharges={2}
        wallRemoveLeft={1}
        editCooldownMs={1_500}
        forbiddenDistance={2}
        activePredictions={2}
        predictionLimit={3}
        timeRemaining={75}
        predictionMarks={[{ x: 5, y: 6 }]}
        traps={[{ x: 2, y: 8 }]}
        playerPosition={{ x: 3.5, y: 4.5 }}
        mazeSize={20}
        phase="explore"
        sessions={[]}
      />,
    );

    expect(screen.getByText('壁残数: 12本')).toBeInTheDocument();
    expect(screen.getByText(`罠: 権利2 / 設置1/${MAX_ACTIVE_TRAPS}`)).toBeInTheDocument();
    expect(screen.getByText('壁削除権: 残り1回')).toBeInTheDocument();
    expect(screen.getByText('編集クールダウン: 1.5秒')).toBeInTheDocument();
    expect(screen.getByText('禁止エリア距離: 2')).toBeInTheDocument();
    expect(screen.getByText('予測地点: 2 / 3')).toBeInTheDocument();
    expect(screen.getByText(/プレイヤー座標/)).toHaveTextContent('3.5');

    const map = screen.getByLabelText('俯瞰マップ');
    const initialViewBox = map.getAttribute('viewBox');
    fireEvent.click(screen.getByRole('button', { name: 'ズームイン' }));
    expect(map.getAttribute('viewBox')).not.toBe(initialViewBox);
    fireEvent.click(screen.getByRole('button', { name: 'プレイヤーにセンタリング' }));
    expect(screen.getByTestId('player-marker')).toBeInTheDocument();
  });

  it('迷路サイズに応じた壁リソース上限をHUDで表示する', () => {
    render(
      <OwnerView
        client={null}
        roomId="ROOM-1"
        wallCount={12}
        trapCharges={1}
        wallRemoveLeft={1}
        editCooldownMs={1_000}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={120}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
        phase="explore"
        sessions={[]}
      />,
    );

    expect(screen.getByText('規定ポイント: 48')).toBeInTheDocument();
    expect(screen.getByText('ゴールボーナス: 10')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '達成率' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
  });

  it('ロビーでプレイヤー未参加なら参加状況を表示し開始ボタンを無効化する', () => {
    render(
      <OwnerView
        client={null}
        roomId="ROOM-1"
        wallCount={0}
        trapCharges={0}
        wallRemoveLeft={1}
        editCooldownMs={0}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={0}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
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
        wallCount={0}
        trapCharges={0}
        wallRemoveLeft={1}
        editCooldownMs={0}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={0}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
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
    expect(send).toHaveBeenCalledWith({ type: 'O_START' });
  });

  it('ルームIDを共有用に表示する', () => {
    render(
      <OwnerView
        client={null}
        roomId="ABC123"
        wallCount={0}
        trapCharges={0}
        wallRemoveLeft={1}
        editCooldownMs={0}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={0}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
        phase="lobby"
        sessions={[]}
      />,
    );

    expect(screen.getByTestId('room-id')).toHaveTextContent('ABC123');
    expect(screen.getByText(/ルームID/)).toBeInTheDocument();
  });
});
