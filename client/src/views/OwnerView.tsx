import { useMemo } from 'react';
import type { NetClient } from '../net/NetClient';
import { HUD } from './HUD';

export interface OwnerViewProps {
  client: NetClient | null;
  wallCount: number;
  trapCharges: number;
}

export function OwnerView({ client, wallCount, trapCharges }: OwnerViewProps) {
  const status = useMemo(() => (client ? '接続済み' : '未接続'), [client]);

  return (
    <div>
      <h2>オーナービュー</h2>
      <p>接続状態: {status}</p>
      <HUD timeRemaining={60} score={wallCount} targetScore={140}>
        <p>罠残数: {trapCharges}</p>
      </HUD>
    </div>
  );
}
