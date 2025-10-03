export type SoundEffect = 'pickup' | 'slowdown' | 'countdown';

type SoundPlayback = {
  play: () => void;
  setVolume: (volume: number) => void;
};

/**
 * Simple sound bus that centralises volume and enable toggling for SFX.
 */
export class SoundBus {
  private enabled = true;
  private volume = 0.7;
  private readonly sounds = new Map<SoundEffect, SoundPlayback>();

  register(effect: SoundEffect, playback: SoundPlayback): void {
    this.sounds.set(effect, playback);
    playback.setVolume(this.volume);
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    for (const playback of this.sounds.values()) {
      playback.setVolume(this.volume);
    }
  }

  toggle(state: boolean): void {
    this.enabled = state;
  }

  play(effect: SoundEffect): void {
    if (!this.enabled) {
      return;
    }

    const playback = this.sounds.get(effect);
    if (!playback) {
      console.warn(`Missing sound effect: ${effect}`);
      return;
    }

    playback.play();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
