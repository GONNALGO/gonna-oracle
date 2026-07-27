// v9.2 — NON-INVASIVE FULLSCREEN GUIDE. Replaces the old permanent
// "FOR TRUE FULLSCREEN..." tip line: a ONE-SHOT pixel card shown on the
// TITLE screen only (touch devices, never when already standalone/installed).
//   iOS (no beforeinstallprompt): 3 illustrated steps (Share -> Add to Home
//     Screen -> Add), then "play from the GONNA icon"
//   Android: 1-tap INSTALL NOW button wired to the captured
//     beforeinstallprompt event; manual steps fallback when unavailable
//   [GOT IT] dismisses and persists (localStorage); a tiny ⛶ icon in the
//   PAUSE menu reopens the card anytime.
import { drawText, drawTextSh } from './font';
import { VH, VW } from './types';

const KEY = 'gonna.fsguide.v1';
const FLUO = '#39FF14';

export type FsPlatform = 'ios' | 'android' | null;

// captured beforeinstallprompt (Android/Chrome) — registered at boot
interface BipEvent extends Event {
  prompt?: () => Promise<void>;
}
let installEvt: BipEvent | null = null;
export function captureInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e as BipEvent;
  });
}

export function detectPlatform(): FsPlatform {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return null;
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    (typeof window.matchMedia === 'function' &&
      (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches))
  );
}

function isTouchDevice(): boolean {
  return typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
}

const CARD = { x: 32, y: 22, w: 320, h: 182 };
const BTN_GOTIT = { x: 238, y: 176, w: 96, h: 18 };
const BTN_INSTALL = { x: 102, y: 96, w: 180, h: 22 };

export class FsGuide {
  visible = false;
  private autoShown = false;
  private slideT = 0;
  platform: FsPlatform = null;
  standalone = false;
  private dismissedFlag = false;
  installFired = false;

  constructor() {
    this.platform = detectPlatform();
    this.standalone = isStandalone();
    try {
      this.dismissedFlag = window.localStorage.getItem(KEY) === '1';
    } catch { /* storage unavailable */ }
  }

  get installAvail(): boolean {
    return installEvt !== null && typeof installEvt.prompt === 'function';
  }

  get dismissed(): boolean {
    return this.dismissedFlag;
  }

  // one-shot auto-show on the TITLE screen only
  maybeAutoShow(scene: string): void {
    if (this.autoShown || this.visible || this.dismissedFlag || this.standalone) return;
    if (scene !== 'title' || !this.platform || !isTouchDevice()) return;
    this.autoShown = true;
    this.visible = true;
    this.slideT = 0;
  }

  // tiny ⛶ icon in the PAUSE menu reopens the card anytime
  reopen(): void {
    if (!this.platform) return;
    this.visible = true;
    this.slideT = 0;
  }

  private dismiss(): void {
    this.visible = false;
    this.dismissedFlag = true;
    try {
      window.localStorage.setItem(KEY, '1');
    } catch { /* storage unavailable */ }
  }

  private install(): void {
    if (this.installAvail && installEvt) {
      this.installFired = true;
      void installEvt.prompt!().catch(() => { /* user declined */ });
      installEvt = null;
    }
  }

  // returns true when the tap was consumed by the card
  tap(gx: number, gy: number): boolean {
    if (!this.visible) return false;
    if (this.slideT < 18) return true; // still sliding in: swallow the tap
    if (this.platform === 'android' && this.installAvail &&
      gx >= BTN_INSTALL.x && gx <= BTN_INSTALL.x + BTN_INSTALL.w && gy >= BTN_INSTALL.y && gy <= BTN_INSTALL.y + BTN_INSTALL.h) {
      this.install();
      return true;
    }
    if (gx >= BTN_GOTIT.x && gx <= BTN_GOTIT.x + BTN_GOTIT.w && gy >= BTN_GOTIT.y && gy <= BTN_GOTIT.y + BTN_GOTIT.h) {
      this.dismiss();
      return true;
    }
    return true; // card visible: swallow background taps
  }

  keyStart(): boolean {
    if (!this.visible) return false;
    this.dismiss();
    return true;
  }

  get info(): { platform: FsPlatform; standalone: boolean; installAvail: boolean; visible: boolean; dismissed: boolean; autoShown: boolean; installFired: boolean } {
    return {
      platform: this.platform,
      standalone: this.standalone,
      installAvail: this.installAvail,
      visible: this.visible,
      dismissed: this.dismissedFlag,
      autoShown: this.autoShown,
      installFired: this.installFired,
    };
  }

  draw(ctx: CanvasRenderingContext2D, t: number): void {
    if (!this.visible) return;
    this.slideT++;
    // slide-in from the top
    const p = Math.min(1, this.slideT / 18);
    const ease = 1 - Math.pow(1 - p, 3);
    const dy = Math.round((1 - ease) * -(CARD.h + CARD.y + 8));
    const x = CARD.x;
    const y = CARD.y + dy;
    // dim backdrop
    ctx.fillStyle = 'rgba(4,6,10,0.72)';
    ctx.fillRect(0, 0, VW, VH);
    // black card, fluo border
    ctx.fillStyle = '#070a14';
    ctx.fillRect(x, y, CARD.w, CARD.h);
    ctx.strokeStyle = FLUO;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, CARD.w - 2, CARD.h - 2);
    ctx.strokeStyle = '#1e8c0a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 4.5, y + 4.5, CARD.w - 9, CARD.h - 9);
    drawTextSh(ctx, 'TRUE FULLSCREEN', x + CARD.w / 2, y + 12, 2, FLUO, 'center', '#0a3d00');
    drawText(ctx, 'ONE TAP FROM THE REAL ARCADE', x + CARD.w / 2, y + 32, 1, '#8a8f9c', 'center');

    if (this.platform === 'ios') {
      // 3 illustrated steps
      const steps: [string, string][] = [
        ['1', 'TAP SHARE'],
        ['2', 'ADD TO HOME SCREEN'],
        ['3', 'TAP ADD'],
      ];
      for (let i = 0; i < 3; i++) {
        const sy = y + 52 + i * 34;
        // step icon tile
        ctx.fillStyle = '#0d1118';
        ctx.fillRect(x + 24, sy, 26, 26);
        ctx.strokeStyle = FLUO;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 24.5, sy + 0.5, 25, 25);
        if (i === 0) drawShareIcon(ctx, x + 29, sy + 4);
        else if (i === 1) drawPlusIcon(ctx, x + 29, sy + 4);
        else drawHomeIcon(ctx, x + 29, sy + 4);
        drawText(ctx, steps[i][0] + '.', x + 62, sy + 4, 1, '#5a5f6c');
        drawTextSh(ctx, steps[i][1], x + 78, sy + 4, 1, '#f2f2f2');
        if (i === 1) drawText(ctx, '(SCROLL THE SHARE SHEET)', x + 78, sy + 14, 1, '#5a5f6c');
      }
      drawText(ctx, 'THEN PLAY FROM THE GONNA ICON!', x + CARD.w / 2, y + 156, 1, (t & 16) !== 0 ? '#f5c542' : '#b8860b', 'center');
    } else if (this.platform === 'android') {
      if (this.installAvail) {
        // 1-tap install straight from beforeinstallprompt
        drawText(ctx, 'INSTALL THE CABINET ON YOUR PHONE', x + CARD.w / 2, y + 58, 1, '#c8ccd4', 'center');
        const b = BTN_INSTALL;
        ctx.fillStyle = this.installFired ? '#0f2408' : '#142a10';
        ctx.fillRect(b.x, b.y + dy, b.w, b.h);
        ctx.strokeStyle = (t & 16) !== 0 ? FLUO : '#1e8c0a';
        ctx.lineWidth = 1;
        ctx.strokeRect(b.x + 0.5, b.y + dy + 0.5, b.w - 1, b.h - 1);
        drawTextSh(ctx, this.installFired ? 'CHECK THE PROMPT!' : 'INSTALL NOW - 1 TAP', b.x + b.w / 2, b.y + dy + 7, 1, FLUO, 'center');
        drawText(ctx, 'FREE - NO STORE - HOME SCREEN ICON', x + CARD.w / 2, y + 132, 1, '#8a8f9c', 'center');
      } else {
        // manual fallback (browser did not fire beforeinstallprompt)
        drawText(ctx, '1. TAP THE BROWSER MENU', x + 40, y + 62, 1, '#f2f2f2');
        drawMenuIcon(ctx, x + 24, y + 60);
        drawText(ctx, '2. ADD TO HOME SCREEN / INSTALL APP', x + 40, y + 84, 1, '#f2f2f2');
        drawPlusIcon(ctx, x + 20, y + 78);
        drawText(ctx, 'THEN PLAY FROM THE GONNA ICON!', x + CARD.w / 2, y + 126, 1, (t & 16) !== 0 ? '#f5c542' : '#b8860b', 'center');
      }
    }
    // GOT IT (persists)
    const g = BTN_GOTIT;
    ctx.fillStyle = '#0d1118';
    ctx.fillRect(g.x, g.y + dy, g.w, g.h);
    ctx.strokeStyle = (t & 16) !== 0 ? '#f5c542' : '#b8860b';
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x + 0.5, g.y + dy + 0.5, g.w - 1, g.h - 1);
    drawText(ctx, 'GOT IT', g.x + g.w / 2, g.y + dy + 5, 1, '#f5c542', 'center');
  }
}

// iOS share glyph: box + arrow up
function drawShareIcon(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#4a9df8';
  ctx.fillRect(x + 8, y, 2, 10); // arrow stem
  ctx.fillRect(x + 5, y + 2, 8, 2); // arrow head bar
  ctx.fillRect(x + 6, y + 1, 2, 2);
  ctx.fillRect(x + 10, y + 1, 2, 2);
  ctx.fillRect(x + 7, y, 4, 2);
  ctx.fillRect(x + 2, y + 6, 2, 12); // box left
  ctx.fillRect(x + 14, y + 6, 2, 12); // box right
  ctx.fillRect(x + 2, y + 16, 14, 2); // box bottom
}
// big plus glyph
function drawPlusIcon(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#4a9df8';
  ctx.fillRect(x + 7, y + 2, 4, 14);
  ctx.fillRect(x + 2, y + 7, 14, 4);
}
// home-screen app tile glyph
function drawHomeIcon(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#7fd858';
  ctx.fillRect(x + 2, y + 2, 14, 14);
  ctx.fillStyle = '#0d1118';
  ctx.fillRect(x + 4, y + 4, 10, 10);
  ctx.fillStyle = '#7fd858';
  ctx.fillRect(x + 7, y + 7, 4, 4);
}
// android 3-dot menu glyph
function drawMenuIcon(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#c8ccd4';
  ctx.fillRect(x + 4, y, 3, 3);
  ctx.fillRect(x + 4, y + 5, 3, 3);
  ctx.fillRect(x + 4, y + 10, 3, 3);
}
