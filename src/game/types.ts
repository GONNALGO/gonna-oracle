// Shared constants and small types for GONNA FIGHT.

export const VW = 384; // internal resolution (CPS1-like)
export const VH = 224;
export const LANE_TOP = 150; // walkable band
export const LANE_BOT = 205;
export const GRAV = 0.28; // px/frame^2 for jumps

export type Facing = 1 | -1;

export interface HitInfo {
  dmg: number;
  kb: number; // knockback px/frame applied
  down: boolean; // causes knockdown
  dir: Facing; // direction of the blow
  pierce?: boolean; // ignores whale guard (thrown objects / explosions)
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

export function randInt(lo: number, hi: number): number {
  return Math.floor(rand(lo, hi + 1));
}

export function chance(p: number): boolean {
  return Math.random() < p;
}

// ---- v4 combo ranks: 3 NICE / 5 GREAT / 8 SUPER / 12 BYZANTINE / 20 LEGENDARY ----
const RANK_TABLE: [number, string][] = [
  [20, 'LEGENDARY'],
  [12, 'BYZANTINE'],
  [8, 'SUPER'],
  [5, 'GREAT'],
  [3, 'NICE'],
];

export function comboRankName(hits: number): string {
  for (const [n, name] of RANK_TABLE) if (hits >= n) return name;
  return '';
}

// 0 = none, 1 = NICE ... 5 = LEGENDARY (monotonic, for rank-up detection)
export function comboRankTier(hits: number): number {
  for (let i = 0; i < RANK_TABLE.length; i++) {
    if (hits >= RANK_TABLE[i][0]) return RANK_TABLE.length - i;
  }
  return 0;
}
