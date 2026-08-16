/**
 * SoundEffects manager using Web Audio API.
 * Provides subtle, instant, non-intrusive UI sound feedback.
 * Pre-warms & auto-resumes AudioContext on initial touch gesture.
 */
class SoundManager {
  private audioContext: AudioContext | null = null;
  private enabled: boolean = true;
  private unlocked: boolean = false;

  constructor() {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("lifehub_sounds_enabled");
      this.enabled = saved !== null ? saved === "true" : true;
      this.setupUnlockListeners();
    }
  }

  private setupUnlockListeners() {
    if (typeof window === "undefined") return;
    const unlock = () => {
      if (this.unlocked && this.audioContext?.state === "running") return;
      const ctx = this.getContext();
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      this.unlocked = true;
    };

    window.addEventListener("touchstart", unlock, { passive: true, once: true });
    window.addEventListener("pointerdown", unlock, { passive: true, once: true });
    window.addEventListener("click", unlock, { passive: true, once: true });
  }

  private getContext(): AudioContext {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
    localStorage.setItem("lifehub_sounds_enabled", String(enabled));
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Short, subtle high-pitched tick for bottom navigation & tab switches.
   */
  public playNavClick() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.setValueAtTime(1400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.02);

      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.02);

      osc.start();
      osc.stop(ctx.currentTime + 0.02);
    } catch {
      /* silent */
    }
  }

  /**
   * Warm soft pop for service card presses.
   */
  public playCardClick() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.setValueAtTime(720, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(460, ctx.currentTime + 0.03);

      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03);

      osc.start();
      osc.stop(ctx.currentTime + 0.03);
    } catch {
      /* silent */
    }
  }

  /**
   * General click fallback.
   */
  public playClick() {
    this.playNavClick();
  }

  /**
   * Deeper, punchier tap for primary action buttons (Add Water, Delete, Tasbih tap).
   */
  public playActionClick() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.setValueAtTime(540, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);

      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch {
      /* silent */
    }
  }

  /**
   * Refreshing water droplet chime for hydration logs.
   */
  public playWater() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.06);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

      osc.start(now);
      osc.stop(now + 0.1);
    } catch {
      /* silent */
    }
  }

  /**
   * Ascending harmonic chime for success banners, workout completion, tasbih finish.
   */
  public playSuccess() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      const playTone = (freq: number, start: number, duration: number, vol = 0.06) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(vol, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.start(start);
        osc.stop(start + duration);
      };

      playTone(523.25, now, 0.09, 0.05); // C5
      playTone(659.25, now + 0.07, 0.12, 0.06); // E5
      playTone(783.99, now + 0.15, 0.18, 0.07); // G5
    } catch {
      /* silent */
    }
  }

  /**
   * Energetic tone for starting a walk/workout session.
   */
  public playWalkStart() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.06, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.start(start);
        osc.stop(start + duration);
      };

      playTone(440, now, 0.08); // A4
      playTone(554.37, now + 0.07, 0.09); // C#5
      playTone(659.25, now + 0.14, 0.15); // E5
    } catch {
      /* silent */
    }
  }

  /**
   * Subtle tone for pausing a session.
   */
  public playWalkPause() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.05, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.start(start);
        osc.stop(start + duration);
      };

      playTone(554.37, now, 0.08);
      playTone(440, now + 0.07, 0.1);
    } catch {
      /* silent */
    }
  }

  /**
   * Triumphant harmonic chime when finishing a full walk or milestone.
   */
  public playWalkFinish() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.06, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.start(start);
        osc.stop(start + duration);
      };

      playTone(523.25, now, 0.1); // C5
      playTone(659.25, now + 0.08, 0.12); // E5
      playTone(783.99, now + 0.16, 0.14); // G5
      playTone(1046.5, now + 0.24, 0.28); // C6
    } catch {
      /* silent */
    }
  }

  /**
   * Countdown tick for interval timers.
   */
  public playTimerTick() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      gain.gain.setValueAtTime(0.03, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.025);
      osc.start();
      osc.stop(ctx.currentTime + 0.025);
    } catch {
      /* silent */
    }
  }

  /**
   * Timer completion alert chime.
   */
  public playTimerComplete() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.07, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.start(start);
        osc.stop(start + duration);
      };

      playTone(659.25, now, 0.1); // E5
      playTone(830.61, now + 0.09, 0.12); // G#5
      playTone(987.77, now + 0.18, 0.22); // B5
    } catch {
      /* silent */
    }
  }

  /**
   * Clean dual chime for document upload and file sync success.
   */
  public playUploadSuccess() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.05, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.start(start);
        osc.stop(start + duration);
      };

      playTone(587.33, now, 0.08); // D5
      playTone(880.0, now + 0.07, 0.14); // A5
    } catch {
      /* silent */
    }
  }

  /**
   * Low double-thud for error banners or failed actions.
   */
  public playError() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      const playThud = (freq: number, start: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.06, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.06);
        osc.start(start);
        osc.stop(start + 0.06);
      };

      playThud(240, now);
      playThud(180, now + 0.07);
    } catch {
      /* silent */
    }
  }

  /**
   * Glass chime for reminder notifications.
   */
  public playNotification() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now); // A5
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.15); // A6

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

      osc.start(now);
      osc.stop(now + 0.2);
    } catch {
      /* silent */
    }
  }
}

export const sounds = new SoundManager();
