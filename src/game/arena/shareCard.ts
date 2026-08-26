// THE ARENA — SHARE CARD (v10.4). Renders the 1200x630 challenge poster the
// Prince wants degens to flex with: void black, throne gold, #39FF14 green,
// the GONNA fighter big on the left (nearest-neighbor, aspect preserved),
// challenge data in hierarchy on the right, ornate border, pixel coin piles,
// the pixel QUANTUM badge for Falcon creators. Never any white flash.
import { drawText, drawTextSh } from '../font';
import type { Challenge } from './chainAdapter';
import { arenaMode, fmtStake } from './chainAdapter';

export const SHARE_W = 1200;
export const SHARE_H = 630;

const GOLD = '#f5c542';
const GOLD_DK = '#b8860b';
const FLUO = '#39FF14';
const INK = '#070a14';
const GRAY = '#8a8f9c';
const DIM = '#5a5f6c';
const PQCYAN = '#57c8d8';

const STAGE_NAMES = ['GHETTO GONNA', 'PUMP HARBOR', 'WALL STREET', 'CONSENSUS', 'THE HOUSE', 'LAUNCHPAD', 'THRONE ROOM'];

export function stageLine(ch: Pick<Challenge, 'stageMode' | 'stageIdx' | 'stageVerified'>): string {
  if (ch.stageMode === 'full') return 'FULL RUN - ALL 7 STAGES';
  const base = 'STAGE ' + ((ch.stageIdx ?? 0) + 1) + ' - ' + STAGE_NAMES[ch.stageIdx ?? 0];
  return ch.stageVerified === false ? base + ' (UNVERIFIED)' : base; // v15.2.8: a guess is never dressed as truth
}

export function formatLine(ch: Pick<Challenge, 'format' | 'seatsTotal'>): string {
  return ch.format === 'duel' ? 'DUEL - FIRST WALLET TAKES ALL' : 'OPEN TABLE ' + ch.seatsTotal + ' SEATS';
}

// degen share copy with tags (the link rides along on X / Telegram)
export function shareText(ch: Challenge): string {
  // v15.2.8b: route through stageLine — a cid%7 fallback GUESS carries the
  // (UNVERIFIED) marker in the social copy too, never dressed as fact
  const stage = ch.stageMode === 'full' ? 'FULL RUN. ALL 7 STAGES.' : stageLine(ch) + '.';
  return (
    'I JUST STAKED ' + fmtStake(ch.stake) + ' $GONNA ON MY OWN FIGHT. ' + stage +
    ' THINK YOU CAN TAKE IT? 🦎⚛️ $GONNA #GONNAFIGHT #ALGORAND #QUANTUMFIGHT @GONNALGO'
  );
}

// v15.2.8: the ?st= link hint (resolution tier c) rides ONLY a VERIFIED
// single-mode stage — a cid%7 fallback guess never propagates as truth
export function shareStageOf(ch: Pick<Challenge, 'stageMode' | 'stageIdx' | 'stageVerified'>): number | null {
  return ch.stageMode !== 'full' && ch.stageVerified !== false && ch.stageIdx !== null && ch.stageIdx >= 0 && ch.stageIdx <= 6 ? ch.stageIdx : null;
}

export function shareUrl(id: number, stageIdx?: number | null): string {
  // the link ALWAYS carries the mode — a ?duel= id means nothing without it
  // (preview origins wipe localStorage; mock ids and chain ids collide)
  const base = window.location.origin + window.location.pathname;
  const st = typeof stageIdx === 'number' && stageIdx >= 0 && stageIdx <= 6 ? '&st=' + stageIdx : '';
  return arenaMode() === 'live' ? base + '?arena=live&duel=' + id + st : base + '?duel=' + id + st;
}

// pixel coin at any integer scale (decoration)
function coin(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  c.fillStyle = GOLD_DK;
  c.fillRect(x, y, 6 * s, 6 * s);
  c.fillStyle = GOLD;
  c.fillRect(x, y + s, 6 * s, 4 * s);
  c.fillStyle = '#fff3c4';
  c.fillRect(x + 2 * s, y + s, s, 2 * s);
}
function pile(c: CanvasRenderingContext2D, x: number, y: number, n: number, s: number): void {
  for (let i = 0; i < n; i++) coin(c, x + (i % 3) * 7 * s + ((i / 3) | 0) * 2 * s, y - ((i / 3) | 0) * 5 * s, s);
}

// ⚛ pixel atom, scaled (Falcon / PQ accounts)
function quantumBadge(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  c.fillStyle = PQCYAN;
  c.fillRect(x + 5 * s, y + 2 * s, 2 * s, 8 * s);
  c.fillRect(x + 2 * s, y + 5 * s, 8 * s, 2 * s);
  c.fillStyle = '#d8fbff';
  c.fillRect(x + 5 * s, y + 5 * s, 2 * s, 2 * s);
  c.strokeStyle = PQCYAN;
  c.lineWidth = s;
  c.strokeRect(x + 0.5, y + 0.5, 12 * s - 1, 12 * s - 1);
}

// aspect-preserving nearest-neighbor blit (never squash the fighter)
function drawFit(c: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, boxW: number, boxH: number): void {
  const iw = (img as HTMLCanvasElement).width || (img as HTMLImageElement).naturalWidth || 0;
  const ih = (img as HTMLCanvasElement).height || (img as HTMLImageElement).naturalHeight || 0;
  if (!iw || !ih) return;
  const s = Math.min(boxW / iw, boxH / ih);
  const w = Math.max(1, Math.round(iw * s));
  const h = Math.max(1, Math.round(ih * s));
  c.drawImage(img, Math.round(x + (boxW - w) / 2), Math.round(y + (boxH - h) / 2), w, h);
}

export function renderShareCard(ch: Challenge, fighterImg: CanvasImageSource | null): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = SHARE_W;
  cv.height = SHARE_H;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;

  // void black + deep-space pixel stars
  c.fillStyle = INK;
  c.fillRect(0, 0, SHARE_W, SHARE_H);
  for (let i = 0; i < 160; i++) {
    const sx = (i * 89) % SHARE_W;
    const sy = (i * 53) % SHARE_H;
    c.fillStyle = i % 3 === 0 ? '#14202a' : i % 3 === 1 ? '#101a30' : '#0d2416';
    c.fillRect(sx, sy, 2, 2);
  }

  // ornate throne border: double gold frame + corner jewels
  c.strokeStyle = GOLD_DK;
  c.lineWidth = 8;
  c.strokeRect(10, 10, SHARE_W - 20, SHARE_H - 20);
  c.strokeStyle = GOLD;
  c.lineWidth = 2;
  c.strokeRect(28, 28, SHARE_W - 56, SHARE_H - 56);
  for (const [cx, cy] of [[10, 10], [SHARE_W - 42, 10], [10, SHARE_H - 42], [SHARE_W - 42, SHARE_H - 42]]) {
    c.fillStyle = GOLD;
    c.fillRect(cx, cy, 32, 8);
    c.fillRect(cx, cy, 8, 32);
    c.fillStyle = FLUO;
    c.fillRect(cx + 12, cy + 12, 8, 8);
  }

  // LEFT: the GONNA fighter, challenge pose, BIG
  c.fillStyle = '#0d1f10';
  c.fillRect(60, 100, 380, 440); // void-green stage plate
  c.strokeStyle = '#1c3a1e';
  c.lineWidth = 2;
  c.strokeRect(60.5, 100.5, 379, 439);
  if (fighterImg) drawFit(c, fighterImg, 80, 120, 340, 360);
  c.fillStyle = FLUO; // ground line, Algorand green
  c.fillRect(80, 500, 340, 3);
  pile(c, 90, 530, ch.stake >= 1_000_000_000 ? 8 : 5, 3); // stake-tier coin pile

  // RIGHT: the challenge, in hierarchy (centered on cx)
  const cx = 810;
  drawTextSh(c, 'GONNA FIGHT', cx, 62, 7, GOLD, 'center', GOLD_DK);
  drawText(c, 'THE PIT', cx, 130, 4, FLUO, 'center');
  c.fillStyle = GOLD_DK;
  c.fillRect(cx - 260, 168, 520, 3);
  // the stake, ENORMOUS gold
  drawTextSh(c, fmtStake(ch.stake) + ' $GONNA', cx, 200, 10, GOLD, 'center', GOLD_DK);
  drawText(c, formatLine(ch), cx, 310, 4, '#c8ccd4', 'center');
  drawText(c, stageLine(ch), cx, 350, 4, GRAY, 'center');
  drawText(c, 'BY ' + ch.creatorName, cx, 394, 3, DIM, 'center');
  drawTextSh(c, 'THINK YOU CAN TAKE IT?', cx, 442, 4, FLUO, 'center', '#0a3d00');
  if (ch.visibility === 'private') drawText(c, 'PRIVATE CHALLENGE - LINK ONLY', cx, 494, 3, '#b45aff', 'center');
  drawText(c, 'gonna.bond/gonnafight', cx, 566, 3, GOLD_DK, 'center');
  if (ch.creatorType === 'falcon') quantumBadge(c, SHARE_W - 100, 52, 3);

  return cv;
}

export function shareCardBlob(cv: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error('blob failed'))), 'image/png');
  });
}
