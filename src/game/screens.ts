// Full-screen scenes: title, stage intro, stage clear tally, game over, continue, victory.
import { drawText, drawTextSh, textWidth } from './font';
import { VH, VW } from './types';
import type { Art } from './sprites';

// Byzantine mosaic border
export function mosaicBorder(ctx: CanvasRenderingContext2D): void {
  for (let x = 0; x < VW; x += 8) {
    ctx.fillStyle = (x / 8) % 2 ? '#b8860b' : '#1e6b2a';
    ctx.fillRect(x, 0, 8, 4);
    ctx.fillRect(x, VH - 4, 8, 4);
  }
  for (let y = 0; y < VH; y += 8) {
    ctx.fillStyle = (y / 8) % 2 ? '#b8860b' : '#1e6b2a';
    ctx.fillRect(0, y, 4, 8);
    ctx.fillRect(VW - 4, y, 4, 8);
  }
}

export function drawTitle(ctx: CanvasRenderingContext2D, t: number, art: Art): void {
  ctx.fillStyle = '#070a14';
  ctx.fillRect(0, 0, VW, VH);
  // glow behind logo
  ctx.fillStyle = '#0d1a12';
  ctx.fillRect(40, 40, VW - 80, 78);
  mosaicBorder(ctx);
  drawTextSh(ctx, 'GONNA', VW / 2, 42, 6, '#7fd858', 'center', '#1e6b2a');
  drawTextSh(ctx, 'FIGHT', VW / 2, 84, 6, '#f5c542', 'center', '#b8860b');
  drawTextSh(ctx, 'A GONNAVERSE PRODUCTION', VW / 2, 128, 1, '#c8ccd4', 'center');
  if ((t & 32) !== 0) {
    drawTextSh(ctx, 'INSERT COIN - PRESS ENTER', VW / 2, 148, 1, '#ffffff', 'center');
  }
  // controls
  drawText(ctx, 'ARROWS/WASD MOVE', VW / 2, 168, 1, '#8a8f9c', 'center');
  drawText(ctx, 'Z PUNCH  X KICK  SPACE JUMP', VW / 2, 178, 1, '#8a8f9c', 'center');
  drawText(ctx, 'C SPECIAL (G-METER)  M MUTE', VW / 2, 188, 1, '#8a8f9c', 'center');
  // lizard mascots
  ctx.drawImage(art.lizIcon, 60, 140, 24, 20);
  ctx.save();
  ctx.translate(VW - 60, 140);
  ctx.scale(-1, 1);
  ctx.drawImage(art.lizIcon, 0, 0, 24, 20);
  ctx.restore();
  drawText(ctx, 'V2.0 BYZANTINE', VW - textWidth('V2.0 BYZANTINE', 1) - 8, VH - 14, 1, '#5a5f6c');
  drawText(ctx, '(C) GONNA & THE BYZANTINES', 8, VH - 14, 1, '#5a5f6c');
}

export function drawIntro(ctx: CanvasRenderingContext2D, name: string, sub: string, t: number): void {
  ctx.fillStyle = '#070a14';
  ctx.fillRect(0, 0, VW, VH);
  mosaicBorder(ctx);
  drawTextSh(ctx, name, VW / 2, 84, 3, '#ffffff', 'center');
  drawTextSh(ctx, sub, VW / 2, 112, 2, '#f5c542', 'center');
  if (t > 90 && (t & 8) !== 0) drawTextSh(ctx, 'GO!', VW / 2, 150, 3, '#7fd858', 'center');
}

export interface Tally {
  timeBonus: number;
  coinBonus: number;
  shown: boolean;
  count: number; // 0..1 progress
}

export function drawClear(ctx: CanvasRenderingContext2D, tally: Tally, score: number): void {
  ctx.fillStyle = 'rgba(5,6,10,0.82)';
  ctx.fillRect(0, 0, VW, VH);
  mosaicBorder(ctx);
  drawTextSh(ctx, 'STAGE CLEAR', VW / 2, 60, 3, '#7fd858', 'center');
  const tb = Math.floor(tally.timeBonus * tally.count);
  const cb = Math.floor(tally.coinBonus * tally.count);
  drawTextSh(ctx, 'TIME BONUS', 90, 108, 1, '#c8ccd4');
  drawTextSh(ctx, String(tb).padStart(6, '0'), 294, 108, 1, '#ffffff', 'right');
  drawTextSh(ctx, '$GONNA BONUS', 90, 122, 1, '#c8ccd4');
  drawTextSh(ctx, String(cb).padStart(6, '0'), 294, 122, 1, '#ffffff', 'right');
  drawTextSh(ctx, 'TOTAL SCORE', 90, 142, 1, '#f5c542');
  drawTextSh(ctx, String(score + tb + cb).padStart(8, '0'), 294, 142, 1, '#f5c542', 'right');
  if (tally.count >= 1) drawTextSh(ctx, 'PRESS ENTER', VW / 2, 170, 1, '#ffffff', 'center');
}

export function drawGameOver(ctx: CanvasRenderingContext2D, t: number): void {
  ctx.fillStyle = 'rgba(10,4,4,' + Math.min(0.85, t / 60) + ')';
  ctx.fillRect(0, 0, VW, VH);
  if (t > 30) drawTextSh(ctx, 'GAME OVER', VW / 2, 100, 4, '#e23b3b', 'center');
}

export function drawContinue(ctx: CanvasRenderingContext2D, count: number, t: number): void {
  ctx.fillStyle = 'rgba(5,6,10,0.88)';
  ctx.fillRect(0, 0, VW, VH);
  mosaicBorder(ctx);
  drawTextSh(ctx, 'CONTINUE?', VW / 2, 70, 3, '#ffffff', 'center');
  drawTextSh(ctx, String(count), VW / 2, 104, 5, count <= 3 ? '#e23b3b' : '#f5c542', 'center');
  if ((t & 16) !== 0) drawTextSh(ctx, 'PRESS ENTER', VW / 2, 160, 1, '#7fd858', 'center');
}

export interface FinalStats {
  score: number;
  timeFrames: number;
  kos: number;
}

export function drawVictory(ctx: CanvasRenderingContext2D, stats: FinalStats, t: number): void {
  ctx.fillStyle = '#070a14';
  ctx.fillRect(0, 0, VW, VH);
  mosaicBorder(ctx);
  // golden rays
  ctx.fillStyle = '#14100a';
  for (let i = 0; i < 8; i++) ctx.fillRect(0, 30 + i * 22, VW, 8);
  drawTextSh(ctx, 'MARKET CAP REACHED!', VW / 2, 34, 2, '#f5c542', 'center');
  drawTextSh(ctx, 'THE GONNAVERSE IS SAFE.', VW / 2, 64, 1, '#ffffff', 'center');
  drawTextSh(ctx, 'SILVIO APPROVES.', VW / 2, 76, 1, '#7fd858', 'center');
  const secs = Math.floor(stats.timeFrames / 60);
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');
  drawTextSh(ctx, 'FINAL SCORE', 100, 106, 1, '#c8ccd4');
  drawTextSh(ctx, String(stats.score).padStart(8, '0'), 284, 106, 1, '#f5c542', 'right');
  drawTextSh(ctx, 'TOTAL TIME', 100, 120, 1, '#c8ccd4');
  drawTextSh(ctx, mm + ':' + ss, 284, 120, 1, '#ffffff', 'right');
  drawTextSh(ctx, 'ENEMIES REKT', 100, 134, 1, '#c8ccd4');
  drawTextSh(ctx, String(stats.kos), 284, 134, 1, '#ffffff', 'right');
  if (t > 60) {
    drawTextSh(ctx, 'GONNA FIGHT', VW / 2, 160, 2, '#7fd858', 'center');
    drawTextSh(ctx, 'GONNA & THE BYZANTINES', VW / 2, 182, 1, '#8a8f9c', 'center');
  }
  if (t > 120 && (t & 32) !== 0) drawTextSh(ctx, 'PRESS ENTER', VW / 2, 202, 1, '#ffffff', 'center');
}

export function drawMarketCap(ctx: CanvasRenderingContext2D, t: number): void {
  if (t > 20 && (t & 8) !== 0) {
    drawTextSh(ctx, 'MARKET CAP REACHED!', VW / 2, 60, 2, '#f5c542', 'center');
  }
}
