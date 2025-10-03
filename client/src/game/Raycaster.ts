import type { Vector2 } from './Physics';

export interface RayHit {
  tile: { x: number; y: number } | null;
  distance: number;
  angle: number;
  intensity: number;
}

export interface RaycasterConfig {
  fov: number; // radians
  range: number; // tiles
  resolution: number; // number of rays
}

export interface RaycasterState {
  position: Vector2;
  angle: number;
}

export interface RaycasterEnvironment {
  isWall(tileX: number, tileY: number): boolean;
}

const RANGE_ATTENUATION_THRESHOLD = 1; // dim final tile within range

export function castRays(
  state: RaycasterState,
  config: RaycasterConfig,
  environment: RaycasterEnvironment,
): RayHit[] {
  if (config.resolution <= 0 || config.range <= 0) {
    return [];
  }

  const hits: RayHit[] = [];
  const origin = state.position;
  const startAngle = state.angle - config.fov / 2;
  const step = config.resolution === 1 ? 0 : config.fov / (config.resolution - 1);

  for (let i = 0; i < config.resolution; i += 1) {
    const angle = config.resolution === 1 ? state.angle : startAngle + step * i;
    hits.push(castSingleRay(origin, angle, config.range, environment));
  }

  return hits;
}

function castSingleRay(
  origin: Vector2,
  angle: number,
  range: number,
  environment: RaycasterEnvironment,
): RayHit {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  let mapX = Math.floor(origin.x);
  let mapY = Math.floor(origin.y);

  const deltaDistX = dirX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirX);
  const deltaDistY = dirY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirY);

  let stepX: number;
  let sideDistX: number;
  if (dirX < 0) {
    stepX = -1;
    sideDistX = (origin.x - mapX) * deltaDistX;
  } else {
    stepX = 1;
    sideDistX = (mapX + 1 - origin.x) * deltaDistX;
  }

  let stepY: number;
  let sideDistY: number;
  if (dirY < 0) {
    stepY = -1;
    sideDistY = (origin.y - mapY) * deltaDistY;
  } else {
    stepY = 1;
    sideDistY = (mapY + 1 - origin.y) * deltaDistY;
  }

  let currentX = mapX;
  let currentY = mapY;
  let side = 0;

  let distanceTravelled = 0;

  while (distanceTravelled < range) {
    if (sideDistX < sideDistY) {
      distanceTravelled = sideDistX;
      sideDistX += deltaDistX;
      currentX += stepX;
      mapX = currentX;
      side = 0;
    } else {
      distanceTravelled = sideDistY;
      sideDistY += deltaDistY;
      currentY += stepY;
      mapY = currentY;
      side = 1;
    }

    if (environment.isWall(currentX, currentY)) {
      const hitDistance = computePerpendicularDistance(
        origin,
        dirX,
        dirY,
        currentX,
        currentY,
        stepX,
        stepY,
        side,
      );
      const distance = Math.min(hitDistance, range);
      return {
        tile: { x: currentX, y: currentY },
        distance,
        angle,
        intensity: computeIntensity(distance, range),
      };
    }
  }

  return {
    tile: null,
    distance: range,
    angle,
    intensity: 0,
  };
}

function computeIntensity(distance: number, range: number): number {
  if (distance >= range) {
    return 0;
  }

  if (distance >= range - RANGE_ATTENUATION_THRESHOLD) {
    return 0.5;
  }

  return 1;
}

function computePerpendicularDistance(
  origin: Vector2,
  dirX: number,
  dirY: number,
  mapX: number,
  mapY: number,
  stepX: number,
  stepY: number,
  side: number,
): number {
  if (side === 0) {
    return Math.abs((mapX - origin.x + (1 - stepX) / 2) / dirX);
  }
  return Math.abs((mapY - origin.y + (1 - stepY) / 2) / dirY);
}
