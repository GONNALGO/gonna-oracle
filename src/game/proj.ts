// Enemy/boss projectiles — pooled, zero hot-loop alloc.
// 'coin':    horizontal gold coin (COIN SNEK spit, SLOT GOLEM volley).
// 'fud':     FUD STORM orb — telegraphed ground shadow, then falls from the sky.
// 'molotov': v5 — arcing bottle, telegraphed landing shadow, bursts into flames.
// 'fudorb':  v5 — FUD CULTIST slow drifting orb (light damage).
import { clamp, GRAV, LANE_BOT, LANE_TOP } from './types';
import type { GameCtx } from './ctx';

export type ProjKind = 'coin' | 'fud' | 'molotov' | 'fudorb';

const MOLOTOV_FLIGHT = 46; // frames of arc (landing shadow visible the whole time)

export class Proj {
  on = false;
  kind: ProjKind = 'coin';
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0; // molotov: lane drift toward target
  vz = 0;
  t = 0;
  tx = 0; // molotov: landing point
  ty = 0;
  telegraph = 0; // fud: frames of shadow warning before falling
  dmg = 8;
  removeMe = false; // kept for Drawable symmetry; engine reuses via `on`

  spawn(kind: ProjKind, x: number, y: number, vx: number, tx = 0, ty = 0): void {
    this.on = true;
    this.kind = kind;
    this.x = x;
    this.y = clamp(y, LANE_TOP, LANE_BOT);
    this.vx = vx;
    this.vy = 0;
    this.t = 0;
    if (kind === 'coin') {
      this.z = 26;
      this.vz = 0;
      this.dmg = 8;
      this.telegraph = 0;
    } else if (kind === 'fudorb') {
      this.z = 24;
      this.vz = 0;
      this.dmg = 6;
      this.telegraph = 0;
    } else if (kind === 'molotov') {
      // lob from (x,y) to (tx,ty) in MOLOTOV_FLIGHT frames on a parabola
      this.tx = tx;
      this.ty = clamp(ty, LANE_TOP, LANE_BOT);
      this.z = 26;
      this.vx = (tx - x) / MOLOTOV_FLIGHT;
      this.vy = (this.ty - this.y) / MOLOTOV_FLIGHT;
      this.vz = 0.5 * GRAV * MOLOTOV_FLIGHT; // z(F)=0 ballistic lob
      this.dmg = 4; // small direct-hit splash (the flames are the real threat)
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
    if (this.kind === 'fudorb') {
      // slow drifting purple orb; gentle lane homing so it feels occult
      this.x += this.vx;
      if ((this.t & 15) === 0 && Math.abs(p.y - this.y) > 4) {
        this.y = clamp(this.y + Math.sign(p.y - this.y), LANE_TOP, LANE_BOT);
      }
      if (p.state !== 'dead' && Math.abs(p.x - this.x) < 11 && Math.abs(p.y - this.y) < 11 && p.z < 22) {
        if (p.hurt({ dmg: this.dmg, kb: 1.5, down: false, dir: this.vx >= 0 ? 1 : -1 }, g)) {
          this.on = false;
          return;
        }
      }
      if (this.t > 240 || this.x < g.camX - 40 || this.x > g.camX + 424) {
        this.on = false;
      }
      return;
    }
    if (this.kind === 'molotov') {
      // arcing bottle; the pulsing landing shadow is the telegraph
      this.x += this.vx;
      this.y = clamp(this.y + this.vy, LANE_TOP, LANE_BOT);
      this.vz -= GRAV;
      this.z += this.vz;
      if (this.z <= 0 || this.t > 90) {
        this.z = 0;
        this.on = false;
        g.audio.glass();
        g.audio.ignite();
        g.spawnFlame(this.tx, this.ty);
        g.fx.spark(this.tx, this.ty - 6, true);
        g.fx.ring(this.tx, this.ty, 24, '#ff8a3c');
        // direct splash on the player if caught at the landing point
        if (p.state !== 'dead' && Math.abs(p.x - this.tx) < 16 && Math.abs(p.y - this.ty) < 10 && p.z < 18) {
          p.hurt({ dmg: this.dmg, kb: 1.5, down: false, dir: p.x >= this.tx ? 1 : -1 }, g);
        }
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
    if (this.kind === 'fudorb') {
      const sy = Math.round(this.y - this.z);
      ctx2d.globalAlpha = 0.3;
      ctx2d.fillStyle = '#000';
      ctx2d.beginPath();
      ctx2d.ellipse(sx, this.y + 2, 6, 2.5, 0, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.globalAlpha = 1;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 0.3);
      ctx2d.fillStyle = '#5a3699';
      ctx2d.fillRect(sx - 4, sy - 4, 9, 9);
      ctx2d.fillStyle = '#b45aff';
      ctx2d.fillRect(sx - 3, sy - 3, 7, 7);
      ctx2d.fillStyle = pulse > 0.5 ? '#ff3b3b' : '#e8e4f8';
      ctx2d.fillRect(sx - 1, sy - 1, 3, 3);
      return;
    }
    if (this.kind === 'molotov') {
      // telegraph: pulsing landing shadow for the whole flight
      const lx = Math.round(this.tx - g.camX);
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 0.4);
      ctx2d.globalAlpha = 0.35 + 0.35 * pulse;
      ctx2d.fillStyle = '#ff8a3c';
      ctx2d.beginPath();
      ctx2d.ellipse(lx, this.ty + 1, 10 + pulse * 5, 4 + pulse * 2, 0, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.globalAlpha = 0.3;
      ctx2d.fillStyle = '#000';
      ctx2d.beginPath();
      ctx2d.ellipse(sx, this.y + 2, 5, 2, 0, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.globalAlpha = 1;
      // spinning bottle
      const sy = Math.round(this.y - this.z);
      ctx2d.save();
      ctx2d.translate(sx, sy);
      ctx2d.rotate(this.t * 0.3);
      ctx2d.fillStyle = '#3f7a3a';
      ctx2d.fillRect(-2, -5, 4, 8);
      ctx2d.fillStyle = '#c8b87a';
      ctx2d.fillRect(-2, 2, 4, 3);
      ctx2d.fillStyle = '#ff8a3c';
      ctx2d.fillRect(-1, -8, 3, 3);
      ctx2d.restore();
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
