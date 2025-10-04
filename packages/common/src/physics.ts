export const MOVE_SPEED = 2.0; // squares per second
export const TURN_SPEED = Math.PI * 2; // 360deg per second
export const PLAYER_RADIUS = 0.35; // squares
export const SERVER_TICK_RATE = 20;
export const SERVER_TICK_INTERVAL_MS = 1000 / SERVER_TICK_RATE;
export const SERVER_TICK_INTERVAL_S = SERVER_TICK_INTERVAL_MS / 1000;
const BINARY_SEARCH_ITERATIONS = 12;

export interface PhysicsEnvironment {
  isSolid(tileX: number, tileY: number): boolean;
}

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
  environment?: PhysicsEnvironment,
): PhysicsState {
  const dt = Math.max(config.deltaTime, 0);
  const turn = clamp(input.turn, -1, 1);
  const forward = clamp(input.forward, -1, 1);

  const nextAngle = normalizeAngle(state.angle + turn * TURN_SPEED * dt);
  const moveSpeed = forward * MOVE_SPEED;
  const direction = angleToVector(nextAngle);

  let velocityX = direction.x * moveSpeed;
  let velocityY = direction.y * moveSpeed;
  let positionX = state.position.x;
  let positionY = state.position.y;

  if (environment) {
    const horizontal = resolveHorizontal(positionX, positionY, velocityX, dt, environment);
    positionX = horizontal.position;
    if (horizontal.collided) {
      velocityX = 0;
    }

    const vertical = resolveVertical(positionX, positionY, velocityY, dt, environment);
    positionY = vertical.position;
    if (vertical.collided) {
      velocityY = 0;
    }
  } else {
    positionX += velocityX * dt;
    positionY += velocityY * dt;
  }

  const position: Vector2 = {
    x: positionX,
    y: positionY,
  };

  const velocity: Vector2 = {
    x: velocityX,
    y: velocityY,
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

interface AxisResolution {
  position: number;
  collided: boolean;
}

function resolveHorizontal(
  startX: number,
  startY: number,
  velocityX: number,
  dt: number,
  environment: PhysicsEnvironment,
): AxisResolution {
  if (velocityX === 0) {
    return { position: startX, collided: false };
  }

  const direction = Math.sign(velocityX);
  const target = startX + velocityX * dt;

  if (!collidesAt(target, startY, environment)) {
    return { position: target, collided: false };
  }

  let low: number;
  let high: number;
  let best = startX;

  if (direction > 0) {
    low = startX;
    high = target;
  } else {
    low = target;
    high = startX;
  }

  for (let i = 0; i < BINARY_SEARCH_ITERATIONS; i += 1) {
    const mid = (low + high) / 2;
    if (collidesAt(mid, startY, environment)) {
      if (direction > 0) {
        high = mid;
      } else {
        low = mid;
      }
    } else {
      best = mid;
      if (direction > 0) {
        low = mid;
      } else {
        high = mid;
      }
    }
  }

  return { position: best, collided: true };
}

function resolveVertical(
  currentX: number,
  startY: number,
  velocityY: number,
  dt: number,
  environment: PhysicsEnvironment,
): AxisResolution {
  if (velocityY === 0) {
    return { position: startY, collided: false };
  }

  const direction = Math.sign(velocityY);
  const target = startY + velocityY * dt;

  if (!collidesAt(currentX, target, environment)) {
    return { position: target, collided: false };
  }

  let low: number;
  let high: number;
  let best = startY;

  if (direction > 0) {
    low = startY;
    high = target;
  } else {
    low = target;
    high = startY;
  }

  for (let i = 0; i < BINARY_SEARCH_ITERATIONS; i += 1) {
    const mid = (low + high) / 2;
    if (collidesAt(currentX, mid, environment)) {
      if (direction > 0) {
        high = mid;
      } else {
        low = mid;
      }
    } else {
      best = mid;
      if (direction > 0) {
        low = mid;
      } else {
        high = mid;
      }
    }
  }

  return { position: best, collided: true };
}

function collidesAt(x: number, y: number, environment: PhysicsEnvironment): boolean {
  const radius = PLAYER_RADIUS;
  const minTileX = Math.floor(x - radius);
  const maxTileX = Math.floor(x + radius);
  const minTileY = Math.floor(y - radius);
  const maxTileY = Math.floor(y + radius);

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (!environment.isSolid(tileX, tileY)) {
        continue;
      }

      if (circleIntersectsTile(x, y, radius, tileX, tileY)) {
        return true;
      }
    }
  }

  return false;
}

function circleIntersectsTile(
  cx: number,
  cy: number,
  radius: number,
  tileX: number,
  tileY: number,
): boolean {
  const nearestX = clamp(cx, tileX, tileX + 1);
  const nearestY = clamp(cy, tileY, tileY + 1);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy < radius * radius;
}
