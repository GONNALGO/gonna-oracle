// Pickups (pooled-ish, short lived) + destructible lane obstacles.
import { GRAV, LANE_BOT, LANE_TOP, rand } from './types';
import type { GameCtx } from './ctx';

export type ItemKind = 'chicken' | 'coinG' | 'coinA' | 'liz' | 'knife' | 'chest';
export type ObstacleKind = 'can' | 'barrel' | 'crate';

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

  constructor(kind: ItemKind, x: number, y: number, scatter: boolean) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.z = scatter ? 10 : 0;
    if (scatter) {
      this.vx = rand(-2, 2);
      this.vz = rand(1.5, 3);
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

  constructor(kind: ObstacleKind, x: number, y: number, contains: ItemKind | 'none' | 'random') {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.hp = kind === 'can' ? 1 : 2;
    this.contains = contains;
  }

  hurt(g: GameCtx): void {
    this.hp--;
    this.hitT = 8;
    g.audio.punch();
    g.fx.shake(1.5);
    const c1 = this.kind === 'can' ? '#8a8f9c' : '#8a5a2a';
    const c2 = this.kind === 'can' ? '#c8ccd4' : '#6e431f';
    g.fx.debris(this.x, this.y - 14, c1, c2, 5);
    if (this.hp <= 0) {
      this.removeMe = true;
      g.fx.debris(this.x, this.y - 14, c1, c2, 14);
      g.audio.hitHard();
      let drop = this.contains;
      if (drop === 'random') {
        const r = Math.random();
        drop = r < 0.3 ? 'chicken' : r < 0.55 ? 'coinA' : r < 0.8 ? 'coinG' : r < 0.92 ? 'chest' : 'liz';
      }
      if (drop !== 'none') g.dropItem(drop, this.x, this.y);
    }
  }

  update(): void {
    if (this.hitT > 0) this.hitT--;
  }

  draw(ctx2d: CanvasRenderingContext2D, g: GameCtx): void {
    const sx = Math.round(this.x - g.camX);
    ctx2d.globalAlpha = 0.3;
    ctx2d.fillStyle = '#000';
    ctx2d.beginPath();
    ctx2d.ellipse(sx, this.y + 2, 12, 4, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;
    const img = g.art[this.kind];
    ctx2d.save();
    if (this.hitT > 0) {
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
