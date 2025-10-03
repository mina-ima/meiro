export interface Vector2 {
  x: number;
  y: number;
}

export interface PlayerState {
  position: Vector2;
  velocity: Vector2;
}

export interface PhysicsConfig {
  speed: number;
  deltaTime: number;
}

export function integrate(state: PlayerState, config: PhysicsConfig): PlayerState {
  const nextPosition: Vector2 = {
    x: state.position.x + state.velocity.x * config.deltaTime * config.speed,
    y: state.position.y + state.velocity.y * config.deltaTime * config.speed,
  };

  return {
    ...state,
    position: nextPosition,
  };
}
