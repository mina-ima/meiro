import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ChangeEvent,
  type ReactNode,
  type CSSProperties,
} from 'react';
import type { NetClient } from '../net/NetClient';
import {
  OWNER_ZOOM_LEVELS,
  MAX_ACTIVE_TRAPS,
  POINT_COUNT_LIMITS,
  POINT_TOTAL_MINIMUMS,
} from '../config/spec';
import type {
  PauseReason,
  ServerSessionEntry,
  ServerPoint,
  SessionPhase,
  ServerMazeState,
} from '../state/sessionStore';

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
  forbiddenDistance: number;
  editCooldownText: string;
  pointCount: number;
  pointCountLimit: number;
  pointTotalValue: number;
  pointTotalMinimum: number;
}

function InitialSetupPanel({
  trapCharges,
  activeTrapCount,
  predictionLimit,
  remainingPredictions,
  timeText,
  pauseMessage,
  forbiddenDistance,
  editCooldownText,
  pointCount,
  pointCountLimit,
  pointTotalValue,
  pointTotalMinimum,
}: InitialSetupPanelProps) {
  const remainingPoints = Math.max(0, pointCountLimit - pointCount);
  const totalShortfall = Math.max(0, pointTotalMinimum - pointTotalValue);
  const totalMet = pointTotalValue >= pointTotalMinimum;
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
      <p style={{ margin: 0 }}>禁止エリア距離: {forbiddenDistance}</p>
      <p style={{ margin: 0 }}>編集クールダウン: {editCooldownText}</p>
      <p style={{ margin: 0 }}>
        予測地点: 残り{remainingPredictions} / {predictionLimit}
      </p>
      <p style={{ margin: 0 }} data-testid="point-count-summary">
        ポイント: {pointCount}/{pointCountLimit}（残り{remainingPoints}個）
      </p>
      <p
        style={{ margin: 0, color: totalMet ? '#15803d' : '#dc2626' }}
        data-testid="point-total-summary"
      >
        合計点: {pointTotalValue}/{pointTotalMinimum}
        {totalMet ? '（条件達成）' : `（あと${totalShortfall}点必要）`}
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

function formatEditCooldown(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return '0.0秒';
  }

  const rounded = Math.round(remainingMs);
  return `${(rounded / 1000).toFixed(1)}秒`;
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
  points?: ServerPoint[];
  playerPosition: Vector2;
  playerAngle?: number;
  mazeSize: 20 | 40;
  maze?: ServerMazeState | null;
  editCooldownMs: number;
  pauseReason?: PauseReason;
  pauseSecondsRemaining?: number;
  phase: SessionPhase;
  sessions: ServerSessionEntry[];
  onToggleSettings?: () => void;
  settingsOpen?: boolean;
}

const DRAG_DATA_TYPE = 'application/meiro-owner-placement';
const PLAYER_MARKER_TIP_OFFSET = 0.6;
const PLAYER_MARKER_BASE_WIDTH = 0.7;
type PlacementType = 'point1' | 'point3' | 'point5' | 'trap' | 'prediction';
type PrepStage = 'point' | 'trap' | 'prediction' | 'ended';

const PREP_TOTAL_MS = 60_000;
const POINT_WINDOW_MS = 40_000;
const TRAP_WINDOW_MS = 5_000;

function getPrepStage(timeRemaining: number): PrepStage {
  const elapsed = PREP_TOTAL_MS - timeRemaining * 1000;
  if (elapsed < 0 || timeRemaining <= 0) return 'ended';
  if (elapsed < POINT_WINDOW_MS) return 'point';
  if (elapsed < POINT_WINDOW_MS + TRAP_WINDOW_MS) return 'trap';
  return 'prediction';
}

function getStageTimeRemaining(timeRemaining: number, stage: PrepStage): number {
  const elapsed = PREP_TOTAL_MS - timeRemaining * 1000;
  switch (stage) {
    case 'point': return Math.max(0, Math.ceil((POINT_WINDOW_MS - elapsed) / 1000));
    case 'trap': return Math.max(0, Math.ceil((POINT_WINDOW_MS + TRAP_WINDOW_MS - elapsed) / 1000));
    case 'prediction': return Math.max(0, Math.ceil(timeRemaining));
    default: return 0;
  }
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
  points = [],
  playerPosition,
  playerAngle = 0,
  mazeSize,
  maze,
  editCooldownMs,
  pauseReason,
  pauseSecondsRemaining,
  phase,
  sessions,
  onToggleSettings,
  settingsOpen,
}: OwnerViewProps) {
  const status = useMemo(() => (client ? '接続済み' : '未接続'), [client]);
  const clampedPredictions = Math.max(0, Math.min(activePredictions, predictionLimit));
  const activeTrapCount = Math.min(traps.length, MAX_ACTIVE_TRAPS);
  const remainingPredictions = Math.max(0, predictionLimit - clampedPredictions);
  const setupTimeText = formatSetupTime(timeRemaining);
  const pointCountLimit = POINT_COUNT_LIMITS[mazeSize];
  const pointTotalMinimum = POINT_TOTAL_MINIMUMS[mazeSize];
  const pointCount = points.length;
  const pointTotalValue = useMemo(
    () => points.reduce((sum, point) => sum + point.value, 0),
    [points],
  );
  const remainingPoints = Math.max(0, pointCountLimit - pointCount);
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
  const showSetupHud = !inLobby;
  const canStartGame = Boolean(inLobby && ownerSession && playerSession);
  const phaseLabel = PHASE_LABELS[phase];
  const editCooldownText = formatEditCooldown(editCooldownMs);

  const hasMazeData = Boolean(maze && maze.cells.length > 0);

  const getInitialZoomIndex = useCallback(() => {
    let fallback = 0;
    for (let i = 0; i < OWNER_ZOOM_LEVELS.length; i += 1) {
      const level = OWNER_ZOOM_LEVELS[i];
      if (level <= 1) {
        fallback = i;
      } else {
        break;
      }
    }
    return fallback;
  }, []);

  const [zoomIndex, setZoomIndex] = useState(() => getInitialZoomIndex());
  const zoom = OWNER_ZOOM_LEVELS[zoomIndex];
  const [offset, setOffset] = useState(() => centerOffset(mazeSize, zoom));
  const [selectedMazeSize, setSelectedMazeSize] = useState<20 | 40>(mazeSize);
  const [armedPlacement, setArmedPlacement] = useState<PlacementType | null>(null);

  useEffect(() => {
    const nextIndex = getInitialZoomIndex();
    setZoomIndex(nextIndex);
    setOffset(centerOffset(mazeSize, OWNER_ZOOM_LEVELS[nextIndex]));
  }, [mazeSize, getInitialZoomIndex]);

  useEffect(() => {
    setOffset((prev) => clampOffset(prev, mazeSize, zoom));
  }, [mazeSize, zoom]);

  useEffect(() => {
    setSelectedMazeSize(mazeSize);
  }, [mazeSize]);

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

  const handleMazeSizeChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const value = Number(event.target.value);
    if (value === 20 || value === 40) {
      setSelectedMazeSize(value);
    }
  }, []);

  const handleStartGame = useCallback(() => {
    if (!client || !canStartGame) {
      return;
    }
    client.send({ type: 'O_START', mazeSize: selectedMazeSize });
  }, [client, canStartGame, selectedMazeSize]);

  const placementEnabled = Boolean(client && phase === 'prep' && hasMazeData);
  const currentStage = getPrepStage(timeRemaining);

  // 罠/予測段階では自動的にツールを選択（クリックだけで配置可能に）
  useEffect(() => {
    if (!placementEnabled) {
      setArmedPlacement(null);
      return;
    }
    if (currentStage === 'trap') {
      setArmedPlacement('trap');
    } else if (currentStage === 'prediction') {
      setArmedPlacement('prediction');
    }
  }, [placementEnabled, currentStage]);

  useEffect(() => {
    if (!placementEnabled) {
      setArmedPlacement(null);
    }
  }, [placementEnabled]);

  const handlePlacementDrop = useCallback(
    (type: PlacementType, cell: Vector2) => {
      if (!client || phase !== 'prep') {
        return;
      }
      const payload = { x: cell.x, y: cell.y };
      if (type === 'point1' || type === 'point3' || type === 'point5') {
        const value = type === 'point1' ? 1 : type === 'point3' ? 3 : 5;
        client.send({
          type: 'O_EDIT',
          edit: { action: 'PLACE_POINT', cell: payload, value },
        });
      } else if (type === 'trap') {
        client.send({
          type: 'O_EDIT',
          edit: { action: 'PLACE_TRAP', cell: payload },
        });
      } else {
        client.send({ type: 'O_MRK', cell: payload, active: true });
      }
    },
    [client, phase],
  );

  const handleToolSelect = useCallback(
    (type: PlacementType) => {
      if (!placementEnabled) {
        return;
      }
      setArmedPlacement(type);
    },
    [placementEnabled],
  );

  const handlePlacementClick = useCallback(
    (cell: Vector2) => {
      if (!armedPlacement) {
        return;
      }
      handlePlacementDrop(armedPlacement, cell);
    },
    [armedPlacement, handlePlacementDrop],
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ margin: 0 }}>オーナービュー</h2>
        {onToggleSettings && inLobby ? (
          <button
            type="button"
            onClick={onToggleSettings}
            aria-pressed={settingsOpen ?? false}
            style={{
              padding: '0.4rem 0.75rem',
              borderRadius: '9999px',
              border: '1px solid #0f172a',
              backgroundColor: settingsOpen ? '#0f172a' : '#e2e8f0',
              color: settingsOpen ? '#f8fafc' : '#0f172a',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            設定
          </button>
        ) : null}
      </div>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <label htmlFor="maze-size-select" style={{ fontWeight: 600 }}>
                迷路サイズ
              </label>
              <select
                id="maze-size-select"
                value={String(selectedMazeSize)}
                onChange={handleMazeSizeChange}
                style={{
                  padding: '0.45rem',
                  borderRadius: '0.375rem',
                  border: '1px solid #94a3b8',
                  maxWidth: '180px',
                }}
              >
                <option value="20">20 × 20</option>
                <option value="40">40 × 40</option>
              </select>
            </div>
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
      {showSetupHud ? (
        <div
          style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}
          aria-live="polite"
        >
          <OwnerMap
            mazeSize={mazeSize}
            maze={maze ?? null}
            zoom={zoom}
            zoomIndex={zoomIndex}
            offset={offset}
            playerPosition={playerPosition}
            playerAngle={playerAngle}
            predictionMarks={predictionMarks}
            traps={traps}
            points={points}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onPan={handlePan}
            onCenterPlayer={handleCenterOnPlayer}
            onPlacementDrop={handlePlacementDrop}
            placementEnabled={placementEnabled}
            onPlacementClick={handlePlacementClick}
            activePlacement={armedPlacement}
          />

          <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <InitialSetupPanel
              trapCharges={trapCharges}
              activeTrapCount={activeTrapCount}
              predictionLimit={predictionLimit}
              remainingPredictions={remainingPredictions}
              timeText={setupTimeText}
              forbiddenDistance={forbiddenDistance}
              editCooldownText={editCooldownText}
              pointCount={pointCount}
              pointCountLimit={pointCountLimit}
              pointTotalValue={pointTotalValue}
              pointTotalMinimum={pointTotalMinimum}
              pauseMessage={
                pauseReason === 'disconnect' && pauseSecondsRemaining !== undefined
                  ? `通信再開待ち: 残り ${pauseSecondsRemaining} 秒`
                  : null
              }
            />
            <PlacementPalette
              trapCharges={trapCharges}
              predictionRemaining={remainingPredictions}
              disabled={!placementEnabled}
              onSelect={handleToolSelect}
              activePlacement={armedPlacement}
              timeRemaining={timeRemaining}
              pointRemaining={remainingPoints}
              pointCountLimit={pointCountLimit}
              pointTotalValue={pointTotalValue}
              pointTotalMinimum={pointTotalMinimum}
            />
          </div>
        </div>
      ) : (
        <section
          aria-label="初期設定待機中"
          style={{
            marginTop: '1rem',
            padding: '1rem',
            border: '1px solid #cbd5f5',
            borderRadius: '0.75rem',
            background: '#f8fafc',
            maxWidth: '520px',
          }}
        >
          <p style={{ margin: 0 }}>
            ゲーム開始を押すと迷路が自動設計され、罠/予測地点を設定する60秒の準備が始まります。
          </p>
          <p style={{ margin: '0.5rem 0 0', color: '#475569' }}>
            プレイヤーの探索が始まるまでは他のHUD情報は表示されません。
          </p>
        </section>
      )}
    </div>
  );
}

interface OwnerMapProps {
  mazeSize: number;
  maze: ServerMazeState | null;
  zoom: number;
  zoomIndex: number;
  offset: Vector2;
  playerPosition: Vector2;
  playerAngle?: number;
  predictionMarks: Vector2[];
  traps: Vector2[];
  points?: ServerPoint[];
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPan: (dx: number, dy: number) => void;
  onCenterPlayer: () => void;
  onPlacementDrop?: (type: PlacementType, cell: Vector2) => void;
  placementEnabled?: boolean;
  onPlacementClick?: (cell: Vector2) => void;
  activePlacement?: PlacementType | null;
}

function OwnerMap({
  mazeSize,
  maze,
  zoom,
  zoomIndex,
  offset,
  playerPosition,
  playerAngle = 0,
  predictionMarks,
  traps,
  points = [],
  onZoomIn,
  onZoomOut,
  onPan,
  onCenterPlayer,
  onPlacementDrop,
  placementEnabled = false,
  onPlacementClick,
  activePlacement,
}: OwnerMapProps) {
  const viewSize = mazeSize / zoom;
  const viewBox = `${offset.x} ${offset.y} ${viewSize} ${viewSize}`;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const playerMarkerPoints = useMemo(() => {
    const baseOffset = PLAYER_MARKER_TIP_OFFSET / 2;
    const halfBase = PLAYER_MARKER_BASE_WIDTH / 2;
    const tipX = playerPosition.x;
    const tipY = playerPosition.y - PLAYER_MARKER_TIP_OFFSET;
    const baseY = playerPosition.y + baseOffset;
    const leftX = playerPosition.x - halfBase;
    const rightX = playerPosition.x + halfBase;
    return `${tipX},${tipY} ${leftX},${baseY} ${rightX},${baseY}`;
  }, [playerPosition.x, playerPosition.y]);

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

  const wallSegments = useMemo(() => {
    if (!maze) {
      return [] as Array<{ key: string; x1: number; y1: number; x2: number; y2: number }>;
    }
    const segments: Array<{ key: string; x1: number; y1: number; x2: number; y2: number }> = [];
    for (const cell of maze.cells) {
      const x = cell.x;
      const y = cell.y;
      const nextX = x + 1;
      const nextY = y + 1;
      if (cell.walls.top) {
        segments.push({ key: `t-${x}-${y}`, x1: x, y1: y, x2: nextX, y2: y });
      }
      if (cell.walls.left) {
        segments.push({ key: `l-${x}-${y}`, x1: x, y1: y, x2: x, y2: nextY });
      }
      if (cell.walls.right && x === mazeSize - 1) {
        segments.push({ key: `r-${x}-${y}`, x1: nextX, y1: y, x2: nextX, y2: nextY });
      }
      if (cell.walls.bottom && y === mazeSize - 1) {
        segments.push({ key: `b-${x}-${y}`, x1: x, y1: nextY, x2: nextX, y2: nextY });
      }
    }
    return segments;
  }, [maze, mazeSize]);

  const zoomOutDisabled = zoomIndex === 0;
  const zoomInDisabled = zoomIndex === OWNER_ZOOM_LEVELS.length - 1;
  const hasMaze = Boolean(maze && maze.cells.length > 0);

  const handleDragOver = useCallback(
    (event: React.DragEvent<SVGSVGElement>) => {
      if (!placementEnabled) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    [placementEnabled],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<SVGSVGElement>) => {
      if (!placementEnabled) {
        return;
      }
      const type = event.dataTransfer?.getData(DRAG_DATA_TYPE) as PlacementType | '';
      if (type !== 'trap' && type !== 'prediction') {
        return;
      }
      event.preventDefault();
      const svgElement = svgRef.current;
      if (!svgElement) {
        return;
      }
      const cell = mapEventToCell(event.clientX, event.clientY, svgElement, offset, mazeSize, zoom);
      if (!cell) {
        return;
      }
      onPlacementDrop?.(type, cell);
    },
    [mazeSize, offset, onPlacementDrop, placementEnabled, zoom],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (!placementEnabled || !onPlacementClick || !activePlacement) {
        return;
      }
      const svgElement = svgRef.current;
      if (!svgElement) {
        return;
      }
      const cell = mapEventToCell(event.clientX, event.clientY, svgElement, offset, mazeSize, zoom);
      if (!cell) {
        return;
      }
      onPlacementClick(cell);
    },
    [activePlacement, mazeSize, offset, onPlacementClick, placementEnabled, zoom],
  );

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
        ref={svgRef}
        width={480}
        height={480}
        viewBox={viewBox}
        aria-label="俯瞰マップ"
        style={{
          border: '1px solid #475569',
          backgroundColor: '#0f172a',
          borderRadius: '0.5rem',
          width: 'min(520px, 90vw)',
          height: 'min(520px, 90vw)',
          cursor: placementEnabled ? 'copy' : 'default',
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
        data-placement-enabled={placementEnabled}
      >
        <rect x={0} y={0} width={mazeSize} height={mazeSize} fill="#111827" />
        {gridLines}

        {hasMaze ? (
          wallSegments.map((segment) => (
            <line
              key={segment.key}
              x1={segment.x1}
              y1={segment.y1}
              x2={segment.x2}
              y2={segment.y2}
              stroke="#e2e8f0"
              strokeWidth={0.2}
              strokeLinecap="round"
              data-testid="maze-wall"
            />
          ))
        ) : (
          <text
            x={mazeSize / 2}
            y={mazeSize / 2}
            fill="#94a3b8"
            fontSize={Math.max(mazeSize / 12, 1.5)}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            迷路生成中…
          </text>
        )}

        {maze ? (
          <>
            <rect
              x={maze.start.x}
              y={maze.start.y}
              width={1}
              height={1}
              fill="rgba(59, 130, 246, 0.15)"
              stroke="#3b82f6"
              strokeWidth={0.12}
              data-testid="maze-start"
            />
            <rect
              x={maze.goal.x}
              y={maze.goal.y}
              width={1}
              height={1}
              fill="rgba(250, 204, 21, 0.25)"
              stroke="#fbbf24"
              strokeWidth={0.12}
              data-testid="maze-goal"
            />
          </>
        ) : null}

        <polygon
          points={playerMarkerPoints}
          fill="#38bdf8"
          stroke="#0ea5e9"
          strokeWidth={0.12}
          strokeLinejoin="round"
          data-testid="player-marker"
          transform={`rotate(${(playerAngle * 180) / Math.PI + 90} ${playerPosition.x} ${playerPosition.y})`}
        >
          <title>プレイヤー位置</title>
        </polygon>

        {points.map((point, index) => (
          <g key={`point-${index}`} data-testid="point-marker">
            <circle
              cx={point.position.x + 0.5}
              cy={point.position.y + 0.5}
              r={0.45}
              fill={point.value === 5 ? '#f59e0b' : point.value === 3 ? '#3b82f6' : '#94a3b8'}
              stroke="#fff"
              strokeWidth={0.08}
            />
            <text
              x={point.position.x + 0.5}
              y={point.position.y + 0.5}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={0.7}
              fill="#fff"
              fontWeight="bold"
              data-testid="point-marker-label"
            >
              {point.value}
            </text>
            <title>{point.value}点ポイント</title>
          </g>
        ))}

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

function mapEventToCell(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
  offset: Vector2,
  mazeSize: number,
  zoom: number,
): Vector2 | null {
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return null;
  }
  const viewSize = mazeSize / zoom;
  const relativeX = ((clientX - rect.left) / rect.width) * viewSize + offset.x;
  const relativeY = ((clientY - rect.top) / rect.height) * viewSize + offset.y;
  if (Number.isNaN(relativeX) || Number.isNaN(relativeY)) {
    return null;
  }

  const cellX = clamp(Math.floor(relativeX), 0, mazeSize - 1);
  const cellY = clamp(Math.floor(relativeY), 0, mazeSize - 1);
  return { x: cellX, y: cellY };
}

interface PlacementPaletteProps {
  trapCharges: number;
  predictionRemaining: number;
  disabled: boolean;
  onSelect?: (type: PlacementType) => void;
  activePlacement?: PlacementType | null;
  timeRemaining: number;
  pointRemaining: number;
  pointCountLimit: number;
  pointTotalValue: number;
  pointTotalMinimum: number;
}

function PlacementPalette({
  trapCharges,
  predictionRemaining,
  disabled,
  onSelect,
  activePlacement,
  timeRemaining,
  pointRemaining,
  pointCountLimit,
  pointTotalValue,
  pointTotalMinimum,
}: PlacementPaletteProps) {
  const stage = getPrepStage(timeRemaining);
  const stageTime = getStageTimeRemaining(timeRemaining, stage);

  const stageLabel: Record<PrepStage, string> = {
    point: '📦 ポイント配置時間',
    trap: '🪤 罠配置時間',
    prediction: '🎯 予測配置時間',
    ended: '⏱ 準備終了',
  };

  const btnStyle = (type: PlacementType, active: boolean): CSSProperties => ({
    padding: '0.4rem 0.75rem',
    borderRadius: '0.375rem',
    border: active ? '2px solid #38bdf8' : '1px solid #334155',
    backgroundColor: disabled ? '#1e293b' : '#0f172a',
    color: '#f8fafc',
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: '0.4rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    userSelect: 'none' as const,
    fontSize: '0.85rem',
    boxShadow: active ? '0 0 0 2px rgba(56,189,248,0.5)' : 'none',
  });

  return (
    <section
      aria-label="設置ツール"
      style={{ border: '1px solid #1f2937', borderRadius: '0.75rem', padding: '0.75rem' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <strong style={{ color: '#f8fafc' }}>{stageLabel[stage]}</strong>
        <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>残り {stageTime}秒</span>
      </div>

      {stage === 'point' ? (
        <div
          style={{ marginBottom: '0.5rem', color: '#cbd5f5', fontSize: '0.8rem' }}
          data-testid="point-palette-summary"
        >
          残り {pointRemaining}個 / 上限 {pointCountLimit}個 ｜ 合計 {pointTotalValue} / 下限{' '}
          {pointTotalMinimum}点
          {pointTotalValue >= pointTotalMinimum ? (
            <span style={{ color: '#4ade80', marginLeft: '0.4rem' }}>達成</span>
          ) : (
            <span style={{ color: '#f87171', marginLeft: '0.4rem' }}>
              不足{Math.max(0, pointTotalMinimum - pointTotalValue)}点
            </span>
          )}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {stage === 'point' ? (
          <>
            <div
              role="button"
              aria-label="1点ポイント"
              style={btnStyle('point1', activePlacement === 'point1')}
              onClick={() => onSelect?.('point1')}
            >
              <span>📦</span><span>1点</span>
            </div>
            <div
              role="button"
              aria-label="3点ポイント"
              style={btnStyle('point3', activePlacement === 'point3')}
              onClick={() => onSelect?.('point3')}
            >
              <span>📦</span><span>3点</span>
            </div>
            <div
              role="button"
              aria-label="5点ポイント"
              style={btnStyle('point5', activePlacement === 'point5')}
              onClick={() => onSelect?.('point5')}
            >
              <span>📦</span><span>5点</span>
            </div>
          </>
        ) : stage === 'trap' ? (
          <div
            role="button"
            aria-label="罠アイコン"
            style={btnStyle('trap', activePlacement === 'trap')}
            onClick={() => onSelect?.('trap')}
          >
            <span>🪤</span><span>罠</span>
            <small style={{ color: '#94a3b8' }}>×{trapCharges}</small>
          </div>
        ) : stage === 'prediction' ? (
          <div
            role="button"
            aria-label="予測地点アイコン"
            style={btnStyle('prediction', activePlacement === 'prediction')}
            onClick={() => onSelect?.('prediction')}
          >
            <span>🎯</span><span>予測</span>
            <small style={{ color: '#94a3b8' }}>×{predictionRemaining}</small>
          </div>
        ) : (
          <p style={{ margin: 0, color: '#94a3b8' }}>探索フェーズに移行します…</p>
        )}
      </div>

      <p style={{ margin: '0.5rem 0 0', color: '#64748b', fontSize: '0.8rem' }}>
        {stage === 'point' ? 'マップをクリックしてポイントを配置' :
         stage === 'trap' ? 'マップをクリックして罠を設置' :
         stage === 'prediction' ? 'マップをクリックして予測地点をマーク' : ''}
      </p>
    </section>
  );
}
