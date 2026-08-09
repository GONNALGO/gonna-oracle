// Full-screen scenes: title, stage intro, stage clear tally, game over, continue, victory.
import { drawText, drawTextSh, textWidth } from './font';
import { VH, VW } from './types';
import type { Art } from './sprites';
import { fmtScore } from './board';
import { drawCheck, drawIconTG, drawIconX, shareCheckRect, shareIconRect } from './shareicons';
import { SHARE_GUIDE } from './share';
import { drawSealedBg } from './sealanim';

const FLUO = '#39FF14'; // v9.2 bullrun green

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
// v9.1: L BOARD button (GLOBAL LEADERBOARD) on the left; the FIGHTER label
// shifts right to stay clear of it.
export const TITLE_FIGHTER_BTN = { x: VW - 96, y: 150, w: 88, h: 18 };
export const TITLE_CONNECT_BTN = { x: VW - 192, y: 150, w: 88, h: 18 };
export const TITLE_BOARD_BTN = { x: 8, y: 150, w: 56, h: 18 };
export const TITLE_FIGHTER_LABEL_X = 72;
export const TITLE_MASCOTS = [
  { x: 56, y: 58, w: 24, h: 20 },
  { x: VW - 80, y: 58, w: 24, h: 20 },
];
// CI/no-overlap assertion helper: exact bbox of the "FIGHTER: <name>" label
export function titleFighterLabelRect(name: string): { x: number; y: number; w: number; h: number } | null {
  if (!name) return null;
  return { x: TITLE_FIGHTER_LABEL_X, y: 156, w: textWidth('FIGHTER: ' + name, 1), h: 7 };
}

function drawTitleBtn(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }, label: string, t: number, color = '#f5c542', crown = false): void {
  ctx.fillStyle = '#0d1118';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = (t & 16) !== 0 ? '#f5c542' : '#b8860b';
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  if (crown) {
    // v9.2.1: small pixel crown before the touch ARENA label (fits cleanly:
    // 11px crown + gap + 29px ARENA < 56px button)
    drawCrown(ctx, b.x + 4, b.y + 6);
    drawText(ctx, label, b.x + b.w / 2 + 7, b.y + 6, 1, color, 'center');
  } else {
    drawText(ctx, label, b.x + b.w / 2, b.y + 6, 1, color, 'center');
  }
}

export function drawTitle(
  ctx: CanvasRenderingContext2D,
  t: number,
  art: Art,
  fighterName = '',
  touch = false,
  connectLabel = '',
  connectColor = '#f5c542',
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
    drawText(ctx, 'FIGHTER: ' + fighterName, TITLE_FIGHTER_LABEL_X, 156, 1, '#f5c542');
  }
  // v9.2.2: ARENA (+ pixel crown) on BOTH desktop and touch — same name
  // everywhere (user explicit); desktop keeps the L key (hint in the controls)
  drawTitleBtn(ctx, TITLE_BOARD_BTN, 'ARENA', t, '#7fd858', true);
  drawTitleBtn(ctx, TITLE_CONNECT_BTN, connectLabel || (touch ? 'CONNECT' : 'C CONNECT'), t, connectColor);
  drawTitleBtn(ctx, TITLE_FIGHTER_BTN, touch ? 'FIGHTER' : 'T FIGHTER', t);
  // controls
  drawText(ctx, 'ARROWS/WASD MOVE  SPACE JUMP  C SPECIAL', VW / 2, 172, 1, '#8a8f9c', 'center');
  drawText(ctx, touch ? 'Z PUNCH  X KICK  P PAUSE  M MUTE' : 'Z PUNCH  X KICK  P PAUSE  M MUTE  L ARENA', VW / 2, 184, 1, '#8a8f9c', 'center');
  // lizard mascots (flanking the logo, clear of every label/button below)
  const m = TITLE_MASCOTS;
  ctx.drawImage(art.lizIcon, m[0].x, m[0].y, m[0].w, m[0].h);
  ctx.save();
  ctx.translate(m[1].x + m[1].w, m[1].y); // mirrored: image lands inside the declared rect
  ctx.scale(-1, 1);
  ctx.drawImage(art.lizIcon, 0, 0, m[1].w, m[1].h);
  ctx.restore();
  drawText(ctx, 'V9.3.7 THE MINTING', VW - textWidth('V9.3.7 THE MINTING', 1) - 8, VH - 14, 1, '#5a5f6c');
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

// v9.1: continues are infinite — the run simply counts them (BYZANTINE CLEAR
// = win with 0 continues, crowned on the leaderboard)
// v9.2: the countdown is INTERACTIVE — 3-way choice DURING the countdown:
// [FIGHT ON] (ENTER / green button) / [SEAL MY RECORD] (S / gold button) /
// walk away (ESC or let it expire -> the save screen)
export const CONTINUE_FIGHT_BTN = { x: 62, y: 168, w: 120, h: 18 };
export const CONTINUE_SEAL_BTN = { x: 202, y: 168, w: 120, h: 18 };
export function drawContinue(ctx: CanvasRenderingContext2D, count: number, t: number, continuesUsed = 0, touch = false): void {
  ctx.fillStyle = 'rgba(5,6,10,0.88)';
  ctx.fillRect(0, 0, VW, VH);
  mosaicBorder(ctx);
  drawTextSh(ctx, 'CONTINUE?', VW / 2, 56, 3, '#ffffff', 'center');
  drawTextSh(ctx, String(count), VW / 2, 88, 5, count <= 3 ? '#e23b3b' : '#f5c542', 'center');
  drawText(ctx, 'CONTINUES USED: ' + continuesUsed, VW / 2, 128, 1, '#8a8f9c', 'center');
  // FIGHT ON (green)
  const f = CONTINUE_FIGHT_BTN;
  ctx.fillStyle = '#0f2408';
  ctx.fillRect(f.x, f.y, f.w, f.h);
  ctx.strokeStyle = (t & 16) !== 0 ? '#7fd858' : '#3fae4a';
  ctx.lineWidth = 1;
  ctx.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1);
  drawTextSh(ctx, 'FIGHT ON', f.x + f.w / 2, f.y + 5, 1, '#7fd858', 'center');
  // SEAL MY RECORD (gold)
  const s = CONTINUE_SEAL_BTN;
  ctx.fillStyle = '#14100a';
  ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.strokeStyle = (t & 16) !== 0 ? '#f5c542' : '#b8860b';
  ctx.lineWidth = 1;
  ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
  drawTextSh(ctx, 'SEAL MY RECORD', s.x + s.w / 2, s.y + 5, 1, '#f5c542', 'center');
  if (!touch) {
    if ((t & 16) !== 0) drawText(ctx, 'ENTER FIGHT ON - S SEAL', VW / 2, 196, 1, '#7fd858', 'center');
    drawText(ctx, 'ESC WALK AWAY', VW / 2, 208, 1, '#5a5f6c', 'center');
  }
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

// v9.1: 👑-style pixel crown for BYZANTINE CLEAR runs (win + 0 continues)
export function drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#f5c542';
  ctx.fillRect(x, y + 4, 11, 2);
  ctx.fillRect(x, y + 1, 2, 3);
  ctx.fillRect(x + 4, y, 3, 4);
  ctx.fillRect(x + 9, y + 1, 2, 3);
  ctx.fillStyle = '#b8860b';
  ctx.fillRect(x + 1, y + 5, 9, 1);
}

// ---------- v9.1 SAVE RECORD (SEAL) ----------
export interface SaveButton {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  icon?: 'x' | 'tg' | null; // v9.2 viral share pixel icon
  posted?: boolean; // v9.2 POSTED! state: drawn pixel checkmark + fluo text (still tappable to re-post)
}
export interface SaveView {
  score: number;
  stage: number; // 1-6
  win: 0 | 1;
  continues: number;
  fighterName: string;
  skinLabel: string;
  skinAccent: string;
  phase: 'edit' | 'busy' | 'done' | 'pending' | 'error';
  err: string;
  txid: string;
  msgLen: number;
  buttons: SaveButton[];
  focus: number;
  touch: boolean;
  rank: number | null; // v9.2: "#N IN THE GONNAVERSE" on the SEALED screen
}
// the DOM message input overlays this exact rect (engine keeps it in sync)
export const SAVE_MSG_RECT = { x: 62, y: 108, w: 260, h: 20 };

export function drawSaveRecord(ctx: CanvasRenderingContext2D, t: number, v: SaveView): void {
  // v9.2: SEALED phases get the bullrun background (gentle rising candles)
  if (v.phase === 'done' || v.phase === 'pending') {
    drawSealedBg(ctx, t);
  } else {
    ctx.fillStyle = '#070a14';
    ctx.fillRect(0, 0, VW, VH);
    for (let i = 0; i < 28; i++) {
      const sx = (i * 137 + ((t >> 3) * (1 + (i & 3)))) % VW;
      const sy = (i * 71) % VH;
      ctx.fillStyle = (i & 1) ? '#101a30' : '#14202a';
      ctx.fillRect(sx, sy, 1, 1);
    }
    mosaicBorder(ctx);
  }
  const byzantine = v.win === 1 && v.continues === 0;

  // ==================== v9.2: SEALED screen (after THE SEAL MOMENT) ==========
  if (v.phase === 'done' || v.phase === 'pending') {
    // v9.2.3 layout: compact header, NOTHING covers the bullrun art — VIEW
    // CARD opens the fullscreen viewer on demand, then the share button rows.
    if (byzantine) drawCrown(ctx, VW / 2 - 78, 12);
    drawTextSh(ctx, 'SEALED!', VW / 2 + (byzantine ? 8 : 0), 6, 3, FLUO, 'center', '#0a3d00');
    if (v.phase === 'pending') {
      drawText(ctx, 'CONFIRM PENDING - IT WILL LAND', VW / 2, 32, 1, '#f5c542', 'center');
    } else if (v.rank !== null) {
      drawTextSh(ctx, '#' + v.rank + ' IN THE GONNAVERSE', VW / 2, 32, 1, FLUO, 'center', '#0a3d00');
    } else {
      drawText(ctx, 'SEALED FOREVER', VW / 2, 32, 1, '#c8ccd4', 'center');
    }
    drawText(ctx, fmtScore(v.score), 30, 42, 1, '#f5c542');
    drawText(ctx, 'TX ' + v.txid.slice(0, 20) + '...', VW - 30, 42, 1, '#8a8f9c', 'right');
    // v9.2.3: the art stays clean — the 2-step pixel guide sits between the
    // VIEW CARD button (step 1, y=72) and the X/TG share row (step 2, y=152)
    drawTextSh(ctx, SHARE_GUIDE, VW / 2, 112, 1, FLUO, 'center', '#0a3d00');
    for (let i = 0; i < v.buttons.length; i++) {
      const b = v.buttons[i];
      const lit = i === v.focus;
      const share = b.icon === 'x' || b.icon === 'tg';
      const posted = b.posted === true;
      ctx.fillStyle = posted ? '#0f2408' : lit ? '#142a10' : '#0d1118';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = lit ? '#f5c542' : share ? ((t & 16) !== 0 ? FLUO : '#1e8c0a') : '#3a3f4c';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      let tx = b.x + b.w / 2;
      // v9.2.2: big 18px official icon, solid FLUO + subtle glow, LEFT side
      if (b.icon === 'x') {
        const r = shareIconRect(b);
        drawIconX(ctx, r.x, r.y, 1, FLUO, true);
        tx += 11;
      } else if (b.icon === 'tg') {
        const r = shareIconRect(b);
        drawIconTG(ctx, r.x, r.y, 1, FLUO, true);
        tx += 11;
      }
      drawText(ctx, posted ? 'POSTED!' : b.label, tx, b.y + Math.floor((b.h - 7) / 2), 1, posted ? FLUO : lit ? '#f5c542' : share ? '#e8ecf4' : '#c8ccd4', 'center');
      // v9.2.2: the DRAWN pixel checkmark hugs the RIGHT edge — the icon stays clean
      if (posted) {
        const r = shareCheckRect(b);
        drawCheck(ctx, r.x, r.y, 1, FLUO);
      }
    }
    if (!v.touch && (t & 32) !== 0) drawText(ctx, 'ARROWS + ENTER - ESC DONE', VW / 2, VH - 8, 1, '#5a5f6c', 'center');
    return;
  }

  drawTextSh(ctx, 'SAVE RECORD', VW / 2, 10, 2, '#f5c542', 'center', '#b8860b');
  if (byzantine) {
    drawCrown(ctx, VW / 2 - 52, 30);
    drawText(ctx, 'BYZANTINE CLEAR!', VW / 2 - 36, 30, 1, '#f5c542');
  }

  // run stats
  const lx = 96;
  const rx = 288;
  drawText(ctx, 'SCORE', lx, 46, 1, '#8a8f9c');
  drawText(ctx, String(v.score).padStart(8, '0'), rx, 46, 1, '#f5c542', 'right');
  drawText(ctx, 'STAGE REACHED', lx, 58, 1, '#8a8f9c');
  drawText(ctx, v.stage + ' / 6', rx, 58, 1, '#f2f2f2', 'right');
  drawText(ctx, 'CONTINUES USED', lx, 70, 1, '#8a8f9c');
  drawText(ctx, String(v.continues), rx, 70, 1, v.continues === 0 ? '#7fd858' : '#f2f2f2', 'right');
  drawText(ctx, 'FIGHTER', lx, 82, 1, '#8a8f9c');
  drawText(ctx, v.fighterName, rx, 82, 1, v.skinAccent, 'right');

  // message input (DOM overlay sits on this exact box)
  drawText(ctx, 'MESSAGE (OPTIONAL)', SAVE_MSG_RECT.x, 98, 1, '#8a8f9c');
  drawText(ctx, v.msgLen + '/32', SAVE_MSG_RECT.x + SAVE_MSG_RECT.w, 98, 1, '#5a5f6c', 'right');
  ctx.fillStyle = '#0d1118';
  ctx.fillRect(SAVE_MSG_RECT.x, SAVE_MSG_RECT.y, SAVE_MSG_RECT.w, SAVE_MSG_RECT.h);
  ctx.strokeStyle = (t & 16) !== 0 ? '#f5c542' : '#b8860b';
  ctx.lineWidth = 1;
  ctx.strokeRect(SAVE_MSG_RECT.x + 0.5, SAVE_MSG_RECT.y + 0.5, SAVE_MSG_RECT.w - 1, SAVE_MSG_RECT.h - 1);
  drawText(ctx, 'ASCII ONLY - ON-CHAIN FOREVER', VW / 2, 134, 1, '#5a5f6c', 'center');

  // phase line
  if (v.phase === 'busy') {
    if ((t & 8) !== 0) drawTextSh(ctx, 'SEALING... SIGN IN YOUR WALLET', VW / 2, 148, 1, '#f5c542', 'center');
  } else if (v.phase === 'error') {
    drawTextSh(ctx, v.err || 'SEAL FAILED', VW / 2, 148, 1, '#e23b3b', 'center');
  }

  // buttons
  for (let i = 0; i < v.buttons.length; i++) {
    const b = v.buttons[i];
    const lit = i === v.focus;
    ctx.fillStyle = lit ? '#1a2a14' : '#0d1118';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = lit ? '#f5c542' : '#3a3f4c';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    drawTextSh(ctx, b.label, b.x + b.w / 2, b.y + Math.floor((b.h - 7) / 2), 1, lit ? '#f5c542' : '#c8ccd4', 'center');
    if (lit && (t & 16) !== 0) drawText(ctx, '>', b.x + 3, b.y + Math.floor((b.h - 7) / 2), 1, '#7fd858');
  }

  drawText(ctx, 'SEAL = 0-ALGO TX TO THE GONNA TREASURY', VW / 2, 200, 1, '#5a5f6c', 'center');
  if (!v.touch && (t & 32) !== 0) drawText(ctx, 'ENTER CONFIRM - ESC SKIP', VW / 2, VH - 10, 1, '#8a8f9c', 'center');
}
