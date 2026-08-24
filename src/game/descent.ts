// v15.1: THE DESCENT — infinite wave survival on an ENDLESS forward scroll.
// Each wave owns a forward zone; clearing it releases the GO arrow and the
// player walks into the next zone. Seeded composition so a challenge id
// reproduces the exact same descent for creator & joiner.
import { VW } from './types';
import { buildStage } from './stages';
import type { StageDef } from './stages';
import type { EnemyKind } from './enemies';
import type { BossKind } from './boss';
import type { Rng } from './rng';

// ---- bonus carrier drop table ----
// v15.2: LONG SHOT (energy bolts on PUNCH) + SPEED OF THE LIZARD (+50% speed)
export type BonusKind = 'bonusA' | 'candle' | 'forge' | 'bullet' | 'longshot' | 'speed';

export interface WavePlan {
  queue: EnemyKind[]; // spawn order (carrier already inserted at its slot)
  carrierBonus: BonusKind | null; // seeded drop for this wave's carrier
  boss: boolean;
  bossKind: BossKind | null;
  bossK: number; // 0-based boss cadence index (depthScale = 1 + 0.15k)
}

export interface DescentState {
  theme: number; // stage idx 0..6 (visual + pool theme)
  seed: number;
  seedLabel: string;
  wave: number; // current wave (1-based)
  phase: 'announce' | 'combat' | 'clear' | 'breathe' | 'boss';
  phaseT: number; // frames spent in the current phase
  queue: EnemyKind[];
  cap: number; // alive cap for this wave
  bossKind: BossKind | null; // boss of the current wave (boss waves only)
  bossK: number; // boss cadence counter (0-based)
  carrierBonus: BonusKind | null; // drop assigned to this wave's carrier
  carrierOut: boolean; // a carrier is currently in play
  carriersSpawned: number;
  carriersEscaped: number;
  bonusDrops: number; // carriers killed -> bonuses actually dropped
  stallT: number; // anti-trickle watchdog: frames with <=2 alive + empty queue
  target: number; // arena: creator's sealed score (0 = free play)
  // ---- bonus timers (frames) ----
  aT: number; // THE A: invincibility 5s
  candleT: number; // GREEN CANDLE: x2 points 10s
  forgeT: number; // COMBO FORGE: combo decay frozen 10s
  bulletT: number; // BULLET TIME: world half-speed 5s
  shotT: number; // v15.2 LONG SHOT: PUNCH launches an energy bolt, 10s
  speedT: number; // v15.2 SPEED OF THE LIZARD: +50% move speed + trail, 10s
  // v15.2 ENERGY audit counters (food lives INSIDE furniture, never free)
  propsSpawned: number; // breakable/throwable props furnished so far
  foodProps: number; // ...of which carry a chicken (seeded drop table)
  // ---- juice state (founder order #2) ----
  lastMult: number; // multiplier tick detector
  multUpT: number; // "+MULT XN" center popup
  multLostT: number; // "MULT LOST" + red vignette pulse
  clearWave: number; // wave number of the last clear (WAVE CLEARED banner)
  clearBonus: number; // bonus scored on the last clear
  clearScore: number; // score right after the clear (TARGET race readout)
  // ---- v15.1 endless scroll ----
  nextTriggerX: number; // camX that starts the next wave (walking into its zone)
  dist: number; // virtual depth: farthest camX reached (px, never ends)
}

// v15.1: the walk between wave zones — 1.5 screens of forward brawling space
export const ZONE_ADV = Math.round(VW * 1.5);
// boot: the first zone starts almost immediately (title card -> short walk)
export const BOOT_TRIGGER_X = 200;

export function newDescent(theme: number, seed: number, seedLabel: string, target: number): DescentState {
  return {
    theme, seed, seedLabel,
    wave: 0, phase: 'clear', phaseT: 86, // boots straight into wave 1
    queue: [], cap: 3,
    bossKind: null, bossK: -1,
    carrierBonus: null, carrierOut: false,
    carriersSpawned: 0, carriersEscaped: 0, bonusDrops: 0,
    stallT: 0, target,
    aT: 0, candleT: 0, forgeT: 0, bulletT: 0, shotT: 0, speedT: 0,
    propsSpawned: 0, foodProps: 0,
    lastMult: 1, multUpT: 0, multLostT: 0,
    clearWave: 0, clearBonus: 0, clearScore: 0,
    nextTriggerX: BOOT_TRIGGER_X, dist: 0,
  };
}

// ---- wave math (v15.2 FINAL CALIBRATION: THREAT POINTS, Prince's order) ----
// Composition spends THREAT POINTS, not heads: P(w,theme) = (8 + 4w) scaled
// by a prestige offset that RAMPS with depth — waves 1-3 sit ~equal across
// themes (everyone at the table); by wave 10 stage 7 runs ~+23% threat vs
// stage 1, deeper waves diverge further. The monster run lives on heavy
// themes.
export function wavePoints(theme: number, w: number): number {
  const t = Math.max(0, Math.min(6, theme));
  const prestige = 1 + t * (0.02 + 0.02 * Math.min(w - 1, 10) / 10);
  return Math.round((8 + 4 * w) * prestige);
}

export function aliveCap(w: number): number {
  return w <= 6 ? 3 : w <= 14 ? 4 : 5;
}

export function isBossWave(w: number): boolean {
  return w >= 10 && (w - 10) % 8 === 0; // 10, 18, 26...
}

export function bossCadenceK(w: number): number {
  return Math.floor((w - 10) / 8);
}

export function waveClearBonus(w: number): number {
  return 100 * w * w;
}

export function bossBonus(w: number): number {
  return 1000 * w;
}

export function scoreMult(comboHits: number): number {
  return Math.min(8, 1 + Math.floor(comboHits / 4));
}

// spawn ramp (integer-rounded at spawn time)
export function rampHp(w: number): number {
  return Math.min(2.5, 1 + 0.05 * w);
}
export function rampSpd(w: number): number {
  return Math.min(1.6, 1 + 0.02 * w);
}

// v15.2 THREAT WEIGHTS (Prince's model): swarm/snek 1, brawler 2, ranged 3,
// bull/heavy 4, whale-tier 6, carrier free (bonus slot).
export const THREAT: Record<EnemyKind, number> = {
  gecko: 1, drone: 1, snek: 1, // swarm tier
  ninja: 2, // brawler tier
  coinsnek: 3, moltov: 3, cultist: 3, // ranged tier
  bull: 4, // heavy tier
  whale: 6, bouncer: 6, // whale tier
  carrier: 0, // bonus only
};

// heavy slots a kind occupies in the wave's heavyCap (whale-tier = 2)
export function heavySlots(k: EnemyKind): number {
  return k === 'whale' || k === 'bouncer' ? 2 : k === 'bull' ? 1 : 0;
}
// whale-tier is never composed before wave 4, on ANY theme
export function isWhaleTier(k: EnemyKind): boolean {
  return k === 'whale' || k === 'bouncer';
}
// gradual heavy introduction (non-boss waves). Waves 1-8 are identical on
// every theme; from wave 9 the cap relaxes ON HEAVY THEMES (stage 7 gets
// bull packs deep, stage 1 stays a brawl).
export function heavyCap(w: number, theme = 0): number {
  if (w <= 1) return 0;
  if (w <= 3) return 1;
  if (w <= 7) return 2;
  if (w === 8) return 3;
  return 3 + Math.floor(Math.max(0, Math.min(6, theme)) / 2);
}

// theme boss: stages 1-2 get the new MINOR variants, 3-7 their own boss
const THEME_BOSS: BossKind[] = ['whaleS', 'darkgonnaS', 'whale', 'darkgonna', 'golem', 'fud', 'gonna404'];

// weighted pick pool = the theme stage's own wave tables
let poolCache: (EnemyKind[] | null)[] = [];
export function themePool(theme: number): EnemyKind[] {
  const t = Math.max(0, Math.min(6, theme));
  if (poolCache[t]) return poolCache[t]!;
  const pool: EnemyKind[] = [];
  for (const w of buildStage(t).waves) pool.push(...w.spawns);
  poolCache[t] = pool;
  return pool;
}

// v15.2: ranged kinds (molotov throwers, FUD wizards, coin spitters).
// Per-wave cap (composition AND concurrent spawns — descentSpawnTick):
// waves 1-5 NEVER exceed 2, waves 6-9 allow 3, wave 10+ allows 4.
export function isRangedKind(k: EnemyKind): boolean {
  return k === 'moltov' || k === 'cultist' || k === 'coinsnek';
}
export function rangedCap(w: number): number {
  return w <= 5 ? 2 : w <= 9 ? 3 : 4;
}

// seeded bonus drop — ONE draw per roll (the stream stays aligned).
// v15.2 FINAL CALIBRATION: uniform among UNLOCKED bonuses (neither rain nor
// desert). Unlock waves: SPEED 2, BULLET TIME 3 (was 9), LONG SHOT 4; the
// classics (A / candle / forge) are always on the table.
export function rollBonus(wave: number, rng: Rng): BonusKind {
  const unlocked: BonusKind[] = ['bonusA', 'candle', 'forge'];
  if (wave >= 2) unlocked.push('speed');
  if (wave >= 3) unlocked.push('bullet');
  if (wave >= 4) unlocked.push('longshot');
  return unlocked[Math.floor(rng.next() * unlocked.length)];
}

// compose wave w for a theme under the locked THREAT-POINT budget; a seeded
// ~45% chance of ONE carrier per wave from wave 2, inserted at a seeded slot.
// v15.2 fill order (Prince's order): ranged slots -> heavy slots -> the rest
// of the points go to the theme's light/medium pool. Every pick is a seeded
// draw, so a challenge id reproduces the exact same composition.
export function composeWave(theme: number, w: number, rng: Rng): WavePlan {
  if (isBossWave(w)) {
    const bossK = bossCadenceK(w);
    // seeded trickle under the boss: cheap pressure only
    const queue: EnemyKind[] = [];
    let budget = Math.max(2, Math.floor(wavePoints(theme, w) / 4));
    const trickle: EnemyKind[] = ['gecko', 'gecko', 'drone', 'snek'];
    while (budget >= 1) {
      const k = trickle[Math.floor(rng.next() * trickle.length)];
      queue.push(k);
      budget -= THREAT[k];
    }
    return { queue, carrierBonus: null, boss: true, bossKind: THEME_BOSS[Math.max(0, Math.min(6, theme))], bossK };
  }
  const pool = themePool(theme);
  const rangedPool = pool.filter(isRangedKind);
  const heavyPool = pool.filter((k) => heavySlots(k) > 0 && (w >= 4 || !isWhaleTier(k)));
  const lightPool = pool.filter((k) => THREAT[k] > 0 && heavySlots(k) === 0 && !isRangedKind(k));
  const pickFrom = (arr: EnemyKind[]): EnemyKind => arr[Math.floor(rng.next() * arr.length)];
  const queue: EnemyKind[] = [];
  let budget = wavePoints(theme, w);

  // 1) ranged slots: a seeded count up to the wave cap, 3 points each
  const rMax = Math.min(rangedCap(w), Math.floor(budget / 3));
  const rWant = rangedPool.length > 0 ? rng.int(0, rMax) : 0;
  for (let i = 0; i < rWant && budget >= 3; i++) {
    const k = pickFrom(rangedPool);
    queue.push(k);
    budget -= THREAT[k];
  }

  // 2) heavy slots: a seeded count up to heavyCap(w, theme); whale-tier eats 2
  let slots = heavyCap(w, theme);
  if (heavyPool.length > 0 && slots > 0) {
    let hWant = rng.int(0, slots);
    let guard = 24;
    while (hWant > 0 && slots > 0 && guard-- > 0) {
      const fit = heavyPool.filter((k) => THREAT[k] <= budget && heavySlots(k) <= slots);
      if (fit.length === 0) break;
      const k = pickFrom(fit);
      queue.push(k);
      budget -= THREAT[k];
      slots -= heavySlots(k);
      hWant -= heavySlots(k);
    }
  }

  // 3) remaining points: light/medium of the theme pool (gecko burns the rest)
  let guard = 200;
  while (budget >= 1 && guard-- > 0) {
    const fit = lightPool.filter((k) => THREAT[k] <= budget);
    if (fit.length === 0) {
      queue.push('gecko'); // theme without a cheap punk: burn the remainder
      budget -= 1;
      continue;
    }
    const k = pickFrom(fit);
    queue.push(k);
    budget -= THREAT[k];
  }

  // v15.2 FINAL REFINEMENT: PROBABILISTIC carrier — from wave 2, each
  // non-boss wave has a seeded ~45% chance of exactly ONE carrier (never
  // two). Same challenge seed = same carrier luck for every player at the
  // table (no re-roll exploits). Some seeds are lucky, some stingy.
  let carrierBonus: BonusKind | null = null;
  if (w >= 2 && rng.chance(0.45)) {
    carrierBonus = rollBonus(w, rng);
    const slot = Math.floor(rng.next() * (queue.length + 1)); // seeded slot
    queue.splice(slot, 0, 'carrier');
  }
  return { queue, carrierBonus, boss: false, bossKind: null, bossK: -1 };
}

// ---- v15.1 endless stage: the theme's full visuals as a seamless LOOP ----
// len stays the theme's loop period L; the engine tiles far/mid/ground with
// crossfaded joints and wraps the street-level props every L px, so the world
// never ends and never shows a seam.
export function buildDescentStage(theme: number): StageDef {
  const t = Math.max(0, Math.min(6, theme));
  const base = buildStage(t);
  return {
    ...base,
    name: 'THE DESCENT',
    sub: base.name + ' - ' + base.sub,
    waves: [], // the director composes waves live
    // v15.2: +50% street furniture per zone. The FULL theme set is kept here;
    // descentObstacleTick spawns it whole on even loops and thinned
    // (every-second-prop) on odd loops — 0.75x average vs the old flat 0.5x,
    // and the readability rule survives (founder: "troppo affollato").
    obstacles: base.obstacles,
    boss: false,
    bossKind: null,
  };
}

// ---- best-wave record (practice bragging rights, local only) ----
const BEST_KEY = 'gonna.descent.best';
export function loadBestWave(): number {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    const n = raw ? JSON.parse(raw) as { wave?: number } : null;
    return n && typeof n.wave === 'number' ? n.wave : 0;
  } catch {
    return 0;
  }
}
export function saveBestWave(wave: number, seedLabel: string): void {
  try {
    if (wave <= loadBestWave()) return;
    window.localStorage.setItem(BEST_KEY, JSON.stringify({ wave, seed: seedLabel, ts: Date.now() }));
  } catch { /* storage unavailable */ }
}
