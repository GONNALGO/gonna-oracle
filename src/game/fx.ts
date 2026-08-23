// Pooled particles, damage popups, shockwave rings, screen shake. Zero per-frame alloc.

interface Particle { on: boolean; x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; s: number; grav: number; }
interface Popup { on: boolean; x: number; y: number; vy: number; life: number; txt: string; c: string; s: number; }
interface Ring { on: boolean; x: number; y: number; r: number; max: number; life: number; c: string; }
// v5: persistent molotov flames — lane hazards with damage-over-time (DoT tick
// is game logic, handled by the engine; this is the pooled visual/state layer)
interface Flame { on: boolean; x: number; y: number; life: number; max: number; tick: number; seed: number; }

export const FLAME_LIFE = 180; // ~3s at 60Hz
export const FLAME_RX = 26; // hazard ellipse half-width
export const FLAME_RY = 9; // hazard ellipse half-height (lane tolerance)

import { drawText } from './font';
import { visualRand } from './rng';

export class FX {
  private parts: Particle[] = [];
  private pops: Popup[] = [];
  private rings: Ring[] = [];
  readonly flames: Flame[] = []; // v5 (readonly ref: engine scans for DoT)
  shakeMag = 0;
  shakeX = 0;
  shakeY = 0;
  flash = 0; // white screen flash frames

  constructor() {
    for (let i = 0; i < 220; i++) this.parts.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, c: '#fff', s: 2, grav: 0 });
    for (let i = 0; i < 24; i++) this.pops.push({ on: false, x: 0, y: 0, vy: 0, life: 0, txt: '', c: '#fff', s: 1 });
    for (let i = 0; i < 12; i++) this.rings.push({ on: false, x: 0, y: 0, r: 0, max: 40, life: 0, c: '#fff' });
    for (let i = 0; i < 12; i++) this.flames.push({ on: false, x: 0, y: 0, life: 0, max: FLAME_LIFE, tick: 0, seed: 0 });
  }

  reset(): void {
    for (const p of this.parts) p.on = false;
    for (const p of this.pops) p.on = false;
    for (const r of this.rings) r.on = false;
    for (const f of this.flames) f.on = false;
    this.shakeMag = 0;
    this.flash = 0;
  }

  // v5: ignite a persistent flame patch on a lane (~3s)
  flame(x: number, y: number): void {
    const f = this.flames.find((q) => !q.on);
    if (!f) return;
    f.on = true;
    f.x = x;
    f.y = y;
    f.max = f.life = FLAME_LIFE;
    f.tick = 0;
    f.seed = visualRand() * 6.28;
  }

  shake(m: number): void {
    if (m > this.shakeMag) this.shakeMag = m;
  }

  spark(x: number, y: number, big = false): void {
    const n = big ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const p = this.parts.find((q) => !q.on);
      if (!p) return;
      p.on = true;
      p.x = x; p.y = y;
      const a = visualRand() * Math.PI * 2;
      const sp = 1 + visualRand() * (big ? 3.4 : 2.2);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 0.6;
      p.max = p.life = big ? 16 + visualRand() * 10 : 10 + visualRand() * 8;
      p.c = visualRand() < 0.5 ? '#f5c542' : visualRand() < 0.5 ? '#fff6d8' : '#ff8a3c';
      p.s = big ? 2 : 1 + (visualRand() < 0.3 ? 1 : 0);
      p.grav = 0.12;
    }
  }

  debris(x: number, y: number, c1: string, c2: string, n = 10): void {
    for (let i = 0; i < n; i++) {
      const p = this.parts.find((q) => !q.on);
      if (!p) return;
      p.on = true;
      p.x = x; p.y = y;
      p.vx = (visualRand() - 0.5) * 4;
      p.vy = -1 - visualRand() * 3;
      p.max = p.life = 30 + visualRand() * 20;
      p.c = visualRand() < 0.5 ? c1 : c2;
      p.s = 2;
      p.grav = 0.22;
    }
  }

  coinsBurst(x: number, y: number, n = 16): void {
    for (let i = 0; i < n; i++) {
      const p = this.parts.find((q) => !q.on);
      if (!p) return;
      p.on = true;
      p.x = x; p.y = y;
      const a = -Math.PI / 2 + (visualRand() - 0.5) * 2.2;
      const sp = 2 + visualRand() * 3.5;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.max = p.life = 40 + visualRand() * 30;
      p.c = visualRand() < 0.7 ? '#f5c542' : '#fff6d8';
      p.s = 2;
      p.grav = 0.18;
    }
  }

  popup(x: number, y: number, txt: string, c = '#fff', life = 42, s = 1): void {
    const p = this.pops.find((q) => !q.on);
    if (!p) return;
    p.on = true;
    p.x = x; p.y = y;
    p.vy = -0.35;
    p.life = life;
    p.txt = txt;
    p.c = c;
    p.s = s; // v15: kill popups SCALE with the multiplier
  }

  ring(x: number, y: number, max: number, c = '#7fd858'): void {
    const r = this.rings.find((q) => !q.on);
    if (!r) return;
    r.on = true;
    r.x = x; r.y = y;
    r.r = 4;
    r.max = max;
    r.life = 22;
    r.c = c;
  }

  update(): void {
    for (const p of this.parts) {
      if (!p.on) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.grav;
      if (--p.life <= 0) p.on = false;
    }
    for (const p of this.pops) {
      if (!p.on) continue;
      p.y += p.vy;
      if (--p.life <= 0) p.on = false;
    }
    for (const r of this.rings) {
      if (!r.on) continue;
      r.r += (r.max - r.r) * 0.25 + 1;
      if (--r.life <= 0) r.on = false;
    }
    // v5 flames: shrink at end of life, puff embers from the particle pool
    for (const f of this.flames) {
      if (!f.on) continue;
      if (--f.life <= 0) { f.on = false; continue; }
      if ((f.life & 7) === 0) {
        const p = this.parts.find((q) => !q.on);
        if (p) {
          p.on = true;
          p.x = f.x + Math.sin(f.seed + f.life * 0.7) * 16;
          p.y = f.y - 3;
          p.vx = (visualRand() - 0.5) * 0.4;
          p.vy = -0.8 - visualRand() * 0.8;
          p.max = p.life = 14 + visualRand() * 10;
          p.c = visualRand() < 0.5 ? '#ff8a3c' : visualRand() < 0.5 ? '#f5c542' : '#e23b3b';
          p.s = 1;
          p.grav = -0.02;
        }
      }
    }
    if (this.shakeMag > 0) {
      this.shakeMag *= 0.85;
      if (this.shakeMag < 0.3) this.shakeMag = 0;
      this.shakeX = (visualRand() - 0.5) * 2 * this.shakeMag;
      this.shakeY = (visualRand() - 0.5) * 2 * this.shakeMag;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
    if (this.flash > 0) this.flash--;
  }

  // v5: flames burn ON the ground — drawn under the entities (world space)
  drawFlames(ctx: CanvasRenderingContext2D, camX: number): void {
    for (const f of this.flames) {
      if (!f.on) continue;
      const sx = Math.round(f.x - camX);
      const fade = Math.min(1, f.life / 40); // die down at the end
      const grow = Math.min(1, (f.max - f.life) / 12); // catch fire quickly
      const w = FLAME_RX * grow;
      // scorch mark
      ctx.globalAlpha = 0.5 * fade;
      ctx.fillStyle = '#1a0e08';
      ctx.beginPath();
      ctx.ellipse(sx, f.y + 2, w, FLAME_RY, 0, 0, Math.PI * 2);
      ctx.fill();
      // flame tongues: deterministic flicker from life+seed, zero alloc
      ctx.globalAlpha = 0.92 * fade;
      for (let i = 0; i < 5; i++) {
        const ph = f.seed + i * 2.4;
        const fx0 = sx + Math.sin(ph) * (w - 6);
        const h = (7 + 6 * (0.5 + 0.5 * Math.sin(f.life * 0.35 + ph))) * grow;
        ctx.fillStyle = i & 1 ? '#e2543a' : '#ff8a3c';
        ctx.fillRect(Math.round(fx0) - 2, Math.round(f.y - h), 5, Math.round(h));
        ctx.fillStyle = '#f5c542';
        ctx.fillRect(Math.round(fx0) - 1, Math.round(f.y - h * 0.6), 3, Math.round(h * 0.6));
      }
      ctx.globalAlpha = 1;
    }
  }

  // world-space draw. v9.0.1 BUG C: all fx store WORLD coordinates (spawned at
  // entity.x) and entities draw at x-camX — camX MUST be subtracted here too,
  // else every spark/ring/popup renders camX px to the right (wave 1 = first
  // camLock > 0, later waves push the strays off-screen so they looked "fine").
  drawWorld(ctx: CanvasRenderingContext2D, camX: number): void {
    for (const p of this.parts) {
      if (!p.on) continue;
      ctx.globalAlpha = Math.min(1, p.life / (p.max * 0.5));
      ctx.fillStyle = p.c;
      ctx.fillRect((p.x - camX) | 0, p.y | 0, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    for (const r of this.rings) {
      if (!r.on) continue;
      ctx.globalAlpha = r.life / 22;
      ctx.strokeStyle = r.c;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(r.x - camX, r.y, r.r, r.r * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const p of this.pops) {
      if (!p.on) continue;
      ctx.globalAlpha = Math.min(1, p.life / 20);
      drawText(ctx, p.txt, p.x - camX, p.y, p.s, '#101018', 'center');
      drawText(ctx, p.txt, p.x - camX - 1, p.y - 1, p.s, p.c, 'center');
    }
    ctx.globalAlpha = 1;
  }

  // CI introspection (v9.0.1 wave-1 regression test): live fx in SCREEN coords
  debugScreen(camX: number): { rings: { x: number; y: number; r: number }[]; parts: { x: number; y: number }[]; pops: { x: number; y: number; txt: string }[] } {
    return {
      rings: this.rings.filter((r) => r.on).map((r) => ({ x: r.x - camX, y: r.y, r: r.r })),
      parts: this.parts.filter((p) => p.on).map((p) => ({ x: p.x - camX, y: p.y })),
      pops: this.pops.filter((p) => p.on).map((p) => ({ x: p.x - camX, y: p.y, txt: p.txt })),
    };
  }
}
