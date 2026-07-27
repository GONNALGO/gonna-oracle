// v9.2 — VIRAL SHARE. Official X / Telegram logos redrawn in pixel art,
// FLUO GREEN #39FF14 on black; exact dual-share texts (signature ONLY in the
// post text, NEVER on the card); 1200x630 PNG card rendered offscreen and
// auto-downloaded on the first share; navigator.share({files}) when capable.
import { drawText, drawTextSh } from './font';
import { stageName, fmtScore, fmtTime } from './board';
import { buildStage } from './stages';
import { SKIN_INFO, skinForAsset } from './skins';
import type { SkinId } from './skins';
import { drawIconTG, drawIconX } from './shareicons';

export const FLUO = '#39FF14'; // bullrun green (v9.2 share/bullrun accent)
export const GAME_URL = 'gonna.bond/gonnafight';
export const TG_CHANNEL = 'https://t.me/GONNAFI';
export const SIGNATURE = 'GONNA SKRRT SKRRT $GONNA @gonnalgo';

// everything a share needs (from a live run or a board run card)
export interface ShareRec {
  score: number;
  stage: number; // 1-6
  win: 0 | 1;
  continues: number;
  timeSec: number | null; // null on v1 seals
  maxCombo: number | null; // null on v1 seals
  assetId: number;
  skin: SkinId;
  fighter: string; // display name (GONNA 2 / GONNA)
  msg: string;
  crown: boolean;
  rank: number | null; // null = unknown (offline)
}

// ---- exact post texts (asserted char-by-char in CI) ----
export function shareTextX(r: ShareRec): string {
  return (
    'I just sealed ' + fmtScore(r.score) + ' on GONNA FIGHT' + (r.crown ? ' 👑' : '') + '\n' +
    '🦎 ' + r.fighter + ' · ' + stageName(r.stage) + ' · ' + fmtTime(r.timeSec) + ' · ' + r.continues + ' continues · COMBO x' + (r.maxCombo ?? 0) + '\n' +
    'Think you can beat me? ' + GAME_URL + '\n' +
    SIGNATURE
  );
}
export function shareTextTG(r: ShareRec): string {
  return shareTextX(r) + '\n' + TG_CHANNEL;
}
export function shareUrlX(r: ShareRec): string {
  return 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareTextX(r));
}
export function shareUrlTG(r: ShareRec): string {
  return 'https://t.me/share/url?url=' + encodeURIComponent('https://' + GAME_URL) + '&text=' + encodeURIComponent(shareTextTG(r));
}

// ============================================================ CARD (1200x630)
export interface CardResult {
  canvas: HTMLCanvasElement;
  hasMsg: boolean; // the player message quote was drawn
  texts: string[]; // every string drawn on the card (CI: no SKRRT signature)
}

export function renderCard(r: ShareRec, sprite: HTMLImageElement | null): CardResult {
  const W = 1200;
  const H = 630;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const texts: string[] = [];
  const T = (str: string, x: number, y: number, scale: number, color: string, align: 'left' | 'center' | 'right' = 'left') => {
    texts.push(str);
    drawText(ctx, str, x, y, scale, color, align);
  };
  const Tsh = (str: string, x: number, y: number, scale: number, color: string, align: 'left' | 'center' | 'right' = 'left', sh = '#0a0a12') => {
    texts.push(str);
    drawTextSh(ctx, str, x, y, scale, color, align, sh);
  };

  // ---- stage backdrop of the final stage reached (real stage art) ----
  ctx.fillStyle = '#070a14';
  ctx.fillRect(0, 0, W, H);
  try {
    const st = buildStage(r.stage - 1);
    const sx = 0.62; // parallax anchor inside the stage
    const k = H / 224; // game px -> card px
    const vw = W / k; // visible game-px width
    const crop = Math.max(0, Math.min(st.len - vw, st.len * sx - vw / 2));
    ctx.drawImage(st.far, Math.round(crop * 0.25), 0, Math.max(1, Math.round(vw * 0.25)), 224, 0, 0, W, H);
    ctx.drawImage(st.mid, Math.round(crop * 0.55), 0, Math.max(1, Math.round(vw * 0.55)), 224, 0, 0, W, H);
    ctx.drawImage(st.ground, Math.round(crop), 140, Math.max(1, Math.round(vw)), 84, 0, Math.round(140 * k), W, Math.round(84 * k));
  } catch { /* backdrop is best-effort: night base already painted */ }
  // readability veil + fluo frame
  ctx.fillStyle = 'rgba(4,6,10,0.45)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = FLUO;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.strokeStyle = '#b8860b';
  ctx.lineWidth = 2;
  ctx.strokeRect(11, 11, W - 22, H - 22);

  // ---- header: GONNA FIGHT + pixel logos (GONNA leaf + Algorand A) ----
  Tsh('GONNA FIGHT', 40, 34, 6, '#7fd858', 'left', '#1e6b2a');
  drawGonnaLogo(ctx, W - 220, 26, 4);
  drawAlgorandLogo(ctx, W - 96, 26, 4);

  // ---- huge gold score with $GONNA brand ----
  Tsh(fmtScore(r.score), W / 2, 120, 9, '#f5c542', 'center', '#b8860b');
  if (r.rank !== null) Tsh('#' + r.rank + ' IN THE GONNAVERSE', W / 2, 216, 4, FLUO, 'center', '#0a3d00');
  if (r.crown) Tsh('BYZANTINE CLEAR', W / 2, r.rank !== null ? 262 : 226, 3, '#f5c542', 'center', '#b8860b');

  // ---- big skin sprite (left) + run row (right) ----
  if (sprite) {
    const dh = 300;
    const dw = Math.round(dh * (sprite.width / sprite.height));
    ctx.drawImage(sprite, 70, 270, dw, dh);
  }
  const rx = 420;
  const info = SKIN_INFO[r.skin];
  T('FIGHTER', rx, 300, 3, '#8a8f9c');
  Tsh(r.fighter, rx + 170, 300, 3, info.accent);
  T('SKIN', rx, 348, 3, '#8a8f9c');
  Tsh(info.label, rx + 170, 348, 3, info.accent);
  T('STAGE', rx, 396, 3, '#8a8f9c');
  Tsh(stageName(r.stage), rx + 170, 396, 3, '#f2f2f2');
  T('TIME', rx, 444, 3, '#8a8f9c');
  Tsh(fmtTime(r.timeSec), rx + 170, 444, 3, '#f2f2f2');
  T('CONTINUES', rx, 492, 3, '#8a8f9c');
  Tsh(String(r.continues), rx + 170, 492, 3, '#f2f2f2');
  T('COMBO', rx, 540, 3, '#8a8f9c');
  Tsh('x' + (r.maxCombo ?? 0), rx + 170, 540, 3, '#f2f2f2');

  // ---- player message in quotes — ONLY when present ----
  let hasMsg = false;
  if (r.msg) {
    hasMsg = true;
    Tsh('"' + r.msg.slice(0, 32) + '"', W / 2, 590, 3, '#ffffff', 'center');
  }

  // ---- footer: NFT tag + URL ----
  const nft = r.assetId > 0 ? skinForAsset(r.assetId) : null;
  if (nft) T(nft.name.trim(), 40, 592, 3, '#f5c542');
  Tsh(GAME_URL, W - 40, 592, 3, FLUO, 'right', '#0a3d00');
  return { canvas: cv, hasMsg, texts };
}

// GONNA pixel leaf mark (fluo) + Algorand pixel A, drawn with rects so the
// card never depends on external image assets.
function drawGonnaLogo(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const px = [ // 8x8 leaf
    '...GG...',
    '..GGGG..',
    '.GGGGGG.',
    'GGGGGGGG',
    'GGGGGGG.',
    '.GGGGG..',
    '..GGG...',
    '...G....',
  ];
  ctx.fillStyle = '#7fd858';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (px[r][c] === 'G') ctx.fillRect(x + c * s, y + r * s, s, s);
}
function drawAlgorandLogo(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const px = [ // 8x8 stylized Algorand A
    '...AA...',
    '..AAAA..',
    '..AAAA..',
    '.AAAAAA.',
    '.AAAAAA.',
    'AAAAAAAA',
    'AA..AAAA',
    'AA...AA.',
  ];
  ctx.fillStyle = '#e8ecf4';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (px[r][c] === 'A') ctx.fillRect(x + c * s, y + r * s, s, s);
}

// ---- PNG download (mobile: lands as the newest photo in the gallery) ----
export function downloadCard(cv: HTMLCanvasElement): void {
  cv.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gonna-fight-seal.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');
}

// generic share: native sheet with the card file when capable
export async function nativeShare(cv: HTMLCanvasElement, text: string): Promise<boolean> {
  try {
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'));
    if (!blob) return false;
    const file = new File([blob], 'gonna-fight-seal.png', { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files?: File[]; text?: string }) => Promise<void> };
    if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], text });
      return true;
    }
  } catch { /* cancelled or unsupported */ }
  return false;
}

export { drawIconX, drawIconTG };
