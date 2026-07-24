// v6 — Capcom-grade mobile touch controls.
// Active ONLY on touch devices (pointer coarse / ontouchstart). Desktop: this
// module is never instantiated, zero cost, zero visual change.
// - FLOATING VIRTUAL JOYSTICK (left thumb): dynamic origin where the thumb
//   lands on the left half, 8-way with a short dead zone, translucent.
// - ARCADE BUTTONS (right thumb): PUNCH big, KICK, JUMP, SPECIAL — fan layout,
//   brighten on press, edge-press + held-state semantics identical to keyboard.
// - Multi-touch tracked per pointerId; joystick independent from buttons.
// - Small PAUSE + MUTE buttons in the free top band (never over HUD).
// - Tap anywhere on title/continue/game-over/clear/victory = confirm (start).
// - Haptics via navigator.vibrate, throttled to max 1 call / 50ms.
// Everything is drawn as a canvas overlay inside the existing render loop:
// zero DOM layout thrashing, zero per-frame allocations.

import { drawText } from './font';
import { VH, VW } from './types';
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

// ---------- button layout (internal 384x224 coords, lower-right fan) ----------
interface PadBtn {
  x: number;
  y: number;
  r: number;
  btn: Btn;
  label: string;
}
// resting alpha ~40%, fat-finger hit padding baked into the test
const HIT_PAD = 7;
const PAD_BTNS: PadBtn[] = [
  { x: 333, y: 168, r: 18, btn: 'punch', label: 'P' }, // big
  { x: 300, y: 182, r: 13, btn: 'kick', label: 'K' },
  { x: 329, y: 201, r: 13, btn: 'jump', label: 'J' },
  { x: 361, y: 195, r: 11, btn: 'special', label: 'S' }, // small
];

// small top-band system buttons (the gap between score and G-METER HUD)
const PAUSE_RECT = { x: 244, y: 4, w: 18, h: 13 };
const MUTE_RECT = { x: 268, y: 4, w: 18, h: 13 };

// ---------- joystick tuning ----------
const JOY_DEAD = 7; // short dead zone (px, internal)
const JOY_RANGE = 24; // stick travel clamp

export interface TouchHooks {
  sceneName(): string; // current engine scene
  isPaused(): boolean;
  togglePause(): void;
  toggleMute(): void;
  anyTap(): void; // audio unlock + title music, mirrors Input.anyKey
}

export class TouchControls {
  readonly active: boolean;
  private input: Input;
  private hooks: TouchHooks;
  private canvas: HTMLCanvasElement;
  private fullscreenTried = false;

  // joystick state (no per-frame allocation: plain fields)
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

  // ---------- helpers ----------
  private toGame(e: PointerEvent, out: { x: number; y: number }): void {
    const r = this.canvas.getBoundingClientRect();
    out.x = ((e.clientX - r.left) / r.width) * VW;
    out.y = ((e.clientY - r.top) / r.height) * VH;
  }

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
      const cl = Math.min(dist, JOY_RANGE) / dist;
      nx = dx * cl;
      ny = dy * cl;
    }
    this.joyDX = nx;
    this.joyDY = ny;
    const dead = dist < JOY_DEAD;
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

  // ---------- pointer handlers ----------
  private pt = { x: 0, y: 0 }; // scratch, no allocation per event

  private onCtx = (e: Event): void => {
    e.preventDefault(); // no long-press context menu
  };

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return; // mouse/pen: leave to desktop behavior
    e.preventDefault();
    this.hooks.anyTap(); // audio unlock + title track (mirrors anyKey)
    if (!this.fullscreenTried) {
      this.fullscreenTried = true;
      try {
        const p = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
        if (p) p.catch(() => { /* fullscreen refused: fine */ });
      } catch { /* unsupported */ }
    }
    this.toGame(e, this.pt);
    const x = this.pt.x;
    const y = this.pt.y;
    const scene = this.hooks.sceneName();

    // tap anywhere = confirm on non-play scenes
    if (scene !== 'play') {
      this.setBtn('start', true);
      this.ptrIds.push(e.pointerId);
      this.ptrBtn.push('start');
      this.ptrJoy.push(false);
      return;
    }

    // system buttons (top band)
    if (x >= PAUSE_RECT.x && x <= PAUSE_RECT.x + PAUSE_RECT.w && y >= PAUSE_RECT.y && y <= PAUSE_RECT.y + PAUSE_RECT.h) {
      this.hooks.togglePause();
      this.ptrIds.push(e.pointerId);
      this.ptrBtn.push(null);
      this.ptrJoy.push(false);
      return;
    }
    if (x >= MUTE_RECT.x && x <= MUTE_RECT.x + MUTE_RECT.w && y >= MUTE_RECT.y && y <= MUTE_RECT.y + MUTE_RECT.h) {
      this.hooks.toggleMute();
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
    for (const b of PAD_BTNS) {
      const dx = x - b.x;
      const dy = y - b.y;
      const rr = b.r + HIT_PAD;
      if (dx * dx + dy * dy <= rr * rr) {
        this.setBtn(b.btn, true);
        this.ptrIds.push(e.pointerId);
        this.ptrBtn.push(b.btn);
        this.ptrJoy.push(false);
        return;
      }
    }

    // floating joystick: thumb lands anywhere on the left half
    if (x < VW / 2 && this.joyId === -1) {
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
    this.toGame(e, this.pt);
    this.applyJoy(this.pt.x - this.joyOX, this.pt.y - this.joyOY);
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

  // ---------- canvas overlay draw (called at the end of Game.render) ----------
  draw(c: CanvasRenderingContext2D): void {
    if (!this.active) return;
    const scene = this.hooks.sceneName();
    const inPlay = scene === 'play';
    c.save();
    c.imageSmoothingEnabled = false;

    if (inPlay) {
      // ---- system buttons: PAUSE + MUTE (top band gap) ----
      this.sysBtn(c, PAUSE_RECT.x, PAUSE_RECT.y, PAUSE_RECT.w, PAUSE_RECT.h, this.hooks.isPaused());
      // pause glyph: two bars
      c.fillStyle = '#e8ecf4';
      c.fillRect(PAUSE_RECT.x + 5, PAUSE_RECT.y + 3, 3, 7);
      c.fillRect(PAUSE_RECT.x + 10, PAUSE_RECT.y + 3, 3, 7);
      this.sysBtn(c, MUTE_RECT.x, MUTE_RECT.y, MUTE_RECT.w, MUTE_RECT.h, false);
      drawText(c, 'M', MUTE_RECT.x + 6, MUTE_RECT.y + 3, 1, '#e8ecf4');

      // ---- arcade buttons ----
      for (const b of PAD_BTNS) {
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
        c.fillRect(b.x - b.r + 3, b.y - b.r + 2, b.r * 2 - 6, 2);
        c.globalAlpha = held ? 1 : 0.85;
        drawText(c, b.label, b.x - 3, b.y - 4, 1, '#ffffff');
        c.globalAlpha = 1;
      }
    }

    // ---- floating joystick: only while the thumb is down ----
    if (this.joyId !== -1) {
      const ox = this.joyOX;
      const oy = this.joyOY;
      c.globalAlpha = 0.35; // translucent base
      c.fillStyle = '#0b0d14';
      c.beginPath();
      c.arc(ox, oy, 21, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#8a8f9c';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(ox + 0.5, oy + 0.5, 20, 0, Math.PI * 2);
      c.stroke();
      // 8-way tick marks
      c.fillStyle = '#8a8f9c';
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4;
        c.fillRect(Math.round(ox + Math.cos(ang) * 17) - 1, Math.round(oy + Math.sin(ang) * 17) - 1, 2, 2);
      }
      // stick knob
      c.globalAlpha = 0.55;
      c.fillStyle = '#d4d9e2';
      c.beginPath();
      c.arc(ox + this.joyDX, oy + this.joyDY, 9, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.fillRect(Math.round(ox + this.joyDX) - 6, Math.round(oy + this.joyDY) - 7, 12, 2);
      c.globalAlpha = 1;
    }

    c.restore();
  }

  private sysBtn(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lit: boolean): void {
    c.globalAlpha = lit ? 0.75 : 0.35;
    c.fillStyle = '#0b0d14';
    c.fillRect(x, y, w, h);
    c.strokeStyle = '#8a8f9c';
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    c.globalAlpha = 1;
  }

  // for tests: current joystick origin in game coords (-1,-1 when idle)
  get joyActive(): boolean {
    return this.joyId !== -1;
  }
  get joyOriginX(): number {
    return this.joyOX;
  }
  get joyOriginY(): number {
    return this.joyOY;
  }
}
