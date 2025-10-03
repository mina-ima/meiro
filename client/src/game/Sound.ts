export type SoundEffect = 'pickup' | 'slowdown' | 'countdown';

/**
 * Stub sound bus. Replace with Phaser sound manager integration when assets
 * arrive.
 */
export class SoundBus {
  private enabled = true;

  toggle(state: boolean): void {
    this.enabled = state;
  }

  play(effect: SoundEffect): void {
    if (!this.enabled) {
      return;
    }

    console.info(`SE: ${effect}`);
  }
}
