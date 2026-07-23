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
