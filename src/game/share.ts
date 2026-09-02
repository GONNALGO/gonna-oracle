// v9.2.3 — VIRAL SHARE v3. Official X / Telegram logos redrawn BIG in pixel
// art, FLUO GREEN #39FF14 on black; exact dual-share texts (signature ONLY in
// the post text, NEVER on the card). The inline card preview is GONE (it
// covered the game art) — a VIEW CARD button now opens a fullscreen CARD
// VIEWER (real <img>, RIGHT CLICK SAVE / HOLD TO SAVE caption). Share taps
// stay NAVIGATION-ONLY: the auto-download never came back (on iOS its
// programmatic anchor click burned the single user-gesture navigation token,
// so the twitter:// scheme jump never fired).
import { drawText, drawTextSh } from './font';
import { stageName, fmtScore, fmtTime } from './board';
import { buildStage } from './stages';
import { SKIN_INFO, skinForAsset } from './skins';
import type { SkinId } from './skins';
import { drawIconTG, drawIconX } from './shareicons';

export const FLUO = '#39FF14'; // bullrun green (v9.2 share/bullrun accent)
export const GAME_URL = 'gonna.bond/quantumfight';
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
// v9.2.1: app-scheme deep links, attempted synchronously inside the genuine
// tap on the overlay anchor (touch only). If the app is installed the composer
// opens directly; otherwise the ~1.2s visibility fallback fires the web intent.
export function shareSchemeX(r: ShareRec): string {
  return 'twitter://post?message=' + encodeURIComponent(shareTextX(r));
}
export function shareSchemeTG(r: ShareRec): string {
  return 'tg://share/url?url=' + encodeURIComponent('https://' + GAME_URL) + '&text=' + encodeURIComponent(shareTextTG(r));
}

// ---- navigation / visibility seams (CI substitutes; production = location) ----
const shareHooks: { go: ((url: string) => void) | null; hidden: (() => boolean) | null } = { go: null, hidden: null };
export function setShareHooks(h: { go?: ((url: string) => void) | null; hidden?: (() => boolean) | null }): void {
  if (h.go !== undefined) shareHooks.go = h.go;
  if (h.hidden !== undefined) shareHooks.hidden = h.hidden;
}
function navGo(url: string): void {
  if (shareHooks.go) shareHooks.go(url);
  else window.location.assign(url);
}
function pageHidden(): boolean {
  if (shareHooks.hidden) return shareHooks.hidden();
  return document.hidden;
}

// ============================================================ SHARE ANCHORS
// v9.2.1 — the pixel share buttons get REAL DOM anchors overlaid invisibly
// (same overlay technique as the seal message input, synced to the canvas fit
// coordinates). A genuine tap on a real <a target="_blank" rel="noopener"> is
// the ONLY way iOS fires universal links into the X / Telegram apps — a
// window.open from the canvas tap handler is a programmatic navigation, so iOS
// shows the popup-blocker prompt and dumps the user on the web login page.
export interface ShareAnchorDef {
  id: string; // save:sharex / save:sharetg / save:viewtx / board:sharex / ...
  rect: { x: number; y: number; w: number; h: number }; // game coords (384x224)
  href: string; // web intent (universal link)
  scheme: string | null; // app scheme attempted first on touch devices
  aria: string;
  onTap: () => void; // POSTED state + sfx ONLY — v9.2.2: no download, nothing that could burn the iOS gesture token
}

const FALLBACK_MS = 1200; // ~1.2s: app did not take over -> web intent fallback

export class ShareAnchors {
  private els = new Map<string, HTMLAnchorElement>();
  private defs = new Map<string, ShareAnchorDef>();
  private sigs = new Map<string, string>();
  private touch = false;

  // called every frame: creates / repositions / removes the overlay anchors so
  // they always sit exactly on their pixel buttons (canvas fit coordinates).
  sync(defs: ShareAnchorDef[], fit: { fitOffX: number; fitOffY: number; fitScale: number }, touch: boolean): void {
    this.touch = touch;
    const live = new Set<string>();
    for (const d of defs) {
      live.add(d.id);
      this.defs.set(d.id, d);
      let el = this.els.get(d.id);
      if (!el) {
        el = document.createElement('a');
        el.className = 'gonna-share-anchor';
        el.target = '_blank';
        el.rel = 'noopener';
        // z-index 31: above the seal message input (30) — the input lingers on
        // the SEALED screen and its lower edge touches the share buttons' top
        el.style.cssText = 'position:fixed;z-index:31;display:block;opacity:0;touch-action:manipulation;-webkit-tap-highlight-color:transparent;';
        el.addEventListener('click', (e) => this.onClick(d.id, e));
        document.body.appendChild(el);
        this.els.set(d.id, el);
        this.sigs.delete(d.id);
      }
      el.setAttribute('aria-label', d.aria);
      const left = Math.round(fit.fitOffX + d.rect.x * fit.fitScale);
      const top = Math.round(fit.fitOffY + d.rect.y * fit.fitScale);
      const w = Math.max(1, Math.round(d.rect.w * fit.fitScale));
      const h = Math.max(1, Math.round(d.rect.h * fit.fitScale));
      const sig = d.href + '|' + (d.scheme ?? '') + '|' + left + ',' + top + ',' + w + ',' + h;
      if (this.sigs.get(d.id) !== sig) {
        this.sigs.set(d.id, sig);
        el.href = d.href;
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';
      }
    }
    for (const [id, el] of this.els) {
      if (!live.has(id)) {
        el.remove();
        this.els.delete(id);
        this.defs.delete(id);
        this.sigs.delete(id);
      }
    }
  }

  private onClick(id: string, e: MouseEvent): void {
    const d = this.defs.get(id);
    if (!d) return;
    d.onTap(); // POSTED state + sfx — v9.2.2: NOTHING else (no download click; the gesture token belongs to the app jump)
    if (this.touch && d.scheme) {
      // touch: try the app FIRST (synchronous scheme attempt keeps the gesture
      // chain); if ~1.2s later the page is still visible the app is not
      // installed -> fall back to the web intent.
      e.preventDefault();
      navGo(d.scheme);
      window.setTimeout(() => {
        if (!pageHidden()) navGo(d.href);
      }, FALLBACK_MS);
    }
    // desktop: no preventDefault -> the anchor's own href opens the web intent
    // in a new tab, exactly like v9.2 (minus the popup blocker).
  }

  // keyboard / canvas-fallback activations route through the real anchor too
  click(id: string): boolean {
    const el = this.els.get(id);
    if (!el) return false;
    el.click();
    return true;
  }

  clear(): void {
    this.sync([], { fitOffX: 0, fitOffY: 0, fitScale: 1 }, this.touch);
  }

  // CI: live DOM state of every overlay anchor
  info(): { id: string; href: string; scheme: string | null; target: string; rel: string; css: { x: number; y: number; w: number; h: number } }[] {
    const out: { id: string; href: string; scheme: string | null; target: string; rel: string; css: { x: number; y: number; w: number; h: number } }[] = [];
    for (const [id, el] of this.els) {
      const r = el.getBoundingClientRect();
      out.push({ id, href: el.href, scheme: this.defs.get(id)?.scheme ?? null, target: el.target, rel: el.rel, css: { x: r.x, y: r.y, w: r.width, h: r.height } });
    }
    return out;
  }
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

// ============================================================ CARD VIEWER
// v9.2.3 — the 1200x630 card NO LONGER sits inline on the SEALED / RUN CARD
// screens (it covered the game art). A VIEW CARD pixel button opens this
// fullscreen modal instead: dark dim backdrop, the REAL <img> centered as
// large as fits (right-click SAVE on desktop, long-press "Add to Photos" on
// touch — it is a real image, not a canvas), pixel caption under it, close
// via [X] / ESC / tap-outside. The auto-download stays dead: the share tap
// must spend the single iOS gesture token on the APP navigation, never on a
// programmatic download click.
export const CARD_CAPTION_DESKTOP = 'RIGHT CLICK SAVE'; // caption under the viewer img (desktop)
export const CARD_CAPTION_TOUCH = 'HOLD TO SAVE'; // caption under the viewer img (touch)
export const SHARE_GUIDE = '1 SAVE THE CARD - 2 POST IT'; // 2-step pixel guide over the share area

export class CardViewer {
  private root: HTMLDivElement | null = null;
  private img: HTMLImageElement | null = null;
  private cap: HTMLDivElement | null = null;
  private id = '';
  private touch = false;
  private openedAt = 0; // tap-outside guard (see the backdrop click listener)
  onClose: (() => void) | null = null;

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(id: string, dataUrl: string, touch: boolean): void {
    this.touch = touch;
    if (!this.root) {
      const root = document.createElement('div');
      root.className = 'gonna-card-viewer';
      root.style.cssText =
        'position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'background:rgba(3,4,8,0.94);gap:12px;touch-action:manipulation;-webkit-tap-highlight-color:transparent;';
      const img = document.createElement('img');
      img.className = 'gonna-card-viewer-img';
      img.alt = 'GONNA FIGHT seal card - right click / hold to save';
      img.draggable = true;
      img.style.cssText =
        'display:block;box-sizing:border-box;max-width:92vw;max-height:68vh;' +
        'border:2px solid ' + FLUO + ';background:#070a14;image-rendering:pixelated;' +
        'box-shadow:0 0 24px rgba(57,255,20,0.25);' +
        '-webkit-touch-callout:default;user-select:none;-webkit-user-select:none;';
      const cap = document.createElement('div');
      cap.className = 'gonna-card-viewer-caption';
      cap.style.cssText =
        'color:' + FLUO + ';font-family:monospace;font-weight:bold;font-size:14px;letter-spacing:2px;text-transform:uppercase;' +
        'text-shadow:0 0 8px rgba(57,255,20,0.6);user-select:none;-webkit-user-select:none;';
      const x = document.createElement('button');
      x.className = 'gonna-card-viewer-close';
      x.type = 'button';
      x.textContent = 'X';
      x.setAttribute('aria-label', 'Close the card viewer');
      x.style.cssText =
        'position:absolute;top:10px;right:10px;width:40px;height:40px;box-sizing:border-box;' +
        'background:#0d1118;color:' + FLUO + ';border:2px solid ' + FLUO + ';' +
        'font-family:monospace;font-weight:bold;font-size:18px;cursor:pointer;';
      root.appendChild(img);
      root.appendChild(cap);
      root.appendChild(x);
      // close paths: [X], tap-outside (the dim backdrop), ESC (capture phase so
      // the game input never sees keys while the viewer is up)
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });
      root.addEventListener('click', (e) => {
        // tap-outside only; taps on the img/caption keep it open. The 400ms
        // guard stops the OPENING tap's own trailing synthetic click (fired
        // after the viewer appears under the finger) from instantly closing it.
        if (e.target === root && performance.now() - this.openedAt > 400) this.close();
      });
      this.keyHandler = (e: KeyboardEvent) => {
        e.stopPropagation(); // the viewer owns the keyboard while open
        if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
        }
      };
      window.addEventListener('keydown', this.keyHandler, true);
      document.body.appendChild(root);
      this.root = root;
      this.img = img;
      this.cap = cap;
      this.id = '';
      this.openedAt = performance.now();
    }
    if (this.img && this.id !== id) {
      this.id = id;
      this.img.src = dataUrl; // only when the card id changes — never per frame
    }
    if (this.cap) this.cap.textContent = this.touch ? CARD_CAPTION_TOUCH : CARD_CAPTION_DESKTOP;
  }

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  close(): void {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    this.img = null;
    this.cap = null;
    this.id = '';
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
    if (this.onClose) this.onClose();
  }

  // CI: live DOM state of the viewer
  info(): { open: boolean; id: string; caption: string; captionDesktop: string; captionTouch: string; src: string; cls: string; imgCls: string } {
    return {
      open: this.isOpen,
      id: this.id,
      caption: this.cap ? this.cap.textContent ?? '' : '',
      captionDesktop: CARD_CAPTION_DESKTOP,
      captionTouch: CARD_CAPTION_TOUCH,
      src: this.img ? this.img.src.slice(0, 32) : '',
      cls: 'gonna-card-viewer',
      imgCls: 'gonna-card-viewer-img',
    };
  }
}

// v9.2.4: the generic web-share (native sheet) path is GONE — the SHARE
// button it served was redundant (VIEW CARD + direct X/TG anchors cover the
// flow) and unsupported/dead on many browsers. X/TG anchors + texts intact.

export { drawIconX, drawIconTG };
