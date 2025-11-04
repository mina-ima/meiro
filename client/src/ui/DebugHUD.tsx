import { MOVE_SPEED, PLAYER_RADIUS, SERVER_TICK_RATE, TURN_SPEED } from '@meiro/common';
import { FRAME_LOOP_INTERVAL_MS } from '../game/frameLoop';
import {
  GOAL_BONUS_RATE,
  MAX_ACTIVE_TRAPS,
  OWNER_EDIT_COOLDOWN_SECONDS,
  OWNER_FORBIDDEN_DISTANCE,
  OWNER_ZOOM_LEVELS,
  PLAYER_FOV_DEGREES,
  PLAYER_VIEW_RANGE,
  POINT_REQUIRED_RATE,
  PREDICTION_BONUS_PROBABILITIES,
  TRAP_DURATION_DIVISOR,
  TRAP_SPEED_MULTIPLIER,
  WALL_STOCK_BY_MAZE_SIZE,
} from '../config/spec';
import type { OwnerClientState, PlayerClientState, PlayerRole } from '../state/sessionStore';

const DEGREES_PER_RADIAN = 180 / Math.PI;

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCooldownMs(valueMs: number): string {
  if (!Number.isFinite(valueMs) || valueMs <= 0) {
    return '0.0';
  }
  return (Math.round(valueMs) / 1000).toFixed(1);
}

function formatPosition(value: number): string {
  return value.toFixed(1);
}

type SanitizedOwnerState = Pick<
  OwnerClientState,
  | 'wallStock'
  | 'trapCharges'
  | 'wallRemoveLeft'
  | 'predictionLimit'
  | 'activePredictionCount'
  | 'predictionHits'
  | 'predictionMarks'
  | 'traps'
  | 'forbiddenDistance'
  | 'editCooldownDuration'
>;

type SanitizedPlayerState = Pick<PlayerClientState, 'predictionHits' | 'position'>;

interface DebugHUDProps {
  role: PlayerRole | null;
  mazeSize: 20 | 40;
  timeRemaining: number;
  owner: SanitizedOwnerState;
  player: SanitizedPlayerState;
  ownerCooldownMs: number;
}

export function DebugHUD({
  role,
  mazeSize,
  timeRemaining,
  owner,
  player,
  ownerCooldownMs,
}: DebugHUDProps) {
  const turnSpeedDegrees = Math.round(TURN_SPEED * DEGREES_PER_RADIAN);
  const frameCapFps = Math.round(1000 / FRAME_LOOP_INTERVAL_MS);
  const zoomLabel = OWNER_ZOOM_LEVELS.map((level) => `${level}×`).join(' / ');
  const wallStocks = `20x20: ${WALL_STOCK_BY_MAZE_SIZE[20]} 本 / 40x40: ${WALL_STOCK_BY_MAZE_SIZE[40]} 本`;
  const trapDuration = `残時間 / ${TRAP_DURATION_DIVISOR}`;
  const predictionBonus = `壁${formatPercent(
    PREDICTION_BONUS_PROBABILITIES.wall,
  )} / 罠${formatPercent(PREDICTION_BONUS_PROBABILITIES.trap)}`;
  const cooldownRemaining = `${formatCooldownMs(ownerCooldownMs)} 秒`;

  return (
    <section aria-label="デバッグHUD" style={{ marginTop: '1.5rem' }}>
      <h3>デバッグHUD</h3>

      <div>
        <h4>仕様値</h4>
        <ul>
          <li>移動速度: {MOVE_SPEED.toFixed(1)} マス/秒</li>
          <li>回転速度: {turnSpeedDegrees} °/秒</li>
          <li>当たり判定半径: {PLAYER_RADIUS.toFixed(2)} マス</li>
          <li>視野角: {PLAYER_FOV_DEGREES}°</li>
          <li>視界距離: {PLAYER_VIEW_RANGE} マス</li>
          <li>描画上限: {frameCapFps} fps</li>
          <li>サーバTick: {SERVER_TICK_RATE} Hz</li>
          <li>ズーム倍率: {zoomLabel}</li>
          <li>編集クールダウン: {OWNER_EDIT_COOLDOWN_SECONDS.toFixed(1)} 秒</li>
          <li>禁止エリア半径: {OWNER_FORBIDDEN_DISTANCE} マス</li>
          <li>壁在庫: {wallStocks}</li>
          <li>規定ポイント係数: {formatPercent(POINT_REQUIRED_RATE)}</li>
          <li>ゴールボーナス係数: {formatPercent(GOAL_BONUS_RATE)}</li>
          <li>罠速度低下: {formatPercent(TRAP_SPEED_MULTIPLIER)}</li>
          <li>罠持続: {trapDuration}</li>
          <li>同時罠数: {MAX_ACTIVE_TRAPS}</li>
          <li>予測ボーナス: {predictionBonus}</li>
        </ul>
      </div>

      <div>
        <h4>現在値</h4>
        <ul>
          <li>役割(現在値): {role ?? '未割り当て'}</li>
          <li>
            迷路サイズ(現在値): {mazeSize} × {mazeSize}
          </li>
          <li>残り時間(現在値): {timeRemaining} 秒</li>
          <li>壁残数(現在値): {owner.wallStock}</li>
          <li>罠権利(現在値): {owner.trapCharges}</li>
          <li>壁削除権(現在値): {owner.wallRemoveLeft}</li>
          <li>
            予測地点(現在値): {owner.activePredictionCount} / {owner.predictionLimit}
          </li>
          <li>予測ヒット累計(現在値): {owner.predictionHits}</li>
          <li>罠設置済み(現在値): {owner.traps.length}</li>
          <li>予測マーク(現在値): {owner.predictionMarks.length}</li>
          <li>禁止エリア距離(現在値): {owner.forbiddenDistance} マス</li>
          <li>編集クールダウン定数(現在値): {(owner.editCooldownDuration / 1000).toFixed(1)} 秒</li>
          <li>残りクールダウン(現在値): {cooldownRemaining}</li>
          <li>
            プレイヤー位置(現在値): ({formatPosition(player.position.x)},{' '}
            {formatPosition(player.position.y)})
          </li>
          <li>プレイヤー予測ヒット(現在値): {player.predictionHits}</li>
        </ul>
      </div>
    </section>
  );
}
