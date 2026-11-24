import { clamp } from './math';

// C Lydian scale across 3 octaves — bright, celestial, uplifting
const LYDIAN_SCALE = [
  261.63, // C4
  293.66, // D4
  329.63, // E4
  369.99, // F#4
  392.0,  // G4
  440.0,  // A4
  493.88, // B4
  523.25, // C5
  587.33, // D5
  659.25, // E5
  739.99, // F#5
  783.99, // G5
  880.0,  // A5
  987.77, // B5
  1046.5, // C6
  1174.66,// D6
  1318.51,// E6
  1567.98,// G6
];

const AMBIENT_CHORDS = [
  [130.81, 196.0, 246.94, 293.66], // Cmaj9
  [146.83, 220.0, 277.18, 329.63], // Dadd9
  [110.0, 164.81, 220.0, 261.63],  // Am7
  [196.0, 246.94, 293.66, 369.99], // Gmaj7
];

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxFilter: BiquadFilterNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private musicGain: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  public sfxEnabled = true;
  public musicEnabled = true;
  public hapticsEnabled = true;

  private lastPullStep = -1;
  private ambientTimer: number | null = null;
  private chordIndex = 0;
  private arpStep = 0;
  private currentBiomeIndex = 0;
  private isFever = false;

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 6;
      comp.attack.value = 0.004;
      comp.release.value = 0.16;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.82;

      this.sfxFilter = this.ctx.createBiquadFilter();
      this.sfxFilter.type = 'lowpass';
      this.sfxFilter.frequency.value = 20000;
      this.sfxFilter.Q.value = 0.7;

      this.musicFilter = this.ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 2400;
      this.musicFilter.Q.value = 0.8;

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicEnabled ? 0.22 : 0;

      // Shimmer echo bus
      this.delayNode = this.ctx.createDelay(0.5);
      this.delayNode.delayTime.value = 0.21;
      const delayFeedback = this.ctx.createGain();
      delayFeedback.gain.value = 0.26;
      const delayFilter = this.ctx.createBiquadFilter();
      delayFilter.type = 'highpass';
      delayFilter.frequency.value = 700;
      const delayWet = this.ctx.createGain();
      delayWet.gain.value = 0.22;

      this.delayNode.connect(delayFilter);
      delayFilter.connect(delayFeedback);
      delayFeedback.connect(this.delayNode);
      this.delayNode.connect(delayWet);
      delayWet.connect(comp);

      this.sfxFilter.connect(comp);
      this.musicFilter.connect(this.musicGain);
      this.musicGain.connect(comp);
      comp.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.createNoiseBuffer();
      this.startAmbientLoop();
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private createNoiseBuffer(): void {
    if (!this.ctx) return;
    const length = this.ctx.sampleRate * 1.0;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
    }
    this.noiseBuffer = buffer;
  }

  public setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(enabled ? 0.22 : 0, this.ctx.currentTime, 0.12);
    }
  }

  public setChronoFilter(active: boolean): void {
    if (!this.ctx || !this.musicFilter) return;
    const now = this.ctx.currentTime;
    this.musicFilter.frequency.setTargetAtTime(active ? 420 : 2600, now, 0.06);
  }

  public setGameContext(biomeIndex: number, isFever: boolean): void {
    this.currentBiomeIndex = biomeIndex;
    this.isFever = isFever;
  }

  public vibrate(pattern: number | number[]): void {
    if (!this.hapticsEnabled) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch {
      // Ignore unsupported environments
    }
  }

  private panNode(pan: number): StereoPannerNode | null {
    if (!this.ctx || typeof this.ctx.createStereoPanner !== 'function') return null;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -0.85, 0.85);
    return panner;
  }

  private connectOut(node: AudioNode, pan = 0, sendDelay = false): void {
    if (!this.ctx || !this.sfxFilter) return;
    const panner = this.panNode(pan);
    if (panner) {
      node.connect(panner);
      panner.connect(this.sfxFilter);
      if (sendDelay && this.delayNode) panner.connect(this.delayNode);
    } else {
      node.connect(this.sfxFilter);
      if (sendDelay && this.delayNode) node.connect(this.delayNode);
    }
  }

  public resetPullTicks(): void {
    this.lastPullStep = -1;
  }

  public playPullTension(ratio: number): void {
    if (!this.sfxEnabled || !this.ctx) return;
    const step = Math.floor(clamp(ratio, 0, 1) * 5);
    if (step === this.lastPullStep || step === 0) return;
    this.lastPullStep = step;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const baseFreq = 260 + step * 68;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.18, now + 0.045);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    osc.connect(gain);
    this.connectOut(gain, 0, false);
    osc.start(now);
    osc.stop(now + 0.06);
    if (step === 5) this.vibrate(6);
  }

  public playCancel(): void {
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(170, now + 0.07);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(gain);
    this.connectOut(gain);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  public playSlingLaunch(powerRatio: number, isFever: boolean): void {
    this.vibrate(14);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Punchy sub-pop
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    const startF = 165 + powerRatio * 90 + (isFever ? 60 : 0);
    osc.frequency.setValueAtTime(startF, now);
    osc.frequency.exponentialRampToValueAtTime(420 + powerRatio * 200, now + 0.09);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(gain);
    this.connectOut(gain, 0, false);
    osc.start(now);
    osc.stop(now + 0.14);

    // Filtered aerodynamic whoosh
    if (this.noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.8;
      filter.frequency.setValueAtTime(450, now);
      filter.frequency.exponentialRampToValueAtTime(2400 + powerRatio * 1400, now + 0.11);
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.01, now);
      nGain.gain.linearRampToValueAtTime(0.24 * (0.5 + powerRatio * 0.5), now + 0.03);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
      src.connect(filter);
      filter.connect(nGain);
      this.connectOut(nGain, 0, true);
      src.start(now);
      src.stop(now + 0.2);
    }
  }

  public playPrismHit(combo: number, pan = 0, isGold = false): void {
    this.vibrate(isGold ? 12 : 7);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const idx = clamp(combo - 1, 0, LYDIAN_SCALE.length - 1);
    const freq = LYDIAN_SCALE[idx] * (isGold ? 1.25 : 1);

    // Crystal bell fundamental
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    osc.connect(gain);
    this.connectOut(gain, pan, true);
    osc.start(now);
    osc.stop(now + 0.36);

    // Shimmer harmonic overtone
    const over = this.ctx.createOscillator();
    const oGain = this.ctx.createGain();
    over.type = 'triangle';
    over.frequency.setValueAtTime(freq * 2.0, now);
    over.frequency.exponentialRampToValueAtTime(freq * 2.01, now + 0.18);
    oGain.gain.setValueAtTime(0.09, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    over.connect(oGain);
    this.connectOut(oGain, pan, true);
    over.start(now);
    over.stop(now + 0.19);
  }

  public playBankShot(pan: number): void {
    this.vibrate(10);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.09);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
    osc.connect(gain);
    this.connectOut(gain, pan, false);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playBankBonus(pan: number): void {
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 1046.5].forEach((f, i) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + i * 0.035);
      g.gain.setValueAtTime(0.13, now + i * 0.035);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.035 + 0.22);
      osc.connect(g);
      this.connectOut(g, pan, true);
      osc.start(now + i * 0.035);
      osc.stop(now + i * 0.035 + 0.24);
    });
  }

  public playBumper(pan: number): void {
    this.vibrate(16);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(580, now + 0.065);
    osc.frequency.exponentialRampToValueAtTime(360, now + 0.19);
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.21);
    osc.connect(gain);
    this.connectOut(gain, pan, true);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  public playCloudBounce(pan: number): void {
    this.vibrate(10);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.11);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    this.connectOut(gain, pan, true);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playEnemySmash(combo: number, pan: number): void {
    this.vibrate(18);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Crisp crunch + musical note
    this.playPrismHit(combo + 2, pan, false);

    const sub = this.ctx.createOscillator();
    const sGain = this.ctx.createGain();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(190, now);
    sub.frequency.exponentialRampToValueAtTime(58, now + 0.12);
    sGain.gain.setValueAtTime(0.16, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    sub.connect(sGain);
    this.connectOut(sGain, pan, false);
    sub.start(now);
    sub.stop(now + 0.14);
  }

  public playSupernova(pan = 0): void {
    this.vibrate([25, 30, 40]);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Deep sub-drop
    const sub = this.ctx.createOscillator();
    const sGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(160, now);
    sub.frequency.exponentialRampToValueAtTime(34, now + 0.42);
    sGain.gain.setValueAtTime(0.42, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    sub.connect(sGain);
    this.connectOut(sGain, pan, false);
    sub.start(now);
    sub.stop(now + 0.46);

    // Explosive noise burst
    if (this.noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3200, now);
      filter.frequency.exponentialRampToValueAtTime(240, now + 0.36);
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.32, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      src.connect(filter);
      filter.connect(nGain);
      this.connectOut(nGain, pan, true);
      src.start(now);
      src.stop(now + 0.4);
    }

    // Celestial chord shimmer
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, now + 0.02 + i * 0.02);
      g.gain.setValueAtTime(0.11, now + 0.02 + i * 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
      o.connect(g);
      this.connectOut(g, pan, true);
      o.start(now + 0.02 + i * 0.02);
      o.stop(now + 0.44);
    });
  }

  public playFeverStart(): void {
    this.vibrate([18, 25, 30]);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 987.77, 1046.5];
    notes.forEach((f, i) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + i * 0.05);
      g.gain.setValueAtTime(0.18, now + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 0.36);
      osc.connect(g);
      this.connectOut(g, (i - 2) * 0.25, true);
      osc.start(now + i * 0.05);
      osc.stop(now + i * 0.05 + 0.38);
    });
  }

  public playShieldDeflect(pan = 0): void {
    this.vibrate(20);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.12);
    g.gain.setValueAtTime(0.12, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(g);
    this.connectOut(g, pan, true);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playShieldSaved(): void {
    this.vibrate([20, 20, 20]);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    [880, 587.33, 440].forEach((f, i) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + i * 0.04);
      g.gain.setValueAtTime(0.22, now + i * 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.24);
      osc.connect(g);
      this.connectOut(g, 0, true);
      osc.start(now + i * 0.04);
      osc.stop(now + i * 0.04 + 0.26);
    });
  }

  public playGateChime(): void {
    this.vibrate([12, 30, 18]);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    [392.0, 493.88, 587.33, 739.99, 987.77].forEach((f, i) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + i * 0.055);
      g.gain.setValueAtTime(0.16, now + i * 0.055);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.45);
      osc.connect(g);
      this.connectOut(g, (i - 2) * 0.2, true);
      osc.start(now + i * 0.055);
      osc.stop(now + i * 0.055 + 0.47);
    });
  }

  public playBossHit(): void {
    this.vibrate([25, 20, 35]);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.24);
    g.gain.setValueAtTime(0.26, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    osc.connect(g);
    this.connectOut(g, 0, true);
    osc.start(now);
    osc.stop(now + 0.27);
  }

  public playBossDefeat(): void {
    this.playSupernova(0);
    setTimeout(() => this.playFeverStart(), 140);
  }

  public playGameOver(): void {
    this.vibrate([35, 40, 60]);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    [440, 392, 329.63, 261.63].forEach((f, i) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + i * 0.09);
      g.gain.setValueAtTime(0.18, now + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.35);
      osc.connect(g);
      this.connectOut(g, 0, true);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.37);
    });
  }

  public playUiTap(bright = false): void {
    this.vibrate(5);
    if (!this.sfxEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(bright ? 660 : 480, now);
    osc.frequency.exponentialRampToValueAtTime(bright ? 880 : 560, now + 0.045);
    g.gain.setValueAtTime(0.11, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(g);
    this.connectOut(g, 0, false);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  private startAmbientLoop(): void {
    if (this.ambientTimer !== null) return;
    const stepMs = 420;
    this.ambientTimer = window.setInterval(() => {
      if (!this.ctx || !this.musicFilter || !this.musicEnabled || this.ctx.state !== 'running') {
        return;
      }
      if (document.hidden) return;

      const now = this.ctx.currentTime;
      const chord = AMBIENT_CHORDS[this.chordIndex % AMBIENT_CHORDS.length];
      const transpose = 1 + (this.currentBiomeIndex % 3) * 0.05946; // gentle semitone lift per biome

      // Every 8 steps, warm pad swell
      if (this.arpStep % 8 === 0) {
        chord.slice(0, 3).forEach((freq) => {
          if (!this.ctx || !this.musicFilter) return;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq * transpose, now);
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.08, now + 1.1);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 3.4);
          osc.connect(gain);
          gain.connect(this.musicFilter);
          osc.start(now);
          osc.stop(now + 3.5);
        });
      }

      // Gentle celestial twinkle arp
      if (this.isFever || this.arpStep % 2 === 0) {
        const noteFreq = chord[this.arpStep % chord.length] * 2 * transpose;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = this.isFever ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(noteFreq, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(this.isFever ? 0.09 : 0.045, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc.connect(gain);
        gain.connect(this.musicFilter);
        osc.start(now);
        osc.stop(now + 0.58);
      }

      this.arpStep++;
      if (this.arpStep % 16 === 0) {
        this.chordIndex++;
      }
    }, stepMs);
  }
}

export const sound = new SoundEngine();
