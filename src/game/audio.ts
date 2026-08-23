// All audio synthesized with WebAudio. No files. Mute toggle handled by engine.
//
// v7 — full COMPOSITIONAL rewrite, Capcom CPS1/CPS2 school (Final Fight,
// Street Fighter II, Mega Man). The WebAudio scheduler engine is unchanged in
// architecture; the music itself is now composed, not beeped:
// - 3 voices: BASS (triangle, low octave, groovy 8th-note lines), LEAD (25%
//   pulse wave, catchy hooks, light delayed vibrato, sits UNDER the bass),
//   DRUMS (noise: kick on quarters, snare on 2&4, hats 8ths/16ths + fills).
// - Real chord progressions: i-VI-III-VII for the urban stages, i-iv-V for
//   boss tension. 8-bar loops, with a B-cycle variation every second pass
//   (drum fill + counter-melody turnaround).
// - Less shrill: gentle lowpass on the music bus, mid registers, no staccato
//   piercing repeats, lead level below bass level.

// ---------------------------------------------------------------------------
// Sequencer data model. Patterns are written as 16th-step token strings:
//   note name + octave (A1, C#2, Bb3) = note-on, '~' = sustain, '.' = rest.
// Drum tokens per 16th step: k=kick s=snare h=hat o=open-hat c=crash
// (combinable: 'kh' = kick+hat). '.' = silence.
// ---------------------------------------------------------------------------

import { visualRand } from './rng';
export interface SeqEvent {
  step: number; // 16th-note index inside the loop
  midi: number;
  len: number; // sustain in 16th steps
}

export interface Track {
  bpm: number;
  steps: number; // loop length in 16th steps (bars * 16)
  swing: number; // 0 = straight, >0 delays off-16ths (funky shuffle)
  bass: SeqEvent[];
  lead: SeqEvent[];
  bassB: SeqEvent[] | null; // B-cycle variation (every 2nd loop)
  leadB: SeqEvent[] | null;
  drums: number[];
  drumsB: number[] | null;
  // compiled step -> event lookups
  bMap: (SeqEvent | null)[];
  lMap: (SeqEvent | null)[];
  bMapB: (SeqEvent | null)[] | null;
  lMapB: (SeqEvent | null)[] | null;
}

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

const STEP_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function parsePat(src: string): SeqEvent[] {
  const toks = src.trim().split(/\s+/);
  const out: SeqEvent[] = [];
  let last: SeqEvent | null = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === '.') {
      last = null;
      continue;
    }
    if (t === '~') {
      if (last) last.len++;
      continue;
    }
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(t);
    if (!m) throw new Error('bad note token: ' + t);
    let semi = STEP_SEMI[m[1]];
    if (m[2] === '#') semi++;
    else if (m[2] === 'b') semi--;
    const midi = (parseInt(m[3], 10) + 1) * 12 + semi;
    last = { step: i, midi, len: 1 };
    out.push(last);
  }
  return out;
}

const DRUM_BIT: Record<string, number> = { k: 1, s: 2, h: 4, o: 8, c: 16 };

function parseDrums(src: string): number[] {
  return src
    .trim()
    .split(/\s+/)
    .map((t) => {
      let m = 0;
      for (const ch of t) m |= DRUM_BIT[ch] ?? 0;
      return m;
    });
}

function toMap(ev: SeqEvent[], steps: number): (SeqEvent | null)[] {
  const map: (SeqEvent | null)[] = new Array(steps).fill(null);
  for (const e of ev) map[e.step] = e;
  return map;
}

function mkTrack(
  bpm: number,
  bassA: string,
  leadA: string,
  drumA: string,
  opts: { swing?: number; bassB?: string; leadB?: string; drumB?: string } = {},
): Track {
  const bass = parsePat(bassA);
  const lead = parsePat(leadA);
  const drums = parseDrums(drumA);
  const steps = drums.length;
  const bassB = opts.bassB ? parsePat(opts.bassB) : null;
  const leadB = opts.leadB ? parsePat(opts.leadB) : null;
  const drumsB = opts.drumB ? parseDrums(opts.drumB) : null;
  return {
    bpm,
    steps,
    swing: opts.swing ?? 0,
    bass,
    lead,
    bassB,
    leadB,
    drums,
    drumsB,
    bMap: toMap(bass, steps),
    lMap: toMap(lead, steps),
    bMapB: bassB ? toMap(bassB, steps) : null,
    lMapB: leadB ? toMap(leadB, steps) : null,
  };
}

// ---- reusable drum bars (16 tokens each) ----
const D_ROCK = 'kh . h . sh . h . kh . h . sh . h .'; // kick 1&3, snare 2&4, 8th hats
const D_ROCKC = 'ckh . h . sh . h . kh . h . sh . h .'; // + crash accent
const D_DRIVE = 'kh h h h sh h h h kh h h h sh h h h'; // martial 16th hats
const D_DRIVEC = 'ckh h h h sh h h h kh h h h sh h h h';
const D_DOCK = 'kh . h . sh . k . kh . h . sh . h .'; // laid-back, kick push on & of 2
const D_FUNK = 'kh h . h sh h kh . kh h . h sh h o .'; // funky 16th grid (swung)
const D_CALM = 'kh . . . sh . . . kh . . . sh . h .'; // dojo minimalism
const D_FILL = 'kh . h . sh . h . kh . sh . s s sh o'; // turnaround fill
const D_FILL16 = 'kh h h h sh h sh h kh h sh sh s s sh o'; // 16th fill
const D_JINGLE = 'ckh . h . sh . h . kh . h . sh . h o';
const D_FINALE = 'kh . sh . kh . sh . kh sh s s c . . .';
const D_SPARSE = 'k . . . s . . . k . . . s . . .';
const D_END = 'k . . . . . . . . . . . . . . .';

function drumLoop(bars: string[]): string {
  return bars.join(' ');
}

// ---------------------------------------------------------------------------
// COMPOSITIONS — all loops are 8 bars (128 steps).
// ---------------------------------------------------------------------------

// TITLE — heroic, memorable fanfare-loop. C major: I - V6 - vi - iii - IV - I6 - ii - V.
const TITLE_BASS_A = [
  'C2 . C2 . G1 . C2 . C3 . C2 . G1 . C2 .', // C
  'B1 . B1 . G1 . B1 . B2 . B1 . G1 . B1 .', // G/B
  'A1 . A1 . E2 . A1 . A2 . A1 . E2 . A1 .', // Am
  'E2 . E2 . B1 . E2 . E3 . E2 . B1 . E2 .', // Em
  'F2 . F2 . C2 . F2 . C3 . F2 . C2 . F2 .', // F
  'E2 . E2 . C2 . E2 . E3 . E2 . C2 . E2 .', // C/E
  'D2 . D2 . A1 . D2 . D3 . D2 . A1 . D2 .', // Dm
  'G1 . G1 . D2 . G1 . G2 . G1 . D2 . G1 G2', // G (pickup)
].join(' ');
const TITLE_LEAD_A = [
  'E4 ~ ~ . G4 ~ ~ . C5 ~ ~ . ~ ~ ~ .', // the hook: rise to C5 and hold
  'D5 ~ ~ . B4 ~ ~ . G4 ~ . A4 . B4 ~ .',
  'C5 ~ ~ . A4 ~ ~ . E4 ~ . G4 . A4 ~ .',
  'B4 ~ ~ . G4 ~ ~ . E4 ~ ~ . ~ ~ ~ .',
  'A4 ~ ~ . C5 ~ ~ . E5 ~ ~ . D5 . C5 .',
  'G4 ~ ~ . E4 ~ ~ . C5 ~ . B4 . A4 ~ .',
  'A4 ~ ~ . F4 ~ ~ . D4 ~ . E4 . F4 ~ .',
  'G4 ~ . A4 . B4 ~ . D5 ~ . E5 ~ ~ ~ .',
].join(' ');
const TITLE_BASS_B = [
  'C2 . C2 . G1 . C2 . C3 . C2 . G1 . C2 .',
  'B1 . B1 . G1 . B1 . B2 . B1 . G1 . B1 .',
  'A1 . A1 . E2 . A1 . A2 . A1 . E2 . A1 .',
  'E2 . E2 . B1 . E2 . E3 . E2 . B1 . E2 .',
  'F2 . F2 . C2 . F2 . C3 . F2 . C2 . F2 .',
  'E2 . E2 . C2 . E2 . E3 . E2 . C2 . E2 .',
  'D2 . D2 . A1 . D2 . F2 . A2 . D3 . A2 .', // ii with run-up
  'G1 . G1 . D2 . G1 . G2 . F2 . D2 . B1 .', // V turnaround
].join(' ');
const TITLE_LEAD_B = [
  'E4 ~ ~ . G4 ~ ~ . C5 ~ ~ . ~ ~ ~ .',
  'D5 ~ ~ . B4 ~ ~ . G4 ~ . A4 . B4 ~ .',
  'C5 ~ ~ . A4 ~ ~ . E4 ~ . G4 . A4 ~ .',
  'B4 ~ ~ . G4 ~ ~ . E4 ~ ~ . ~ ~ ~ .',
  'A4 ~ ~ . C5 ~ ~ . E5 ~ ~ . D5 . C5 .',
  'G4 ~ ~ . E4 ~ ~ . C5 ~ . B4 . A4 ~ .',
  'F4 ~ ~ . A4 ~ ~ . D5 ~ . C5 . A4 ~ .', // counter-melody answer
  'B4 ~ . D5 . G4 ~ . A4 ~ . B4 ~ ~ ~ .',
].join(' ');

// STAGE 1 METRO — urban groove, A minor: i - VI - III - VII (x2), 112bpm.
const S1_BASS_A = [
  'A1 . A1 . A1 . A2 . A1 . A1 . G1 . A1 .',
  'F1 . F1 . F1 . F2 . F1 . F1 . E1 . F1 .',
  'C2 . C2 . C2 . C3 . C2 . C2 . B1 . C2 .',
  'G1 . G1 . G1 . G2 . G1 . G1 . A1 . B1 .',
  'A1 . A1 . A2 . A1 . A1 . E2 . G1 . A1 .',
  'F2 . F2 . F2 . C2 . F2 . C2 . E2 . F2 .', // F up an octave under the lead peak
  'C2 . C2 . C3 . C2 . C2 . G1 . B1 . C2 .',
  'G1 . G1 . G2 . G1 . B1 . D2 . G2 . G1 .',
].join(' ');
const S1_LEAD_A = [
  'A4 ~ ~ . G4 . A4 . C5 ~ ~ . A4 ~ ~ .', // hook phrase 1
  'A4 ~ ~ . G4 . A4 . F4 ~ ~ . E4 ~ ~ .',
  'E4 ~ ~ . G4 ~ . A4 . C5 ~ ~ . D5 ~ .',
  'D5 ~ ~ . B4 ~ . G4 . A4 ~ . ~ ~ ~ .',
  'A4 ~ ~ . G4 . A4 . C5 ~ ~ . D5 ~ ~ .', // hook phrase 2 (lifted)
  'E5 ~ ~ . D5 . C5 . A4 ~ ~ . G4 ~ ~ .',
  'E4 ~ . G4 . A4 ~ . C5 . D5 ~ . E5 ~ .',
  'D5 ~ . B4 . G4 ~ . A4 ~ ~ . ~ ~ ~ .',
].join(' ');
const S1_BASS_B = S1_BASS_A; // groove locked; variation lives in lead + drums
const S1_LEAD_B = [
  'A4 ~ ~ . G4 . A4 . C5 ~ ~ . A4 ~ ~ .',
  'A4 ~ ~ . G4 . A4 . F4 ~ ~ . E4 ~ ~ .',
  'E4 ~ ~ . G4 ~ . A4 . C5 ~ ~ . D5 ~ .',
  'D5 ~ ~ . B4 ~ . G4 . A4 ~ . ~ ~ ~ .',
  'A4 ~ ~ . G4 . A4 . C5 ~ ~ . D5 ~ ~ .',
  'E5 ~ ~ . D5 . C5 . A4 ~ ~ . G4 ~ ~ .',
  'G4 ~ ~ . E4 ~ . G4 . A4 ~ ~ . C5 ~ .', // counter-melody turnaround
  'B4 ~ . D5 . B4 ~ . G4 ~ . A4 ~ ~ ~ .',
].join(' ');

// STAGE 2 DOCKS — laid-back but driving, D minor: i - VI - III - VII, 96bpm.
const S2_BASS_A = [
  'D2 ~ ~ . . D2 . . D2 . . A1 . D2 . .',
  'Bb1 ~ ~ . . Bb1 . . Bb1 . . F1 . Bb1 . .',
  'F1 ~ ~ . . F1 . . F1 . . C2 . F1 . .',
  'C2 ~ ~ . . C2 . . C2 . . G1 . C2 . .',
  'D2 ~ ~ . . D2 . . D2 . . A1 . C2 D2 .',
  'Bb1 ~ ~ . . Bb1 . . Bb1 . . F1 . A1 Bb1 .',
  'F1 ~ ~ . . F1 . . F1 . . C2 . E2 F2 .',
  'C2 ~ ~ . . C2 . . C2 . . D2 . E2 G2 .',
].join(' ');
const S2_LEAD_A = [
  'A4 ~ ~ ~ ~ ~ . . F4 ~ ~ . A4 ~ ~ .',
  'F4 ~ ~ ~ ~ ~ . . D4 ~ ~ . F4 ~ ~ .',
  'A4 ~ ~ . G4 ~ ~ . F4 ~ ~ . E4 ~ ~ .',
  'E4 ~ ~ . D4 ~ ~ . C4 ~ ~ . ~ ~ ~ .',
  'F4 ~ ~ . A4 ~ ~ . D5 ~ ~ . C5 ~ ~ .',
  'C5 ~ ~ . A4 ~ ~ . F4 ~ ~ . G4 ~ ~ .',
  'A4 ~ ~ . C5 ~ ~ . A4 ~ . G4 . F4 ~ .',
  'E4 ~ . G4 . E4 ~ . D4 ~ ~ . ~ ~ ~ .',
].join(' ');
const S2_BASS_B = S2_BASS_A;
const S2_LEAD_B = [
  'A4 ~ ~ ~ ~ ~ . . F4 ~ ~ . A4 ~ ~ .',
  'F4 ~ ~ ~ ~ ~ . . D4 ~ ~ . F4 ~ ~ .',
  'A4 ~ ~ . G4 ~ ~ . F4 ~ ~ . E4 ~ ~ .',
  'E4 ~ ~ . D4 ~ ~ . C4 ~ ~ . ~ ~ ~ .',
  'F4 ~ ~ . A4 ~ ~ . D5 ~ ~ . C5 ~ ~ .',
  'C5 ~ ~ . A4 ~ ~ . F4 ~ ~ . G4 ~ ~ .',
  'C5 ~ ~ . A4 ~ . C5 . D5 ~ ~ . C5 ~ .', // counter-melody
  'G4 ~ . E4 . C4 ~ . D4 ~ ~ . ~ ~ ~ .',
].join(' ');

// STAGE 3 WALL ST — martial, E minor: i - VI - III - VII, 122bpm, 16th hats.
const S3_BASS_A = [
  'E1 . E1 E1 . E1 . E2 . E1 . E1 . B1 . E1',
  'C2 . C2 C2 . C2 . C3 . C2 . C2 . G1 . C2',
  'G1 . G1 G1 . G1 . G2 . G1 . G1 . D2 . G1',
  'D2 . D2 D2 . D2 . D3 . D2 . D2 . A1 . D2',
  'E1 . E1 E1 . E1 . E2 . E1 . B1 . D2 . E2',
  'C2 . C2 C2 . C2 . C3 . C2 . G1 . B1 . C2',
  'G1 . G1 G1 . G1 . G2 . G1 . D2 . F#2 . G2',
  'D2 . D2 D2 . D2 . A2 . A1 . B1 . C#2 . D2',
].join(' ');
const S3_LEAD_A = [
  'E4 . E4 . G4 ~ . E4 . A4 ~ . G4 ~ ~ .',
  'E4 . E4 . G4 ~ . A4 . G4 ~ . E4 ~ ~ .',
  'D4 . D4 . G4 ~ . B4 ~ ~ . A4 . G4 ~ .',
  'A4 ~ . G4 . F#4 ~ . E4 ~ . D4 ~ ~ ~ .',
  'E4 . E4 . G4 ~ . E4 . B4 ~ . A4 ~ ~ .',
  'A4 . A4 . C5 ~ . B4 . A4 ~ . G4 ~ ~ .',
  'B4 ~ . A4 . G4 ~ . D5 ~ . B4 . G4 ~ .',
  'A4 ~ . F#4 . D4 ~ . E4 ~ ~ . ~ ~ ~ .',
].join(' ');
const S3_BASS_B = S3_BASS_A;
const S3_LEAD_B = [
  'E4 . E4 . G4 ~ . E4 . A4 ~ . G4 ~ ~ .',
  'E4 . E4 . G4 ~ . A4 . G4 ~ . E4 ~ ~ .',
  'D4 . D4 . G4 ~ . B4 ~ ~ . A4 . G4 ~ .',
  'A4 ~ . G4 . F#4 ~ . E4 ~ . D4 ~ ~ ~ .',
  'E4 . E4 . G4 ~ . E4 . B4 ~ . A4 ~ ~ .',
  'A4 . A4 . C5 ~ . B4 . A4 ~ . G4 ~ ~ .',
  'G4 ~ . B4 . D5 ~ . B4 . G4 . A4 . B4 .', // martial answer
  'F#4 ~ . D4 . A4 ~ . E4 ~ ~ . ~ ~ ~ .',
].join(' ');

// STAGE 4 DOJO — pentatonic, calmer. A minor pentatonic: i - i - iv - iv - VI - VII - i - i, 92bpm.
const S4_BASS_A = [
  'A1 ~ ~ . A1 ~ ~ . A1 ~ ~ . E2 ~ ~ .',
  'A1 ~ ~ . A1 ~ ~ . G1 ~ ~ . E1 ~ ~ .',
  'D2 ~ ~ . D2 ~ ~ . D2 ~ ~ . A1 ~ ~ .',
  'D2 ~ ~ . D2 ~ ~ . C2 ~ ~ . A1 ~ ~ .',
  'F1 ~ ~ . F1 ~ ~ . C2 ~ ~ . F2 ~ ~ .',
  'G1 ~ ~ . G1 ~ ~ . D2 ~ ~ . G2 ~ ~ .',
  'A1 ~ ~ . A1 ~ ~ . E2 ~ ~ . A1 ~ ~ .',
  'A1 ~ ~ . G1 ~ ~ . E1 ~ ~ . A1 ~ ~ .',
].join(' ');
const S4_LEAD_A = [
  'A4 ~ ~ ~ ~ ~ . . D5 ~ ~ ~ ~ ~ . .',
  'C5 ~ ~ ~ ~ ~ . . A4 ~ ~ . G4 ~ ~ .',
  'A4 ~ ~ ~ ~ ~ . . G4 ~ ~ . E4 ~ ~ .',
  'D4 ~ ~ ~ ~ ~ . . E4 ~ ~ . G4 ~ ~ .',
  'A4 ~ ~ . C5 ~ ~ . D5 ~ ~ . E5 ~ ~ .',
  'D5 ~ ~ . C5 ~ ~ . A4 ~ ~ . G4 ~ ~ .',
  'E4 ~ ~ . G4 ~ ~ . A4 ~ ~ . C5 ~ ~ .',
  'A4 ~ ~ ~ ~ ~ . . ~ ~ ~ ~ ~ ~ ~ .',
].join(' ');
const S4_BASS_B = S4_BASS_A;
const S4_LEAD_B = [
  'A4 ~ ~ ~ ~ ~ . . D5 ~ ~ ~ ~ ~ . .',
  'C5 ~ ~ ~ ~ ~ . . A4 ~ ~ . G4 ~ ~ .',
  'A4 ~ ~ ~ ~ ~ . . G4 ~ ~ . E4 ~ ~ .',
  'D4 ~ ~ ~ ~ ~ . . E4 ~ ~ . G4 ~ ~ .',
  'A4 ~ ~ . C5 ~ ~ . D5 ~ ~ . E5 ~ ~ .',
  'D5 ~ ~ . C5 ~ ~ . A4 ~ ~ . G4 ~ ~ .',
  'C5 ~ ~ . A4 ~ ~ . G4 ~ ~ . E4 ~ ~ .', // falling counter-melody
  'D4 ~ ~ . E4 ~ ~ . A4 ~ ~ ~ ~ ~ . .',
].join(' ');

// STAGE 5 CASINO — funky swing, C minor: i - i - iv - iv - i - iv - V - i, 106bpm swung.
const S5_BASS_A = [
  'C2 . . C2 . C2 . . Eb2 . . C2 . G1 . Bb1',
  'C2 . . C2 . C2 . . Eb2 . . C2 . Bb1 . C2',
  'F2 . . F2 . F2 . . Ab2 . . F2 . C3 . Eb3', // iv up an octave under the high stabs
  'F2 . . F2 . F2 . . Ab2 . . F2 . Eb3 . F2',
  'C2 . . C2 . C2 . . Eb2 . . C2 . G1 . Bb1',
  'F2 . . F2 . F2 . . Ab2 . . F2 . C3 . Eb3',
  'G1 . . G1 . G1 . . B1 . . D2 . G2 . G1',
  'C2 . . C2 . Eb2 . G2 . . C3 . Bb2 . G2 .',
].join(' ');
const S5_LEAD_A = [
  'C4 . . Eb4 . G4 . . Bb4 ~ . . G4 . Eb4 .',
  'C4 . . Eb4 . G4 . . Bb4 . A4 . G4 ~ ~ .',
  'F4 . . Ab4 . C5 ~ . . Bb4 ~ . . Ab4 ~ .',
  'F4 . . Ab4 . C5 . . Bb4 . Ab4 . G4 ~ ~ .',
  'C4 . . Eb4 . G4 . . Bb4 ~ . . C5 ~ ~ .',
  'Ab4 . . C5 . Eb5 ~ . . C5 ~ . . Bb4 ~ .',
  'G4 . . B4 . D5 ~ . . B4 . D5 . G4 ~ .',
  'C5 ~ ~ . Bb4 . G4 . Eb4 ~ ~ . ~ ~ ~ .',
].join(' ');
const S5_BASS_B = S5_BASS_A;
const S5_LEAD_B = [
  'C4 . . Eb4 . G4 . . Bb4 ~ . . G4 . Eb4 .',
  'C4 . . Eb4 . G4 . . Bb4 . A4 . G4 ~ ~ .',
  'F4 . . Ab4 . C5 ~ . . Bb4 ~ . . Ab4 ~ .',
  'F4 . . Ab4 . C5 . . Bb4 . Ab4 . G4 ~ ~ .',
  'C4 . . Eb4 . G4 . . Bb4 ~ . . C5 ~ ~ .',
  'Ab4 . . C5 . Eb5 ~ . . C5 ~ . . Bb4 ~ .',
  'D5 ~ . B4 . G4 ~ . B4 . D5 ~ . B4 . G4', // dominant climb
  'Eb5 ~ . C5 . Bb4 ~ . G4 ~ . Eb4 ~ ~ ~ .',
].join(' ');

// STAGE 6 LAUNCHPAD — rising epic, A minor: i - VI - VII - v - i - VI - iv - V, 126bpm.
const S6_BASS_A = [
  'A1 . A1 . C2 . D2 . E2 . D2 . C2 . A1 .',
  'F1 . F1 . A1 . C2 . F2 . C2 . A1 . F1 .',
  'G1 . G1 . B1 . D2 . G2 . D2 . B1 . G1 .',
  'E2 . E2 . G1 . B1 . E2 . B1 . G1 . E2 .', // v up an octave under the held E5
  'A1 . A1 . C2 . E2 . A2 . E2 . C2 . A1 .',
  'F1 . F1 . A1 . C2 . F2 . C2 . A1 . F1 .',
  'D2 . D2 . F2 . A2 . C3 . A2 . F2 . D2 .',
  'E1 . E1 . G#1 . B1 . E2 . D2 . B1 . G#1 .',
].join(' ');
const S6_LEAD_A = [
  'A4 ~ ~ . C5 ~ ~ . E5 ~ ~ . D5 . C5 .',
  'C5 ~ ~ . A4 ~ ~ . C5 ~ ~ . D5 ~ ~ .',
  'D5 ~ ~ . B4 ~ ~ . D5 ~ ~ . E5 ~ ~ .',
  'E5 ~ ~ . D5 . B4 . G4 ~ ~ . B4 ~ ~ .',
  'A4 ~ ~ . C5 ~ ~ . E5 ~ ~ . D5 . C5 .',
  'C5 ~ ~ . D5 ~ ~ . E5 ~ ~ . C5 ~ ~ .',
  'D5 ~ ~ . C5 ~ ~ . A4 ~ ~ . F4 ~ ~ .',
  'G#4 ~ ~ . B4 ~ ~ . E5 ~ ~ . ~ ~ ~ .',
].join(' ');
const S6_BASS_B = S6_BASS_A;
const S6_LEAD_B = [
  'A4 ~ ~ . C5 ~ ~ . E5 ~ ~ . D5 . C5 .',
  'C5 ~ ~ . A4 ~ ~ . C5 ~ ~ . D5 ~ ~ .',
  'D5 ~ ~ . B4 ~ ~ . D5 ~ ~ . E5 ~ ~ .',
  'E5 ~ ~ . D5 . B4 . G4 ~ ~ . B4 ~ ~ .',
  'A4 ~ ~ . C5 ~ ~ . E5 ~ ~ . D5 . C5 .',
  'C5 ~ ~ . D5 ~ ~ . E5 ~ ~ . C5 ~ ~ .',
  'F4 ~ . A4 . D5 ~ . C5 ~ . A4 ~ ~ ~ .', // rising answer
  'G#4 ~ . B4 . E5 ~ . D5 ~ . B4 ~ ~ ~ .',
].join(' ');

// BOSS — fast minor but GROOVE-heavy (no dissonance): A minor i - i - iv - V, 144bpm.
const BOSS_BASS_A = [
  'A1 . A1 . A1 . A2 . A1 . A1 . G1 . A1 .',
  'A1 . A1 . A2 . A1 . A1 . E2 . G1 . A1 .',
  'D2 . D2 . D2 . A2 . D2 . D2 . C2 . D2 .',
  'E2 . E2 . E2 . B2 . E2 . E2 . D2 . E2 .',
  'A1 . A1 . A1 . A2 . A1 . A1 . G1 . A1 .',
  'A1 . A1 . A2 . A1 . B1 . C2 . D2 . E2 .',
  'D2 . D2 . D2 . A2 . D2 . D2 . C2 . D2 .',
  'E2 . E2 . B2 . E2 . G#2 . B2 . D2 . E2 .',
].join(' ');
const BOSS_LEAD_A = [
  'A4 . A4 . C5 ~ . A4 . G4 . A4 ~ ~ ~ .', // call
  'A4 . A4 . C5 ~ . D5 . E5 ~ . D5 . C5 .', // response
  'D5 ~ . C5 . A4 ~ . F4 . A4 ~ . G4 ~ .',
  'G#4 ~ . B4 . E5 ~ . D5 . B4 ~ . G#4 ~ .',
  'A4 . A4 . C5 ~ . A4 . G4 . A4 ~ ~ ~ .',
  'E5 ~ . D5 . C5 ~ . A4 . G4 . A4 ~ ~ .',
  'D5 ~ . C5 . A4 ~ . F4 . G4 . A4 ~ ~ .',
  'B4 ~ . G#4 . E4 ~ . A4 ~ ~ . ~ ~ ~ .',
].join(' ');
const BOSS_BASS_B = BOSS_BASS_A;
const BOSS_LEAD_B = [
  'A4 . A4 . C5 ~ . A4 . G4 . A4 ~ ~ ~ .',
  'A4 . A4 . C5 ~ . D5 . E5 ~ . D5 . C5 .', // response
  'D5 ~ . C5 . A4 ~ . F4 . A4 ~ . G4 ~ .',
  'G#4 ~ . B4 . E5 ~ . D5 . B4 ~ . G#4 ~ .',
  'A4 . A4 . C5 ~ . A4 . G4 . A4 ~ ~ ~ .',
  'E5 ~ . D5 . C5 ~ . A4 . G4 . A4 ~ ~ .',
  'A4 ~ . C5 . D5 ~ . C5 . A4 . G4 ~ ~ .', // counter-riff
  'G#4 ~ . B4 . D5 ~ . E5 ~ ~ . ~ ~ ~ .',
].join(' ');

// BOSS 2 (EMPEROR FUD) — same family, E minor i - i - iv - V, 148bpm, darker riff.
const FUD_BASS_A = [
  'E1 . E1 . E1 . E2 . E1 . E1 . D1 . E1 .',
  'E1 . E1 . E2 . E1 . E1 . B1 . D1 . E1 .',
  'A1 . A1 . A1 . E2 . A1 . A1 . G1 . A1 .',
  'B1 . B1 . B1 . F#2 . B1 . B1 . A1 . B1 .',
  'E1 . E1 . E1 . E2 . E1 . E1 . D1 . E1 .',
  'E1 . E1 . E2 . E1 . F#1 . G1 . A1 . B1 .',
  'A1 . A1 . A1 . E2 . A1 . A1 . G1 . A1 .',
  'B1 . B1 . F#2 . B1 . D#2 . F#2 . A2 . B1 .',
].join(' ');
const FUD_LEAD_A = [
  'E4 . E4 . G4 ~ . E4 . D4 . E4 ~ ~ ~ .',
  'E4 . E4 . G4 ~ . A4 . B4 ~ . A4 . G4 .',
  'A4 ~ . G4 . E4 ~ . C4 . E4 ~ . D4 ~ .',
  'D#4 ~ . F#4 . B4 ~ . A4 . F#4 ~ . D#4 ~ .',
  'E4 . E4 . G4 ~ . E4 . D4 . E4 ~ ~ ~ .',
  'B4 ~ . A4 . G4 ~ . E4 . D4 . E4 ~ ~ .',
  'C5 ~ . B4 . A4 ~ . E4 . F4 . G4 ~ ~ .',
  'F#4 ~ . D#4 . B3 ~ . E4 ~ ~ . ~ ~ ~ .',
].join(' ');
const FUD_BASS_B = FUD_BASS_A;
const FUD_LEAD_B = [
  'E4 . E4 . G4 ~ . E4 . D4 . E4 ~ ~ ~ .',
  'E4 . E4 . G4 ~ . A4 . B4 ~ . A4 . G4 .',
  'A4 ~ . G4 . E4 ~ . C4 . E4 ~ . D4 ~ .',
  'D#4 ~ . F#4 . B4 ~ . A4 . F#4 ~ . D#4 ~ .',
  'E4 . E4 . G4 ~ . E4 . D4 . E4 ~ ~ ~ .',
  'B4 ~ . A4 . G4 ~ . E4 . D4 . E4 ~ ~ .',
  'E4 ~ . G4 . A4 ~ . G4 . E4 . D4 ~ ~ .', // counter-riff
  'D#4 ~ . F#4 . A4 ~ . B4 ~ ~ . ~ ~ ~ .',
].join(' ');

// VICTORY jingle — bright C major fanfare loop, 8 bars, 126bpm.
const WIN_BASS = [
  'C2 . C2 . G2 . C2 . C3 . C2 . G2 . C2 .',
  'F2 . F2 . C3 . F2 . C3 . F2 . C3 . F2 .',
  'G2 . G2 . D2 . G2 . G2 . G2 . D2 . G2 .',
  'C2 . C2 . E2 . G2 . C3 ~ ~ ~ ~ ~ ~ ~',
  'C2 . C2 . G2 . C2 . C3 . C2 . G2 . C2 .',
  'F2 . F2 . C3 . F2 . C3 . F2 . C3 . F2 .',
  'G2 . G2 . D2 . G2 . G2 . G2 . D2 . G2 G2',
  'C2 . C2 . E2 . G2 . C3 ~ ~ ~ ~ ~ ~ ~',
].join(' ');
const WIN_LEAD = [
  'E4 ~ . G4 ~ . C5 ~ . E5 ~ . D5 . C5 .',
  'A4 ~ . C5 ~ . D5 ~ . C5 ~ . A4 . G4 .',
  'B4 ~ . D5 ~ . E5 ~ . D5 ~ . B4 . G4 .',
  'C5 ~ ~ ~ ~ ~ ~ ~ E5 ~ ~ . G4 ~ ~ .',
  'G4 ~ . C5 ~ . E5 ~ . D5 ~ . C5 . E4 .',
  'A4 ~ . C5 ~ . D5 ~ . E5 ~ . C5 . A4 .',
  'B4 ~ . D5 ~ . G4 ~ . B4 ~ . D5 . E5 .',
  'C5 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .',
].join(' ');

// GAME OVER jingle — A minor slow descent, 8 bars, 92bpm.
const OVER_BASS = [
  'A1 ~ ~ ~ ~ ~ . . A1 ~ ~ . G1 ~ ~ .',
  'F1 ~ ~ ~ ~ ~ . . F1 ~ ~ . C2 ~ ~ .',
  'D2 ~ ~ ~ ~ ~ . . D2 ~ ~ . E2 ~ ~ .',
  'E1 ~ ~ ~ ~ ~ . . E1 ~ ~ . G#1 ~ ~ .',
  'A1 ~ ~ ~ ~ ~ . . A1 ~ ~ . G1 ~ ~ .',
  'F1 ~ ~ ~ ~ ~ . . F1 ~ ~ . E1 ~ ~ .',
  'D2 ~ ~ ~ ~ ~ . . D2 ~ ~ . E2 ~ ~ .',
  'A1 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .',
].join(' ');
const OVER_LEAD = [
  'A4 ~ ~ ~ ~ ~ . . G4 ~ ~ . E4 ~ ~ .',
  'F4 ~ ~ ~ ~ ~ . . E4 ~ ~ . C4 ~ ~ .',
  'D4 ~ ~ ~ ~ ~ . . F4 ~ ~ . A4 ~ ~ .',
  'G#4 ~ ~ ~ ~ ~ . . E4 ~ ~ . B3 ~ ~ .',
  'E5 ~ ~ ~ ~ ~ . . D5 ~ ~ . C5 ~ ~ .',
  'A4 ~ ~ ~ ~ ~ . . G4 ~ ~ . F4 ~ ~ .',
  'F4 ~ ~ ~ ~ ~ . . E4 ~ ~ . D4 ~ ~ .',
  'A4 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .',
].join(' ');

export const TRACKS: Record<string, Track> = {
  title: mkTrack(108, TITLE_BASS_A, TITLE_LEAD_A, drumLoop([D_ROCKC, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK]), {
    bassB: TITLE_BASS_B,
    leadB: TITLE_LEAD_B,
    drumB: drumLoop([D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_FILL]),
  }),
  stage1: mkTrack(112, S1_BASS_A, S1_LEAD_A, drumLoop([D_ROCKC, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK]), {
    bassB: S1_BASS_B,
    leadB: S1_LEAD_B,
    drumB: drumLoop([D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_FILL]),
  }),
  stage2: mkTrack(96, S2_BASS_A, S2_LEAD_A, drumLoop([D_DOCK, D_DOCK, D_DOCK, D_DOCK, D_DOCK, D_DOCK, D_DOCK, D_DOCK]), {
    bassB: S2_BASS_B,
    leadB: S2_LEAD_B,
    drumB: drumLoop([D_DOCK, D_DOCK, D_DOCK, D_DOCK, D_DOCK, D_DOCK, D_DOCK, D_FILL]),
  }),
  stage3: mkTrack(122, S3_BASS_A, S3_LEAD_A, drumLoop([D_DRIVEC, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE]), {
    bassB: S3_BASS_B,
    leadB: S3_LEAD_B,
    drumB: drumLoop([D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_FILL16]),
  }),
  stage4: mkTrack(92, S4_BASS_A, S4_LEAD_A, drumLoop([D_CALM, D_CALM, D_CALM, D_CALM, D_CALM, D_CALM, D_CALM, D_CALM]), {
    bassB: S4_BASS_B,
    leadB: S4_LEAD_B,
    drumB: drumLoop([D_CALM, D_CALM, D_CALM, D_CALM, D_CALM, D_CALM, D_CALM, D_FILL]),
  }),
  stage5: mkTrack(106, S5_BASS_A, S5_LEAD_A, drumLoop([D_FUNK, D_FUNK, D_FUNK, D_FUNK, D_FUNK, D_FUNK, D_FUNK, D_FUNK]), {
    swing: 0.55,
    bassB: S5_BASS_B,
    leadB: S5_LEAD_B,
    drumB: drumLoop([D_FUNK, D_FUNK, D_FUNK, D_FUNK, D_FUNK, D_FUNK, D_FUNK, D_FILL16]),
  }),
  stage6: mkTrack(126, S6_BASS_A, S6_LEAD_A, drumLoop([D_ROCKC, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK]), {
    bassB: S6_BASS_B,
    leadB: S6_LEAD_B,
    drumB: drumLoop([D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_FILL16]),
  }),
  boss: mkTrack(144, BOSS_BASS_A, BOSS_LEAD_A, drumLoop([D_DRIVEC, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE]), {
    bassB: BOSS_BASS_B,
    leadB: BOSS_LEAD_B,
    drumB: drumLoop([D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_FILL16]),
  }),
  boss2: mkTrack(148, FUD_BASS_A, FUD_LEAD_A, drumLoop([D_DRIVEC, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE]), {
    bassB: FUD_BASS_B,
    leadB: FUD_LEAD_B,
    drumB: drumLoop([D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_DRIVE, D_FILL16]),
  }),
  victory: mkTrack(126, WIN_BASS, WIN_LEAD, drumLoop([D_JINGLE, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_ROCK, D_FINALE])),
  gameover: mkTrack(92, OVER_BASS, OVER_LEAD, drumLoop([D_SPARSE, D_SPARSE, D_SPARSE, D_SPARSE, D_SPARSE, D_SPARSE, D_SPARSE, D_END])),
};

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null; // v7: gentle master lowpass on the music bus
  private sfxGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private pulse25: PeriodicWave | null = null; // v7: Capcom 25% pulse lead
  muted = false;

  // music sequencer state
  private track: Track | null = null;
  private trackName: string | null = null; // v9.2.2: audioInfo debug hook
  private step = 0;
  private nextT = 0;
  private timer: number | null = null;

  // v9.2.2 — audioInfo debug hook (CI + on-device diagnostics):
  //   state    = AudioContext state ('none' until the first ensure())
  //   track    = currently loaded music track ('title' is queued at page load)
  //   unlocked = context exists AND is running (first gesture landed)
  //   muted    = M toggle state
  get info(): { state: string; track: string | null; unlocked: boolean; muted: boolean } {
    return {
      state: this.ctx ? this.ctx.state : 'none',
      track: this.trackName,
      unlocked: this.ctx !== null && this.ctx.state === 'running',
      muted: this.muted,
    };
  }

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
    // v7: gentle lowpass on the music bus — kills the shrill edge, keeps the bite
    this.musicFilter = this.ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 3400;
    this.musicFilter.Q.value = 0.4;
    this.musicGain.connect(this.musicFilter);
    this.musicFilter.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);
    // v7: 25% pulse wave for the lead voice (Mega Man / SF2 hollow lead)
    const H = 24;
    const pre = new Float32Array(H + 1);
    const pim = new Float32Array(H + 1);
    for (let n = 1; n <= H; n++) pim[n] = (2 / (Math.PI * n)) * Math.sin(Math.PI * n * 0.25);
    this.pulse25 = this.ctx.createPeriodicWave(pre, pim, { disableNormalization: false });
    // shared noise buffer
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = visualRand() * 2 - 1;
    this.nextT = this.ctx.currentTime + 0.06;
    // start sequencer clock
    this.timer = window.setInterval(() => this.schedule(), 40);
    // v9.2.2: attempt playback IMMEDIATELY (page load) — autoplay policy will
    // keep the context suspended until the first gesture, which is fine: the
    // moment a gesture lands, ensure() resumes and the queued title track plays.
    void this.ctx.resume();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  }

  // v6: touch pause — freeze the whole audio clock with the game
  setPaused(p: boolean): void {
    if (!this.ctx) return;
    if (p) void this.ctx.suspend();
    else if (this.ctx.state === 'suspended') void this.ctx.resume();
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
  lift(): void { this.noise(0.07, 0.25, 2600); this.blip(260, 0.12, 'square', 0.28, 620); }
  crash(): void { this.noise(0.18, 0.55, 1400); this.blip(180, 0.14, 'square', 0.3, 50); }
  throwSfx(): void { this.noise(0.25, 0.35, 3000); this.blip(500, 0.25, 'sine', 0.2, 150); }
  special(): void { this.blip(200, 0.5, 'sawtooth', 0.35, 1600); this.noise(0.5, 0.5, 900, 0.35); this.blip(80, 0.4, 'square', 0.4, 40, 0.35); }
  explode(): void { this.noise(0.7, 0.7, 700); this.blip(120, 0.5, 'sawtooth', 0.4, 30); }
  oneUp(): void { const n = [523, 659, 784, 1047, 1319]; n.forEach((f, i) => this.blip(f, 0.12, 'square', 0.25, 0, i * 0.1)); }
  uiMove(): void { this.blip(440, 0.05, 'square', 0.18); }
  uiSelect(): void { this.blip(660, 0.07, 'square', 0.22); this.blip(990, 0.1, 'square', 0.22, 0, 0.07); }
  hurtPlayer(): void { this.blip(300, 0.15, 'sawtooth', 0.3, 100); this.noise(0.1, 0.3, 1800); }
  rankUp(): void { this.blip(784, 0.06, 'square', 0.2); this.blip(1175, 0.1, 'square', 0.2, 0, 0.06); } // v4 combo rank-up
  // ---- v5 new-enemy SFX ----
  molotov(): void { this.noise(0.28, 0.28, 2600); this.blip(520, 0.22, 'sine', 0.16, 140); } // bottle whoosh
  glass(): void { this.blip(1250, 0.05, 'square', 0.2); this.noise(0.12, 0.4, 5200); } // shatter
  ignite(): void { this.noise(0.45, 0.4, 850); this.blip(190, 0.32, 'sawtooth', 0.2, 55); } // flames catch
  flameTick(): void { this.noise(0.05, 0.16, 1400); } // standing-in-fire DoT tick
  clang(): void { this.blip(2350, 0.09, 'square', 0.24); this.blip(1760, 0.16, 'square', 0.18, 420, 0.02); this.noise(0.05, 0.22, 7000); } // riot shield
  revive(): void { this.blip(523, 0.34, 'sine', 0.26, 261); this.blip(392, 0.44, 'sine', 0.22, 196, 0.16); this.noise(0.55, 0.14, 620); } // eerie resurrection
  chant(): void { this.blip(175, 0.3, 'sawtooth', 0.18, 88); this.blip(233, 0.24, 'sine', 0.14, 116, 0.08); } // FUD orb cast
  fanfare(): void {
    const seq: [number, number][] = [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [784, 0.54], [1047, 0.66], [1319, 0.84]];
    for (const [f, d] of seq) this.blip(f, 0.16, 'square', 0.28, 0, d);
  }
  // ---- v9.2: THE SEAL MOMENT ----
  // ACT 2: deep synth gong when the block confirms (low sine bell + shimmer)
  gong(): void {
    this.blip(98, 1.6, 'sine', 0.5, 0);
    this.blip(147, 1.2, 'sine', 0.3, 0, 0.01);
    this.blip(196, 0.9, 'triangle', 0.22, 0, 0.02);
    this.noise(0.5, 0.12, 900, 0.25);
  }
  // ACT 4: rank-reveal THUD (punchy low drum hit)
  thud(): void {
    this.blip(72, 0.28, 'sine', 0.5, 34);
    this.noise(0.12, 0.4, 700);
  }
  // ACT 3: triumph chiptune fanfare — a new short jingle (NOT a stage track):
  // bright rising run + held high tonic, square-wave Capcom style
  triumph(): void {
    const seq: [number, number, number][] = [
      // freq, delay, dur
      [659, 0.0, 0.1],
      [784, 0.1, 0.1],
      [988, 0.2, 0.1],
      [1175, 0.3, 0.14],
      [988, 0.46, 0.09],
      [1175, 0.55, 0.09],
      [1319, 0.64, 0.22],
      [1568, 0.88, 0.34],
    ];
    for (const [f, d, dur] of seq) this.blip(f, dur, 'square', 0.26, 0, d);
    // sparkle harmony on the finale
    this.blip(2093, 0.3, 'square', 0.14, 0, 0.88);
    this.noise(0.3, 0.1, 6000, 0.15);
  }

  // ---------- Music sequencer ----------
  playTrack(name: keyof typeof TRACKS): void {
    this.track = TRACKS[name] ?? null;
    this.trackName = name;
    this.step = 0;
    if (this.ctx) this.nextT = this.ctx.currentTime + 0.06;
  }

  stopMusic(): void {
    this.track = null;
    this.trackName = null;
  }

  private schedule(): void {
    if (!this.ctx || !this.track || !this.musicGain || this.muted) return;
    if (this.nextT < this.ctx.currentTime - 0.25) this.nextT = this.ctx.currentTime;
    const tr = this.track;
    const stepDur = 60 / tr.bpm / 4;
    // schedule up to 0.12s ahead
    while (this.nextT < this.ctx.currentTime + 0.12) {
      const idx = this.step % tr.steps;
      const cycle = Math.floor(this.step / tr.steps);
      const useB = (cycle & 1) === 1; // variation every 2nd pass
      let t0 = this.nextT;
      if (tr.swing > 0 && (idx & 1) === 1) t0 += stepDur * tr.swing * 0.5; // swung off-16ths
      const bMap = useB && tr.bMapB ? tr.bMapB : tr.bMap;
      const lMap = useB && tr.lMapB ? tr.lMapB : tr.lMap;
      const drm = useB && tr.drumsB ? tr.drumsB : tr.drums;
      const b = bMap[idx];
      if (b) this.note(midiToFreq(b.midi), b.len * stepDur * 0.92, 'triangle', 0.5, t0, false);
      const l = lMap[idx];
      if (l) {
        // lead: 25% pulse, UNDER the bass in level, vibrato on held notes
        const leadWave: OscillatorType | PeriodicWave = this.pulse25 ?? 'square';
        this.note(midiToFreq(l.midi), l.len * stepDur * 0.95, leadWave, 0.15, t0, l.len * stepDur >= 0.24);
      }
      const d = drm[idx];
      if (d) this.drum(d, t0);
      this.nextT += stepDur;
      this.step++;
    }
  }

  private note(freq: number, dur: number, wave: OscillatorType | PeriodicWave, vol: number, t0: number, vib: boolean): void {
    if (!this.ctx || !this.musicGain) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    if (typeof wave === 'string') o.type = wave as OscillatorType;
    else o.setPeriodicWave(wave);
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0);
    g.gain.setTargetAtTime(0.0001, t0 + dur * 0.7, 0.03);
    if (vib) {
      // light delayed vibrato (Capcom lead shimmer) — 5.6Hz, +-9 cents
      const lfo = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      lfo.frequency.value = 5.6;
      lg.gain.setValueAtTime(0, t0);
      lg.gain.linearRampToValueAtTime(9, t0 + Math.min(0.14, dur * 0.4));
      lfo.connect(lg);
      lg.connect(o.detune);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.1);
    }
    o.connect(g).connect(this.musicGain);
    o.start(t0);
    o.stop(t0 + dur + 0.1);
  }

  // ---------- v7 drum voice (all noise-based, on the music bus) ----------
  private drum(mask: number, t0: number): void {
    if (!this.ctx || !this.musicGain || !this.noiseBuf) return;
    const burst = (type: BiquadFilterType, freq: number, dur: number, vol: number, q = 0.8): void => {
      if (!this.ctx || !this.musicGain || !this.noiseBuf) return;
      const s = this.ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      s.connect(f).connect(g).connect(this.musicGain);
      s.start(t0);
      s.stop(t0 + dur + 0.02);
    };
    if (mask & 1) {
      // kick: noise thump + sine body drop (the groove anchor)
      burst('lowpass', 240, 0.13, 0.5);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(108, t0);
      o.frequency.exponentialRampToValueAtTime(44, t0 + 0.1);
      g.gain.setValueAtTime(0.55, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
      o.connect(g).connect(this.musicGain);
      o.start(t0);
      o.stop(t0 + 0.15);
    }
    if (mask & 2) burst('bandpass', 1900, 0.11, 0.34, 1.1); // snare on 2 & 4
    if (mask & 4) burst('highpass', 7800, 0.03, 0.1); // closed hat
    if (mask & 8) burst('highpass', 7200, 0.16, 0.13); // open hat
    if (mask & 16) burst('highpass', 5200, 0.5, 0.16); // crash
  }

  destroy(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}
