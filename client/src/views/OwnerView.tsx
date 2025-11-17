import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { NetClient } from '../net/NetClient';
import { OWNER_ZOOM_LEVELS, MAX_ACTIVE_TRAPS } from '../config/spec';
import type { PauseReason, ServerSessionEntry, SessionPhase } from '../state/sessionStore';

interface Vector2 {
  x: number;
  y: number;
}

interface InitialSetupPanelProps {
  trapCharges: number;
  activeTrapCount: number;
  predictionLimit: number;
  remainingPredictions: number;
  timeText: string;
  pauseMessage: string | null;
}

function InitialSetupPanel({
  trapCharges,
  activeTrapCount,
  predictionLimit,
  remainingPredictions,
  timeText,
  pauseMessage,
}: InitialSetupPanelProps) {
  return (
    <section
      aria-label="初期設定情報"
      style={{
        minWidth: '240px',
        padding: '1rem',
        border: '1px solid #cbd5f5',
        borderRadius: '0.75rem',
        background: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a' }}>初期設定</h3>
      <p style={{ margin: 0 }}>罠権利: {trapCharges}</p>
      <p style={{ margin: 0 }}>
        罠: 設置{activeTrapCount}/{MAX_ACTIVE_TRAPS}
      </p>
      <p style={{ margin: 0 }}>
        予測地点: 残り{remainingPredictions} / {predictionLimit}
      </p>
      <p style={{ margin: 0 }}>設定残り時間: {timeText}</p>
      {pauseMessage ? (
        <p style={{ margin: 0, color: '#dc2626' }} aria-live="polite">
          {pauseMessage}
        </p>
      ) : null}
    </section>
  );
}

function formatSetupTime(remainingSeconds: number): string {
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
    return '0秒';
  }

  return `${Math.ceil(remainingSeconds)}秒`;
}

export interface OwnerViewProps {
  client: NetClient | null;
  roomId: string | null;
  trapCharges: number;
  forbiddenDistance: number;
  activePredictions: number;
  predictionLimit: number;
  timeRemaining: number;
  predictionMarks: Vector2[];
  traps: Vector2[];
  playerPosition: Vector2;
  mazeSize: 20 | 40;
  pauseReason?: PauseReason;
  pauseSecondsRemaining?: number;
  phase: SessionPhase;
  sessions: ServerSessionEntry[];
}

export function OwnerView({
  client,
  roomId,
  trapCharges,
  forbiddenDistance,
  activePredictions,
  predictionLimit,
  timeRemaining,
  predictionMarks,
  traps,
  playerPosition,
  mazeSize,
  pauseReason,
  pauseSecondsRemaining,
  phase,
  sessions,
}: OwnerViewProps) {
  const status = useMemo(() => (client ? '接続済み' : '未接続'), [client]);
  const clampedPredictions = Math.max(0, Math.min(activePredictions, predictionLimit));
  const activeTrapCount = Math.min(traps.length, MAX_ACTIVE_TRAPS);
  const remainingPredictions = Math.max(0, predictionLimit - clampedPredictions);
  const setupTimeText = formatSetupTime(timeRemaining);
  const ownerSession = useMemo(
    () => sessions.find((session) => session.role === 'owner'),
    [sessions],
  );
  const playerSession = useMemo(
    () => sessions.find((session) => session.role === 'player'),
    [sessions],
  );
  const ownerStatus = ownerSession ? `入室済 (${ownerSession.nick})` : '未接続';
  const playerStatus = playerSession ? `入室済 (${playerSession.nick})` : '未接続';
  const inLobby = phase === 'lobby';
  const canStartGame = Boolean(inLobby && ownerSession && playerSession);
  const phaseLabel = PHASE_LABELS[phase];

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

  const handleStartGame = useCallback(() => {
    if (!client || !canStartGame) {
      return;
    }
    client.send({ type: 'O_START' });
  }, [client, canStartGame]);

  return (
    <div>
      <h2>オーナービュー</h2>
      <p>接続状態: {status}</p>
      <p aria-live="polite">
        ルームID:{' '}
        <strong data-testid="room-id">
          {roomId && roomId.trim().length > 0 ? roomId : '取得中'}
        </strong>
      </p>
      <section
        aria-label="参加状況"
        style={{
          margin: '0 0 1rem',
          padding: '0.75rem',
          border: '1px solid #e2e8f0',
          borderRadius: '0.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          maxWidth: '420px',
        }}
      >
        <p style={{ margin: 0 }}>オーナー: {ownerStatus}</p>
        <p style={{ margin: 0 }}>プレイヤー: {playerStatus}</p>
        {inLobby ? (
          <>
            <button
              type="button"
              onClick={handleStartGame}
              disabled={!canStartGame || !client}
              aria-live="polite"
              style={{
                padding: '0.5rem',
                borderRadius: '0.375rem',
                border: '1px solid transparent',
                backgroundColor: !canStartGame || !client ? '#94a3b8' : '#0f766e',
                color: '#f8fafc',
                fontWeight: 600,
                cursor: !canStartGame || !client ? 'not-allowed' : 'pointer',
              }}
            >
              ゲーム開始
            </button>
            <small style={{ color: '#475569' }} aria-live="polite">
              {playerSession
                ? '両者が揃いました。ボタンを押すとカウントダウンが始まります。'
                : 'プレイヤーが入室すると開始できます。'}
            </small>
          </>
        ) : (
          <p style={{ margin: 0 }}>現在フェーズ: {phaseLabel}</p>
        )}
      </section>
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

        <InitialSetupPanel
          trapCharges={trapCharges}
          activeTrapCount={activeTrapCount}
          predictionLimit={predictionLimit}
          remainingPredictions={remainingPredictions}
          timeText={setupTimeText}
          pauseMessage={
            pauseReason === 'disconnect' && pauseSecondsRemaining !== undefined
              ? `通信再開待ち: 残り ${pauseSecondsRemaining} 秒`
              : null
          }
        />
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

const PHASE_LABELS: Record<SessionPhase, string> = {
  lobby: 'ロビー',
  countdown: 'カウントダウン',
  prep: '準備',
  explore: '探索',
  result: '結果',
};
