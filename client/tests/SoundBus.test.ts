import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoundBus } from '../src/game/Sound';

describe('SoundBus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('登録時に初期音量0.7を適用する', () => {
    const bus = new SoundBus();
    const playback = createStubPlayback();

    bus.register('pickup', playback);

    expect(playback.volume).toBeCloseTo(0.7, 5);
    expect(playback.setVolume).toHaveBeenCalledWith(0.7);
  });

  it('setVolumeで全クリップを0〜1にクランプして更新する', () => {
    const bus = new SoundBus();
    const pickup = createStubPlayback();
    const slowdown = createStubPlayback();

    bus.register('pickup', pickup);
    bus.register('slowdown', slowdown);

    bus.setVolume(1.5);
    expect(pickup.volume).toBe(1);
    expect(slowdown.volume).toBe(1);

    bus.setVolume(-0.4);
    expect(pickup.volume).toBe(0);
    expect(slowdown.volume).toBe(0);
  });

  it('toggle(false)中は再生せず、解除後に再生する', () => {
    const bus = new SoundBus();
    const playback = createStubPlayback();

    bus.register('pickup', playback);
    bus.toggle(false);

    bus.play('pickup');
    expect(playback.play).not.toHaveBeenCalled();

    bus.toggle(true);
    bus.play('pickup');

    expect(playback.play).toHaveBeenCalledTimes(1);
  });

  it('未登録の効果音は警告を出して無視する', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bus = new SoundBus();

    bus.play('pickup');

    expect(warn).toHaveBeenCalled();
  });
});

function createStubPlayback() {
  const playback = {
    volume: 0,
    play: vi.fn(),
    setVolume: vi.fn((volume: number) => {
      playback.volume = volume;
    }),
  };

  return playback;
}
