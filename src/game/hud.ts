// HUD: portrait + HP + lives, $GONNA score, meter segments + timer, boss bar, GO arrow.
import { drawText, drawTextSh, textWidth } from './font';
import { VW } from './types';
import type { GameCtx } from './ctx';

export function drawHud(ctx: CanvasRenderingContext2D, g: GameCtx, score: number, timeLeft: number, goArrow: boolean, animT: number, muted: boolean): void {
  const p = g.player;
  // ---- top-left: portrait + HP + lives ----
  ctx.fillStyle = '#101018';
  ctx.fillRect(4, 4, 20, 22);
  ctx.strokeStyle = '#f5c542';
  ctx.lineWidth = 1;
  ctx.strokeRect(4.5, 4.5, 19, 21);
  const port = g.frames.get('0_0');
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
  drawTextSh(ctx, 'TIME ' + String(t).padStart(3, '0'), VW - 66, 24, 1, t < 30 ? '#e23b3b' : '#c8ccd4', 'left');

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
