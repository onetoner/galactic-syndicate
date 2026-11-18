import type { AudioApi, AudioVolumes, MusicMood, SfxName } from './AudioApi';

/**
 * Prozeduraler Web-Audio-Synthesizer: generative Sci-Fi-Ambient-Musik + alle Soundeffekte.
 * Signalweg:  [Musik] -> musicBus \
 *             [SFX]   -> sfxBus   -> master -> Kompressor -> Ausgang
 *             [UI]    -> uiBus    /
 */

interface MoodDef {
  /** Grundton in Hz */
  root: number;
  /** Akkorde als Halbton-Abstände zum Grundton */
  chords: number[][];
  /** Tonleiter für die Melodie-Tupfer (Halbtöne) */
  scale: number[];
  /** Sekunden pro Akkord */
  chordSeconds: number;
  /** Wahrscheinlichkeit pro Achtel für einen Melodie-Ton */
  pluckChance: number;
  /** Achtel-Länge in Sekunden */
  step: number;
  /** Filter-Grundfrequenz des Pads */
  cutoff: number;
  /** Bass-Puls pro Akkord (0 = kein Puls) */
  pulse: number;
  padType: OscillatorType;
}

const MOODS: Record<MusicMood, MoodDef> = {
  menu: {
    root: 110, chords: [[0, 7, 10, 14], [-4, 3, 7, 12], [-2, 5, 9, 12], [-7, 0, 7, 15]],
    scale: [0, 2, 3, 7, 10, 12, 14, 15], chordSeconds: 9, pluckChance: 0.22, step: 0.42, cutoff: 900, pulse: 0, padType: 'sawtooth',
  },
  earth: {
    root: 98, chords: [[0, 7, 10, 15], [-2, 5, 10, 14], [-5, 2, 7, 10], [-4, 3, 8, 12]],
    scale: [0, 3, 5, 7, 10, 12, 15], chordSeconds: 7, pluckChance: 0.3, step: 0.36, cutoff: 700, pulse: 2, padType: 'sawtooth',
  },
  space: {
    root: 130.81, chords: [[0, 7, 11, 14], [2, 9, 13, 18], [-3, 4, 9, 16], [-5, 2, 7, 11]],
    scale: [0, 2, 4, 6, 7, 9, 11, 12, 14], chordSeconds: 11, pluckChance: 0.18, step: 0.5, cutoff: 1300, pulse: 0, padType: 'triangle',
  },
  tension: {
    root: 92.5, chords: [[0, 6, 9, 15], [1, 7, 10, 13], [-2, 4, 7, 13], [0, 3, 6, 12]],
    scale: [0, 1, 3, 6, 7, 9, 12], chordSeconds: 4.5, pluckChance: 0.4, step: 0.24, cutoff: 1100, pulse: 4, padType: 'sawtooth',
  },
};

const semi = (root: number, n: number): number => root * Math.pow(2, n / 12);
const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

type Bus = 'sfx' | 'ui';

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  freqEnd?: number;
  dur: number;
  gain?: number;
  attack?: number;
  delay?: number;
  bus: Bus;
  detune?: number;
}

interface NoiseOpts {
  dur: number;
  gain?: number;
  filter?: BiquadFilterType;
  freq?: number;
  freqEnd?: number;
  q?: number;
  delay?: number;
  attack?: number;
  bus: Bus;
}

export class SynthAudio implements AudioApi {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private uiBus!: GainNode;
  private musicFade!: GainNode;
  private padFilter!: BiquadFilterNode;
  private delay!: DelayNode;
  private delayFeedback!: GainNode;
  private noiseBuffer: AudioBuffer | null = null;

  private volumes: AudioVolumes = { master: 0.8, music: 0.5, sfx: 0.8, ui: 0.6 };
  private mood: MusicMood | null = null;
  private pendingMood: MusicMood | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private stepIndex = 0;
  private chordIndex = 0;
  private nextChordTime = 0;
  private padVoices: { osc: OscillatorNode; gain: GainNode }[] = [];
  private windSource: AudioBufferSourceNode | null = null;
  private lastPlayed = new Map<string, number>();
  /** einfacher deterministischer Zufall für die Musik (kein Einfluss auf die Simulation) */
  private seed = 1337;

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  async unlock(): Promise<void> {
    try {
      if (!this.ctx) this.build();
      if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
      if (this.pendingMood && this.ctx) {
        const m = this.pendingMood;
        this.pendingMood = null;
        this.setMood(m);
      }
    } catch {
      /* Audio ist optional – Fehler dürfen das Spiel nie blockieren */
    }
  }

  isUnlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private build(): void {
    const Ctor: typeof AudioContext | undefined =
      (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.connect(comp);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.uiBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.uiBus.connect(this.master);

    // Musik-Kette: Pad -> Tiefpass -> Fade -> musicBus, plus Echo für Melodie-Tupfer
    this.musicFade = ctx.createGain();
    this.musicFade.gain.value = 0;
    this.musicFade.connect(this.musicBus);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 800;
    this.padFilter.Q.value = 0.7;
    this.padFilter.connect(this.musicFade);
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.42;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.42;
    this.delay.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay);
    this.delay.connect(this.musicFade);

    // Rauschpuffer (2 s) für Wind, Zischen, Explosionen
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = this.rand() * 2 - 1;
    this.noiseBuffer = buf;

    this.applyVolumes();
  }

  setVolumes(v: AudioVolumes): void {
    this.volumes = { master: clamp01(v.master), music: clamp01(v.music), sfx: clamp01(v.sfx), ui: clamp01(v.ui) };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // quadratische Kennlinie fühlt sich natürlicher an als linear
    this.master.gain.setTargetAtTime(this.volumes.master ** 2, t, 0.03);
    this.musicBus.gain.setTargetAtTime(this.volumes.music ** 2 * 0.9, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx ** 2, t, 0.03);
    this.uiBus.gain.setTargetAtTime(this.volumes.ui ** 2 * 0.8, t, 0.03);
  }

  // ---------------------------------------------------------------- Musik

  setMood(mood: MusicMood): void {
    if (!this.ctx) {
      this.pendingMood = mood;
      return;
    }
    if (this.mood === mood && this.timer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const first = this.mood === null || !this.timer;
    this.mood = mood;
    const def = MOODS[mood];

    // weiches Überblenden: kurz absenken, Akkord wechseln, wieder anheben
    this.musicFade.gain.cancelScheduledValues(t);
    this.musicFade.gain.setTargetAtTime(first ? 0 : 0.15, t, 0.4);
    this.musicFade.gain.setTargetAtTime(1, t + (first ? 0.05 : 1.2), 1.4);
    this.padFilter.frequency.setTargetAtTime(def.cutoff, t, 1.5);
    this.delay.delayTime.setTargetAtTime(def.step * 1.5, t, 0.5);

    this.chordIndex = 0;
    this.nextChordTime = t + (first ? 0.05 : 1.0);
    this.nextStepTime = this.nextChordTime;
    this.stepIndex = 0;
    this.startWind();
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 120);
  }

  stopMusic(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.mood = null;
    this.pendingMood = null;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicFade.gain.cancelScheduledValues(t);
    this.musicFade.gain.setTargetAtTime(0, t, 0.3);
    for (const v of this.padVoices) this.releaseVoice(v, t, 0.6);
    this.padVoices = [];
    if (this.windSource) {
      try { this.windSource.stop(t + 1); } catch { /* bereits gestoppt */ }
      this.windSource = null;
    }
  }

  private startWind(): void {
    if (!this.ctx || !this.noiseBuffer || this.windSource) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    // langsame Filterfahrt = "Raumwind"
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain);
    lfoGain.connect(bp.frequency);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.musicFade);
    src.start();
    lfo.start();
    src.onended = () => {
      try { lfo.stop(); } catch { /* egal */ }
    };
    this.windSource = src;
  }

  private releaseVoice(v: { osc: OscillatorNode; gain: GainNode }, t: number, rel: number): void {
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, rel / 3);
      v.osc.stop(t + rel + 0.2);
    } catch {
      /* Stimme war schon beendet */
    }
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.mood || ctx.state !== 'running') return;
    const def = MOODS[this.mood];
    const horizon = ctx.currentTime + 0.6;
    // nach langen Pausen (Tab im Hintergrund) nicht alles nachholen
    if (this.nextStepTime < ctx.currentTime - 1) {
      this.nextStepTime = ctx.currentTime + 0.05;
      this.nextChordTime = Math.min(this.nextChordTime, this.nextStepTime);
    }

    while (this.nextChordTime < horizon) {
      this.playChord(def, def.chords[this.chordIndex % def.chords.length]!, this.nextChordTime);
      this.chordIndex++;
      this.nextChordTime += def.chordSeconds;
    }

    while (this.nextStepTime < horizon) {
      const chord = def.chords[(this.chordIndex + def.chords.length - 1) % def.chords.length]!;
      if (this.rand() < def.pluckChance) {
        const note = def.scale[Math.floor(this.rand() * def.scale.length)]!;
        const octave = this.rand() < 0.3 ? 24 : 12;
        this.pluck(semi(def.root, note + octave), this.nextStepTime, 0.05 + this.rand() * 0.04);
      }
      if (def.pulse > 0 && this.stepIndex % Math.max(1, Math.round(8 / def.pulse)) === 0) {
        this.bassPulse(semi(def.root, chord[0]! - 12), this.nextStepTime);
      }
      this.stepIndex++;
      this.nextStepTime += def.step;
    }
  }

  private playChord(def: MoodDef, chord: number[], t: number): void {
    const ctx = this.ctx!;
    const old = this.padVoices;
    for (const v of old) this.releaseVoice(v, t, 3.2);
    this.padVoices = [];
    chord.forEach((n, i) => {
      for (const det of [-7, 6]) {
        const osc = ctx.createOscillator();
        osc.type = def.padType;
        osc.frequency.value = semi(def.root, n);
        osc.detune.value = det + (this.rand() - 0.5) * 4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.028 - i * 0.003, t + 2.6);
        osc.connect(g);
        g.connect(this.padFilter);
        osc.start(t);
        // Sicherheitsnetz: keine Stimme lebt ewig
        osc.stop(t + def.chordSeconds + 8);
        this.padVoices.push({ osc, gain: g });
      }
    });
    // Sub-Bass
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = semi(def.root, chord[0]! - 12);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.07, t + 1.5);
    sub.connect(sg);
    sg.connect(this.musicFade);
    sub.start(t);
    sub.stop(t + def.chordSeconds + 8);
    this.padVoices.push({ osc: sub, gain: sg });
  }

  private pluck(freq: number, t: number, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 2.01;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    osc.connect(g);
    osc2.connect(g2);
    g2.connect(g);
    g.connect(this.musicFade);
    g.connect(this.delay);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + 1.7);
    osc2.stop(t + 1.7);
  }

  private bassPulse(freq: number, t: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(420, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(f);
    f.connect(g);
    g.connect(this.musicFade);
    osc.start(t);
    osc.stop(t + 0.35);
  }

  // ---------------------------------------------------------------- Soundeffekte

  private bus(b: Bus): GainNode {
    return b === 'ui' ? this.uiBus : this.sfxBus;
  }

  private tone(o: ToneOpts): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, o.freq), t);
    if (o.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const peak = o.gain ?? 0.2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g);
    g.connect(this.bus(o.bus));
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  private noise(o: NoiseOpts): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuffer) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'lowpass';
    f.frequency.setValueAtTime(Math.max(20, o.freq ?? 1200), t);
    if (o.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t + o.dur);
    f.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.2, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.bus(o.bus));
    src.start(t, this.rand() * 1.5);
    src.stop(t + o.dur + 0.05);
  }

  play(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // Drossel: derselbe Effekt höchstens alle 40 ms (Automations-Spam bei 4× Tempo)
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < 0.04) return;
    this.lastPlayed.set(name, now);

    const ui: Bus = 'ui';
    const fx: Bus = 'sfx';
    switch (name) {
      case 'ui_click':
        this.tone({ type: 'triangle', freq: 880, freqEnd: 1320, dur: 0.07, gain: 0.16, bus: ui });
        break;
      case 'ui_hover':
        this.tone({ type: 'sine', freq: 1400, dur: 0.035, gain: 0.05, bus: ui });
        break;
      case 'ui_open':
        this.tone({ type: 'sine', freq: 420, freqEnd: 900, dur: 0.16, gain: 0.14, bus: ui });
        this.noise({ dur: 0.18, gain: 0.04, filter: 'highpass', freq: 2500, bus: ui });
        break;
      case 'ui_close':
        this.tone({ type: 'sine', freq: 820, freqEnd: 380, dur: 0.14, gain: 0.13, bus: ui });
        break;
      case 'ui_error':
        this.tone({ type: 'square', freq: 190, dur: 0.12, gain: 0.1, bus: ui });
        this.tone({ type: 'square', freq: 150, dur: 0.16, gain: 0.1, delay: 0.11, bus: ui });
        break;
      case 'ui_toggle':
        this.tone({ type: 'triangle', freq: 660, dur: 0.05, gain: 0.13, bus: ui });
        this.tone({ type: 'triangle', freq: 990, dur: 0.06, gain: 0.12, delay: 0.05, bus: ui });
        break;
      case 'place':
        this.tone({ type: 'sine', freq: 190, freqEnd: 70, dur: 0.18, gain: 0.3, bus: fx });
        this.noise({ dur: 0.09, gain: 0.12, filter: 'lowpass', freq: 900, bus: fx });
        this.tone({ type: 'triangle', freq: 1200, dur: 0.05, gain: 0.06, delay: 0.02, bus: fx });
        break;
      case 'demolish':
        this.noise({ dur: 0.32, gain: 0.22, filter: 'lowpass', freq: 1800, freqEnd: 200, bus: fx });
        this.tone({ type: 'sawtooth', freq: 140, freqEnd: 45, dur: 0.28, gain: 0.14, bus: fx });
        break;
      case 'plant':
        this.noise({ dur: 0.12, gain: 0.1, filter: 'bandpass', freq: 700, q: 1.5, bus: fx });
        this.tone({ type: 'sine', freq: 520, freqEnd: 780, dur: 0.14, gain: 0.1, delay: 0.05, bus: fx });
        break;
      case 'water':
        for (let i = 0; i < 4; i++) {
          this.tone({ type: 'sine', freq: 700 + this.rand() * 900, freqEnd: 1500 + this.rand() * 700, dur: 0.07, gain: 0.07, delay: i * 0.05, bus: fx });
        }
        this.noise({ dur: 0.25, gain: 0.05, filter: 'highpass', freq: 3000, bus: fx });
        break;
      case 'harvest':
        this.noise({ dur: 0.08, gain: 0.12, filter: 'highpass', freq: 1800, bus: fx });
        [523.25, 659.25, 783.99].forEach((f, i) => this.tone({ type: 'triangle', freq: f, dur: 0.16, gain: 0.11, delay: 0.04 + i * 0.06, bus: fx }));
        break;
      case 'craft':
        this.noise({ dur: 0.3, gain: 0.07, filter: 'bandpass', freq: 1400, freqEnd: 3200, q: 3, bus: fx });
        this.tone({ type: 'sine', freq: 300, freqEnd: 620, dur: 0.3, gain: 0.1, bus: fx });
        this.tone({ type: 'triangle', freq: 1046.5, dur: 0.18, gain: 0.09, delay: 0.3, bus: fx });
        break;
      case 'machine':
        this.tone({ type: 'sawtooth', freq: 82, freqEnd: 96, dur: 0.22, gain: 0.07, bus: fx });
        this.noise({ dur: 0.1, gain: 0.05, filter: 'bandpass', freq: 2400, q: 4, delay: 0.12, bus: fx });
        break;
      case 'buy':
        this.tone({ type: 'triangle', freq: 660, dur: 0.08, gain: 0.13, bus: fx });
        this.tone({ type: 'triangle', freq: 880, dur: 0.1, gain: 0.13, delay: 0.07, bus: fx });
        break;
      case 'sell':
      case 'coins':
        [1318.5, 1568, 2093, 2637].forEach((f, i) => this.tone({ type: 'sine', freq: f, dur: 0.14, gain: 0.08, delay: i * 0.045, bus: fx }));
        break;
      case 'ship_launch':
        this.noise({ dur: 1.4, gain: 0.2, filter: 'lowpass', freq: 200, freqEnd: 2600, attack: 0.3, bus: fx });
        this.tone({ type: 'sawtooth', freq: 55, freqEnd: 220, dur: 1.3, gain: 0.12, attack: 0.2, bus: fx });
        break;
      case 'ship_arrive':
        this.noise({ dur: 0.9, gain: 0.14, filter: 'lowpass', freq: 2400, freqEnd: 200, bus: fx });
        this.tone({ type: 'sine', freq: 784, dur: 0.2, gain: 0.1, delay: 0.5, bus: fx });
        this.tone({ type: 'sine', freq: 1046.5, dur: 0.3, gain: 0.1, delay: 0.68, bus: fx });
        break;
      case 'ship_built':
        [392, 523.25, 659.25, 783.99].forEach((f, i) => this.tone({ type: 'sawtooth', freq: f, dur: 0.3, gain: 0.07, delay: i * 0.1, bus: fx }));
        this.noise({ dur: 0.5, gain: 0.06, filter: 'highpass', freq: 4000, delay: 0.3, bus: fx });
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) this.tone({ type: 'square', freq: 740, freqEnd: 520, dur: 0.22, gain: 0.1, delay: i * 0.26, bus: fx });
        break;
      case 'police':
        for (let i = 0; i < 4; i++) {
          this.tone({ type: 'sawtooth', freq: i % 2 ? 620 : 830, dur: 0.2, gain: 0.09, delay: i * 0.2, bus: fx });
        }
        break;
      case 'bribe':
        this.noise({ dur: 0.2, gain: 0.07, filter: 'highpass', freq: 3500, bus: fx });
        [987.77, 1318.5].forEach((f, i) => this.tone({ type: 'sine', freq: f, dur: 0.2, gain: 0.09, delay: 0.1 + i * 0.09, bus: fx }));
        break;
      case 'explosion':
      case 'raid':
        this.noise({ dur: 1.1, gain: 0.4, filter: 'lowpass', freq: 3000, freqEnd: 60, bus: fx });
        this.tone({ type: 'sine', freq: 120, freqEnd: 28, dur: 0.9, gain: 0.4, bus: fx });
        if (name === 'raid') this.tone({ type: 'square', freq: 440, freqEnd: 330, dur: 0.5, gain: 0.07, delay: 0.5, bus: fx });
        break;
      case 'takeover':
        [261.63, 329.63, 392, 523.25, 659.25].forEach((f, i) => {
          this.tone({ type: 'sawtooth', freq: f, dur: 0.7, gain: 0.07, delay: i * 0.12, bus: fx });
          this.tone({ type: 'sine', freq: f * 2, dur: 0.7, gain: 0.05, delay: i * 0.12, bus: fx });
        });
        this.tone({ type: 'sine', freq: 65.4, dur: 1.4, gain: 0.25, bus: fx });
        break;
      case 'system_lost':
        [392, 349.23, 311.13, 233.08].forEach((f, i) => this.tone({ type: 'sawtooth', freq: f, dur: 0.5, gain: 0.08, delay: i * 0.18, bus: fx }));
        this.tone({ type: 'sine', freq: 90, freqEnd: 40, dur: 1.2, gain: 0.22, bus: fx });
        break;
      case 'rank_up':
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone({ type: 'triangle', freq: f, dur: 0.35, gain: 0.1, delay: i * 0.08, bus: fx }));
        break;
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  dispose(): void {
    this.stopMusic();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}

/** Stummer Ersatz für Umgebungen ohne Web Audio (Tests, sehr alte Browser). */
export class NullAudio implements AudioApi {
  async unlock(): Promise<void> { /* nichts */ }
  isUnlocked(): boolean { return false; }
  setVolumes(_v: AudioVolumes): void { /* nichts */ }
  setMood(_m: MusicMood): void { /* nichts */ }
  stopMusic(): void { /* nichts */ }
  play(_n: SfxName): void { /* nichts */ }
  suspend(): void { /* nichts */ }
  resume(): void { /* nichts */ }
  dispose(): void { /* nichts */ }
}

export function createAudio(): AudioApi {
  const g = globalThis as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
  return g.AudioContext || g.webkitAudioContext ? new SynthAudio() : new NullAudio();
}
