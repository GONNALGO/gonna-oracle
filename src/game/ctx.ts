// Context passed to all entities each frame. Implemented by the engine (Game).
import type { AudioSys } from './audio';
import type { FX } from './fx';
import type { Input } from './input';
import type { Art } from './sprites';
import type { Player } from './player';
import type { Enemy, EnemyKind } from './enemies';
import type { BossLike } from './boss';
import type { Item, ItemKind, Obstacle } from './items';
import type { Proj, ProjKind } from './proj';
import type { Facing } from './types';

export interface GameCtx {
  audio: AudioSys;
  fx: FX;
  input: Input;
  art: Art;
  frames: Map<string, HTMLImageElement>;
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
