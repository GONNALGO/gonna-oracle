// All audio synthesized with WebAudio. No files. Mute toggle handled by engine.

export interface Track {
  bpm: number;
  bass: (number | 0)[]; // midi notes per 16th step, 0 = rest
  lead: (number | 0)[];
  bassWave?: OscillatorType;
  leadWave?: OscillatorType;
}

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// ---- Chiptune compositions (16th-note steps) ----
// Stage 1: night city drive, A minor, 140bpm, 64 steps (4 bars)
const ST1_BASS: (number | 0)[] = [
  33, 0, 33, 0, 33, 0, 36, 0, 33, 0, 33, 0, 40, 0, 38, 0,
  33, 0, 33, 0, 33, 0, 36, 0, 31, 0, 31, 0, 38, 0, 36, 0,
  33, 0, 33, 0, 33, 0, 36, 0, 33, 0, 33, 0, 40, 0, 38, 0,
  29, 0, 29, 0, 31, 0, 33, 0, 36, 0, 38, 0, 40, 0, 43, 0,
];
const ST1_LEAD: (number | 0)[] = [
  57, 0, 60, 0, 64, 0, 60, 0, 65, 0, 64, 0, 60, 0, 57, 0,
  57, 0, 60, 0, 64, 0, 67, 0, 65, 0, 64, 0, 60, 0, 62, 0,
  57, 0, 60, 0, 64, 0, 60, 0, 65, 0, 64, 0, 60, 0, 57, 0,
  55, 0, 57, 0, 59, 0, 60, 0, 62, 0, 64, 0, 67, 0, 69, 0,
];
// Stage 2: docks dusk, C major-ish groove, 132bpm
const ST2_BASS: (number | 0)[] = [
  36, 0, 0, 36, 0, 0, 39, 0, 36, 0, 0, 36, 0, 43, 0, 41,
  34, 0, 0, 34, 0, 0, 38, 0, 36, 0, 0, 36, 0, 41, 0, 39,
  36, 0, 0, 36, 0, 0, 39, 0, 36, 0, 0, 36, 0, 43, 0, 41,
  31, 0, 0, 31, 0, 0, 34, 0, 33, 0, 0, 33, 0, 36, 0, 38,
];
const ST2_LEAD: (number | 0)[] = [
  60, 0, 0, 0, 64, 0, 67, 0, 0, 0, 65, 0, 64, 0, 0, 0,
  58, 0, 0, 0, 62, 0, 65, 0, 0, 0, 64, 0, 62, 0, 0, 0,
  60, 0, 0, 0, 64, 0, 67, 0, 0, 0, 69, 0, 67, 0, 65, 0,
  64, 0, 0, 0, 62, 0, 60, 0, 58, 0, 55, 0, 58, 0, 0, 0,
];
// Stage 3 / boss: fast minor, tense, 160bpm
const ST3_BASS: (number | 0)[] = [
  33, 33, 0, 33, 33, 0, 33, 36, 33, 33, 0, 33, 38, 0, 36, 0,
  33, 33, 0, 33, 33, 0, 33, 36, 31, 31, 0, 31, 38, 0, 40, 0,
  33, 33, 0, 33, 33, 0, 33, 36, 33, 33, 0, 33, 38, 0, 36, 0,
  29, 29, 0, 29, 31, 0, 33, 0, 36, 36, 0, 38, 40, 0, 41, 0,
];
const ST3_LEAD: (number | 0)[] = [
  69, 0, 69, 0, 0, 72, 0, 69, 67, 0, 64, 0, 69, 0, 0, 0,
  69, 0, 69, 0, 0, 72, 0, 74, 72, 0, 69, 0, 67, 0, 64, 0,
  69, 0, 69, 0, 0, 72, 0, 69, 67, 0, 64, 0, 69, 0, 0, 0,
  65, 0, 67, 0, 69, 0, 72, 0, 76, 0, 74, 0, 72, 0, 74, 0,
];
// Title: heroic slow loop, 120bpm
const TITLE_BASS: (number | 0)[] = [
  33, 0, 0, 0, 33, 0, 0, 0, 36, 0, 0, 0, 38, 0, 0, 0,
  33, 0, 0, 0, 33, 0, 0, 0, 40, 0, 38, 0, 36, 0, 31, 0,
];
const TITLE_LEAD: (number | 0)[] = [
  57, 0, 0, 60, 0, 0, 64, 0, 0, 69, 0, 0, 67, 0, 64, 0,
  57, 0, 0, 60, 0, 0, 64, 0, 72, 0, 0, 71, 0, 69, 0, 0,
];

export const TRACKS: Record<string, Track> = {
  title: { bpm: 120, bass: TITLE_BASS, lead: TITLE_LEAD, leadWave: 'square' },
  stage1: { bpm: 140, bass: ST1_BASS, lead: ST1_LEAD },
  stage2: { bpm: 132, bass: ST2_BASS, lead: ST2_LEAD },
  stage3: { bpm: 160, bass: ST3_BASS, lead: ST3_LEAD },
  boss: { bpm: 168, bass: ST3_BASS, lead: ST3_LEAD },
};

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  // music sequencer state
  private track: Track | null = null;
  private step = 0;
  private nextT = 0;
  private timer: number | null = null;

  // Must be called from a user gesture (key press).
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.34;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);
    // shared noise buffer
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.nextT = this.ctx.currentTime + 0.06;
    // start sequencer clock
    this.timer = window.setInterval(() => this.schedule(), 40);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  }

  // ---------- SFX primitives ----------
  private blip(freq: number, dur: number, type: OscillatorType, vol: number, slideTo = 0, delay = 0): void {
    if (!this.ctx || !this.sfxGain) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.sfxGain);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, cutoff = 3000, delay = 0): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ---------- Game SFX ----------
  swing(): void { this.noise(0.06, 0.18, 5000); }
  punch(): void { this.noise(0.09, 0.5, 2500); this.blip(220, 0.08, 'square', 0.3, 90); }
  hitHard(): void { this.noise(0.14, 0.6, 1600); this.blip(150, 0.12, 'square', 0.35, 60); }
  block(): void { this.blip(700, 0.05, 'square', 0.2); this.noise(0.04, 0.2, 6000); }
  ko(): void { this.blip(400, 0.4, 'sawtooth', 0.35, 50); this.noise(0.3, 0.35, 1200); }
  pickup(): void { this.blip(660, 0.07, 'square', 0.25); this.blip(880, 0.07, 'square', 0.25, 0, 0.07); this.blip(1320, 0.12, 'square', 0.25, 0, 0.14); }
  coin(): void { this.blip(990, 0.05, 'square', 0.22); this.blip(1320, 0.1, 'square', 0.22, 0, 0.05); }
  jump(): void { this.noise(0.16, 0.2, 4000); this.blip(300, 0.15, 'sine', 0.18, 700); }
  land(): void { this.noise(0.06, 0.25, 1200); }
  grab(): void { this.blip(180, 0.08, 'square', 0.3, 120); this.noise(0.06, 0.3, 2000); }
  throwSfx(): void { this.noise(0.25, 0.35, 3000); this.blip(500, 0.25, 'sine', 0.2, 150); }
  special(): void { this.blip(200, 0.5, 'sawtooth', 0.35, 1600); this.noise(0.5, 0.5, 900, 0.35); this.blip(80, 0.4, 'square', 0.4, 40, 0.35); }
  explode(): void { this.noise(0.7, 0.7, 700); this.blip(120, 0.5, 'sawtooth', 0.4, 30); }
  oneUp(): void { const n = [523, 659, 784, 1047, 1319]; n.forEach((f, i) => this.blip(f, 0.12, 'square', 0.25, 0, i * 0.1)); }
  uiMove(): void { this.blip(440, 0.05, 'square', 0.18); }
  uiSelect(): void { this.blip(660, 0.07, 'square', 0.22); this.blip(990, 0.1, 'square', 0.22, 0, 0.07); }
  hurtPlayer(): void { this.blip(300, 0.15, 'sawtooth', 0.3, 100); this.noise(0.1, 0.3, 1800); }
  fanfare(): void {
    const seq: [number, number][] = [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [784, 0.54], [1047, 0.66], [1319, 0.84]];
    for (const [f, d] of seq) this.blip(f, 0.16, 'square', 0.28, 0, d);
  }

  // ---------- Music sequencer ----------
  playTrack(name: keyof typeof TRACKS): void {
    this.track = TRACKS[name] ?? null;
    this.step = 0;
    if (this.ctx) this.nextT = this.ctx.currentTime + 0.06;
  }

  stopMusic(): void {
    this.track = null;
  }

  private schedule(): void {
    if (!this.ctx || !this.track || !this.musicGain || this.muted) return;
    if (this.nextT < this.ctx.currentTime - 0.25) this.nextT = this.ctx.currentTime;
    const stepDur = 60 / this.track.bpm / 4;
    // schedule up to 0.12s ahead
    while (this.nextT < this.ctx.currentTime + 0.12) {
      const i = this.step % this.track.bass.length;
      const b = this.track.bass[i];
      const l = this.track.lead[i % this.track.lead.length];
      if (b) this.note(midiToFreq(b), stepDur * 0.9, this.track.bassWave ?? 'triangle', 0.5, this.nextT);
      if (l) this.note(midiToFreq(l), stepDur * 0.95, this.track.leadWave ?? 'square', 0.2, this.nextT);
      this.nextT += stepDur;
      this.step++;
    }
  }

  private note(freq: number, dur: number, type: OscillatorType, vol: number, t0: number): void {
    if (!this.ctx || !this.musicGain) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0);
    g.gain.setTargetAtTime(0.0001, t0 + dur * 0.7, 0.03);
    o.connect(g).connect(this.musicGain);
    o.start(t0);
    o.stop(t0 + dur + 0.1);
  }

  destroy(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}
