// HUD: portrait + HP + lives, $GONNA score, meter segments + timer, boss bar, GO arrow,
// v4 free-flow combo counter (right side, upper area — never over the boss bar).
import { drawText, drawTextSh, textWidth } from './font';
import { comboRankName, comboRankTier, VW } from './types';
import type { GameCtx } from './ctx';

// combo counter display state (module singleton, zero allocation in draw)
const comboUI = { shown: 0, popT: 99, fade: 0, flashT: 0, tier: 0 };

// color escalation: white -> gold -> GONNA green
function rankColor(rank: string): string {
  if (rank === 'LEGENDARY' || rank === 'BYZANTINE') return '#7fd858';
  if (rank === 'SUPER' || rank === 'GREAT') return '#f5c542';
  return '#ffffff';
}

export function drawHud(ctx: CanvasRenderingContext2D, g: GameCtx, score: number, timeLeft: number, goArrow: boolean, animT: number, muted: boolean): void {
  const p = g.player;
  // ---- top-left: portrait + HP + lives ----
  ctx.fillStyle = '#101018';
  ctx.fillRect(4, 4, 20, 22);
  ctx.strokeStyle = '#f5c542';
  ctx.lineWidth = 1;
  ctx.strokeRect(4.5, 4.5, 19, 21);
  const port = (g.pframes ?? g.frames).get('0_0'); // v9: skin portrait
  if (port) ctx.drawImage(port, 6, 6, 16 * (port.width / port.height), 16);
  // HP bar
  ctx.fillStyle = '#101018';
  ctx.fillRect(27, 6, 66, 7);
  const frac = p.hp / p.maxHp;
  const hpCol = frac > 0.5 ? '#3fae4a' : frac > 0.25 ? '#f5c542' : '#e23b3b';
  ctx.fillStyle = hpCol;
  ctx.fillRect(28, 7, Math.max(0, 64 * frac), 5);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(28, 7, Math.max(0, 64 * frac), 2);
  drawText(ctx, 'GONNA', 27, 15, 1, '#7fd858');
  // lives
  for (let i = 0; i < p.lives; i++) {
    ctx.drawImage(g.art.lizIcon, 27 + i * 14, 23);
  }
  // knife uses
  if (p.knifeUses > 0) {
    ctx.drawImage(g.art.knife, 70, 24);
    drawText(ctx, 'X' + p.knifeUses, 89, 25, 1, '#c8ccd4');
  }

  // ---- top-center: score ----
  drawTextSh(ctx, '$GONNA', VW / 2, 5, 1, '#f5c542', 'center');
  drawTextSh(ctx, String(score).padStart(8, '0'), VW / 2, 14, 1, '#ffffff', 'center');

  // ---- top-right: meter + timer ----
  drawText(ctx, 'G-METER', VW - 66, 5, 1, '#7fd858');
  for (let i = 0; i < 3; i++) {
    const bx = VW - 66 + i * 21;
    ctx.fillStyle = '#101018';
    ctx.fillRect(bx, 13, 19, 7);
    const fill = Math.min(1, Math.max(0, p.meter - i));
    if (fill > 0) {
      ctx.fillStyle = fill >= 1 ? '#f5c542' : '#b8860b';
      ctx.fillRect(bx + 1, 14, Math.floor(17 * fill), 5);
    }
  }
  const t = Math.max(0, Math.ceil(timeLeft));
  const descent = g.descent; // v15
  if (descent) {
    // ---- v15: WAVE 07 — persistent, chunky gold arcade numerals ----
    const wl = 'WAVE ' + String(Math.max(1, descent.wave)).padStart(2, '0');
    drawTextSh(ctx, wl, VW - 8, 24, 2, '#f5c542', 'right');
    // ---- v15: multiplier readout (x2 candle = fluo green) ----
    const mult = g.killMult();
    if (mult > 1) {
      drawTextSh(ctx, 'X' + mult, VW / 2 + 44, 14, 1, descent.candleT > 0 ? '#39FF14' : '#f5c542', 'left');
    }
    // ---- v15: TARGET bar — the race against the creator's sealed score ----
    if (descent.target > 0) {
      const beaten = score >= descent.target;
      drawText(ctx, beaten ? 'TARGET BEATEN' : 'TARGET ' + String(descent.target).padStart(8, '0'), VW / 2, 26, 1, beaten ? '#39FF14' : '#ffae2a', 'center');
      // slim progress bar under the readout — the race at a glance
      const frac = Math.min(1, score / descent.target);
      ctx.fillStyle = '#101018';
      ctx.fillRect(VW / 2 - 41, 32, 82, 5);
      ctx.fillStyle = beaten ? '#39FF14' : '#b8860b';
      ctx.fillRect(VW / 2 - 40, 33, Math.floor(80 * frac), 3);
    }
  } else {
    drawTextSh(ctx, 'TIME ' + String(t).padStart(3, '0'), VW - 66, 24, 1, t < 30 ? '#e23b3b' : '#c8ccd4', 'left');
  }

  // ---- boss HP bottom ----
  if (g.boss && g.boss.alive && g.boss.state !== 'intro') {
    const bw = 220;
    const bx = (VW - bw) / 2;
    ctx.fillStyle = '#101018';
    ctx.fillRect(bx - 2, 202, bw + 4, 9);
    ctx.fillStyle = '#5a1010';
    ctx.fillRect(bx, 204, bw, 5);
    ctx.fillStyle = '#e23b3b';
    ctx.fillRect(bx, 204, (bw * g.boss.hp) / g.boss.maxHp, 5);
    drawTextSh(ctx, g.boss.name, VW / 2, 193, 1, '#f5c542', 'center');
  }

  // ---- v4 combo counter: right side, upper area; lives only during a combo ----
  const hits = p.comboHits;
  if (hits >= 2) {
    if (comboUI.shown !== hits) {
      comboUI.shown = hits;
      comboUI.popT = 0; // pop scale-in on every hit
    }
    const tier = comboRankTier(hits);
    if (tier > comboUI.tier) comboUI.flashT = 10; // light rank-up flash (no shake)
    comboUI.tier = tier;
    comboUI.fade = 1;
  } else if (comboUI.fade > 0) {
    comboUI.fade -= 0.045; // gentle fade-out when the combo ends
    if (comboUI.fade <= 0) {
      comboUI.fade = 0;
      comboUI.shown = 0;
      comboUI.tier = 0;
    }
  }
  comboUI.popT++;
  if (comboUI.flashT > 0) comboUI.flashT--;
  if (comboUI.fade > 0 && comboUI.shown >= 2) {
    const rank = comboRankName(comboUI.shown);
    let col = rankColor(rank);
    if (comboUI.flashT > 0 && (comboUI.flashT & 2) !== 0) col = '#ffffff';
    // v15: COMBO FORGE — the meter burns amber while the decay is frozen
    if (g.descent && g.descent.forgeT > 0) col = (animT & 4) !== 0 ? '#ffae2a' : '#ff8a3c';
    const baseY = g.descent ? 66 : 40; // v15: clear of the WAVE cluster
    const pop = comboUI.popT < 6 ? 1 + (6 - comboUI.popT) * 0.12 : 1;
    const a = Math.min(1, comboUI.fade);
    const num = String(comboUI.shown);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(VW - 12, baseY);
    ctx.scale(pop, pop);
    drawTextSh(ctx, num, 0, 0, 3, col, 'right'); // big number, gold shadow accent
    ctx.restore();
    ctx.globalAlpha = a;
    const labelY = baseY + Math.round(21 * pop) + 3;
    drawTextSh(ctx, 'HITS', VW - 12, labelY, 1, '#c8ccd4', 'right');
    if (rank) drawTextSh(ctx, rank, VW - 12, labelY + 9, 1, col, 'right');
    ctx.globalAlpha = 1;
  }

  // ---- GO arrow ----
  if (goArrow && (animT & 16) !== 0) {
    drawTextSh(ctx, 'GO', VW - 52, 100, 2, '#7fd858');
    ctx.fillStyle = '#7fd858';
    const ax = VW - 24;
    ctx.beginPath();
    ctx.moveTo(ax, 100);
    ctx.lineTo(ax + 12, 106);
    ctx.lineTo(ax, 112);
    ctx.fill();
  }

  if (muted) drawText(ctx, 'MUTE', VW - textWidth('MUTE', 1) - 4, 34, 1, '#8a8f9c');
}
