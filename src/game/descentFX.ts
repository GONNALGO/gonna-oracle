// v15: THE DESCENT — presentation layer. Bonus icons (pure pixel art, no
// external assets), wave slam-in / boss WARNING banners, bonus auras, the
// BREATHE beat, MULT popups, near-death pulse and the bullet-time grade.
// PALETTE LAW: dark warm base, gold hierarchy, red/amber/cyan accents,
// NEVER a white flash frame.
import { drawText, drawTextSh, textWidth } from './font';
import { VH, VW } from './types';
import type { GameCtx } from './ctx';
import type { BonusKind, DescentState } from './descent';
import { scoreMult, waveClearBonus } from './descent';

const GOLD = '#f5c542';
const GOLD_D = '#b8860b';
const GREEN = '#39FF14';
const GREEN_D = '#3fae4a';
const AMBER = '#ffae2a';
const RED = '#e23b3b';
const RED_D = '#7a1620';
const CYAN = '#3ce8e0';
const DIM = '#8a8f9c';

// ---------- tiny pixel-art bonus icons (12x12, cached) ----------
const iconCache = new Map<BonusKind, HTMLCanvasElement>();

function mkIcon(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = 12;
  c.height = 12;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  return [c, x];
}

export function bonusIcon(kind: BonusKind): HTMLCanvasElement {
  const hit = iconCache.get(kind);
  if (hit) return hit;
  const [c, x] = mkIcon();
  const R = (px: number, py: number, w: number, h: number, col: string) => {
    x.fillStyle = col;
    x.fillRect(px, py, w, h);
  };
  if (kind === 'bonusA') {
    // THE A — Algorand glyph, cyan on dark
    R(1, 1, 10, 10, '#062a28');
    R(4, 2, 3, 2, CYAN);
    R(3, 4, 2, 5, CYAN);
    R(6, 4, 2, 5, CYAN);
    R(3, 6, 5, 1, CYAN); // crossbar
    R(2, 8, 8, 1, CYAN); // slash
  } else if (kind === 'candle') {
    // GREEN CANDLE — bullish stick with wick
    R(5, 0, 2, 2, GREEN_D); // wick top
    R(3, 2, 6, 7, GREEN); // body
    R(4, 3, 4, 1, '#0a3d08'); // shade
    R(5, 9, 2, 2, GREEN_D); // wick bottom
    R(2, 11, 8, 1, GOLD_D); // base
  } else if (kind === 'forge') {
    // COMBO FORGE — amber flame over anvil
    R(4, 1, 3, 2, AMBER);
    R(3, 3, 5, 3, '#ff8a3c');
    R(4, 4, 2, 2, GOLD); // hot core
    R(2, 7, 8, 2, '#5a5f6c'); // anvil top
    R(4, 9, 4, 2, '#3a3f4c'); // anvil body
  } else {
    // BULLET TIME — hourglass, cyan/amber
    R(2, 1, 8, 1, CYAN);
    R(3, 2, 6, 2, '#0e2a33');
    R(4, 4, 4, 1, CYAN);
    R(5, 5, 2, 2, AMBER); // falling sand
    R(3, 7, 6, 3, '#0e2a33');
    R(4, 8, 4, 1, AMBER);
    R(2, 10, 8, 1, CYAN);
  }
  iconCache.set(kind, c);
  return c;
}

export function drawBonusIcon(ctx: CanvasRenderingContext2D, kind: BonusKind, sx: number, sy: number): void {
  const img = bonusIcon(kind);
  ctx.drawImage(img, Math.round(sx - 6), Math.round(sy - 12));
}

// ---------- wave banners ----------
// SLAM-IN: scale 3.2 -> overshoot 1.18 -> settle 1.0, hold ~1s, wipe up.
export function drawWaveSlam(ctx: CanvasRenderingContext2D, d: DescentState): void {
  if (d.phase === 'announce') {
    const t = d.phaseT;
    const label = 'WAVE ' + String(d.wave).padStart(2, '0');
    let scale = 3.2;
    if (t >= 3) scale = 2.4;
    if (t >= 5) scale = 1.18; // single-frame-ish overshoot
    if (t >= 8) scale = 1.0;
    let y = 92;
    let alpha = 1;
    if (t > 66) {
      // wipe out: slide up + fade, no flash
      const k = (t - 66) / 24;
      y = 92 - k * 60;
      alpha = Math.max(0, 1 - k);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    const s = 4 * scale;
    const w = textWidth(label, s);
    // dark plaque
    ctx.fillStyle = 'rgba(7,8,14,0.82)';
    ctx.fillRect(VW / 2 - w / 2 - 14, y - 8, w + 28, 7 * s + 16);
    ctx.strokeStyle = GOLD_D;
    ctx.lineWidth = 1;
    ctx.strokeRect(VW / 2 - w / 2 - 13.5, y - 7.5, w + 27, 7 * s + 15);
    drawTextSh(ctx, label, VW / 2, y, s, GOLD, 'center');
    ctx.restore();
    return;
  }
  if (d.phase === 'clear' && d.clearWave > 0) {
    // WAVE CLEARED +bonus (gold, quick)
    const t = d.phaseT;
    const alpha = t < 70 ? 1 : Math.max(0, 1 - (t - 70) / 20);
    const label = 'WAVE ' + String(d.clearWave).padStart(2, '0') + ' CLEARED';
    const bonus = '+' + d.clearBonus;
    ctx.save();
    ctx.globalAlpha = alpha;
    // dark plaque — the clear readout must stay readable over bright billboards
    const w = textWidth(label, 2);
    ctx.fillStyle = 'rgba(7,8,14,0.78)';
    ctx.fillRect(VW / 2 - w / 2 - 10, 68, w + 20, d.target > 0 ? 56 : 40);
    drawTextSh(ctx, label, VW / 2, 78, 2, GOLD, 'center');
    drawTextSh(ctx, bonus, VW / 2, 96, 2, GREEN, 'center');
    // the race readout (arena): distance to target right after the clear
    if (d.target > 0) {
      const race = 'TARGET ' + d.target + ' - YOU ' + d.clearScore;
      drawText(ctx, race, VW / 2, 114, 1, d.clearScore >= d.target ? GREEN : AMBER, 'center');
    }
    ctx.restore();
    return;
  }
  if (d.phase === 'breathe') {
    // 5s of calm after a boss kill — pressure drop
    ctx.save();
    ctx.globalAlpha = Math.min(0.8, d.phaseT / 30);
    drawText(ctx, 'BREATHE.', VW / 2, 60, 1, DIM, 'center');
    ctx.restore();
  }
}

// boss WARNING: hazard banding + name. Runs during the 'boss' phase opening
// while the boss walks in (intro state). Red/amber only — no white.
export function drawBossWarning(ctx: CanvasRenderingContext2D, d: DescentState, bossName: string, frame: number): void {
  const t = d.phaseT;
  if (t > 150) return;
  const pulse = (frame & 8) !== 0;
  const band = pulse ? RED : AMBER;
  // striped hazard bands, top + bottom
  for (let sx = -16; sx < VW + 16; sx += 16) {
    const off = ((frame >> 1) % 16 + sx) % (VW + 32) - 16;
    ctx.fillStyle = (Math.floor(off / 16) & 1) === 0 ? band : '#14060a';
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(off, 30);
    ctx.lineTo(off + 8, 30);
    ctx.lineTo(off + 4, 42);
    ctx.lineTo(off - 4, 42);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(off, VH - 30);
    ctx.lineTo(off + 8, VH - 30);
    ctx.lineTo(off + 4, VH - 42);
    ctx.lineTo(off - 4, VH - 42);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const alpha = t > 128 ? Math.max(0, 1 - (t - 128) / 22) : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  drawTextSh(ctx, 'WARNING', VW / 2, 62, 3, pulse ? RED : AMBER, 'center');
  drawTextSh(ctx, bossName, VW / 2, 96, 2, GOLD, 'center');
  drawTextSh(ctx, 'APPROACHES', VW / 2, 116, 2, pulse ? AMBER : RED, 'center');
  ctx.restore();
}

// ---------- center popups: MULT up / MULT lost ----------
export function drawMultJuice(ctx: CanvasRenderingContext2D, d: DescentState, comboHits: number): void {
  if (d.multUpT > 0) {
    const t = 40 - d.multUpT;
    const pop = t < 5 ? 1 + (5 - t) * 0.16 : 1;
    ctx.save();
    ctx.translate(VW / 2, 132);
    ctx.scale(pop, pop);
    drawTextSh(ctx, '+MULT X' + scoreMult(comboHits), 0, 0, 2, AMBER, 'center');
    ctx.restore();
  }
  if (d.multLostT > 0) {
    // red vignette pulse — the pain of losing the multiplier
    const k = d.multLostT / 45;
    ctx.save();
    ctx.globalAlpha = 0.55 * k;
    ctx.strokeStyle = RED;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, VW - 6, VH - 6);
    ctx.globalAlpha = Math.min(1, 0.4 + k);
    drawTextSh(ctx, 'MULT LOST', VW / 2, 132, 2, RED, 'center');
    ctx.restore();
  }
}

// ---------- bonus auras (world pass, under/over the player) ----------
export function drawBonusAuras(ctx: CanvasRenderingContext2D, g: GameCtx, d: DescentState, frame: number): void {
  const p = g.player;
  const sx = Math.round(p.x - g.camX);
  const sy = Math.round(p.y - p.z);
  if (d.aT > 0) {
    // THE A: orbiting Algorand-A ring + cyan edge glow (NO white flash)
    ctx.save();
    ctx.strokeStyle = CYAN;
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(frame * 0.2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(sx, p.y - 2, 20, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const img = bonusIcon('bonusA');
    for (let i = 0; i < 3; i++) {
      const a = frame * 0.06 + (i * Math.PI * 2) / 3;
      const ox = sx + Math.cos(a) * 22;
      const oy = p.y - 24 + Math.sin(a) * 14;
      ctx.drawImage(img, Math.round(ox - 6), Math.round(oy - 6));
    }
    ctx.restore();
  }
  if (d.candleT > 0) {
    // GREEN CANDLE: candle above the head + green flame trail
    const img = bonusIcon('candle');
    const bob = (frame & 8) === 0 ? 0 : -1;
    ctx.drawImage(img, sx - 6, Math.round(sy - 66 + bob));
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = GREEN;
    for (let i = 0; i < 3; i++) {
      const fy = p.y - 6 - ((frame * 2 + i * 7) % 18);
      ctx.fillRect(sx - 8 + i * 7, Math.round(fy), 2, 2);
    }
    ctx.restore();
  }
  if (d.forgeT > 0) {
    // COMBO FORGE: amber embers rising off the shoulders
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = AMBER;
    for (let i = 0; i < 3; i++) {
      const fy = sy - 30 - ((frame * 1.5 + i * 9) % 22);
      ctx.fillRect(sx - 6 + i * 6, Math.round(fy), 2, 2);
    }
    ctx.restore();
  }
}

// ---------- full-screen descent grade (overlay pass, after the HUD) ----------
export function drawDescentGrade(ctx: CanvasRenderingContext2D, g: GameCtx, d: DescentState, frame: number): void {
  // BULLET TIME vignette (desaturation itself is a world-pass filter)
  if (d.bulletT > 0) {
    ctx.save();
    ctx.strokeStyle = CYAN;
    ctx.globalAlpha = 0.35 + 0.1 * Math.sin(frame * 0.15);
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, VW - 3, VH - 3);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#0a1418';
    ctx.fillRect(0, 0, VW, 10);
    ctx.fillRect(0, VH - 10, VW, 10);
    ctx.restore();
    drawText(ctx, 'BULLET TIME', VW / 2, VH - 20, 1, CYAN, 'center');
  }
  // NEAR-DEATH: persistent subtle red edge pulse at <= 25% HP (one life!)
  const p = g.player;
  if (p.hp > 0 && p.hp <= p.maxHp * 0.25 && p.state !== 'dead') {
    const beat = Math.pow(Math.max(0, Math.sin(frame * 0.11)), 3); // heartbeat
    ctx.save();
    ctx.globalAlpha = 0.16 + 0.2 * beat;
    ctx.strokeStyle = RED_D;
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, VW - 5, VH - 5);
    ctx.strokeStyle = RED;
    ctx.lineWidth = 2;
    ctx.strokeRect(4.5, 4.5, VW - 9, VH - 9);
    ctx.restore();
  }
}

// countdown pips for the HUD (bottom-left): active bonus + seconds left
export function drawBonusPips(ctx: CanvasRenderingContext2D, d: DescentState): void {
  const pips: [BonusKind, number][] = [];
  if (d.aT > 0) pips.push(['bonusA', d.aT]);
  if (d.candleT > 0) pips.push(['candle', d.candleT]);
  if (d.forgeT > 0) pips.push(['forge', d.forgeT]);
  if (d.bulletT > 0) pips.push(['bullet', d.bulletT]);
  let bx = 6;
  for (const [kind, t] of pips) {
    ctx.drawImage(bonusIcon(kind), bx, VH - 16);
    drawText(ctx, String(Math.ceil(t / 60)), bx + 14, VH - 14, 1, kind === 'bonusA' ? CYAN : kind === 'candle' ? GREEN : kind === 'forge' ? AMBER : CYAN);
    bx += 30;
  }
}

// exposed for the engine render pass
export const DESCENT_COLORS = { GOLD, GOLD_D, GREEN, AMBER, RED, CYAN, DIM };
export { waveClearBonus };
