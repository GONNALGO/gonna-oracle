// Pooled particles, damage popups, shockwave rings, screen shake. Zero per-frame alloc.

interface Particle { on: boolean; x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; s: number; grav: number; }
interface Popup { on: boolean; x: number; y: number; vy: number; life: number; txt: string; c: string; }
interface Ring { on: boolean; x: number; y: number; r: number; max: number; life: number; c: string; }

import { drawText } from './font';

export class FX {
  private parts: Particle[] = [];
  private pops: Popup[] = [];
  private rings: Ring[] = [];
  shakeMag = 0;
  shakeX = 0;
  shakeY = 0;
  flash = 0; // white screen flash frames

  constructor() {
    for (let i = 0; i < 220; i++) this.parts.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, c: '#fff', s: 2, grav: 0 });
    for (let i = 0; i < 24; i++) this.pops.push({ on: false, x: 0, y: 0, vy: 0, life: 0, txt: '', c: '#fff' });
    for (let i = 0; i < 12; i++) this.rings.push({ on: false, x: 0, y: 0, r: 0, max: 40, life: 0, c: '#fff' });
  }

  reset(): void {
    for (const p of this.parts) p.on = false;
    for (const p of this.pops) p.on = false;
    for (const r of this.rings) r.on = false;
    this.shakeMag = 0;
    this.flash = 0;
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
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * (big ? 3.4 : 2.2);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 0.6;
      p.max = p.life = big ? 16 + Math.random() * 10 : 10 + Math.random() * 8;
      p.c = Math.random() < 0.5 ? '#f5c542' : Math.random() < 0.5 ? '#fff6d8' : '#ff8a3c';
      p.s = big ? 2 : 1 + (Math.random() < 0.3 ? 1 : 0);
      p.grav = 0.12;
    }
  }

  debris(x: number, y: number, c1: string, c2: string, n = 10): void {
    for (let i = 0; i < n; i++) {
      const p = this.parts.find((q) => !q.on);
      if (!p) return;
      p.on = true;
      p.x = x; p.y = y;
      p.vx = (Math.random() - 0.5) * 4;
      p.vy = -1 - Math.random() * 3;
      p.max = p.life = 30 + Math.random() * 20;
      p.c = Math.random() < 0.5 ? c1 : c2;
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
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 2 + Math.random() * 3.5;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.max = p.life = 40 + Math.random() * 30;
      p.c = Math.random() < 0.7 ? '#f5c542' : '#fff6d8';
      p.s = 2;
      p.grav = 0.18;
    }
  }

  popup(x: number, y: number, txt: string, c = '#fff'): void {
    const p = this.pops.find((q) => !q.on);
    if (!p) return;
    p.on = true;
    p.x = x; p.y = y;
    p.vy = -0.7;
    p.life = 42;
    p.txt = txt;
    p.c = c;
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
    if (this.shakeMag > 0) {
      this.shakeMag *= 0.85;
      if (this.shakeMag < 0.3) this.shakeMag = 0;
      this.shakeX = (Math.random() - 0.5) * 2 * this.shakeMag;
      this.shakeY = (Math.random() - 0.5) * 2 * this.shakeMag;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
    if (this.flash > 0) this.flash--;
  }

  // world-space draw (inside camera transform)
  drawWorld(ctx: CanvasRenderingContext2D): void {
    for (const p of this.parts) {
      if (!p.on) continue;
      ctx.globalAlpha = Math.min(1, p.life / (p.max * 0.5));
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x | 0, p.y | 0, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    for (const r of this.rings) {
      if (!r.on) continue;
      ctx.globalAlpha = r.life / 22;
      ctx.strokeStyle = r.c;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const p of this.pops) {
      if (!p.on) continue;
      ctx.globalAlpha = Math.min(1, p.life / 20);
      drawText(ctx, p.txt, p.x, p.y, 1, '#101018', 'center');
      drawText(ctx, p.txt, p.x - 1, p.y - 1, 1, p.c, 'center');
    }
    ctx.globalAlpha = 1;
  }
}
