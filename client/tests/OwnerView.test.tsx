import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OwnerView } from '../src/views/OwnerView';
import { MAX_ACTIVE_TRAPS } from '../src/config/spec';

describe('OwnerView', () => {
  it('HUDに壁残数・罠権利・クールダウン・禁止エリア・予測地点数を表示する', () => {
    render(
      <OwnerView
        client={null}
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
});
