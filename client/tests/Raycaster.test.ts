import { describe, expect, it } from 'vitest';
import {
  castRays,
  type RaycasterConfig,
  type RaycasterEnvironment,
  type RaycasterState,
} from '../src/game/Raycaster';

describe('Raycaster', () => {
  const defaultConfig: RaycasterConfig = {
    fov: Math.PI / 2,
    range: 4,
    resolution: 5,
  };

  const state: RaycasterState = {
    position: { x: 2.5, y: 2.5 },
    angle: 0,
  };

  const environment: RaycasterEnvironment = createEnvironment([
    '#####',
    '#...#',
    '#...#',
    '#...#',
    '#####',
  ]);

  it('指定した解像度の本数だけレイを返す', () => {
    const hits = castRays(state, { ...defaultConfig, resolution: 7 }, environment);
    expect(hits).toHaveLength(7);
  });

  it('中央レイは現在向きと同じ方向に投射される', () => {
    const hits = castRays(state, defaultConfig, environment);
    const middle = hits[Math.floor(defaultConfig.resolution / 2)];
    expect(middle.angle).toBeCloseTo(state.angle, 6);
    expect(middle.tile).toEqual({ x: 4, y: 2 });
    expect(middle.distance).toBeGreaterThan(1.4);
    expect(middle.distance).toBeLessThanOrEqual(defaultConfig.range);
  });

  it('左右端のレイはFOV/2だけ回転してマップ境界に命中する', () => {
    const hits = castRays(state, defaultConfig, environment);
    const left = hits[0];
    const right = hits[hits.length - 1];

    expect(left.angle).toBeCloseTo(state.angle - defaultConfig.fov / 2, 6);
    expect(right.angle).toBeCloseTo(state.angle + defaultConfig.fov / 2, 6);
    expect(left.tile).not.toBeNull();
    expect(right.tile).not.toBeNull();
    expect(left.distance).toBeLessThanOrEqual(defaultConfig.range);
    expect(right.distance).toBeLessThanOrEqual(defaultConfig.range);
  });

  it('距離4マスに到達したレイは強度が0.5まで減光される', () => {
    const farEnvironment = createEnvironment([
      '........',
      '........',
      '........',
      '........',
      '#######',
    ]);

    const hits = castRays(
      { ...state, position: { x: 2.5, y: 0.5 }, angle: Math.PI / 2 },
      defaultConfig,
      farEnvironment,
    );

    const center = hits[Math.floor(defaultConfig.resolution / 2)];
    expect(center.distance).toBeCloseTo(defaultConfig.range - 0.5, 6);
    expect(center.intensity).toBeCloseTo(0.5, 6);
  });

  it('範囲内に壁が無い場合は距離=rangeで強度0になる', () => {
    const openEnvironment: RaycasterEnvironment = {
      isWall() {
        return false;
      },
    };
    const hits = castRays(state, defaultConfig, openEnvironment);
    const center = hits[Math.floor(defaultConfig.resolution / 2)];

    expect(center.tile).toBeNull();
    expect(center.distance).toBe(defaultConfig.range);
    expect(center.intensity).toBe(0);
  });
});

function createEnvironment(rows: string[]): RaycasterEnvironment {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  return {
    isWall(tileX, tileY) {
      if (tileX < 0 || tileY < 0 || tileX >= width || tileY >= height) {
        return true;
      }
      return rows[tileY][tileX] === '#';
    },
  };
}
