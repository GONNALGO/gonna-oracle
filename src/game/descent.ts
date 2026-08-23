// v15: THE DESCENT — infinite wave survival. Arena-style single screen
// (MINT-style locked camera): the waves come to YOU. Seeded composition so a
// challenge id reproduces the exact same descent for creator & joiner.
import { VW } from './types';
import { buildStage } from './stages';
import type { StageDef } from './stages';
import type { EnemyKind } from './enemies';
import type { BossKind } from './boss';
import type { Rng } from './rng';

// ---- bonus carrier drop table ----
export type BonusKind = 'bonusA' | 'candle' | 'forge' | 'bullet';

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
  // ---- juice state (founder order #2) ----
  lastMult: number; // multiplier tick detector
  multUpT: number; // "+MULT XN" center popup
  multLostT: number; // "MULT LOST" + red vignette pulse
  clearWave: number; // wave number of the last clear (WAVE CLEARED banner)
  clearBonus: number; // bonus scored on the last clear
  clearScore: number; // score right after the clear (TARGET race readout)
}

export function newDescent(theme: number, seed: number, seedLabel: string, target: number): DescentState {
  return {
    theme, seed, seedLabel,
    wave: 0, phase: 'clear', phaseT: 86, // boots straight into wave 1
    queue: [], cap: 3,
    bossKind: null, bossK: -1,
    carrierBonus: null, carrierOut: false,
    carriersSpawned: 0, carriersEscaped: 0, bonusDrops: 0,
    stallT: 0, target,
    aT: 0, candleT: 0, forgeT: 0, bulletT: 0,
    lastMult: 1, multUpT: 0, multLostT: 0,
    clearWave: 0, clearBonus: 0, clearScore: 0,
  };
}

// ---- wave math (LOCKED spec) ----
export function waveBudget(w: number): number {
  return 6 + 3 * w;
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

const COST: Record<EnemyKind, number> = {
  gecko: 1, drone: 1.5, snek: 2, coinsnek: 2, ninja: 2.5, moltov: 2.5,
  cultist: 3, whale: 5, bouncer: 6, bull: 6, carrier: 0, // carrier: bonus only
};

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

// seeded bonus drop: A 30% / candle 30% / forge 30% / bullet-time 10%
// (bullet-time weight is 0 before wave 9 — weights renormalize to thirds)
export function rollBonus(wave: number, rng: Rng): BonusKind {
  const r = rng.next();
  if (wave >= 9) {
    return r < 0.3 ? 'bonusA' : r < 0.6 ? 'candle' : r < 0.9 ? 'forge' : 'bullet';
  }
  return r < 1 / 3 ? 'bonusA' : r < 2 / 3 ? 'candle' : 'forge';
}

// compose wave w for a theme under the locked budget; ONE carrier per wave
// from wave 3, inserted at a seeded queue slot.
export function composeWave(theme: number, w: number, rng: Rng): WavePlan {
  if (isBossWave(w)) {
    const bossK = bossCadenceK(w);
    // seeded trickle under the boss: cheap pressure only
    const queue: EnemyKind[] = [];
    let budget = Math.max(2, Math.floor(waveBudget(w) / 4));
    const trickle: EnemyKind[] = ['gecko', 'gecko', 'drone', 'snek'];
    while (budget >= 1) {
      const k = trickle[Math.floor(rng.next() * trickle.length)];
      const c = COST[k];
      if (c > budget) break;
      queue.push(k);
      budget -= c;
    }
    return { queue, carrierBonus: null, boss: true, bossKind: THEME_BOSS[Math.max(0, Math.min(6, theme))], bossK };
  }
  const pool = themePool(theme);
  const queue: EnemyKind[] = [];
  let budget = waveBudget(w);
  let guard = 200;
  while (budget >= 1 && guard-- > 0) {
    const k = pool[Math.floor(rng.next() * pool.length)];
    const c = COST[k];
    if (c > budget) {
      if (budget >= 1 && c > 1) {
        // burn small remainders on the cheapest punk
        queue.push('gecko');
        budget -= 1;
      }
      continue;
    }
    queue.push(k);
    budget -= c;
  }
  let carrierBonus: BonusKind | null = null;
  if (w >= 3) {
    carrierBonus = rollBonus(w, rng);
    const slot = Math.floor(rng.next() * (queue.length + 1)); // seeded slot
    queue.splice(slot, 0, 'carrier');
  }
  return { queue, carrierBonus, boss: false, bossKind: null, bossK: -1 };
}

// ---- arena stage: the theme's visuals, one locked screen ----
export function buildDescentStage(theme: number): StageDef {
  const t = Math.max(0, Math.min(6, theme));
  const base = buildStage(t);
  return {
    ...base,
    name: 'THE DESCENT',
    sub: base.name + ' - ' + base.sub,
    len: VW, // camera never moves
    waves: [], // the director composes waves live
    obstacles: base.obstacles
      .filter((_, i) => i % 2 === 0) // thin the set for one screen
      .map((o) => ({ ...o, x: 40 + Math.round((o.x / base.len) * (VW - 80)) })),
    boss: false,
    bossKind: null,
    arenaX: VW,
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
