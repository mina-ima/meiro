export interface RayHit {
  tile: { x: number; y: number };
  distance: number;
}

export interface RaycasterConfig {
  fov: number;
  range: number;
  resolution: number;
}

/**
 * Placeholder raycaster that returns an empty sweep. Real implementation will
 * trace maze geometry; for now we expose typing + deterministic output.
 */
export function castRays(config: RaycasterConfig): RayHit[] {
  const { resolution } = config;
  return Array.from({ length: resolution }, (_, index) => ({
    tile: { x: index, y: 0 },
    distance: 0,
  }));
}
