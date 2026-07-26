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

// v9: FIGHTER mini-button rect on the title (tap hotspot, game coords)
// v9.0.1: CONNECT WALLET button next to it; mascots moved up into the logo glow
// so they can never sit on top of the FIGHTER label / button text (IMG_6420).
export const TITLE_FIGHTER_BTN = { x: VW - 96, y: 150, w: 88, h: 18 };
export const TITLE_CONNECT_BTN = { x: VW - 192, y: 150, w: 88, h: 18 };
export const TITLE_MASCOTS = [
  { x: 56, y: 58, w: 24, h: 20 },
  { x: VW - 80, y: 58, w: 24, h: 20 },
];
// CI/no-overlap assertion helper: exact bbox of the "FIGHTER: <name>" label
export function titleFighterLabelRect(name: string): { x: number; y: number; w: number; h: number } | null {
  if (!name) return null;
  return { x: 8, y: 156, w: textWidth('FIGHTER: ' + name, 1), h: 7 };
}

function drawTitleBtn(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }, label: string, t: number): void {
  ctx.fillStyle = '#0d1118';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = (t & 16) !== 0 ? '#f5c542' : '#b8860b';
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  drawText(ctx, label, b.x + b.w / 2, b.y + 6, 1, '#f5c542', 'center');
}

export function drawTitle(
  ctx: CanvasRenderingContext2D,
  t: number,
  art: Art,
  fighterName = '',
  touch = false,
  connectLabel = '',
): void {
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
    drawTextSh(ctx, 'INSERT COIN - PRESS ENTER', VW / 2, 140, 1, '#ffffff', 'center');
  }
  // v9: current fighter + CHOOSE YOUR FIGHTER entry (T / mini-button)
  // v9.0.1: CONNECT WALLET entry (C / mini-button); shows the short address once connected
  if (fighterName) {
    drawText(ctx, 'FIGHTER: ' + fighterName, 8, 156, 1, '#f5c542');
  }
  drawTitleBtn(ctx, TITLE_CONNECT_BTN, connectLabel || (touch ? 'CONNECT' : 'C CONNECT'), t);
  drawTitleBtn(ctx, TITLE_FIGHTER_BTN, touch ? 'FIGHTER' : 'T FIGHTER', t);
  // controls
  drawText(ctx, 'ARROWS/WASD MOVE  SPACE JUMP  C SPECIAL', VW / 2, 172, 1, '#8a8f9c', 'center');
  drawText(ctx, 'Z PUNCH  X KICK  P PAUSE  M MUTE', VW / 2, 184, 1, '#8a8f9c', 'center');
  // lizard mascots (flanking the logo, clear of every label/button below)
  const m = TITLE_MASCOTS;
  ctx.drawImage(art.lizIcon, m[0].x, m[0].y, m[0].w, m[0].h);
  ctx.save();
  ctx.translate(m[1].x + m[1].w, m[1].y); // mirrored: image lands inside the declared rect
  ctx.scale(-1, 1);
  ctx.drawImage(art.lizIcon, 0, 0, m[1].w, m[1].h);
  ctx.restore();
  drawText(ctx, 'V9.0 THE GATE', VW - textWidth('V9.0 THE GATE', 1) - 8, VH - 14, 1, '#5a5f6c');
  drawText(ctx, '(C) GONNA + THE BYZANTINES', 8, VH - 14, 1, '#5a5f6c');
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

export function drawVictory(ctx: CanvasRenderingContext2D, stats: FinalStats, t: number, final = false): void {
  ctx.fillStyle = '#070a14';
  ctx.fillRect(0, 0, VW, VH);
  mosaicBorder(ctx);
  if (final) {
    // FINAL VICTORY: rocket launch + credits
    ctx.fillStyle = '#0a0e1c';
    ctx.fillRect(0, 150, VW, 74);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = i % 3 ? '#c8d4f8' : '#7a8ac8';
      ctx.fillRect((i * 97) % VW, (i * 53) % 130, 1, 1);
    }
    // rocket climbs as t grows
    const ry = 168 - Math.min(150, Math.max(0, t - 20) * 1.1);
    const rx = VW / 2 - 90;
    ctx.fillStyle = '#e8e4d8';
    ctx.fillRect(rx, ry - 40, 16, 40);
    ctx.fillStyle = '#3fae4a';
    ctx.fillRect(rx + 2, ry - 52, 12, 12);
    ctx.fillStyle = '#101a30';
    ctx.fillRect(rx + 5, ry - 34, 6, 6);
    ctx.fillStyle = '#1e6b2a';
    ctx.fillRect(rx - 5, ry - 12, 6, 12);
    ctx.fillRect(rx + 15, ry - 12, 6, 12);
    // exhaust
    const fl = 8 + ((t >> 2) & 3) * 3;
    ctx.fillStyle = '#f5c542';
    ctx.fillRect(rx + 3, ry, 10, fl);
    ctx.fillStyle = '#ff8a3c';
    ctx.fillRect(rx + 5, ry, 6, fl + 5);
    drawTextSh(ctx, 'FUD ELIMINATED.', VW / 2, 26, 2, '#e23b3b', 'center');
    drawTextSh(ctx, 'TO THE MOON.', VW / 2, 46, 2, '#f5c542', 'center');
    const secs = Math.floor(stats.timeFrames / 60);
    const mm = Math.floor(secs / 60);
    const ss = String(secs % 60).padStart(2, '0');
    drawTextSh(ctx, 'SCORE ' + String(stats.score).padStart(8, '0'), VW / 2 + 60, 70, 1, '#f5c542', 'center');
    drawTextSh(ctx, 'TIME ' + mm + ':' + ss + '  REKT ' + stats.kos, VW / 2 + 60, 82, 1, '#c8ccd4', 'center');
    if (t > 90) {
      drawTextSh(ctx, 'GONNA FIGHT', VW / 2 + 60, 104, 2, '#7fd858', 'center');
      drawTextSh(ctx, 'GONNA + THE BYZANTINES', VW / 2 + 60, 124, 1, '#f5c542', 'center');
      drawTextSh(ctx, 'A GONNAVERSE PRODUCTION', VW / 2 + 60, 138, 1, '#8a8f9c', 'center');
      drawTextSh(ctx, 'STARRING GONNA AS HIMSELF', VW / 2 + 60, 152, 1, '#8a8f9c', 'center');
      drawTextSh(ctx, 'WHALE - DARK GONNA - SLOT GOLEM - FUD', VW / 2 + 60, 166, 1, '#8a8f9c', 'center');
      drawTextSh(ctx, 'THANK YOU FOR PLAYING', VW / 2 + 60, 184, 1, '#7fd858', 'center');
    }
    if (t > 200 && (t & 32) !== 0) drawTextSh(ctx, 'PRESS ENTER', VW / 2, 206, 1, '#ffffff', 'center');
    return;
  }
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
    drawTextSh(ctx, 'GONNA + THE BYZANTINES', VW / 2, 182, 1, '#8a8f9c', 'center');
  }
  if (t > 120 && (t & 32) !== 0) drawTextSh(ctx, 'PRESS ENTER', VW / 2, 202, 1, '#ffffff', 'center');
}

export function drawMarketCap(ctx: CanvasRenderingContext2D, t: number, line = 'MARKET CAP REACHED!'): void {
  if (t > 20 && (t & 8) !== 0) {
    drawTextSh(ctx, line, VW / 2, 60, 2, '#f5c542', 'center');
  }
}
