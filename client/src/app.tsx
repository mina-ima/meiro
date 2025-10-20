import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NetClient } from './net/NetClient';
import { useSessionStore, type ServerStatePayload } from './state/sessionStore';
import { logClientInit, logClientError, logPhaseChange } from './logging/telemetry';
import { OwnerView, PlayerView } from './views';
import { ToastHost, enqueueErrorToast, enqueueInfoToast } from './ui/toasts';
import { DebugHUD } from './ui/DebugHUD';
import { OWNER_FORBIDDEN_DISTANCE } from './config/spec';

const WS_ENDPOINT = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8787';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isServerStatePayload(value: unknown): value is ServerStatePayload {
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
  const score = useSessionStore((state) => state.score);
  const targetScore = useSessionStore((state) => state.targetScore);
  const ownerState = useSessionStore((state) => state.owner);
  const playerState = useSessionStore((state) => state.player);
  const phase = useSessionStore((state) => state.phase);
  const phaseEndsAt = useSessionStore((state) => state.phaseEndsAt);
  const mazeSize = useSessionStore((state) => state.mazeSize);
  const setRoom = useSessionStore((state) => state.setRoom);
  const setScore = useSessionStore((state) => state.setScore);
  const applyServerState = useSessionStore((state) => state.applyServerState);
  const timeRemaining = useTimeRemaining(phaseEndsAt);
  const previousPhase = useRef(phase);

  useEffect(() => {
    logClientInit({
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    });
  }, []);

  useEffect(() => {
    // 仮の初期状態。初回のみUI確認用にプレイヤー役割で起動する。
    if (role !== null) {
      return;
    }
    setRoom('DEBUGROOM', 'player');
    setScore(0, 100);
  }, [role, setRoom, setScore]);

  useEffect(() => {
    if (previousPhase.current !== phase) {
      const countdownMs = phaseEndsAt ? Math.max(phaseEndsAt - Date.now(), 0) : undefined;
      logPhaseChange(phase, countdownMs);
      previousPhase.current = phase;
    }
  }, [phase, phaseEndsAt]);

  const handleServerMessage = useCallback(
    (data: unknown) => {
      if (!isRecord(data) || typeof data.type !== 'string') {
        return;
      }

      if (data.type === 'STATE') {
        const payload = (data as { payload?: unknown }).payload;
        if (isServerStatePayload(payload)) {
          applyServerState(payload);
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
    if (!roomId || !role) {
      return null;
    }

    return new NetClient(
      {
        endpoint: WS_ENDPOINT,
        nick: 'debugger',
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
  }, [roomId, role, handleServerMessage]);

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
  const forbiddenDistance = OWNER_FORBIDDEN_DISTANCE;

  const mainView =
    role === 'owner' ? (
      <OwnerView
        client={client}
        wallCount={ownerState.wallStock}
        trapCharges={ownerState.trapCharges}
        wallRemoveLeft={ownerState.wallRemoveLeft}
        editCooldownMs={ownerCooldownMs}
        forbiddenDistance={forbiddenDistance}
        activePredictions={ownerState.activePredictionCount}
        predictionLimit={ownerState.predictionLimit}
        timeRemaining={timeRemaining}
        predictionMarks={ownerState.predictionMarks}
        traps={ownerState.traps}
        playerPosition={playerState.position}
        mazeSize={mazeSize}
      />
    ) : (
      <PlayerView
        points={score}
        targetPoints={targetScore}
        predictionHits={playerState.predictionHits}
        phase={phase}
        timeRemaining={timeRemaining}
      />
    );

  return (
    <>
      {mainView}
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
        }}
        player={{
          position: playerState.position,
          predictionHits: playerState.predictionHits,
        }}
        ownerCooldownMs={ownerCooldownMs}
      />
      <ToastHost />
    </>
  );
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
