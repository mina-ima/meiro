import { describe, expect, it } from 'vitest';
import {
  MOVE_SPEED,
  PLAYER_RADIUS,
  TURN_SPEED,
  integrate,
  type PhysicsInput,
  type PhysicsState,
} from '../src/game/Physics';

const DELTA = 1e-6;

describe('Physics.integrate', () => {
  it('前進入力1で1秒後に2.0マス進む', () => {
    const initial: PhysicsState = {
      position: { x: 0, y: 0 },
      angle: 0,
      velocity: { x: 0, y: 0 },
    };

    const input: PhysicsInput = { forward: 1, turn: 0 };

    const result = integrate(initial, input, { deltaTime: 1 });

    expect(result.position.x).toBeCloseTo(MOVE_SPEED, DELTA);
    expect(result.position.y).toBeCloseTo(0, DELTA);
    expect(result.velocity.x).toBeCloseTo(MOVE_SPEED, DELTA);
    expect(result.velocity.y).toBeCloseTo(0, DELTA);
  });

  it('回転入力1で0.5秒後に180度（πラジアン）回転する', () => {
    const initial: PhysicsState = {
      position: { x: 0, y: 0 },
      angle: 0,
      velocity: { x: 0, y: 0 },
    };

    const input: PhysicsInput = { forward: 0, turn: 1 };

    const result = integrate(initial, input, { deltaTime: 0.5 });

    expect(result.angle).toBeCloseTo(TURN_SPEED * 0.5, DELTA);
  });
});

describe('Physics 定数', () => {
  it('移動速度は2.0マス/秒', () => {
    expect(MOVE_SPEED).toBeCloseTo(2.0);
  });

  it('回転速度は360°/秒（2πラジアン/秒）', () => {
    expect(TURN_SPEED).toBeCloseTo(Math.PI * 2);
  });

  it('プレイヤー半径は0.35マス', () => {
    expect(PLAYER_RADIUS).toBeCloseTo(0.35);
  });
});

