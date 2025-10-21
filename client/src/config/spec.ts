export const OWNER_ZOOM_LEVELS: readonly number[] = [0.5, 0.75, 1, 1.5, 2, 3, 4];
export const OWNER_EDIT_COOLDOWN_SECONDS = 1;
export const OWNER_FORBIDDEN_DISTANCE = 2;

export const PLAYER_FOV_DEGREES = 90;
export const PLAYER_VIEW_RANGE = 4;
export const LATENCY_WARNING_THRESHOLD_MS = 100;

export const TRAP_SPEED_MULTIPLIER = 0.4;
export const TRAP_DURATION_DIVISOR = 5;
export const MAX_ACTIVE_TRAPS = 2;

export const PREDICTION_BONUS_PROBABILITIES: Readonly<{ wall: number; trap: number }> = {
  wall: 0.7,
  trap: 0.3,
};

export const WALL_STOCK_BY_MAZE_SIZE: Readonly<Record<20 | 40, number>> = {
  20: 48,
  40: 140,
};

export const POINT_REQUIRED_RATE = 0.65;
export const GOAL_BONUS_RATE = 0.2;

export const POINT_PLACEMENT_WINDOWS = {
  points: 40,
  traps: 5,
  prediction: 15,
} as const;
