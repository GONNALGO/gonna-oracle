// v6.1 — Capcom-grade mobile touch controls, SCREEN-SPACE edition.
// Active ONLY on touch devices (pointer coarse / ontouchstart). Desktop: this
// module is never instantiated, zero cost, zero visual change.
//
// The canvas is now full-bleed (whole viewport) and the 384x224 game view is
// letterboxed INSIDE it (see fit.ts). Touch controls therefore live in screen
// space (CSS px), laid out from the same ViewFit the renderer uses:
// - FLOATING VIRTUAL JOYSTICK (left thumb): dynamic origin where the thumb
//   lands on the LEFT HALF OF THE ACTUAL VIEWPORT, 8-way, short dead zone.
// - ARCADE BUTTONS (right thumb): PUNCH big, KICK, JUMP, SPECIAL — fan layout.
//   Landscape: fan rides the bottom-right corner over the game view.
//   Portrait: fan lives in the free lower area and is LARGER (ergonomic mode).
// - PAUSE / MUTE / ZOOM system buttons: landscape keeps the v6 top-band gap
//   (never over HUD); portrait moves them into the free area below the game
//   view so they stay finger-sized. ZOOM toggles FIT/ZOOM (persisted).
// - Multi-touch tracked per pointerId; joystick independent from buttons.
// - Tap anywhere on title/continue/game-over/clear/victory = confirm (start).
// - Haptics via navigator.vibrate, throttled to max 1 call / 50ms.
// Everything is drawn as a canvas overlay inside the existing render loop:
// zero DOM layout thrashing, zero per-frame allocations.

import { drawText } from './font';
import { computeFit } from './fit';
import type { ViewFit } from './fit';
import { VH } from './types';
import type { Input, Btn } from './input';

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if ('ontouchstart' in window) return true;
  if (navigator.maxTouchPoints > 0) return true;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

// ---------- haptics ----------
export class Haptics {
  enabled = false; // set by TouchControls when a touch device is present
  private last = -100;

  private fire(pattern: number | number[]): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.last < 50) return; // throttled: max 1 vibration / 50ms
    this.last = now;
    try {
      navigator.vibrate(pattern);
    } catch {
      this.enabled = false; // no vibrate support: stop trying
    }
  }

  hit(): void { this.fire(10); } // hit landed
  ko(): void { this.fire(20); } // enemy KO
  hurt(): void { this.fire(30); } // player hurt
  finisher(): void { this.fire(40); } // 5th-hit finisher
  rankUp(): void { this.fire([15, 50, 15]); } // combo rank-up double pulse
}

// ---------- screen-space layout (CSS px) ----------
interface PadBtn {
  x: number;
  y: number;
  r: number;
  btn: Btn;
  label: string;
}
interface SysRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// v6 fan proportions (offsets in units of the PUNCH radius R)
const FAN: { dx: number; dy: number; rr: number; btn: Btn; label: string }[] = [
  { dx: 0, dy: 0, rr: 1, btn: 'punch', label: 'P' }, // big
  { dx: -1.83, dy: 0.78, rr: 0.72, btn: 'kick', label: 'K' },
  { dx: -0.22, dy: 1.83, rr: 0.72, btn: 'jump', label: 'J' },
  { dx: 1.56, dy: 1.5, rr: 0.6, btn: 'special', label: 'S' }, // small
];

// landscape: system buttons keep the v6 top-band gap (game coords), between
// the centered score and the G-METER — never over HUD/G-METER/TIME/combo.
const SYS_GAME: SysRect[] = [
  { x: 244, y: 4, w: 18, h: 13 }, // pause
  { x: 268, y: 4, w: 18, h: 13 }, // mute
  { x: 292, y: 4, w: 18, h: 13 }, // zoom (ends 310 < 318 G-METER)
];

export interface TouchHooks {
  sceneName(): string; // current engine scene
  isPaused(): boolean;
  togglePause(): void;
  toggleMute(): void;
  anyTap(): void; // audio unlock + title music, mirrors Input.anyKey
  zoomOn(): boolean; // v6.1: FIT/ZOOM preference
  toggleZoom(): void;
}

export class TouchControls {
  readonly active: boolean;
  private input: Input;
  private hooks: TouchHooks;
  private canvas: HTMLCanvasElement;
  private fullscreenTried = false;
  private fit: ViewFit = computeFit(384, 224, 1, false, false);

  // layout (CSS px) — recomputed on every viewport change, zero per-frame cost
  private pad: PadBtn[] = [
    { x: 0, y: 0, r: 1, btn: 'punch', label: 'P' },
    { x: 0, y: 0, r: 1, btn: 'kick', label: 'K' },
    { x: 0, y: 0, r: 1, btn: 'jump', label: 'J' },
    { x: 0, y: 0, r: 1, btn: 'special', label: 'S' },
  ];
  private R = 30; // PUNCH radius
  private hitPad = 10;
  private labelScale = 2;
  private pauseR: SysRect = { x: 0, y: 0, w: 0, h: 0 };
  private muteR: SysRect = { x: 0, y: 0, w: 0, h: 0 };
  private zoomR: SysRect = { x: 0, y: 0, w: 0, h: 0 };
  private joyBaseR = 35;
  private joyTravel = 40;
  private joyDead = 12;
  private sysScale = 1; // glyph scale for system buttons

  // joystick state (no per-frame allocation: plain fields, CSS px)
  private joyId = -1;
  private joyOX = 0;
  private joyOY = 0;
  private joyDX = 0; // clamped stick offset for drawing
  private joyDY = 0;
  private joyL = false;
  private joyR = false;
  private joyU = false;
  private joyD = false;

  // active pointers: parallel arrays, pointerId -> Btn it holds (buttons/start)
  private ptrIds: number[] = [];
  private ptrBtn: (Btn | null)[] = [];
  private ptrJoy: boolean[] = [];

  constructor(canvas: HTMLCanvasElement, input: Input, haptics: Haptics, hooks: TouchHooks) {
    this.canvas = canvas;
    this.input = input;
    this.hooks = hooks;
    this.active = isTouchDevice();
    if (!this.active) return;
    input.touchMode = true; // relaxed object-lift tolerance on touch
    haptics.enabled = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    canvas.addEventListener('pointerdown', this.onDown, { passive: false });
    canvas.addEventListener('pointermove', this.onMove, { passive: false });
    canvas.addEventListener('pointerup', this.onUp, { passive: false });
    canvas.addEventListener('pointercancel', this.onUp, { passive: false });
    canvas.addEventListener('contextmenu', this.onCtx);
  }

  destroy(): void {
    if (!this.active) return;
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('contextmenu', this.onCtx);
  }

  // v6.1: same ViewFit the renderer uses — controls follow the same math
  setViewport(f: ViewFit): void {
    this.fit = f;
    if (!this.active) return;
    this.layout();
  }

  private layout(): void {
    const f = this.fit;
    const m = 10; // edge margin
    // v6.2: notch / home-indicator safe areas — controls never go under them
    let sal = 0;
    let sar = 0;
    let sab = 0;
    try {
      const cs = getComputedStyle(document.documentElement);
      sal = parseFloat(cs.getPropertyValue('--sal')) || 0;
      sar = parseFloat(cs.getPropertyValue('--sar')) || 0;
      sab = parseFloat(cs.getPropertyValue('--sab')) || 0;
    } catch { /* no CSS env support: zero insets */ }
    // free area starts under the CURRENT game view (taller when ZOOMed)
    const gameBottom = f.fitOffY + VH * f.scale;
    let px: number;
    let py: number;
    if (f.portrait) {
      // portrait: controls live in the free lower area — LARGER (ergonomic mode)
      const freeH = Math.max(140, f.cssH - gameBottom);
      this.R = Math.min(52, Math.max(34, freeH * 0.14));
      const R = this.R;
      px = f.cssW - m - sar - 2.6 * R;
      py = gameBottom + freeH * 0.5 - 0.775 * R; // fan vertically centered in free area
      if (py - R < gameBottom + 6) py = gameBottom + 6 + R;
      if (py + 2.55 * R > f.cssH - m - sab) py = f.cssH - m - sab - 2.55 * R;
      // system buttons: finger-sized row at the top of the free area (never over HUD)
      const S = 40;
      const sy = gameBottom + 12;
      this.sysScale = 2;
      this.pauseR.x = 12 + sal; this.pauseR.y = sy; this.pauseR.w = S; this.pauseR.h = S;
      this.muteR.x = 62 + sal; this.muteR.y = sy; this.muteR.w = S; this.muteR.h = S;
      this.zoomR.x = 112 + sal; this.zoomR.y = sy; this.zoomR.w = S; this.zoomR.h = S;
    } else {
      // landscape: full-height game view, fan rides the bottom-right corner
      this.R = Math.min(56, Math.max(28, f.cssH * 0.092));
      const R = this.R;
      px = f.cssW - m - sar - 2.6 * R;
      py = f.cssH - m - sab - 2.55 * R;
      // system buttons in the v6 top-band gap (game coords -> screen via FIT)
      this.sysScale = Math.max(1, Math.round(f.fitScale));
      for (let i = 0; i < 3; i++) {
        const g = SYS_GAME[i];
        const r = i === 0 ? this.pauseR : i === 1 ? this.muteR : this.zoomR;
        r.x = f.fitOffX + g.x * f.fitScale;
        r.y = f.fitOffY + g.y * f.fitScale;
        r.w = g.w * f.fitScale;
        r.h = g.h * f.fitScale;
      }
    }
    for (let i = 0; i < 4; i++) {
      const b = this.pad[i];
      const d = FAN[i];
      b.x = px + d.dx * this.R;
      b.y = py + d.dy * this.R;
      b.r = d.rr * this.R;
    }
    this.hitPad = Math.max(8, this.R * 0.3);
    this.labelScale = Math.min(3, Math.max(1, Math.round(this.R / 16)));
    this.joyBaseR = this.R * 1.17;
    this.joyTravel = this.R * 1.33;
    this.joyDead = Math.max(10, this.R * 0.39);
  }

  // ---------- helpers ----------
  private setBtn(b: Btn, isDown: boolean): void {
    const inp = this.input;
    if (isDown) {
      if (!inp.down[b]) inp.pressed[b] = true; // edge, same as keyboard
      inp.down[b] = true;
    } else {
      inp.down[b] = false;
    }
  }

  private heldByOther(id: number, b: Btn): boolean {
    for (let i = 0; i < this.ptrIds.length; i++) {
      if (this.ptrIds[i] !== id && this.ptrBtn[i] === b) return true;
    }
    return false;
  }

  private ptrIndex(id: number): number {
    for (let i = 0; i < this.ptrIds.length; i++) if (this.ptrIds[i] === id) return i;
    return -1;
  }

  private removePtr(i: number): void {
    const last = this.ptrIds.length - 1;
    this.ptrIds[i] = this.ptrIds[last];
    this.ptrBtn[i] = this.ptrBtn[last];
    this.ptrJoy[i] = this.ptrJoy[last];
    this.ptrIds.length = last;
    this.ptrBtn.length = last;
    this.ptrJoy.length = last;
  }

  private applyJoy(dx: number, dy: number): void {
    const dist = Math.sqrt(dx * dx + dy * dy);
    let nx = 0;
    let ny = 0;
    if (dist > 0.001) {
      const cl = Math.min(dist, this.joyTravel) / dist;
      nx = dx * cl;
      ny = dy * cl;
    }
    this.joyDX = nx;
    this.joyDY = ny;
    const dead = dist < this.joyDead;
    // 8-way snap: a cardinal wins its octant when it beats the other axis by tan(22.5deg)
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const T1 = 0.4142; // tan(22.5deg)
    const horiz = !dead && ax > ay * T1;
    const vert = !dead && ay > ax * T1;
    const nl = horiz && dx < 0;
    const nr = horiz && dx > 0;
    const nu = vert && dy < 0;
    const nd = vert && dy > 0;
    if (nl !== this.joyL) { this.joyL = nl; this.setBtn('left', nl); }
    if (nr !== this.joyR) { this.joyR = nr; this.setBtn('right', nr); }
    if (nu !== this.joyU) { this.joyU = nu; this.setBtn('up', nu); }
    if (nd !== this.joyD) { this.joyD = nd; this.setBtn('down', nd); }
  }

  private releaseJoy(): void {
    this.joyId = -1;
    if (this.joyL) { this.joyL = false; this.setBtn('left', false); }
    if (this.joyR) { this.joyR = false; this.setBtn('right', false); }
    if (this.joyU) { this.joyU = false; this.setBtn('up', false); }
    if (this.joyD) { this.joyD = false; this.setBtn('down', false); }
  }

  // ---------- pointer handlers (screen space: canvas is fixed at inset 0) ----------
  private onCtx = (e: Event): void => {
    e.preventDefault(); // no long-press context menu
  };

  private inRect(x: number, y: number, r: SysRect): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return; // mouse/pen: leave to desktop behavior
    e.preventDefault();
    this.hooks.anyTap(); // audio unlock + title track (mirrors anyKey)
    if (!this.fullscreenTried) {
      // v6.1: progressive enhancement only — unsupported on iPhone Safari,
      // the 100dvh canvas + visualViewport refit carry the experience there.
      this.fullscreenTried = true;
      try {
        const p = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
        if (p) p.catch(() => { /* fullscreen refused: fine */ });
      } catch { /* unsupported */ }
      try {
        window.scrollTo(0, 1); // legacy chrome-collapse trick
      } catch { /* ignore */ }
    }
    const x = e.clientX;
    const y = e.clientY;
    const scene = this.hooks.sceneName();

    // tap anywhere = confirm on non-play scenes
    if (scene !== 'play') {
      this.setBtn('start', true);
      this.ptrIds.push(e.pointerId);
      this.ptrBtn.push('start');
      this.ptrJoy.push(false);
      return;
    }

    // system buttons
    if (this.inRect(x, y, this.pauseR)) {
      this.hooks.togglePause();
      this.ptrIds.push(e.pointerId);
      this.ptrBtn.push(null);
      this.ptrJoy.push(false);
      return;
    }
    if (this.inRect(x, y, this.muteR)) {
      this.hooks.toggleMute();
      this.ptrIds.push(e.pointerId);
      this.ptrBtn.push(null);
      this.ptrJoy.push(false);
      return;
    }
    if (this.inRect(x, y, this.zoomR)) {
      this.hooks.toggleZoom();
      this.ptrIds.push(e.pointerId);
      this.ptrBtn.push(null);
      this.ptrJoy.push(false);
      return;
    }
    if (this.hooks.isPaused()) {
      // while paused, only PAUSE (handled above) does anything
      this.ptrIds.push(e.pointerId);
      this.ptrBtn.push(null);
      this.ptrJoy.push(false);
      return;
    }

    // arcade buttons (right thumb fan)
    for (const b of this.pad) {
      const dx = x - b.x;
      const dy = y - b.y;
      const rr = b.r + this.hitPad;
      if (dx * dx + dy * dy <= rr * rr) {
        this.setBtn(b.btn, true);
        this.ptrIds.push(e.pointerId);
        this.ptrBtn.push(b.btn);
        this.ptrJoy.push(false);
        return;
      }
    }

    // floating joystick: thumb lands anywhere on the LEFT HALF of the viewport
    if (x < this.fit.cssW / 2 && this.joyId === -1) {
      this.joyId = e.pointerId;
      this.joyOX = x;
      this.joyOY = y;
      this.joyDX = 0;
      this.joyDY = 0;
      this.ptrIds.push(e.pointerId);
      this.ptrBtn.push(null);
      this.ptrJoy.push(true);
      return;
    }

    // stray touch: track so its release is harmless
    this.ptrIds.push(e.pointerId);
    this.ptrBtn.push(null);
    this.ptrJoy.push(false);
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId !== this.joyId) return;
    e.preventDefault();
    this.applyJoy(e.clientX - this.joyOX, e.clientY - this.joyOY);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    const i = this.ptrIndex(e.pointerId);
    if (i !== -1) {
      const b = this.ptrBtn[i];
      const wasJoy = this.ptrJoy[i];
      this.removePtr(i);
      if (wasJoy && e.pointerId === this.joyId) this.releaseJoy();
      if (b && !this.heldByOther(e.pointerId, b)) this.setBtn(b, false);
    } else if (e.pointerId === this.joyId) {
      this.releaseJoy();
    }
  };

  // ---------- canvas overlay draw (screen space, called at the end of render) ----------
  draw(c: CanvasRenderingContext2D): void {
    if (!this.active) return;
    const f = this.fit;
    const scene = this.hooks.sceneName();
    const inPlay = scene === 'play';
    c.save();
    c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0); // CSS px space
    c.imageSmoothingEnabled = false;

    if (inPlay) {
      // ---- system buttons: PAUSE + MUTE + ZOOM ----
      this.sysBtn(c, this.pauseR, this.hooks.isPaused());
      // pause glyph: two bars
      const pcx = this.pauseR.x + this.pauseR.w / 2;
      const pcy = this.pauseR.y + this.pauseR.h / 2;
      const bw = Math.max(3, this.pauseR.w * 0.14);
      const bh = this.pauseR.h * 0.5;
      c.fillStyle = '#e8ecf4';
      c.fillRect(Math.round(pcx - bw - 1.5), Math.round(pcy - bh / 2), Math.round(bw), Math.round(bh));
      c.fillRect(Math.round(pcx + 1.5), Math.round(pcy - bh / 2), Math.round(bw), Math.round(bh));
      this.sysBtn(c, this.muteR, false);
      drawText(c, 'M', Math.round(this.muteR.x + this.muteR.w / 2 - 3 * this.sysScale), Math.round(this.muteR.y + this.muteR.h / 2 - 4 * this.sysScale), this.sysScale, '#e8ecf4');
      this.sysBtn(c, this.zoomR, this.hooks.zoomOn());
      drawText(c, 'Z', Math.round(this.zoomR.x + this.zoomR.w / 2 - 3 * this.sysScale), Math.round(this.zoomR.y + this.zoomR.h / 2 - 4 * this.sysScale), this.sysScale, this.hooks.zoomOn() ? '#7fd858' : '#e8ecf4');

      // ---- arcade buttons ----
      for (const b of this.pad) {
        const held = this.input.down[b.btn];
        const a = held ? 0.78 : 0.4; // brighten on press, ~40% resting
        c.globalAlpha = a;
        // pixel-art round button: dark rim, colored face, top highlight
        c.fillStyle = '#0b0d14';
        c.beginPath();
        c.arc(b.x, b.y, b.r + 1, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = b.btn === 'punch' ? '#c23b3b' : b.btn === 'kick' ? '#2f6fb2' : b.btn === 'jump' ? '#3f9e4d' : '#b8860b';
        c.beginPath();
        c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.fillRect(Math.round(b.x - b.r + 3), Math.round(b.y - b.r + 2), Math.round(b.r * 2 - 6), 2);
        c.globalAlpha = held ? 1 : 0.85;
        drawText(c, b.label, Math.round(b.x - 3 * this.labelScale), Math.round(b.y - 4 * this.labelScale), this.labelScale, '#ffffff');
        c.globalAlpha = 1;
      }
    }

    // ---- floating joystick: only while the thumb is down ----
    if (this.joyId !== -1) {
      const ox = this.joyOX;
      const oy = this.joyOY;
      const br = this.joyBaseR;
      c.globalAlpha = 0.35; // translucent base
      c.fillStyle = '#0b0d14';
      c.beginPath();
      c.arc(ox, oy, br + 1, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#8a8f9c';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(ox + 0.5, oy + 0.5, br, 0, Math.PI * 2);
      c.stroke();
      // 8-way tick marks
      c.fillStyle = '#8a8f9c';
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4;
        c.fillRect(Math.round(ox + Math.cos(ang) * (br - 4)) - 1, Math.round(oy + Math.sin(ang) * (br - 4)) - 1, 2, 2);
      }
      // stick knob
      const kr = br * 0.43;
      c.globalAlpha = 0.55;
      c.fillStyle = '#d4d9e2';
      c.beginPath();
      c.arc(ox + this.joyDX, oy + this.joyDY, kr, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.fillRect(Math.round(ox + this.joyDX - kr * 0.66), Math.round(oy + this.joyDY - kr * 0.78), Math.round(kr * 1.33), 2);
      c.globalAlpha = 1;
    }

    c.restore();
  }

  private sysBtn(c: CanvasRenderingContext2D, r: SysRect, lit: boolean): void {
    c.globalAlpha = lit ? 0.75 : 0.35;
    c.fillStyle = '#0b0d14';
    c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeStyle = lit ? '#7fd858' : '#8a8f9c';
    c.lineWidth = 1;
    c.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    c.globalAlpha = 1;
  }

  // ---------- test hooks ----------
  // current joystick origin in CSS px (-1,-1 semantics via joyActive)
  get joyActive(): boolean {
    return this.joyId !== -1;
  }
  get joyOriginX(): number {
    return this.joyOX;
  }
  get joyOriginY(): number {
    return this.joyOY;
  }
  // current screen-space layout (CSS px) for headless assertions
  get padLayout(): { x: number; y: number; r: number; btn: string }[] {
    return this.pad;
  }
  get sysLayout(): { pause: SysRect; mute: SysRect; zoom: SysRect } {
    return { pause: this.pauseR, mute: this.muteR, zoom: this.zoomR };
  }
}
