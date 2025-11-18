import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OwnerView } from '../src/views/OwnerView';
import { MAX_ACTIVE_TRAPS } from '../src/config/spec';
import type { NetClient } from '../src/net/NetClient';
import { createMockMaze } from './helpers/mockMaze';

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

  it('設定ボタンで設定表示の開閉をトリガーする', () => {
    const toggle = vi.fn();
    render(
      <OwnerView
        client={null}
        roomId="ROOM-1"
        trapCharges={1}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={30}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
        editCooldownMs={0}
        phase="lobby"
        sessions={[]}
        onToggleSettings={toggle}
        settingsOpen
      />,
    );

    const button = screen.getByRole('button', { name: '設定' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('ゲーム開始後は設定ボタンを表示しない', () => {
    render(
      <OwnerView
        client={null}
        roomId="ROOM-1"
        trapCharges={1}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={30}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
        editCooldownMs={0}
        phase="explore"
        sessions={[]}
        onToggleSettings={vi.fn()}
        settingsOpen
      />,
    );

    expect(screen.queryByRole('button', { name: '設定' })).not.toBeInTheDocument();
  });

  it('受信した迷路データから壁を描画する', () => {
    const maze = createMockMaze(20);
    const { container } = render(
      <OwnerView
        client={null}
        roomId="ROOM-1"
        trapCharges={1}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={30}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={20}
        editCooldownMs={0}
        phase="explore"
        sessions={[]}
        maze={maze}
      />,
    );

    const topWall = container.querySelector('line[data-testid="maze-wall"][x1="0"][y1="0"][x2="1"][y2="0"]');
    const rightOuterWall = container.querySelector(
      'line[data-testid="maze-wall"][x1="20"][y1="0"][x2="20"][y2="1"]',
    );
    const bottomOuterWall = container.querySelector(
      'line[data-testid="maze-wall"][x1="0"][y1="20"][x2="1"][y2="20"]',
    );

    expect(topWall).not.toBeNull();
    expect(rightOuterWall).not.toBeNull();
    expect(bottomOuterWall).not.toBeNull();
  });

  it('準備フェーズで罠アイコンを配置するとO_EDITが送信される', () => {
    const send = vi.fn();
    const client = { send } as unknown as NetClient;
    const maze = createMockMaze(40);
    render(
      <OwnerView
        client={client}
        roomId="ROOM-DRAG"
        trapCharges={1}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={60}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={40}
        editCooldownMs={0}
        phase="prep"
        sessions={[
          { id: 'owner', role: 'owner', nick: 'OWNER' },
          { id: 'player', role: 'player', nick: 'PLAYER' },
        ]}
        maze={maze}
      />,
    );

    const trapIcon = screen.getByLabelText('罠アイコン');
    const map = screen.getByLabelText('俯瞰マップ');
    expect(map.getAttribute('data-placement-enabled')).toBe('true');
    mockBoundingRect(map);

    fireEvent.click(trapIcon);
    fireEvent.click(map, { clientX: 240, clientY: 240 });

    expect(send).toHaveBeenCalledWith({
      type: 'O_EDIT',
      edit: { action: 'PLACE_TRAP', cell: { x: 20, y: 20 } },
    });
  });

  it('準備フェーズで予測地点アイコンを配置するとO_MRKが送信される', () => {
    const send = vi.fn();
    const client = { send } as unknown as NetClient;
    render(
      <OwnerView
        client={client}
        roomId="ROOM-DRAG"
        trapCharges={2}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={60}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={40}
        editCooldownMs={0}
        phase="prep"
        sessions={[
          { id: 'owner', role: 'owner', nick: 'OWNER' },
          { id: 'player', role: 'player', nick: 'PLAYER' },
        ]}
        maze={createMockMaze(40)}
      />,
    );

    const predictionIcon = screen.getByLabelText('予測地点アイコン');
    const map = screen.getByLabelText('俯瞰マップ');
    expect(map.getAttribute('data-placement-enabled')).toBe('true');
    mockBoundingRect(map);

    fireEvent.click(predictionIcon);
    fireEvent.click(map, { clientX: 120, clientY: 120 });

    expect(send).toHaveBeenCalledWith({
      type: 'O_MRK',
      cell: { x: 10, y: 10 },
      active: true,
    });
  });

  it('準備フェーズ以外では配置しても送信されない', () => {
    const send = vi.fn();
    const client = { send } as unknown as NetClient;
    render(
      <OwnerView
        client={client}
        roomId="ROOM-DRAG"
        trapCharges={2}
        forbiddenDistance={2}
        activePredictions={0}
        predictionLimit={3}
        timeRemaining={60}
        predictionMarks={[]}
        traps={[]}
        playerPosition={{ x: 0, y: 0 }}
        mazeSize={40}
        editCooldownMs={0}
        phase="explore"
        sessions={[
          { id: 'owner', role: 'owner', nick: 'OWNER' },
          { id: 'player', role: 'player', nick: 'PLAYER' },
        ]}
        maze={createMockMaze(40)}
      />,
    );

    const trapIcon = screen.getByLabelText('罠アイコン');
    const map = screen.getByLabelText('俯瞰マップ');
    mockBoundingRect(map);

    fireEvent.click(trapIcon);
    fireEvent.click(map, { clientX: 200, clientY: 200 });

    expect(send).not.toHaveBeenCalled();
  });
});

function mockBoundingRect(element: Element) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    width: 480,
    height: 480,
    top: 0,
    left: 0,
    bottom: 480,
    right: 480,
    x: 0,
    y: 0,
    toJSON: () => {},
  } as DOMRect);
}
