// v9.2 — THE SEAL MOMENT: the 4-act emotional animation that plays while the
// record is sealed on-chain (~5s, skippable with a tap).
//   ACT 1 SIGNING   — gonna breathing center screen, green rising particles,
//                     "SIGN IN YOUR WALLET..." pulsing (the wallet is live)
//   ACT 2 CONFIRMED — freeze frame, half-beat of silence, then a FULL-SCREEN
//                     FLUO GREEN FLASH (#39FF14 — NOT white), deep synth gong,
//                     block number stamps on screen
//   ACT 3 BULLRUN   — green crypto candles rise from the bottom accelerating,
//                     mega-candles burst into sparks, "+69%" labels float up,
//                     the score ticks up like a pumping ticker to the final
//                     gold score, victory pose, BYZANTINE CLEAR crown drop,
//                     triumph chiptune fanfare
//   ACT 4 REVEAL    — "IMMORTALIZED ON-CHAIN" types out, "#N IN THE
//                     GONNAVERSE" lands with a THUD, the share card slides in
//                     like a polaroid -> then the SEALED screen (gentle
//                     candles keep rising in its background, see drawSealedBg)
import { drawText, drawTextSh } from './font';
import { drawCrown, mosaicBorder } from './screens';
import { fmtScore } from './board';
import { VH, VW } from './types';
import type { SkinId } from './skins';

export const FLASH_COLOR = '#39FF14'; // FLUO GREEN — never white

export interface SealAnimRec {
  score: number;
  win: 0 | 1;
  continues: number;
  skin: SkinId;
}

export interface Candle {
  x: number;
  w: number;
  body: number; // final body height (increasing left -> right)
  delay: number;
  speed: number;
  mega: boolean;
  burst: boolean;
}

interface Particle {
  x: number;
  y: number;
  vy: number;
  t: number;
  seed: number;
}

const ACT2_LEN = 52;
const ACT3_LEN = 132;
const ACT4_LEN = 126;

export class SealMoment {
  act: 1 | 2 | 3 | 4 = 1;
  actT = 0;
  totalT = 0;
  rec: SealAnimRec = { score: 0, win: 0, continues: 0, skin: 'gonna' };
  block = 0; // confirmed round (0 = pending/unknown)
  rank: number | null = null; // null -> "SEALED FOREVER"
  byzantine = false;
  done = false;
  skipped = false;
  private candles: Candle[] = [];
  private parts: Particle[] = [];
  private sparks: Particle[] = [];
  private tickerBlip = 0;

  start(rec: SealAnimRec): void {
    this.act = 1;
    this.actT = 0;
    this.totalT = 0;
    this.rec = rec;
    this.block = 0;
    this.rank = null;
    this.byzantine = rec.win === 1 && rec.continues === 0;
    this.done = false;
    this.skipped = false;
    this.parts = [];
    this.sparks = [];
    this.tickerBlip = 0;
    // bullrun candles: bodies strictly increasing left -> right
    this.candles = [];
    const n = 15;
    const cw = 16;
    const gap = 9;
    const x0 = Math.floor((VW - (n * cw + (n - 1) * gap)) / 2);
    for (let i = 0; i < n; i++) {
      this.candles.push({
        x: x0 + i * (cw + gap),
        w: cw,
        body: 26 + i * 7 + ((i * 37) % 11),
        delay: i * 5,
        speed: 1.35 + (i % 4) * 0.22,
        mega: i % 5 === 4,
        burst: false,
      });
    }
  }

  // the wallet confirmed: SIGNING -> CONFIRMED (freeze -> silence -> FLASH)
  confirm(block: number): void {
    if (this.act !== 1) return;
    this.block = block;
    this.act = 2;
    this.actT = 0;
  }

  // tap/ENTER/ESC skips the show straight to the SEALED screen
  skip(): void {
    if (this.done) return;
    this.skipped = true;
    this.done = true;
  }

  // returns audio cues the engine fires on the exact frames
  update(): { gong: boolean; triumph: boolean; thud: boolean; tick: boolean } {
    const cue = { gong: false, triumph: false, thud: false, tick: false };
    if (this.done) return cue;
    this.actT++;
    this.totalT++;
    if (this.act === 2) {
      if (this.actT === 14) cue.gong = true; // half-beat of silence, then GONG
      if (this.actT >= ACT2_LEN) {
        this.act = 3;
        this.actT = 0;
        cue.triumph = true; // fanfare kicks the bullrun
      }
    } else if (this.act === 3) {
      // pumping ticker blips while the score climbs
      const p = Math.min(1, this.actT / 96);
      if (p < 1 && this.actT - this.tickerBlip >= 4) {
        this.tickerBlip = this.actT;
        cue.tick = true;
      }
      for (const cd of this.candles) {
        if (cd.mega && !cd.burst && this.actT > cd.delay + 62) {
          cd.burst = true;
          for (let i = 0; i < 12; i++) {
            this.sparks.push({ x: cd.x + cd.w / 2, y: VH - 30 - cd.body, vy: -(1 + (i % 4) * 0.7), t: 26 + (i % 3) * 6, seed: i * 61 });
          }
        }
      }
      for (const s of this.sparks) {
        s.x += ((s.seed % 7) - 3) * 0.45;
        s.y += s.vy;
        s.vy += 0.06;
        s.t--;
      }
      this.sparks = this.sparks.filter((s) => s.t > 0);
      if (this.actT >= ACT3_LEN) {
        this.act = 4;
        this.actT = 0;
      }
    } else if (this.act === 4) {
      if (this.actT === 56) cue.thud = true; // rank reveal THUD
      if (this.actT >= ACT4_LEN) this.done = true;
    } else {
      // ACT 1: rising green particles while the wallet signs
      if ((this.totalT & 3) === 0 && this.parts.length < 46) {
        this.parts.push({ x: (this.totalT * 53) % VW, y: VH + 4, vy: -(0.7 + ((this.totalT * 29) % 10) / 14), t: 200, seed: this.totalT });
      }
      for (const p of this.parts) {
        p.y += p.vy;
        p.x += ((p.seed % 5) - 2) * 0.12;
        p.t--;
      }
      this.parts = this.parts.filter((p) => p.t > 0 && p.y > -6);
    }
    return cue;
  }

  get candleCount(): number {
    if (this.act < 3) return 0;
    let n = 0;
    for (const cd of this.candles) if (this.actT > cd.delay) n++;
    return n;
  }

  get info(): { act: number; actT: number; flash: string; candles: number; block: number; rank: number | null; done: boolean; skipped: boolean } {
    return { act: this.act, actT: this.actT, flash: FLASH_COLOR, candles: this.candleCount, block: this.block, rank: this.rank, done: this.done, skipped: this.skipped };
  }

  // ================================================================ DRAW
  // frames = skin-aware sprite frames (engine passes pframes ?? frames)
  draw(ctx: CanvasRenderingContext2D, frames: Map<string, HTMLImageElement>): void {
    ctx.fillStyle = '#070a14';
    ctx.fillRect(0, 0, VW, VH);
    mosaicBorder(ctx);
    switch (this.act) {
      case 1: this.drawSigning(ctx, frames); break;
      case 2: this.drawConfirmed(ctx, frames); break;
      case 3: this.drawBullrun(ctx, frames); break;
      case 4: this.drawReveal(ctx, frames); break;
    }
    if (this.act >= 2 && (this.totalT & 32) !== 0) {
      drawText(ctx, 'TAP TO SKIP', VW - 8, VH - 10, 1, '#5a5f6c', 'right');
    }
  }

  private gonna(ctx: CanvasRenderingContext2D, frames: Map<string, HTMLImageElement>, key: string, x: number, feetY: number, scale = 2): void {
    const img = frames.get(key) ?? frames.get('0_0');
    if (!img) return;
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, Math.round(x - dw / 2), Math.round(feetY - dh), Math.round(dw), Math.round(dh));
  }

  // ---- ACT 1: SIGNING ----
  private drawSigning(ctx: CanvasRenderingContext2D, frames: Map<string, HTMLImageElement>): void {
    for (const p of this.parts) {
      ctx.fillStyle = (p.seed & 1) ? FLASH_COLOR : '#1e8c0a';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
    // breathing gonna (idle bob)
    const bob = Math.round(Math.sin(this.actT / 14) * 2);
    this.gonna(ctx, frames, '0_0', VW / 2, 168 + bob, 2);
    drawTextSh(ctx, 'SIGN IN YOUR WALLET...', VW / 2, 40, 1, (this.actT & 16) !== 0 ? FLASH_COLOR : '#1e8c0a', 'center');
    drawTextSh(ctx, 'SEALING YOUR RUN ON-CHAIN', VW / 2, 58, 1, '#8a8f9c', 'center');
  }

  // ---- ACT 2: CONFIRMED ----
  private drawConfirmed(ctx: CanvasRenderingContext2D, frames: Map<string, HTMLImageElement>): void {
    // freeze frame: the gonna mid-pose, dead still, half-beat of silence
    this.gonna(ctx, frames, '2_0', VW / 2, 168, 2);
    if (this.actT >= 12) {
      // FULL-SCREEN FLUO GREEN FLASH (NOT white), fading over ~14 frames
      const f = Math.max(0, 1 - (this.actT - 12) / 14);
      ctx.globalAlpha = Math.min(1, f * 1.15);
      ctx.fillStyle = FLASH_COLOR;
      ctx.fillRect(0, 0, VW, VH);
      ctx.globalAlpha = 1;
    }
    if (this.actT >= 16) {
      // block number stamps on screen (scale pop on entry)
      const pop = this.actT < 20 ? 2 : 1;
      drawTextSh(ctx, 'CONFIRMED', VW / 2, 44, pop + 1, FLASH_COLOR, 'center', '#0a3d00');
      if (this.block > 0) drawTextSh(ctx, 'BLOCK #' + this.block, VW / 2, 66, 1, '#c8ccd4', 'center');
    }
  }

  // ---- ACT 3: BULLRUN ----
  private drawBullrun(ctx: CanvasRenderingContext2D, frames: Map<string, HTMLImageElement>): void {
    drawCandles(ctx, this.candles, this.actT, false);
    // floating pixel labels
    const labels: [string, number, number][] = [
      ['+69%', 40, 26],
      ['+420%', VW - 96, 44],
      ['$GONNA TO THE MOON', VW / 2 - 60, 62],
    ];
    for (let i = 0; i < labels.length; i++) {
      const lt = this.actT - labels[i][2];
      if (lt > 0 && lt < 70) {
        const y = 150 - lt * 1.4;
        ctx.globalAlpha = Math.min(1, (70 - lt) / 24);
        drawText(ctx, labels[i][0], labels[i][1], Math.round(y), 1, FLASH_COLOR);
        ctx.globalAlpha = 1;
      }
    }
    // mega-candle sparks
    for (const s of this.sparks) {
      ctx.fillStyle = (s.seed & 1) ? FLASH_COLOR : '#b6ff9e';
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 2, 2);
    }
    // the pumping price ticker: score counts up from 0 to the final gold score
    const p = Math.min(1, this.actT / 96);
    const ease = 1 - Math.pow(1 - p, 3);
    const shown = Math.floor(this.rec.score * ease);
    drawTextSh(ctx, fmtScore(shown), VW / 2, 22, 2, p >= 1 ? '#f5c542' : FLASH_COLOR, 'center', p >= 1 ? '#b8860b' : '#0a3d00');
    // victory pose (jump frame, fist up)
    const gy = 196;
    this.gonna(ctx, frames, '2_0', VW / 2, gy, 2);
    // BYZANTINE CLEAR: gold crown falls with a pixel bounce onto the head
    if (this.byzantine) {
      const ct = this.actT - 58;
      if (ct >= 0) {
        const headY = gy - 62;
        let cy: number;
        if (ct < 26) cy = -12 + (headY + 12) * (ct / 26); // fall
        else if (ct < 34) cy = headY - (34 - ct) * 1.4; // bounce up
        else if (ct < 40) cy = headY - 11 + (ct - 34) * 1.8; // settle
        else cy = headY;
        drawCrown(ctx, Math.round(VW / 2 - 5), Math.round(cy));
      }
    }
  }

  // ---- ACT 4: REVEAL ----
  private drawReveal(ctx: CanvasRenderingContext2D, frames: Map<string, HTMLImageElement>): void {
    drawCandles(ctx, this.candles, ACT3_LEN, true); // gentle background
    // IMMORTALIZED ON-CHAIN types letter by letter
    const line = 'IMMORTALIZED ON-CHAIN';
    const n = Math.min(line.length, Math.floor(this.actT / 2));
    drawTextSh(ctx, line.slice(0, n), VW / 2, 40, 2, '#f2f2f2', 'center');
    // rank reveal with THUD (or SEALED FOREVER when the rank is unknown)
    if (this.actT >= 56) {
      const pop = this.actT < 62 ? 3 : 2;
      if (this.rank !== null) {
        drawTextSh(ctx, '#' + this.rank + ' IN THE GONNAVERSE', VW / 2, 74, pop, FLASH_COLOR, 'center', '#0a3d00');
      } else {
        drawTextSh(ctx, 'SEALED FOREVER', VW / 2, 76, pop, FLASH_COLOR, 'center', '#0a3d00');
      }
    }
    // the share card slides in like a polaroid
    if (this.actT >= 66) {
      const slide = Math.min(1, (this.actT - 66) / 22);
      const cw = 132;
      const ch = 88;
      const cx = Math.round(VW + (VW / 2 - cw / 2 - VW) * easeOut(slide));
      const cy = 108;
      ctx.fillStyle = '#e8e4d8';
      ctx.fillRect(cx - 4, cy - 4, cw + 8, ch + 14);
      ctx.fillStyle = '#070a14';
      ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeStyle = FLASH_COLOR;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
      this.gonna(ctx, frames, '0_0', cx + 26, cy + ch - 8, 1);
      drawText(ctx, fmtScore(this.rec.score), cx + 48, cy + 12, 1, '#f5c542');
      if (this.rank !== null) drawText(ctx, '#' + this.rank + ' IN THE GONNAVERSE', cx + 48, cy + 26, 1, FLASH_COLOR);
      if (this.byzantine) drawCrown(ctx, cx + 48, cy + 40);
    }
  }
}

function easeOut(p: number): number {
  return 1 - Math.pow(1 - p, 2);
}

// bullrun candlesticks — bodies + wicks, rising from the bottom with
// acceleration. gentle=true: fully risen, soft sway (SEALED screen / ACT4 bg)
export function drawCandles(ctx: CanvasRenderingContext2D, candles: Candle[], t: number, gentle: boolean): void {
  for (const cd of candles) {
    const rise = gentle ? 1 : Math.max(0, Math.min(1.12, ((t - cd.delay) / 46) * cd.speed));
    if (rise <= 0) continue;
    const h = Math.round(cd.body * easeOut(Math.min(1, rise)));
    const sway = gentle ? Math.round(Math.sin((t + cd.x) / 40) * 1.5) : 0;
    const top = VH - 24 - h + sway;
    // wick
    ctx.fillStyle = '#1e8c0a';
    ctx.fillRect(cd.x + Math.floor(cd.w / 2), top - 7, 1, h + 12);
    // body (fluo green bull candle)
    ctx.fillStyle = FLASH_COLOR;
    ctx.fillRect(cd.x, top, cd.w, h);
    ctx.fillStyle = '#1e8c0a';
    ctx.fillRect(cd.x, top + h - 3, cd.w, 3);
    ctx.fillRect(cd.x, top, cd.w, 1);
  }
}

// the sealed-screen background: candles keep rising gently
const BG_CANDLES: Candle[] = (() => {
  const out: Candle[] = [];
  const n = 15;
  const cw = 16;
  const gap = 9;
  const x0 = Math.floor((VW - (n * cw + (n - 1) * gap)) / 2);
  for (let i = 0; i < n; i++) {
    out.push({ x: x0 + i * (cw + gap), w: cw, body: 20 + i * 5 + ((i * 37) % 9), delay: 0, speed: 1, mega: false, burst: false });
  }
  return out;
})();
export function drawSealedBg(ctx: CanvasRenderingContext2D, t: number): void {
  ctx.fillStyle = '#070a14';
  ctx.fillRect(0, 0, VW, VH);
  ctx.globalAlpha = 0.5;
  drawCandles(ctx, BG_CANDLES, t, true);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(7,10,20,0.45)';
  ctx.fillRect(0, 0, VW, VH);
  mosaicBorder(ctx);
}
