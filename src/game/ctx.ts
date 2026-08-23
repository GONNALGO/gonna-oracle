// Context passed to all entities each frame. Implemented by the engine (Game).
import type { AudioSys } from './audio';
import type { FX } from './fx';
import type { Input } from './input';
import type { Haptics } from './touch';
import type { Art } from './sprites';
import type { Player } from './player';
import type { Enemy, EnemyKind } from './enemies';
import type { BossLike } from './boss';
import type { Item, ItemKind, Obstacle } from './items';
import type { Proj, ProjKind } from './proj';
import type { Facing } from './types';
import type { Rng } from './rng';
import type { DescentState } from './descent';

export interface GameCtx {
  // v15: seeded sim randomness (THE DESCENT determinism). NEVER Math.random.
  rng: Rng;
  // v15: THE DESCENT run state (null in the classic campaign / MINT)
  descent: DescentState | null;
  // v15: kill score multiplier (combo mult x candle) — 1 outside THE DESCENT
  killMult(): number;
  audio: AudioSys;
  fx: FX;
  input: Input;
  haptics: Haptics; // v6: no-op on desktop, throttled navigator.vibrate on touch
  art: Art;
  frames: Map<string, HTMLImageElement>;
  pframes: Map<string, HTMLImageElement> | null; // v9: selected skin frames (null = base GONNA)
  player: Player;
  enemies: Enemy[];
  boss: BossLike | null;
  items: Item[];
  obstacles: Obstacle[];
  projs: Proj[];
  camX: number;
  stageLen: number;
  hitStop(frames: number): void;
  slowMo(frames: number): void;
  addScore(n: number): void;
  addMeter(n: number): void;
  spawnEnemy(kind: EnemyKind, side: Facing): void;
  dropItem(kind: ItemKind, x: number, y: number): void;
  dropCoins(x: number, y: number, n: number): void;
  spawnProj(kind: ProjKind, x: number, y: number, vx: number, tx?: number, ty?: number): void;
  spawnFlame(x: number, y: number): void; // v5: persistent molotov flame patch
}
