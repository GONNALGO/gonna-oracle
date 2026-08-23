// v15: seeded RNG for THE DESCENT. mulberry32 stream + string hash.
// ALL simulation randomness flows through a Game-owned Rng (g.rng) so a
// challenge seed reproduces the exact same run for creator & joiner.
// Visual-only scatter (particles, debris, audio noise) uses the separate
// module-level visual stream below — it never feeds back into the sim, and
// it keeps Math.random() out of the game step entirely (QA trap: zero hits).

export interface Rng {
  next(): number; // [0, 1)
  range(lo: number, hi: number): number;
  int(lo: number, hi: number): number; // inclusive both ends
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit — stable across browsers, no deps
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function makeRng(seed: number): Rng {
  const f = mulberry32(seed >>> 0);
  return {
    next: f,
    range: (lo, hi) => lo + f() * (hi - lo),
    int: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)),
    chance: (p) => f() < p,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(f() * arr.length)],
  };
}

export function makeRngFromLabel(label: string): Rng {
  return makeRng(hashSeed(label));
}

// ---- campaign stream: the classic campaign keeps the EXACT v14.4 random
// stream (Math.random at the same call sites, in the same order) so FULL RUN
// behavior is byte-equivalent to pre-descent builds. Only THE DESCENT owns a
// seeded sim stream. ----
export const mathRng: Rng = {
  next: () => Math.random(),
  range: (lo, hi) => lo + Math.random() * (hi - lo),
  int: (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1)),
  chance: (p) => Math.random() < p,
  pick: <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)],
};

// ---- visual-only stream (fx / audio noise). Fixed seed: determinism is not
// required here, only the ABSENCE of Math.random inside the game step. ----
const visual = mulberry32(0xc0ffee);
// true while a seeded DESCENT run owns the step: visual noise comes from the
// fixed-seed stream so Math.random stays out of the deterministic sim. In the
// campaign visualRand is plain Math.random — exactly what v14.4 did.
let seededSim = false;
export function setSeededSim(on: boolean): void {
  seededSim = on;
}
export function visualRand(): number {
  return seededSim ? visual() : Math.random();
}

// short readable seed label for practice runs (shown on the death screen)
const SEED_WORDS = ['GEKKO', 'MOON', 'PUMP', 'BYZANT', 'HODL', 'DEGEN', 'LIZARD', 'ALPHA', 'SIGMA', 'CANDLE'];
export function randomSeedLabel(): string {
  const w = SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)];
  const n = Math.floor(Math.random() * 0xffff);
  return 'FREE-' + w + '-' + n.toString(16).toUpperCase().padStart(4, '0');
}
