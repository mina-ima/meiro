type MetricsEvent = {
  type: string;
  roomId: string;
  at: number;
} & Record<string, unknown>;

function defaultEmit(event: MetricsEvent): void {
  console.info('[metrics]', event);
}

const STATE_LATENCY_ALERT_THRESHOLD_MS = 200;

export class RoomMetrics {
  constructor(
    private readonly roomId: string,
    private readonly emit: (event: MetricsEvent) => void = defaultEmit,
  ) {}

  logRoomCreated(mazeSize: number): void {
    this.emit({
      type: 'room.created',
      roomId: this.roomId,
      at: Date.now(),
      mazeSize,
    });
  }

  logRoomDisposed(): void {
    this.emit({
      type: 'room.disposed',
      roomId: this.roomId,
      at: Date.now(),
    });
  }

  logSessionJoin(role: string): void {
    this.emit({
      type: 'session.join',
      roomId: this.roomId,
      at: Date.now(),
      role,
    });
  }

  logSessionLeave(role: string): void {
    this.emit({
      type: 'session.leave',
      roomId: this.roomId,
      at: Date.now(),
      role,
    });
  }

  logPhaseTransition(previous: string, current: string, durationMs: number): void {
    this.emit({
      type: 'phase.transition',
      roomId: this.roomId,
      at: Date.now(),
      previous,
      current,
      durationMs,
    });
  }

  logOwnerEditRejected(code: string): void {
    this.emit({
      type: 'owner.edit.rejected',
      roomId: this.roomId,
      at: Date.now(),
      code,
    });
  }

  logPlayerInputRejected(reason: string): void {
    this.emit({
      type: 'player.input.rejected',
      roomId: this.roomId,
      at: Date.now(),
      reason,
    });
  }

  logStateMessage(bytes: number, immediate: boolean, queueDepth: number): void {
    this.emit({
      type: 'state.message.sent',
      roomId: this.roomId,
      at: Date.now(),
      bytes,
      immediate,
      queueDepth,
    });
  }

  logStateLatency(latencyMs: number): void {
    const at = Date.now();
    this.emit({
      type: 'state.latency',
      roomId: this.roomId,
      at,
      latencyMs,
      alert: latencyMs > STATE_LATENCY_ALERT_THRESHOLD_MS,
    });
    if (latencyMs > STATE_LATENCY_ALERT_THRESHOLD_MS) {
      this.emit({
        type: 'state.latency.alert',
        roomId: this.roomId,
        at,
        latencyMs,
        thresholdMs: STATE_LATENCY_ALERT_THRESHOLD_MS,
      });
    }
  }

  logSocketError(reason: string): void {
    this.emit({
      type: 'socket.error',
      roomId: this.roomId,
      at: Date.now(),
      reason,
    });
  }
}
