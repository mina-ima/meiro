import { useCallback, useEffect, useMemo, useRef, useState, ChangeEvent, FormEvent } from 'react';
import { NetClient } from './net/NetClient';
import {
  useSessionStore,
  type PlayerRole,
  type NetworkStatePayload,
  normalizeServerPayload,
} from './state/sessionStore';
import { logClientInit, logClientError, logPhaseChange } from './logging/telemetry';
import { OwnerView, PlayerView } from './views';
import { ToastHost, enqueueErrorToast, enqueueInfoToast } from './ui/toasts';
import { DebugHUD } from './ui/DebugHUD';
import { getOptionalWsBase } from './config/env';

const WS_BASE = getOptionalWsBase();
const DEFAULT_HTTP_ENDPOINT = import.meta.env.PROD
  ? 'https://meiro-server.minamidenshi.workers.dev'
  : null;

const HTTP_ENDPOINT = resolveHttpEndpoint(
  import.meta.env.VITE_HTTP_ORIGIN ?? DEFAULT_HTTP_ENDPOINT,
  WS_BASE ? `${WS_BASE}/ws` : null,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNetworkStatePayload(value: unknown): value is NetworkStatePayload {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.seq !== 'number' || typeof value.full !== 'boolean') {
    return false;
  }

  if (value.full) {
    return isRecord(value.snapshot);
  }

  return isRecord(value.changes);
}

export function App() {
  const role = useSessionStore((state) => state.role);
  const roomId = useSessionStore((state) => state.roomId);
  const nick = useSessionStore((state) => state.nick);
  const score = useSessionStore((state) => state.score);
  const targetScore = useSessionStore((state) => state.targetScore);
  const pointCompensationAward = useSessionStore((state) => state.pointCompensationAward);
  const ownerState = useSessionStore((state) => state.owner);
  const playerState = useSessionStore((state) => state.player);
  const phase = useSessionStore((state) => state.phase);
  const phaseEndsAt = useSessionStore((state) => state.phaseEndsAt);
  const paused = useSessionStore((state) => state.paused);
  const pauseReason = useSessionStore((state) => state.pauseReason);
  const pauseExpiresAt = useSessionStore((state) => state.pauseExpiresAt);
  const pauseRemainingMs = useSessionStore((state) => state.pauseRemainingMs);
  const pausePhase = useSessionStore((state) => state.pausePhase);
  const mazeSize = useSessionStore((state) => state.mazeSize);
  const maze = useSessionStore((state) => state.maze);
  const serverSnapshot = useSessionStore((state) => state.serverSnapshot);
  const applyServerState = useSessionStore((state) => state.applyServerState);
  const setRoom = useSessionStore((state) => state.setRoom);
  const setNickState = useSessionStore((state) => state.setNick);
  const resetSession = useSessionStore((state) => state.reset);
  const timeRemaining = useTimeRemaining(phaseEndsAt);
  const previousPhase = useRef(phase);
  const [debugHudVisible, setDebugHudVisible] = useState(false);

  useEffect(() => {
    logClientInit({
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    });
  }, []);

  useEffect(() => {
    if (previousPhase.current !== phase) {
      const countdownMs = phaseEndsAt ? Math.max(phaseEndsAt - Date.now(), 0) : undefined;
      logPhaseChange(phase, countdownMs);
      previousPhase.current = phase;
    }
  }, [phase, phaseEndsAt]);

  const beginSession = useCallback(
    (room: string, nextRole: PlayerRole, nickname: string) => {
      const normalizedNick = resolveConnectionNick(nickname);
      resetSession();
      setNickState(normalizedNick);
      setRoom(room, nextRole, normalizedNick);
    },
    [resetSession, setNickState, setRoom],
  );

  const handleServerMessage = useCallback(
    (data: unknown) => {
      if (!isRecord(data) || typeof data.type !== 'string') {
        return;
      }

      if (data.type === 'STATE') {
        const payload = (data as { payload?: unknown }).payload;
        if (isNetworkStatePayload(payload)) {
          applyServerState(normalizeServerPayload(payload));
        }
        return;
      }

      if (data.type === 'ERR' && typeof data.code === 'string') {
        enqueueErrorToast(data.code);
        logClientError(data.code);
      }
    },
    [applyServerState],
  );

  const client = useMemo(() => {
    if (!roomId || !role || !WS_BASE) {
      return null;
    }

    const nickname = resolveConnectionNick(nick);

    return new NetClient(
      {
        base: WS_BASE,
        nick: nickname,
        role,
        room: roomId,
      },
      {
        onMessage: handleServerMessage,
        onError: () => {
          enqueueErrorToast('NETWORK_ERROR');
        },
      },
    );
  }, [roomId, role, handleServerMessage, nick]);

  useEffect(() => {
    if (!client) {
      return;
    }

    client.connect();
    return () => {
      client.dispose();
    };
  }, [client]);

  const previousPredictionHits = useRef(playerState.predictionHits);

  useEffect(() => {
    if (role !== 'player') {
      previousPredictionHits.current = playerState.predictionHits;
      return;
    }

    if (playerState.predictionHits > previousPredictionHits.current) {
      enqueueInfoToast('予測地点を通過！');
    }

    previousPredictionHits.current = playerState.predictionHits;
  }, [playerState.predictionHits, role]);

  const ownerCooldownMs = useCountdown(ownerState.editCooldownUntil, 100);
  const forbiddenDistance = ownerState.forbiddenDistance;
  const hasAuthoritativeState = serverSnapshot !== null;
  const isRoleAssigned = role === 'owner' || role === 'player';
  const readyForGameplay = hasAuthoritativeState && isRoleAssigned;
  useEffect(() => {
    if (!readyForGameplay || role !== 'owner' || phase !== 'lobby') {
      setDebugHudVisible(false);
    }
  }, [readyForGameplay, role, phase]);
  const pauseTargetMs =
    paused && pauseReason === 'disconnect' ? (pauseExpiresAt ?? undefined) : undefined;
  const pauseCountdownMs = useCountdown(pauseTargetMs, 1_000);
  const rawPauseRemainingMs =
    paused && pauseReason === 'disconnect'
      ? pauseTargetMs != null
        ? pauseCountdownMs
        : (pauseRemainingMs ?? 0)
      : 0;
  const pauseSecondsRemaining =
    paused && pauseReason === 'disconnect' ? Math.max(0, Math.ceil(rawPauseRemainingMs / 1000)) : 0;
  const pauseInfo =
    paused && pauseReason === 'disconnect'
      ? {
          reason: pauseReason,
          secondsRemaining: pauseSecondsRemaining,
          phase: pausePhase,
        }
      : null;
  const showDebugHud = debugHudVisible && readyForGameplay && role === 'owner' && phase === 'lobby';

  const mainView =
    role == null ? (
      <LobbyView
        httpEndpoint={HTTP_ENDPOINT}
        defaultNick={nick ?? ''}
        onNicknamePersist={setNickState}
        onBeginSession={beginSession}
      />
    ) : !readyForGameplay ? (
      <WaitingView role={role} hasAuthoritativeState={hasAuthoritativeState} roomId={roomId} />
    ) : role === 'owner' ? (
      <OwnerView
        client={client}
        roomId={roomId}
        trapCharges={ownerState.trapCharges}
        forbiddenDistance={forbiddenDistance}
        activePredictions={ownerState.activePredictionCount}
        predictionLimit={ownerState.predictionLimit}
        timeRemaining={timeRemaining}
        predictionMarks={ownerState.predictionMarks}
        traps={ownerState.traps}
        playerPosition={playerState.position}
        mazeSize={mazeSize}
        maze={maze}
        editCooldownMs={ownerCooldownMs}
        pauseReason={pauseInfo?.reason}
        pauseSecondsRemaining={pauseInfo?.secondsRemaining}
        phase={phase}
        sessions={serverSnapshot?.sessions ?? []}
        onToggleSettings={
          phase === 'lobby' ? () => setDebugHudVisible((visible) => !visible) : undefined
        }
        settingsOpen={phase === 'lobby' ? debugHudVisible : false}
      />
    ) : (
      <PlayerView
        points={score}
        targetPoints={targetScore}
        predictionHits={playerState.predictionHits}
        phase={phase}
        timeRemaining={timeRemaining}
        pauseReason={pauseInfo?.reason}
        pauseSecondsRemaining={pauseInfo?.secondsRemaining}
        compensationBonus={pointCompensationAward}
      />
    );
  const pauseOverlay = pauseInfo ? (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.88)',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        gap: '0.75rem',
        padding: '1.5rem',
        fontSize: '1rem',
      }}
    >
      <h3 style={{ margin: 0, fontSize: '1.4rem' }}>通信が途切れています</h3>
      <p style={{ margin: 0 }}>
        再接続を待機しています。残り {pauseInfo.secondsRemaining} 秒で不在側の敗北となります。
      </p>
      <p style={{ margin: 0 }}>どちらかが復帰すると自動で再開します。</p>
    </div>
  ) : null;

  return (
    <>
      <div style={{ position: 'relative' }}>
        {mainView}
        {pauseOverlay}
      </div>
      {showDebugHud ? (
        <DebugHUD
          role={role}
          mazeSize={mazeSize}
          timeRemaining={timeRemaining}
          owner={{
            wallStock: ownerState.wallStock,
            trapCharges: ownerState.trapCharges,
            wallRemoveLeft: ownerState.wallRemoveLeft,
            predictionLimit: ownerState.predictionLimit,
            activePredictionCount: ownerState.activePredictionCount,
            predictionHits: ownerState.predictionHits,
            predictionMarks: ownerState.predictionMarks,
            traps: ownerState.traps,
            forbiddenDistance: ownerState.forbiddenDistance,
            editCooldownDuration: ownerState.editCooldownDuration,
          }}
          player={{
            position: playerState.position,
            predictionHits: playerState.predictionHits,
          }}
          ownerCooldownMs={ownerCooldownMs}
        />
      ) : null}
      <ToastHost />
    </>
  );
}

function sanitizeNicknameInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 10);
}

function normalizeNickname(value: string): string {
  return sanitizeNicknameInput(value);
}

function isValidNickname(nick: string): boolean {
  return /^[A-Z0-9_-]{2,10}$/.test(nick);
}

function normalizeRoomCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z2-9]/g, '')
    .slice(0, 6);
}

function isValidRoomCode(code: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code);
}

function resolveHttpEndpoint(envValue: unknown, wsEndpoint: string | null): string | null {
  if (typeof envValue === 'string') {
    const trimmed = envValue.trim();
    if (trimmed.length > 0) {
      return trimTrailingSlash(trimmed);
    }
  }
  if (!wsEndpoint) {
    return null;
  }
  return deriveHttpOriginFromWs(wsEndpoint);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function deriveHttpOriginFromWs(wsUrl: string): string | null {
  try {
    const url = new URL(wsUrl);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return trimTrailingSlash(url.toString());
  } catch {
    return null;
  }
}

function resolveConnectionNick(nick?: string | null): string {
  const normalized = normalizeNickname(nick ?? '');
  return isValidNickname(normalized) ? normalized : 'debugger';
}

function useTimeRemaining(targetMs?: number): number {
  const remainingMs = useCountdown(targetMs, 1_000);
  if (targetMs == null) {
    return 0;
  }
  if (remainingMs <= 0) {
    return 0;
  }
  return Math.ceil(remainingMs / 1000);
}

function useCountdown(targetMs?: number, intervalMs: number = 1_000): number {
  const [remaining, setRemaining] = useState(() => computeRemainingMs(targetMs));

  useEffect(() => {
    const next = computeRemainingMs(targetMs);
    setRemaining(next);

    if (!shouldScheduleCountdown(targetMs)) {
      return;
    }

    let timerId: number | undefined;

    const tick = () => {
      const updated = computeRemainingMs(targetMs);
      setRemaining((previous) => {
        if (Math.abs(previous - updated) < 1) {
          return previous;
        }
        return updated;
      });

      if (updated <= 0 && timerId !== undefined) {
        window.clearInterval(timerId);
        timerId = undefined;
      }
    };

    timerId = window.setInterval(tick, intervalMs);
    return () => {
      if (timerId !== undefined) {
        window.clearInterval(timerId);
      }
    };
  }, [targetMs, intervalMs]);

  return remaining;
}

function computeRemainingMs(targetMs?: number): number {
  if (targetMs == null || !Number.isFinite(targetMs)) {
    return 0;
  }
  return Math.max(0, targetMs - Date.now());
}

function shouldScheduleCountdown(targetMs?: number): boolean {
  if (targetMs == null || !Number.isFinite(targetMs)) {
    return false;
  }
  return targetMs > Date.now();
}

interface LobbyViewProps {
  httpEndpoint: string | null;
  defaultNick: string;
  onNicknamePersist: (nick: string | null) => void;
  onBeginSession: (roomId: string, role: PlayerRole, nickname: string) => void;
}

export function LobbyView({
  httpEndpoint,
  defaultNick,
  onNicknamePersist,
  onBeginSession,
}: LobbyViewProps) {
  const [nickInput, setNickInput] = useState(sanitizeNicknameInput(defaultNick));
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [selectedRole, setSelectedRole] = useState<PlayerRole>('player');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    setNickInput(sanitizeNicknameInput(defaultNick));
  }, [defaultNick]);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const handleNicknameChange = (event: ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizeNicknameInput(event.target.value);
    setNickInput(sanitized);
    onNicknamePersist(sanitized.length > 0 ? sanitized : null);
  };

  const handleRoomCodeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const sanitized = normalizeRoomCode(event.target.value);
    setRoomCodeInput(sanitized);
  };

  const handleRoleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value === 'owner' ? 'owner' : 'player';
    setSelectedRole(value);
  };

  const wsUnavailable = WS_BASE == null;
  const httpUnavailable = httpEndpoint == null;
  const infraUnavailable = wsUnavailable || httpUnavailable;
  const handleCreateRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedNick = normalizeNickname(nickInput);
    if (!isValidNickname(normalizedNick)) {
      enqueueErrorToast('INVALID_NAME');
      return;
    }
    if (!httpEndpoint || wsUnavailable) {
      enqueueErrorToast('NETWORK_ERROR');
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch(`${httpEndpoint}/rooms`, { method: 'POST' });
      if (!response.ok) {
        throw new Error('create-room-failed');
      }
      const result = (await response.json()) as { roomId?: string };
      const roomId = normalizeRoomCode(result.roomId ?? '');
      if (!isValidRoomCode(roomId)) {
        throw new Error('invalid-room-id');
      }
      enqueueInfoToast(`ルームID ${roomId} を作成しました。`);
      onBeginSession(roomId, 'owner', normalizedNick);
    } catch {
      enqueueErrorToast('NETWORK_ERROR');
    } finally {
      if (isMountedRef.current) {
        setIsCreating(false);
      }
    }
  };

  const handleJoinRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedNick = normalizeNickname(nickInput);
    const normalizedRoom = normalizeRoomCode(roomCodeInput);

    if (!isValidNickname(normalizedNick)) {
      enqueueErrorToast('INVALID_NAME');
      return;
    }
    if (!isValidRoomCode(normalizedRoom)) {
      enqueueErrorToast('INVALID_ROOM');
      return;
    }
    if (wsUnavailable) {
      enqueueErrorToast('NETWORK_ERROR');
      return;
    }

    setIsJoining(true);
    onBeginSession(normalizedRoom, selectedRole, normalizedNick);
    if (isMountedRef.current) {
      setIsJoining(false);
    }
  };

  return (
    <section
      aria-label="ロビー設定"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        maxWidth: '360px',
        margin: '0 auto',
      }}
    >
      <header>
        <h2 style={{ marginBottom: '0.5rem' }}>ルームへ参加</h2>
        <p style={{ margin: 0, color: '#64748b' }}>
          ニックネームを入力し、新しいルームを作成するか既存ルームのコードで参加してください。
        </p>
      </header>

      {infraUnavailable ? (
        <div
          role="alert"
          style={{
            borderRadius: '0.375rem',
            backgroundColor: '#fee2e2',
            color: '#b91c1c',
            padding: '0.75rem',
            fontSize: '0.9rem',
          }}
        >
          サーバーのエンドポイントが設定されていません。環境変数 VITE_WS_URL または VITE_HTTP_ORIGIN
          を確認してください。
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label htmlFor="nickname-input" style={{ fontWeight: 600 }}>
          ニックネーム
        </label>
        <input
          id="nickname-input"
          type="text"
          value={nickInput}
          onChange={handleNicknameChange}
          maxLength={10}
          aria-describedby="nickname-hint"
          style={{
            padding: '0.5rem',
            borderRadius: '0.375rem',
            border: '1px solid #cbd5f5',
          }}
        />
        <small id="nickname-hint" style={{ color: '#94a3b8' }}>
          2〜10文字、英数字・ハイフン・アンダースコアのみ
        </small>
        <form onSubmit={handleCreateRoom}>
          <button
            type="submit"
            disabled={infraUnavailable || isCreating}
            style={{
              marginTop: '0.75rem',
              width: '100%',
              padding: '0.5rem',
              borderRadius: '0.375rem',
              border: 'none',
              backgroundColor: infraUnavailable || isCreating ? '#94a3b8' : '#2563eb',
              color: '#f8fafc',
              fontWeight: 600,
              cursor: infraUnavailable || isCreating ? 'not-allowed' : 'pointer',
            }}
          >
            新しいルームを作成
          </button>
        </form>
      </div>

      <form
        onSubmit={handleJoinRoom}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
        aria-label="既存ルームへの参加"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label htmlFor="room-code-input" style={{ fontWeight: 600 }}>
            ルームコード
          </label>
          <input
            id="room-code-input"
            type="text"
            value={roomCodeInput}
            onChange={handleRoomCodeChange}
            maxLength={6}
            placeholder="例: ABC2D3"
            style={{
              padding: '0.5rem',
              borderRadius: '0.375rem',
              border: '1px solid #cbd5f5',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
            }}
          />
        </div>

        <fieldset
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: '0.375rem',
            padding: '0.75rem',
            display: 'flex',
            gap: '1rem',
          }}
        >
          <legend style={{ padding: '0 0.25rem', fontWeight: 600 }}>参加する役割</legend>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <input
              type="radio"
              name="lobby-role"
              value="player"
              checked={selectedRole === 'player'}
              onChange={handleRoleChange}
            />
            プレイヤー
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <input
              type="radio"
              name="lobby-role"
              value="owner"
              checked={selectedRole === 'owner'}
              onChange={handleRoleChange}
            />
            オーナー
          </label>
        </fieldset>

        <button
          type="submit"
          disabled={isJoining || wsUnavailable}
          style={{
            width: '100%',
            padding: '0.5rem',
            borderRadius: '0.375rem',
            border: 'none',
            backgroundColor: isJoining || wsUnavailable ? '#94a3b8' : '#0f766e',
            color: '#f8fafc',
            fontWeight: 600,
            cursor: isJoining || wsUnavailable ? 'not-allowed' : 'pointer',
          }}
        >
          ルームに参加
        </button>
      </form>
    </section>
  );
}

interface WaitingViewProps {
  role: PlayerRole | null;
  roomId: string | null;
  hasAuthoritativeState: boolean;
}

function WaitingView({ role, roomId, hasAuthoritativeState }: WaitingViewProps) {
  const roleLabel = role === 'owner' ? 'オーナー' : role === 'player' ? 'プレイヤー' : '未割り当て';
  const detailMessage =
    role == null
      ? 'ルームに参加するとビューが表示されます。'
      : hasAuthoritativeState
        ? `役割（${roleLabel}）での最新STATEを取得しています。`
        : `役割（${roleLabel}）として接続を初期化しています。`;

  return (
    <section aria-label="接続待機">
      <h2>接続待機中</h2>
      <p>サーバーからのSTATE更新を待機しています。</p>
      <p>{detailMessage}</p>
      {roomId ? (
        <p>
          現在のルームID: <strong>{roomId}</strong>
        </p>
      ) : null}
    </section>
  );
}
