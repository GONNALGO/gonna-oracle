// v9.4 THE MINTING — SF2-style bonus stage. One obsidian ALGORAND monument,
// 40 seconds, your whole moveset. No enemies, no threats: pure execution.
// Huge HP pool = only optimized combo play destroys it in time. Points are
// REAL: they join the run score and get sealed on-chain.
//
// THE CAP IS ONE CONSTANT. Silvio decides it. Directive: COMPETITION.

import { drawText } from './font';
import { clamp, VH, VW } from './types';
import type { GameCtx } from './ctx';
import type { AttackBox } from './player';
import { MINT_FX } from './stages';

// ---------- TUNABLES ----------
export const MINT_SECONDS = 40; // the SF2 car-bonus clock
export const MINT_MONUMENT_HP = 300; // execution gate
export const MINT_POINTS_PER_DMG = 120; // full clear = 36,000
export const MINT_FLAWLESS_BONUS = 4000; // destroyed with >10s left
export const MINT_BONUS_CAP = 40000; // <<<< THE SILVIO CONSTANT
export const MINT_FLAWLESS_TIME = 10; // seconds left required for FLAWLESS
// --------------------------------

type Ctx = CanvasRenderingContext2D;

function fmtNum(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// deterministic 0..1 hash (no RNG state, stable cracks frame to frame)
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function tinted(img: HTMLImageElement, color: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const x = cv.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, cv.width, cv.height);
  return cv;
}

export class MintState {
  readonly x = 252; // world center of the monument (camX never moves)
  readonly baseY = 192; // ground line at the pedestal
  y = 200; // z-sort lane: player above the base walks behind, below walks in front
  hp = MINT_MONUMENT_HP;
  readonly maxHp = MINT_MONUMENT_HP;
  lastHitId = -1;
  broken = false;
  flawless = false;
  done = false; // results on screen, waiting for START
  earned = 0; // points the mint added to the run (capped)
  private animT = 0;
  private breakT = 0;
  private wrapT = 0;
  private idleT = 0; // frames since the last hit (2s grace before the chart turns on you)
  private shakeT = 0;
  private statue: HTMLCanvasElement | null = null;

  get ratio(): number {
    return this.hp / this.maxHp;
  }
  get wrapFrames(): number {
    return this.wrapT;
  }

  hitTest(box: AttackBox): boolean {
    return box.x0 - 26 < this.x && box.x1 + 26 > this.x && Math.abs(this.baseY - box.y) <= 34;
  }

  hit(g: GameCtx, dmg: number): void {
    if (this.broken || this.done) return;
    const prev = this.ratio;
    this.hp = Math.max(0, this.hp - dmg);
    this.idleT = 0;
    this.shakeT = 6;
    this.addPoints(g, dmg * MINT_POINTS_PER_DMG, this.x + 6, this.baseY - 100);
    MINT_FX.chart = clamp(this.earned / (this.maxHp * MINT_POINTS_PER_DMG), 0, 1);
    MINT_FX.hype = 1;
    const cx = this.x + (g.player.x < this.x ? -22 : 22);
    const cy = this.baseY - 58;
    g.fx.spark(cx, cy, dmg >= 24);
    g.fx.shake(dmg >= 24 ? 2.5 : 1.2);
    g.hitStop(dmg >= 24 ? 3 : 2);
    const r = this.ratio;
    // damage-state crossings: chunk bursts + the deep thud
    if ((prev > 0.65 && r <= 0.65) || (prev > 0.35 && r <= 0.35)) {
      g.fx.debris(this.x, this.baseY - 60, '#2c313c', '#4a5160', 14);
      g.fx.shake(4);
      g.audio.thud();
      g.fx.popup(this.x, this.baseY - 116, 'CRACK!', '#8a8f9c');
    } else {
      g.fx.debris(cx, cy, '#2c313c', '#4a5160', 4);
    }
    if (this.hp <= 0) this.shatter(g);
  }

  private addPoints(g: GameCtx, pts: number, px: number, py: number): void {
    const add = Math.max(0, Math.min(pts, MINT_BONUS_CAP - this.earned));
    if (add <= 0) return;
    this.earned += add;
    g.addScore(add);
    g.fx.popup(px, py, '+' + fmtNum(add), '#f5c542');
  }

  private shatter(g: GameCtx): void {
    this.broken = true;
    this.breakT = 0;
    MINT_FX.godCandle = 0.001;
    MINT_FX.klaxon = false;
    MINT_FX.hype = 1;
    g.fx.debris(this.x, this.baseY - 56, '#2c313c', '#f5c542', 26);
    g.fx.coinsBurst(this.x, this.baseY - 70, 20);
    g.fx.ring(this.x, this.baseY - 60, 70, '#f5c542');
    g.fx.shake(6);
    g.audio.gong();
    // NO white flash. Never a white flash.
  }

  awardFlawless(g: GameCtx): void {
    if (this.flawless) return;
    this.flawless = true;
    this.addPoints(g, MINT_FLAWLESS_BONUS, this.x, this.baseY - 122);
  }

  timeUp(g: GameCtx): void {
    if (this.done) return;
    this.done = true;
    this.wrapT = 0;
    MINT_FX.klaxon = false;
    g.audio.uiSelect();
  }

  update(g: GameCtx): void {
    this.animT++;
    if (this.shakeT > 0) this.shakeT--;
    if (!this.broken && !this.done) {
      this.idleT++;
      if (this.idleT > 120) {
        // stand still 2s and the chart turns on you
        MINT_FX.dip = Math.min(1, MINT_FX.dip + 0.03);
        MINT_FX.chart = Math.max(0, MINT_FX.chart - 0.0016);
      } else {
        MINT_FX.dip = Math.max(0, MINT_FX.dip - 0.06);
      }
    } else {
      MINT_FX.dip = Math.max(0, MINT_FX.dip - 0.06);
    }
    MINT_FX.hype *= 0.985;
    if (MINT_FX.godCandle > 0 && MINT_FX.godCandle < 1) {
      MINT_FX.godCandle = Math.min(1, MINT_FX.godCandle + 0.02);
    }
    if (this.broken && !this.done) {
      this.breakT++;
      // the crowd showers the pedestal with coins while the statue settles
      if (this.breakT === 40) g.fx.coinsBurst(this.x - 70, 150, 10);
      if (this.breakT === 65) g.fx.coinsBurst(this.x + 70, 150, 10);
      if (this.breakT === 100) {
        this.done = true;
        this.wrapT = 0;
        g.audio.triumph();
      }
    }
    if (this.done) this.wrapT++;
  }

  // entity draw: world coords (screen x = world x - camX, camX is always 0 here)
  draw(c: Ctx, g: GameCtx): void {
    const sx = Math.round(this.x - g.camX) + (!this.broken && this.shakeT > 0 ? (this.shakeT & 1 ? 1 : -1) : 0);
    const by = this.baseY;
    // ---- pedestal (always) ----
    c.fillStyle = '#3a2f14';
    c.fillRect(sx - 42, by, 84, 6);
    c.fillStyle = '#6e5318';
    c.fillRect(sx - 42, by, 84, 2);
    c.fillStyle = '#2c240f';
    c.fillRect(sx - 36, by + 6, 72, 4);
    if (!this.broken) this.drawMonument(c, sx, by);
    else this.drawStatue(c, sx, by, g);
  }

  private drawMonument(c: Ctx, x: number, by: number): void {
    const top = by - 104;
    const r = this.ratio;
    // ---- obsidian slab ----
    c.fillStyle = '#1c202a';
    c.fillRect(x - 30, top, 60, 104);
    c.fillStyle = '#2a303d'; // left/top bevel
    c.fillRect(x - 30, top, 3, 104);
    c.fillRect(x - 30, top, 60, 3);
    c.fillStyle = '#12151d'; // right/bottom shade
    c.fillRect(x + 27, top, 3, 104);
    c.fillRect(x - 30, by - 3, 60, 3);
    c.fillStyle = '#161a24'; // inner panel
    c.fillRect(x - 24, top + 6, 48, 92);
    // rivets
    c.fillStyle = '#39404e';
    c.fillRect(x - 27, top + 4, 2, 2);
    c.fillRect(x + 25, top + 4, 2, 2);
    c.fillRect(x - 27, by - 8, 2, 2);
    c.fillRect(x + 25, by - 8, 2, 2);
    // something breathes inside: green pulse along the inner seam
    const pulse = r > 0.65 ? 0.22 + 0.18 * Math.sin(this.animT * 0.06) : 0.08;
    c.globalAlpha = Math.max(0, pulse);
    c.fillStyle = '#39ff14';
    c.fillRect(x - 24, top + 6, 48, 1);
    c.fillRect(x - 24, by - 10, 48, 1);
    c.globalAlpha = 1;
    // ---- the ALGORAND mark (obsidian on obsidian, beveled) ----
    const cx = x;
    const cy = top + 52;
    c.lineCap = 'butt';
    c.strokeStyle = '#3d4453'; // bevel pass
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(cx - 17, cy + 21);
    c.lineTo(cx + 1, cy - 21);
    c.lineTo(cx + 19, cy + 21);
    c.stroke();
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(cx - 7, cy + 6);
    c.lineTo(cx + 10, cy + 6);
    c.stroke();
    c.strokeStyle = '#0b0d12'; // face pass
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(cx - 17, cy + 21);
    c.lineTo(cx + 1, cy - 21);
    c.lineTo(cx + 19, cy + 21);
    c.stroke();
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(cx - 7, cy + 6);
    c.lineTo(cx + 10, cy + 6);
    c.stroke();
    // ---- damage: cracks, then gold bleeding through ----
    if (r <= 0.65) {
      const n = r > 0.35 ? 3 : 7;
      for (let i = 0; i < n; i++) {
        const sx0 = x - 22 + hash01(i * 3 + 1) * 44;
        const sy0 = top + 6 + hash01(i * 5 + 2) * 30;
        c.strokeStyle = r <= 0.35 ? '#f5c542' : '#05070a'; // deep cracks glow gold
        c.globalAlpha = r <= 0.35 ? 0.85 : 1;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(sx0, sy0);
        let px = sx0;
        let py = sy0;
        for (let k = 0; k < 4; k++) {
          px += (hash01(i * 11 + k * 7) - 0.5) * 14;
          py += 8 + hash01(i * 13 + k * 3) * 10;
          c.lineTo(px, Math.min(py, by - 6));
        }
        c.stroke();
        c.globalAlpha = 1;
      }
      if (r <= 0.35) {
        // heavy damage: the gold underneath shines through the whole panel
        c.globalAlpha = 0.16 + 0.08 * Math.sin(this.animT * 0.1);
        c.fillStyle = '#f5c542';
        c.fillRect(x - 24, top + 6, 48, 92);
        c.globalAlpha = 1;
      }
    }
  }

  private drawStatue(c: Ctx, x: number, by: number, g: GameCtx): void {
    if (!this.statue) {
      const img = g.frames.get('0_0'); // the REAL GONNA idle frame
      if (!img) return;
      const shade = tinted(img, '#8a6518');
      const main = tinted(img, '#f5c542');
      const glint = tinted(img, '#f5d76e');
      const cv = document.createElement('canvas');
      cv.width = img.width + 1;
      cv.height = img.height + 1;
      const sx2 = cv.getContext('2d')!;
      sx2.imageSmoothingEnabled = false;
      sx2.drawImage(shade, 1, 1);
      sx2.drawImage(main, 0, 0);
      // lighter crown: top 38% gets the glint pass
      sx2.drawImage(glint, 0, 0, glint.width, Math.floor(glint.height * 0.38), 0, 0, glint.width, Math.floor(glint.height * 0.38));
      this.statue = cv;
    }
    const st = this.statue;
    const phase = Math.min(1, this.breakT / 46); // flip-in
    const rise = (1 - phase) * 30;
    const sc = phase >= 0.85 ? 1 : Math.max(0.05, Math.abs(Math.cos(phase * Math.PI * 3)));
    const w = Math.max(1, Math.round(st.width * 0.72 * sc));
    const h = Math.round(st.height * 0.72);
    const dx = Math.round(x - (st.width * 0.72) / 2);
    const dy = Math.round(by - h - 2 + rise);
    // golden ground glow under the idol
    c.globalAlpha = 0.25;
    c.fillStyle = '#f5c542';
    c.fillRect(x - 30, by - 1, 60, 2);
    c.globalAlpha = 1;
    c.drawImage(st, 0, 0, st.width, st.height, dx, dy, w, h);
    if (phase >= 1) {
      // settled: glint sweep + sparkles
      const sweep = this.animT % 90;
      if (sweep < 18) {
        const gx = dx + Math.round((sweep / 18) * w);
        c.globalAlpha = 0.5;
        c.fillStyle = '#fff2c0';
        c.fillRect(gx, dy + 4, 1, h - 8);
        c.globalAlpha = 1;
      }
      for (let i = 0; i < 3; i++) {
        if (hash01((this.animT >> 2) + i * 17) > 0.6) {
          c.fillStyle = '#fff2c0';
          c.fillRect(dx + Math.round(hash01(i * 31) * w), dy + Math.round(hash01(i * 47) * h * 0.7), 2, 2);
        }
      }
    }
  }
}

// ---------- overlay (HUD layer, screen space) ----------
export function drawMintHud(c: Ctx, m: MintState, timeLeft: number, frame: number, touch: boolean): void {
  // monument bar (hidden once results are up) — bottom center, clear of the HUD score
  if (!m.done) {
    drawText(c, 'THE MONUMENT', VW / 2, 198, 1, '#8a8f9c', 'center');
    c.fillStyle = '#101218';
    c.fillRect(VW / 2 - 61, 206, 122, 8);
    c.strokeStyle = '#4a5160';
    c.lineWidth = 1;
    c.strokeRect(VW / 2 - 60.5, 206.5, 121, 7);
    if (!m.broken) {
      c.fillStyle = m.ratio > 0.35 ? '#f5c542' : '#ff9d2e';
      c.fillRect(VW / 2 - 59, 208, Math.round(118 * m.ratio), 4);
    } else {
      c.fillStyle = '#39ff14';
      c.fillRect(VW / 2 - 59, 208, 118, 4);
    }
  }
  // the moment
  if (m.broken && !m.done) {
    drawText(c, 'MINTED!', VW / 2 + 1, 51, 3, '#101218', 'center');
    drawText(c, 'MINTED!', VW / 2, 50, 3, '#f5c542', 'center');
    if (m.flawless) drawText(c, 'FLAWLESS MINT +' + fmtNum(MINT_FLAWLESS_BONUS), VW / 2, 74, 1, '#f5d76e', 'center');
  }
  // results
  if (m.done) {
    c.fillStyle = 'rgba(13,17,24,0.92)';
    c.fillRect(VW / 2 - 88, 56, 176, 66);
    c.strokeStyle = '#f5c542';
    c.lineWidth = 1;
    c.strokeRect(VW / 2 - 87.5, 56.5, 175, 65);
    drawText(c, m.broken ? 'MINTED!' : 'TIME UP', VW / 2, 66, 2, m.broken ? '#f5c542' : '#8a8f9c', 'center');
    if (m.flawless) drawText(c, 'FLAWLESS MINT', VW / 2, 84, 1, '#f5d76e', 'center');
    drawText(c, 'BONUS +' + fmtNum(m.earned), VW / 2, 94, 1, '#f5c542', 'center');
    if (m.wrapFrames > 40 && (frame & 32) !== 0) {
      drawText(c, touch ? 'TAP TO CONTINUE' : 'PRESS START', VW / 2, 110, 1, '#c8ccd4', 'center');
    }
  }
  // klaxon seconds
  if (!m.done && !m.broken && timeLeft <= 10 && (frame & 16) !== 0) {
    drawText(c, 'HURRY!', VW / 2, VH - 34, 1, '#e5484d', 'center');
  }
}
