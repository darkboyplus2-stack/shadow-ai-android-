import { HologramState } from '../types/hologram';

/**
 * Procedural sci-fi sound effects using Web Audio API.
 * Zero external audio files, 100% browser-native synthesis.
 */
class SoundService {
  private ctx: AudioContext | null = null;
  private isEnabled: boolean = true;

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
  }

  /**
   * Play subtle interaction blip
   */
  public playClick(freq = 660) {
    if (!this.isEnabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, this.ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.09);
    } catch {
      // AudioContext could be blocked by browser policy
    }
  }

  /**
   * Sound when state changes (e.g. Idle -> Listening / Thinking / Speaking / Working / Error)
   */
  public playStateShift(state: HologramState) {
    if (!this.isEnabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, this.ctx.currentTime);

      const t = this.ctx.currentTime;
      let startFreq = 260;
      let targetFreq = 480;

      if (state === 'LISTENING') {
        startFreq = 340;
        targetFreq = 620;
      } else if (state === 'THINKING') {
        startFreq = 440;
        targetFreq = 840;
      } else if (state === 'SPEAKING') {
        startFreq = 540;
        targetFreq = 380;
      } else if (state === 'WORKING') {
        startFreq = 380;
        targetFreq = 680;
      } else if (state === 'ERROR') {
        startFreq = 280;
        targetFreq = 160;
      } else {
        startFreq = 380;
        targetFreq = 260;
      }

      osc.frequency.setValueAtTime(startFreq, t);
      osc.frequency.exponentialRampToValueAtTime(targetFreq, t + 0.18);

      gain.gain.setValueAtTime(state === 'ERROR' ? 0.04 : 0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(t + 0.26);
    } catch {
      // Ignore
    }
  }

  /**
   * Smooth tactile spin sound during dragging
   */
  public playDragTick() {
    if (!this.isEnabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800 + Math.random() * 200, this.ctx.currentTime);

      gain.gain.setValueAtTime(0.015, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.03);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.035);
    } catch {
      // Ignore
    }
  }
}

export const soundFx = new SoundService();
