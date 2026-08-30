// Keyboard input: Arrows/WASD move, Z/J punch, X/K kick, SPACE/L jump, C/U special,
// ENTER start/confirm, M mute, P/ESC pause. Edge-triggered "pressed" + level "down".

export type Btn = 'left' | 'right' | 'up' | 'down' | 'punch' | 'kick' | 'jump' | 'special' | 'start' | 'mute' | 'pause' | 'fighter';

const KEYS: Record<string, Btn> = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  KeyZ: 'punch', KeyJ: 'punch',
  KeyX: 'kick', KeyK: 'kick',
  Space: 'jump', KeyL: 'jump',
  KeyC: 'special', KeyU: 'special',
  Enter: 'start',
  KeyM: 'mute',
  KeyP: 'pause', Escape: 'pause',
  KeyT: 'fighter', // v9: CHOOSE YOUR FIGHTER from the title screen
};

export class Input {
  down: Record<Btn, boolean> = {
    left: false, right: false, up: false, down: false,
    punch: false, kick: false, jump: false, special: false, start: false, mute: false, pause: false, fighter: false,
  };
  pressed: Record<Btn, boolean> = { ...this.down };
  /** v9.0.3: raw edge-triggered key CODES (scene shortcuts that share a mapped
   *  key, e.g. KeyD = DISCONNECT on the fighter screen while WASD D = right) */
  pressedCodes = new Set<string>();
  private downCodes = new Set<string>();
  /** v6: true while touch controls are active (relaxed object-lift tolerance) */
  touchMode = false;
  /** v17.0.7 (Friedbean REPLAY MISMATCH): while an arena run sits in a
   * non-play scene (intro / clear / victory), the 8 gameplay buttons must
   * NOT register levels — the GIL log is levels-only and the replay driver
   * re-arms from an all-up baseline at each play segment, so a key that
   * re-arms mid-cut via OS key-repeat would desync the replay. start/pause
   * and menu keys are unaffected. */
  suppressGameplay = false;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  /** fired on any keydown (for AudioContext unlock) */
  anyKey: (() => void) | null = null;

  constructor() {
    this.onKeyDown = (e: KeyboardEvent) => {
      if (this.anyKey) this.anyKey();
      // v9.1: a DOM overlay input (SEAL message) owns its keys — the game must
      // NOT preventDefault Space/arrows/etc. while the player is typing
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      if (!this.downCodes.has(e.code)) this.pressedCodes.add(e.code);
      this.downCodes.add(e.code);
      const b = KEYS[e.code];
      if (!b) return;
      e.preventDefault();
      // v17.0.7: during arena non-play scenes the gameplay buttons are muted
      if (this.suppressGameplay && b !== 'start' && b !== 'pause' && b !== 'mute' && b !== 'fighter') return;
      if (!this.down[b]) this.pressed[b] = true;
      this.down[b] = true;
    };
    this.onKeyUp = (e: KeyboardEvent) => {
      this.downCodes.delete(e.code);
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      const b = KEYS[e.code];
      if (!b) return;
      e.preventDefault();
      this.down[b] = false;
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  // call at END of each logic step to clear edge triggers
  postUpdate(): void {
    for (const k of Object.keys(this.pressed) as Btn[]) this.pressed[k] = false;
    this.pressedCodes.clear();
  }

  // v17.0.7: hard release of every keyboard level+edge — used at scene cuts
  // so a key HELD across the cut cannot enter the next scene as a ghost
  // level (replay parity: the GIL log is levels-only, so both sides must
  // start each play segment from the same all-up baseline). downCodes is
  // kept: the physical key is still down, so no phantom keyup edge; the
  // level re-arms on the next auto-repeat keydown.
  releaseAll(): void {
    for (const k of Object.keys(this.down) as Btn[]) this.down[k] = false;
    for (const k of Object.keys(this.pressed) as Btn[]) this.pressed[k] = false;
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
