// Pickups (pooled-ish, short lived) + interactive lane obstacles
// (solid blockers: break them, lift & throw them, or avoid them).
import { GRAV, LANE_BOT, LANE_TOP } from './types';
import type { GameCtx } from './ctx';
import { drawBonusIcon } from './descentFX';
import type { BonusKind } from './descent';

// v15: THE DESCENT bonus kinds — bonusA (THE A: invincibility), candle (GREEN
// CANDLE: x2 points), forge (COMBO FORGE: no decay), bullet (BULLET TIME)
// v15.2: longshot (LONG SHOT: bolts on PUNCH), speed (SPEED OF THE LIZARD)
export type ItemKind = 'chicken' | 'coinG' | 'coinA' | 'liz' | 'knife' | 'chest' | BonusKind;

// v15.2: DESCENT bonus kinds share the pixel-icon draw path (no art-table entry)
export function isBonusItem(kind: ItemKind): kind is BonusKind {
  return kind === 'bonusA' || kind === 'candle' || kind === 'forge' || kind === 'bullet' || kind === 'longshot' || kind === 'speed';
}
export type ObstacleKind = 'can' | 'barrel' | 'crate' | 'safe' | 'drum' | 'chips';
export type ObstacleMode = 'idle' | 'held' | 'thrown';

export interface ObCfg {
  hp: number;
  liftable: boolean;
  throwDmg: number;
  throwSpd: number;
  throwRange: number; // max flight px before crashing
  halfW: number; // solid half-width on X
  laneHalf: number; // solid lane tolerance on Y
  jumpClear: number; // z needed to pass over it
  c1: string;
  c2: string; // debris colors
}

export const OB_CFG: Record<ObstacleKind, ObCfg> = {
  can: { hp: 1, liftable: true, throwDmg: 15, throwSpd: 4.6, throwRange: 300, halfW: 9, laneHalf: 12, jumpClear: 18, c1: '#8a8f9c', c2: '#c8ccd4' },
  barrel: { hp: 2, liftable: true, throwDmg: 25, throwSpd: 4.2, throwRange: 280, halfW: 10, laneHalf: 13, jumpClear: 22, c1: '#8a5a2a', c2: '#6e431f' },
  crate: { hp: 1, liftable: true, throwDmg: 20, throwSpd: 5.4, throwRange: 340, halfW: 11, laneHalf: 13, jumpClear: 20, c1: '#a5723c', c2: '#8a5a2a' },
  safe: { hp: 3, liftable: false, throwDmg: 0, throwSpd: 0, throwRange: 0, halfW: 13, laneHalf: 30, jumpClear: 26, c1: '#8a8f9c', c2: '#5a5f6c' },
  drum: { hp: 1, liftable: true, throwDmg: 40, throwSpd: 4.4, throwRange: 280, halfW: 10, laneHalf: 13, jumpClear: 22, c1: '#b33a2a', c2: '#f5c542' },
  chips: { hp: 1, liftable: true, throwDmg: 10, throwSpd: 5.6, throwRange: 260, halfW: 9, laneHalf: 12, jumpClear: 16, c1: '#f5c542', c2: '#b8860b' },
};

// swing ids for thrown obstacles (player punches use small ints, enemies 10000+)
let oSwing = 50000;
export function nextOSwing(): number {
  return oSwing++;
}

// Solid lane collision: clamp horizontal movement so entities can't walk
// through blocking obstacles on the same lane band (jump over = high z).
export function blockObjects(obs: Obstacle[], oldX: number, newX: number, y: number, z: number): number {
  for (const o of obs) {
    if (o.mode !== 'idle' || o.removeMe) continue;
    const c = OB_CFG[o.kind];
    if (z >= c.jumpClear) continue;
    if (Math.abs(y - o.y) >= c.laneHalf) continue;
    const minD = c.halfW + 6;
    if (Math.abs(newX - o.x) < minD) {
      if (Math.abs(oldX - o.x) >= minD - 0.01) {
        newX = o.x + (oldX < o.x ? -minD : minD); // stop at the side we came from
      } else {
        newX = o.x + (newX >= o.x ? minD : -minD); // somehow inside: push out
      }
    }
  }
  return newX;
}

// v8: which idle obstacle is blocking this position (same test as blockObjects)
export function blockingAt(obs: Obstacle[], x: number, y: number, z: number): Obstacle | null {
  for (const o of obs) {
    if (o.mode !== 'idle' || o.removeMe) continue;
    const c = OB_CFG[o.kind];
    if (z >= c.jumpClear) continue;
    if (Math.abs(y - o.y) >= c.laneHalf) continue;
    if (Math.abs(x - o.x) < c.halfW + 7) return o;
  }
  return null;
}

// Oil drum explosion: AoE on adjacent lanes, hurts EVERYONE (player too), chains drums.
export function explodeAt(g: GameCtx, x: number, y: number, src: Obstacle): void {
  g.audio.explode();
  g.fx.shake(10);
  g.fx.flash = 7;
  g.hitStop(6);
  g.fx.spark(x, y - 18, true);
  g.fx.spark(x, y - 30, true);
  g.fx.ring(x, y - 10, 70, '#ff8a3c');
  g.fx.ring(x, y - 10, 46, '#f5c542');
  g.fx.debris(x, y - 14, '#b33a2a', '#f5c542', 16);
  for (const e of g.enemies) {
    if (!e.alive) continue;
    if (Math.abs(e.x - x) < 70 && Math.abs(e.y - y) < 42 && e.z < 40) {
      e.hurt({ dmg: 40, kb: 5, down: true, dir: e.x >= x ? 1 : -1, pierce: true }, g);
    }
  }
  if (g.boss && g.boss.alive && Math.abs(g.boss.x - x) < 90 && Math.abs(g.boss.y - y) < 46) {
    g.boss.hurt({ dmg: 40, kb: 0, down: false, dir: g.boss.x >= x ? 1 : -1 }, g);
  }
  const p = g.player;
  if (Math.abs(p.x - x) < 56 && Math.abs(p.y - y) < 36 && p.z < 32) {
    p.hurt({ dmg: 40, kb: 4, down: true, dir: p.x >= x ? 1 : -1 }, g);
  }
  // chain other drums
  for (const o of g.obstacles) {
    if (o === src || o.removeMe || o.kind !== 'drum') continue;
    if (Math.abs(o.x - x) < 70 && Math.abs(o.y - y) < 42) o.ignite();
  }
}

export class Item {
  kind: ItemKind;
  x: number;
  y: number;
  z: number;
  vx = 0;
  vz = 0;
  life = 600; // 10s
  bounces = 0;
  removeMe = false;

  // v15: scatter velocity is sim-relevant (where the pickup lands) — the
  // engine passes its seeded stream; Math.random is never called here.
  constructor(kind: ItemKind, x: number, y: number, scatter: boolean, rnd: () => number) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.z = scatter ? 10 : 0;
    if (scatter) {
      this.vx = -2 + rnd() * 4;
      this.vz = 1.5 + rnd() * 1.5;
    }
  }

  update(): void {
    this.life--;
    if (this.life <= 0) this.removeMe = true;
    if (this.z > 0 || this.vz > 0) {
      this.vz -= GRAV;
      this.z += this.vz;
      this.x += this.vx;
      if (this.z <= 0) {
        this.z = 0;
        if (this.bounces < 1) {
          this.bounces++;
          this.vz = 1.6; // bounce once
          this.vx *= 0.5;
        } else {
          this.vz = 0;
          this.vx = 0;
        }
      }
    }
  }

  collect(g: GameCtx): void {
    const p = g.player;
    switch (this.kind) {
      case 'chicken':
        p.hp = Math.min(p.maxHp, p.hp + 50);
        g.fx.popup(p.x, p.y - 70, '+50', '#7fd858');
        g.audio.pickup();
        break;
      case 'coinA':
        p.hp = Math.min(p.maxHp, p.hp + 20);
        g.addScore(200);
        g.fx.popup(p.x, p.y - 70, '+20 HP', '#7fd858');
        g.audio.pickup();
        break;
      case 'coinG':
        g.addScore(100);
        g.audio.coin();
        break;
      case 'liz':
        p.lives = Math.min(5, p.lives + 1);
        g.fx.popup(p.x, p.y - 70, '1UP!', '#f5c542');
        g.audio.oneUp();
        break;
      case 'knife':
        p.knifeUses = 5;
        g.fx.popup(p.x, p.y - 70, 'KNIFE!', '#c8ccd4');
        g.audio.pickup();
        break;
      case 'chest':
        g.addScore(5000);
        g.fx.popup(p.x, p.y - 70, 'JACKPOT +5000', '#f5c542');
        g.audio.oneUp();
        break;
      // ---- v15 DESCENT bonuses (carrier drops) — v15.2: actually armed here ----
      case 'bonusA':
        if (g.descent) g.descent.aT = 300; // 5s untouchable
        g.fx.popup(p.x, p.y - 70, 'THE A - UNTOUCHABLE!', '#3ce8e0');
        g.audio.oneUp();
        break;
      case 'candle':
        if (g.descent) g.descent.candleT = 600; // 10s x2 points
        g.fx.popup(p.x, p.y - 70, 'GREEN CANDLE - X2 POINTS!', '#39FF14');
        g.audio.oneUp();
        break;
      case 'forge':
        if (g.descent) g.descent.forgeT = 600; // 10s combo never decays
        g.fx.popup(p.x, p.y - 70, 'COMBO FORGE - NO DECAY!', '#ffae2a');
        g.audio.oneUp();
        break;
      case 'bullet':
        if (g.descent) g.descent.bulletT = 300; // 5s world half-speed
        g.fx.popup(p.x, p.y - 70, 'BULLET TIME!', '#3ce8e0');
        g.audio.oneUp();
        break;
      case 'longshot':
        if (g.descent) g.descent.shotT = 600; // 10s: PUNCH fires energy bolts
        g.fx.popup(p.x, p.y - 70, 'LONG SHOT - PUNCH TO FIRE!', '#39FF14');
        g.audio.oneUp();
        break;
      case 'speed':
        if (g.descent) g.descent.speedT = 600; // 10s: +50% move speed
        g.fx.popup(p.x, p.y - 70, 'SPEED OF THE LIZARD!', '#39FF14');
        g.audio.oneUp();
        break;
    }
    this.removeMe = true;
  }

  draw(ctx2d: CanvasRenderingContext2D, g: GameCtx): void {
    if (this.life < 120 && (this.life & 8) !== 0) return; // blink before expiring
    const sx = Math.round(this.x - g.camX);
    const sy = Math.round(this.y - this.z);
    ctx2d.globalAlpha = 0.3;
    ctx2d.fillStyle = '#000';
    ctx2d.beginPath();
    ctx2d.ellipse(sx, this.y + 2, 8, 3, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;
    // v15: DESCENT bonus icons are pure pixel art (no art-table entry)
    if (isBonusItem(this.kind)) {
      drawBonusIcon(ctx2d, this.kind, sx, sy);
      return;
    }
    const img = g.art[this.kind];
    ctx2d.drawImage(img, sx - (img.width >> 1), sy - img.height);
  }
}

export class Obstacle {
  kind: ObstacleKind;
  x: number;
  y: number;
  hp: number;
  contains: ItemKind | 'none' | 'random';
  hitT = 0;
  lastSwing = 0;
  removeMe = false;
  // v2: lane-object state
  mode: ObstacleMode = 'idle';
  vx = 0;
  spin = 0;
  traveled = 0;
  fromEnemy = false;
  swingId = 0;
  hitSomething = false;
  fuse = 0; // >0: drum ignited, explodes when it reaches 0

  constructor(kind: ObstacleKind, x: number, y: number, contains: ItemKind | 'none' | 'random') {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.hp = OB_CFG[kind].hp;
    this.contains = contains;
  }

  get cfg(): ObCfg {
    return OB_CFG[this.kind];
  }

  hurt(g: GameCtx): void {
    if (this.mode !== 'idle' || this.removeMe || this.fuse > 0) return;
    this.hp--;
    this.hitT = 8;
    g.audio.punch();
    g.fx.shake(1.5);
    g.fx.debris(this.x, this.y - 14, this.cfg.c1, this.cfg.c2, 5);
    if (this.hp <= 0) {
      if (this.kind === 'drum') this.ignite();
      else this.destroy(g);
    }
  }

  // smashed by a thrown object (chain reaction)
  smash(g: GameCtx): void {
    if (this.removeMe || this.fuse > 0) return;
    if (this.kind === 'drum') this.ignite();
    else this.destroy(g);
  }

  ignite(): void {
    if (this.fuse <= 0) this.fuse = 6;
  }

  private dropLoot(g: GameCtx): void {
    let drop = this.contains;
    if (drop === 'random') {
      const r = g.rng.next(); // v15: seeded obstacle contents
      drop = r < 0.3 ? 'chicken' : r < 0.55 ? 'coinA' : r < 0.8 ? 'coinG' : r < 0.92 ? 'chest' : 'liz';
    }
    // v15.2 ENERGY doctrine: NO extra lives in THE DESCENT — one life is the
    // mode's identity. A 1UP roll downgrades to food (same draw, no re-roll).
    if (drop === 'liz' && g.descent) drop = 'chicken';
    if (drop !== 'none') g.dropItem(drop, this.x, this.y);
  }

  private releaseCarrier(g: GameCtx): void {
    if (g.player.carrying === this) g.player.carrying = null;
    for (const e of g.enemies) if (e.heldObj === this) e.heldObj = null;
  }

  destroy(g: GameCtx): void {
    this.removeMe = true;
    this.releaseCarrier(g);
    g.fx.debris(this.x, this.y - 14, this.cfg.c1, this.cfg.c2, 14);
    g.audio.hitHard();
    this.dropLoot(g);
  }

  // thrown object crashes into debris (wall / end of flight / direct hit)
  crash(g: GameCtx): void {
    this.removeMe = true;
    this.releaseCarrier(g);
    g.audio.crash();
    g.fx.shake(2.5);
    g.fx.debris(this.x, this.y - 12, this.cfg.c1, this.cfg.c2, 12);
    this.dropLoot(g);
  }

  explode(g: GameCtx): void {
    this.removeMe = true;
    this.releaseCarrier(g);
    explodeAt(g, this.x, this.y, this);
  }

  // launch as a projectile along the current lane
  launch(dir: 1 | -1, fromEnemy: boolean, g: GameCtx): void {
    const c = this.cfg;
    this.mode = 'thrown';
    this.fromEnemy = fromEnemy;
    this.swingId = nextOSwing();
    this.vx = dir * c.throwSpd * (fromEnemy ? 0.9 : 1);
    this.x += dir * (c.halfW + 4);
    this.traveled = 0;
    this.spin = 0;
    this.hitSomething = false;
    g.audio.throwSfx();
  }

  update(g: GameCtx): void {
    if (this.hitT > 0) this.hitT--;
    if (this.fuse > 0) {
      this.fuse--;
      if (this.fuse <= 0) this.explode(g);
      return;
    }
    if (this.mode !== 'thrown') return;
    const c = this.cfg;
    this.x += this.vx;
    this.traveled += Math.abs(this.vx);
    this.spin += 0.35;
    const dir = this.vx >= 0 ? 1 : -1;

    if (!this.fromEnemy) {
      // player-thrown: mows down ALL enemies on the lane
      for (const e of g.enemies) {
        if (!e.alive || e.lastHitId === this.swingId) continue;
        if (Math.abs(e.x - this.x) < 16 && Math.abs(e.y - this.y) < 14 && e.z < 30) {
          e.lastHitId = this.swingId;
          e.hurt({ dmg: c.throwDmg, kb: 4, down: true, dir, pierce: true }, g);
          this.firstImpact(g);
          if (this.kind === 'drum') {
            this.explode(g);
            return;
          }
        }
      }
      if (g.boss && g.boss.alive && g.boss.lastHitId !== this.swingId) {
        if (Math.abs(g.boss.x - this.x) < 40 && Math.abs(g.boss.y - this.y) < 26) {
          g.boss.lastHitId = this.swingId;
          g.boss.hurt({ dmg: c.throwDmg, kb: 0, down: false, dir }, g);
          this.firstImpact(g);
          if (this.kind === 'drum') {
            this.explode(g);
            return;
          }
        }
      }
    } else {
      // enemy-thrown: hits the player (dodge by lane change / jump)
      const p = g.player;
      if (Math.abs(p.x - this.x) < 14 && Math.abs(p.y - this.y) < 12 && p.z < 26) {
        if (p.hurt({ dmg: c.throwDmg, kb: 3, down: true, dir }, g)) {
          if (this.kind === 'drum') this.explode(g);
          else this.crash(g);
          return;
        }
      }
    }

    // smash other obstacles -> chain reactions
    for (const o of g.obstacles) {
      if (o === this || o.mode === 'held' || o.removeMe || o.lastSwing === this.swingId) continue;
      if (Math.abs(o.x - this.x) < c.halfW + o.cfg.halfW && Math.abs(o.y - this.y) < Math.max(14, o.cfg.laneHalf)) {
        o.lastSwing = this.swingId;
        o.smash(g);
        this.firstImpact(g);
        if (this.kind === 'drum') {
          this.explode(g);
          return;
        }
      }
    }

    // wall / end of flight
    if (this.x < 8 || this.x > g.stageLen - 8 || this.traveled > c.throwRange) {
      if (this.kind === 'drum') this.explode(g);
      else this.crash(g);
    }
  }

  private firstImpact(g: GameCtx): void {
    if (this.hitSomething) return;
    this.hitSomething = true;
    g.hitStop(5);
    g.fx.shake(4);
  }

  draw(ctx2d: CanvasRenderingContext2D, g: GameCtx): void {
    if (this.mode === 'held') return; // drawn overhead by the carrier
    const sx = Math.round(this.x - g.camX);
    ctx2d.globalAlpha = 0.3;
    ctx2d.fillStyle = '#000';
    ctx2d.beginPath();
    ctx2d.ellipse(sx, this.y + 2, 12, 4, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;
    const img = g.art[this.kind];
    ctx2d.save();
    if (this.fuse > 0 && (this.fuse & 2) !== 0) ctx2d.filter = 'brightness(3)'; // ignited blink
    if (this.mode === 'thrown') {
      ctx2d.translate(sx, this.y - (img.height >> 1));
      ctx2d.rotate(this.spin);
      ctx2d.drawImage(img, -(img.width >> 1), -(img.height >> 1));
    } else if (this.hitT > 0) {
      ctx2d.translate(sx, this.y);
      ctx2d.rotate(Math.sin(this.hitT) * 0.08);
      ctx2d.drawImage(img, -(img.width >> 1), -img.height);
    } else {
      ctx2d.drawImage(img, sx - (img.width >> 1), this.y - img.height);
    }
    ctx2d.restore();
  }
}

export function clampLane(y: number): number {
  return Math.min(LANE_BOT, Math.max(LANE_TOP, y));
}
