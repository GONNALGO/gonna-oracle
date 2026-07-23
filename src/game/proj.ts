// Enemy/boss projectiles — pooled, zero hot-loop alloc.
// 'coin': horizontal gold coin (COIN SNEK spit, SLOT GOLEM volley).
// 'fud':  FUD STORM orb — telegraphed ground shadow, then falls from the sky.
import { clamp, LANE_BOT, LANE_TOP } from './types';
import type { GameCtx } from './ctx';

export type ProjKind = 'coin' | 'fud';

export class Proj {
  on = false;
  kind: ProjKind = 'coin';
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vz = 0;
  t = 0;
  telegraph = 0; // fud: frames of shadow warning before falling
  dmg = 8;
  removeMe = false; // kept for Drawable symmetry; engine reuses via `on`

  spawn(kind: ProjKind, x: number, y: number, vx: number): void {
    this.on = true;
    this.kind = kind;
    this.x = x;
    this.y = clamp(y, LANE_TOP, LANE_BOT);
    this.vx = vx;
    this.t = 0;
    if (kind === 'coin') {
      this.z = 26;
      this.vz = 0;
      this.dmg = 8;
      this.telegraph = 0;
    } else {
      // fud: starts high above the target lane, falls after the telegraph
      this.z = 150;
      this.vz = 0;
      this.dmg = 10;
      this.telegraph = 42;
    }
  }

  update(g: GameCtx): void {
    if (!this.on) return;
    this.t++;
    const p = g.player;
    if (this.kind === 'coin') {
      this.x += this.vx;
      // hits the player (jump over it)
      if (p.state !== 'dead' && Math.abs(p.x - this.x) < 12 && Math.abs(p.y - this.y) < 12 && p.z < 24) {
        if (p.hurt({ dmg: this.dmg, kb: 2, down: false, dir: this.vx >= 0 ? 1 : -1 }, g)) {
          this.on = false;
          return;
        }
      }
      if (this.t > 150 || this.x < g.camX - 40 || this.x > g.camX + 424) {
        this.on = false;
      }
      return;
    }
    // fud orb
    if (this.t < this.telegraph) return; // telegraph shadow only
    if (this.t === this.telegraph) g.audio.swing();
    this.vz -= 0.35;
    this.z += this.vz;
    if (this.z <= 0) {
      this.z = 0;
      this.on = false;
      g.audio.land();
      g.fx.ring(this.x, this.y, 26, '#e23b3b');
      g.fx.debris(this.x, this.y - 4, '#e23b3b', '#7a1a2a', 6);
      if (p.state !== 'dead' && Math.abs(p.x - this.x) < 22 && Math.abs(p.y - this.y) < 14 && p.z < 20) {
        p.hurt({ dmg: this.dmg, kb: 2, down: false, dir: p.x >= this.x ? 1 : -1 }, g);
      }
    }
  }

  draw(ctx2d: CanvasRenderingContext2D, g: GameCtx): void {
    if (!this.on) return;
    const sx = Math.round(this.x - g.camX);
    if (this.kind === 'coin') {
      const img = g.art.coinG;
      // spin: squash X with time
      const sq = Math.abs(Math.cos(this.t * 0.25));
      ctx2d.globalAlpha = 0.3;
      ctx2d.fillStyle = '#000';
      ctx2d.beginPath();
      ctx2d.ellipse(sx, this.y + 2, 6, 2.5, 0, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.globalAlpha = 1;
      const w = Math.max(2, Math.round(img.width * (0.35 + 0.65 * sq)));
      ctx2d.drawImage(img, sx - (w >> 1), Math.round(this.y - this.z - 6), w, img.height);
      return;
    }
    // fud: pulsing ground shadow during telegraph, red orb while falling
    const warn = this.t < this.telegraph;
    const pulse = warn ? 0.5 + 0.5 * Math.sin(this.t * 0.4) : 0.5;
    ctx2d.globalAlpha = warn ? 0.35 + 0.35 * pulse : 0.3;
    ctx2d.fillStyle = warn ? '#e23b3b' : '#000';
    ctx2d.beginPath();
    ctx2d.ellipse(sx, this.y + 1, warn ? 12 + pulse * 4 : 10, warn ? 5 : 4, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;
    if (!warn) {
      const sy = Math.round(this.y - this.z);
      ctx2d.fillStyle = '#7a1a2a';
      ctx2d.fillRect(sx - 4, sy - 4, 9, 9);
      ctx2d.fillStyle = '#e23b3b';
      ctx2d.fillRect(sx - 3, sy - 3, 7, 7);
      ctx2d.fillStyle = '#ff9a9a';
      ctx2d.fillRect(sx - 1, sy - 3, 2, 2);
    }
  }
}
