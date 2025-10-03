import { useEffect, useMemo } from 'react';
import { OwnerView, PlayerView } from './views';
import { ToastHost } from './ui/toasts';
import { NetClient } from './net/NetClient';
import { useSessionStore } from './state/sessionStore';

const WS_ENDPOINT = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8787';

export function App() {
  const { role, roomId, score, targetScore, setRoom, setScore } = useSessionStore();

  useEffect(() => {
    // 仮の初期状態。UI 確認用にプレイヤー役割で起動する。
    setRoom('DEBUGROOM', 'player');
    setScore(0, 100);
  }, [setRoom, setScore]);

  const client = useMemo(() => {
    if (!roomId || !role) {
      return null;
    }

    return new NetClient({
      endpoint: WS_ENDPOINT,
      nick: 'debugger',
      role,
      room: roomId,
    });
  }, [roomId, role]);

  if (role === 'owner') {
    return (
      <>
        <OwnerView client={client} wallCount={120} trapCharges={1} />
        <ToastHost />
      </>
    );
  }

  return (
    <>
      <PlayerView points={score} targetPoints={targetScore} predictionHits={0} />
      <ToastHost />
    </>
  );
}
