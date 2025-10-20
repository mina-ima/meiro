import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { NetClient } from '../net/NetClient';
import { HUD } from './HUD';
import { OWNER_ZOOM_LEVELS } from '../config/spec';

interface Vector2 {
  x: number;
  y: number;
}

export interface OwnerViewProps {
  client: NetClient | null;
  wallCount: number;
  trapCharges: number;
  wallRemoveLeft: 0 | 1;
  editCooldownMs: number;
  forbiddenDistance: number;
  activePredictions: number;
  predictionLimit: number;
  timeRemaining: number;
  predictionMarks: Vector2[];
  traps: Vector2[];
  playerPosition: Vector2;
  mazeSize: 20 | 40;
}

export function OwnerView({
  client,
  wallCount,
  trapCharges,
  wallRemoveLeft,
  editCooldownMs,
  forbiddenDistance,
  activePredictions,
  predictionLimit,
  timeRemaining,
  predictionMarks,
  traps,
  playerPosition,
  mazeSize,
}: OwnerViewProps) {
  const status = useMemo(() => (client ? '接続済み' : '未接続'), [client]);
  const cooldownText = formatCooldown(editCooldownMs);
  const clampedPredictions = Math.max(0, Math.min(activePredictions, predictionLimit));

  const [zoomIndex, setZoomIndex] = useState(3);
  const zoom = OWNER_ZOOM_LEVELS[zoomIndex];
  const [offset, setOffset] = useState(() => centerOffset(mazeSize, zoom));

  useEffect(() => {
    setOffset((prev) => clampOffset(prev, mazeSize, zoom));
  }, [mazeSize, zoom]);

  const handleZoomIn = useCallback(() => {
    setZoomIndex((index) => Math.min(index + 1, OWNER_ZOOM_LEVELS.length - 1));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomIndex((index) => Math.max(index - 1, 0));
  }, []);

  const handlePan = useCallback(
    (dx: number, dy: number) => {
      setOffset((prev) => {
        const viewSize = mazeSize / zoom;
        const panStep = Math.max(viewSize / 6, 1);
        const next = {
          x: prev.x + dx * panStep,
          y: prev.y + dy * panStep,
        };
        return clampOffset(next, mazeSize, zoom);
      });
    },
    [mazeSize, zoom],
  );

  const handleCenterOnPlayer = useCallback(() => {
    const viewSize = mazeSize / zoom;
    const next = {
      x: playerPosition.x - viewSize / 2,
      y: playerPosition.y - viewSize / 2,
    };
    setOffset(clampOffset(next, mazeSize, zoom));
  }, [mazeSize, zoom, playerPosition.x, playerPosition.y]);

  return (
    <div>
      <h2>オーナービュー</h2>
      <p>接続状態: {status}</p>
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <OwnerMap
          mazeSize={mazeSize}
          zoom={zoom}
          zoomIndex={zoomIndex}
          offset={offset}
          forbiddenDistance={forbiddenDistance}
          playerPosition={playerPosition}
          predictionMarks={predictionMarks}
          traps={traps}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onPan={handlePan}
          onCenterPlayer={handleCenterOnPlayer}
        />

        <HUD timeRemaining={timeRemaining} score={wallCount} targetScore={140}>
          <p>壁残数: {wallCount}本</p>
          <p>罠権利: {trapCharges}</p>
          <p>壁削除権: 残り{wallRemoveLeft}回</p>
          <p>編集クールダウン: {cooldownText}</p>
          <p>禁止エリア距離: {forbiddenDistance}</p>
          <p>
            予測地点: {clampedPredictions} / {predictionLimit}
          </p>
          <p>
            プレイヤー座標: ({playerPosition.x.toFixed(1)}, {playerPosition.y.toFixed(1)})
          </p>
        </HUD>
      </div>
    </div>
  );
}

interface OwnerMapProps {
  mazeSize: number;
  zoom: number;
  zoomIndex: number;
  offset: Vector2;
  forbiddenDistance: number;
  playerPosition: Vector2;
  predictionMarks: Vector2[];
  traps: Vector2[];
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPan: (dx: number, dy: number) => void;
  onCenterPlayer: () => void;
}

function OwnerMap({
  mazeSize,
  zoom,
  zoomIndex,
  offset,
  forbiddenDistance,
  playerPosition,
  predictionMarks,
  traps,
  onZoomIn,
  onZoomOut,
  onPan,
  onCenterPlayer,
}: OwnerMapProps) {
  const viewSize = mazeSize / zoom;
  const viewBox = `${offset.x} ${offset.y} ${viewSize} ${viewSize}`;

  const gridLines = useMemo(() => {
    const lines: ReactNode[] = [];
    const step = mazeSize <= 20 ? 1 : 2;
    for (let i = 0; i <= mazeSize; i += step) {
      const opacity = i % 5 === 0 ? 0.3 : 0.12;
      lines.push(
        <line
          key={`v-${i}`}
          x1={i}
          y1={0}
          x2={i}
          y2={mazeSize}
          stroke="#475569"
          strokeWidth={0.05}
          opacity={opacity}
        />,
      );
      lines.push(
        <line
          key={`h-${i}`}
          x1={0}
          y1={i}
          x2={mazeSize}
          y2={i}
          stroke="#475569"
          strokeWidth={0.05}
          opacity={opacity}
        />,
      );
    }
    return lines;
  }, [mazeSize]);

  const zoomOutDisabled = zoomIndex === 0;
  const zoomInDisabled = zoomIndex === OWNER_ZOOM_LEVELS.length - 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        <button
          type="button"
          onClick={onZoomOut}
          disabled={zoomOutDisabled}
          aria-label="ズームアウト"
        >
          －
        </button>
        <button type="button" onClick={onZoomIn} disabled={zoomInDisabled} aria-label="ズームイン">
          ＋
        </button>
        <button type="button" onClick={onCenterPlayer} aria-label="プレイヤーにセンタリング">
          プレイヤー中心
        </button>
        <div style={{ display: 'flex', gap: '0.35rem' }} aria-label="パン操作">
          <button type="button" onClick={() => onPan(0, -1)} aria-label="上にパン">
            ↑
          </button>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <button type="button" onClick={() => onPan(-1, 0)} aria-label="左にパン">
              ←
            </button>
            <button type="button" onClick={() => onPan(1, 0)} aria-label="右にパン">
              →
            </button>
          </div>
          <button type="button" onClick={() => onPan(0, 1)} aria-label="下にパン">
            ↓
          </button>
        </div>
      </div>

      <svg
        width={360}
        height={360}
        viewBox={viewBox}
        aria-label="俯瞰マップ"
        style={{
          border: '1px solid #475569',
          backgroundColor: '#0f172a',
          borderRadius: '0.5rem',
        }}
      >
        <rect x={0} y={0} width={mazeSize} height={mazeSize} fill="#111827" />
        {gridLines}

        <circle
          cx={playerPosition.x}
          cy={playerPosition.y}
          r={forbiddenDistance}
          fill="rgba(56, 189, 248, 0.08)"
          stroke="#38bdf8"
          strokeDasharray="1 1"
        >
          <title>禁止エリア</title>
        </circle>

        <circle
          cx={playerPosition.x}
          cy={playerPosition.y}
          r={0.4}
          fill="#38bdf8"
          stroke="#0ea5e9"
          data-testid="player-marker"
        >
          <title>プレイヤー位置</title>
        </circle>

        {predictionMarks.map((mark, index) => (
          <rect
            key={`pred-${index}`}
            x={mark.x}
            y={mark.y}
            width={1}
            height={1}
            fill="rgba(74, 222, 128, 0.35)"
            stroke="#22c55e"
            strokeWidth={0.08}
            data-testid="prediction-marker"
          >
            <title>予測地点</title>
          </rect>
        ))}

        {traps.map((trap, index) => (
          <circle
            key={`trap-${index}`}
            cx={trap.x + 0.5}
            cy={trap.y + 0.5}
            r={0.35}
            fill="#facc15"
            stroke="#f59e0b"
            data-testid="trap-marker"
          >
            <title>罠</title>
          </circle>
        ))}
      </svg>

      <div style={{ fontSize: '0.85rem', color: '#cbd5f5' }}>
        <p style={{ margin: 0 }}>ズーム: ×{zoom.toFixed(2)}</p>
      </div>
    </div>
  );
}

function clampOffset(offset: Vector2, mazeSize: number, zoom: number): Vector2 {
  const viewSize = mazeSize / zoom;
  const maxOffset = Math.max(mazeSize - viewSize, 0);
  return {
    x: clamp(offset.x, 0, maxOffset),
    y: clamp(offset.y, 0, maxOffset),
  };
}

function centerOffset(mazeSize: number, zoom: number): Vector2 {
  const viewSize = mazeSize / zoom;
  const base = Math.max((mazeSize - viewSize) / 2, 0);
  return { x: base, y: base };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function formatCooldown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0秒';
  }

  const seconds = Math.round((ms / 1000) * 10) / 10;
  if (Number.isInteger(seconds)) {
    return `${Math.trunc(seconds)}秒`;
  }

  return `${seconds}秒`;
}
