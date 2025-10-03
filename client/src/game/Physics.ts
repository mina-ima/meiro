export const MOVE_SPEED = 2.0; // squares per second
export const TURN_SPEED = Math.PI * 2; // 360deg per second
export const PLAYER_RADIUS = 0.35; // squares

export interface Vector2 {
  x: number;
  y: number;
}

export interface PhysicsState {
  position: Vector2;
  angle: number; // radians
  velocity: Vector2;
}

export interface PhysicsInput {
  forward: number; // -1..1
  turn: number; // -1..1
}

export interface PhysicsConfig {
  deltaTime: number; // seconds
}

export function integrate(
  state: PhysicsState,
  input: PhysicsInput,
  config: PhysicsConfig,
): PhysicsState {
  const dt = Math.max(config.deltaTime, 0);
  const turn = clamp(input.turn, -1, 1);
  const forward = clamp(input.forward, -1, 1);

  const nextAngle = normalizeAngle(state.angle + turn * TURN_SPEED * dt);
  const moveSpeed = forward * MOVE_SPEED;
  const direction = angleToVector(nextAngle);

  const velocity: Vector2 = {
    x: direction.x * moveSpeed,
    y: direction.y * moveSpeed,
  };

  const position: Vector2 = {
    x: state.position.x + velocity.x * dt,
    y: state.position.y + velocity.y * dt,
  };

  return {
    position,
    angle: nextAngle,
    velocity,
  };
}

function angleToVector(angle: number): Vector2 {
  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
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

function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let result = angle % twoPi;
  if (result <= -Math.PI) {
    result += twoPi;
  } else if (result > Math.PI) {
    result -= twoPi;
  }
  return result;
}
