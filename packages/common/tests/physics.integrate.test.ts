import { describe, expect, it } from 'vitest';
import {
  MOVE_SPEED,
  PLAYER_RADIUS,
  SERVER_TICK_INTERVAL_S,
  integrate,
  type PhysicsState,
  type PhysicsInput,
  type PhysicsEnvironment,
} from '../src/physics';

const DELTA = 1e-6;

function step(
  state: PhysicsState,
  input: PhysicsInput,
  environment: PhysicsEnvironment,
  ticks: number,
): PhysicsState {
  let current = state;
  for (let i = 0; i < ticks; i += 1) {
    current = integrate(current, input, { deltaTime: SERVER_TICK_INTERVAL_S }, environment);
  }
  return current;
}

describe('integrate', () => {
  it('垂直の壁に沿ってスライドし、横方向へは進まない', () => {
    const environment: PhysicsEnvironment = {
      isSolid(tileX, tileY) {
        return tileX === 1;
      },
    };

    const start: PhysicsState = {
      position: { x: 1 - PLAYER_RADIUS, y: 0.5 },
      velocity: { x: 0, y: 0 },
      angle: Math.PI / 4,
    };

    const input: PhysicsInput = { forward: 1, turn: 0 };
    const after = step(start, input, environment, 10);

    expect(after.position.x).toBeCloseTo(1 - PLAYER_RADIUS, 6);
    const expectedY =
      start.position.y +
      Math.sin(start.angle) * MOVE_SPEED * SERVER_TICK_INTERVAL_S * 10;
    expect(after.position.y).toBeCloseTo(expectedY, 6);
    expect(after.velocity.x).toBeCloseTo(0, DELTA);
    expect(after.velocity.y).toBeCloseTo(Math.sin(start.angle) * MOVE_SPEED, DELTA);
    expect(after.angle).toBeCloseTo(start.angle, DELTA);
  });

  it('角に押し付けた場合はそこで停止しゼロ速度になる', () => {
    const environment: PhysicsEnvironment = {
      isSolid(tileX, tileY) {
        return tileX === 1 || tileY === 1;
      },
    };

    const start: PhysicsState = {
      position: { x: 1 - PLAYER_RADIUS, y: 0.5 },
      velocity: { x: 0, y: 0 },
      angle: Math.PI / 4,
    };

    const input: PhysicsInput = { forward: 1, turn: 0 };
    const after = step(start, input, environment, 10);

    expect(after.position.x).toBeCloseTo(1 - PLAYER_RADIUS, 4);
    expect(after.position.y).toBeCloseTo(1 - PLAYER_RADIUS, 4);
    expect(after.velocity.x).toBeCloseTo(0, DELTA);
    expect(after.velocity.y).toBeCloseTo(0, DELTA);
    expect(after.angle).toBeCloseTo(start.angle, DELTA);
  });
});
