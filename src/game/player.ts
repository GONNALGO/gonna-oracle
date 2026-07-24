// GONNA — the player. States, free-flow combos (v4), grab/throw, jump, special, carry.
import { clamp, comboRankTier, GRAV, LANE_BOT, LANE_TOP, VW } from './types';
import type { Facing, HitInfo } from './types';
import type { GameCtx } from './ctx';
import type { Enemy } from './enemies';
import { blockObjects } from './items';
import type { Obstacle } from './items';

export type PState =
  | 'idle' | 'walk' | 'punch' | 'kick' | 'jump' | 'jumpkick'
  | 'hurt' | 'down' | 'getup' | 'grab' | 'knee' | 'throw'
  | 'special' | 'dead' | 'victory' | 'carry';

const SCALE = 0.55; // source frames are ~2x game size
const IDLE_FR = ['0_0', '0_1', '0_3', '0_5'];
const WALK_FR = ['3_0', '3_1', '3_2', '3_5'];

// ---- v4 free-flow combo ----
const CHAIN_WINDOW = 24; // ~400ms at 60Hz opened by every landed hit
const STRING_MAX = 5; // hits per string; the 5th is always a FINISHER
const PUNCH_FR = ['1_1', '1_2', '1_3']; // Z branch: fast hits cycle
const KICK_FR = ['1_4', '1_5']; // X branch: heavy hits cycle

export interface AttackBox {
  x0: number;
  x1: number;
  y: number;
  laneTol: number;
  dmg: number;
  kb: number;
  down: boolean;
  id: number;
}

let swingCounter = 1;

export class Player {
  x = 60;
  y = 178;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  face: Facing = 1;
  hp = 100;
  maxHp = 100;
  lives = 2;
  meter = 0; // 0..3 segments
  knifeUses = 0;
  state: PState = 'idle';
  t = 0;
  animT = 0;
  invuln = 0;
  flashT = 0;
  // ---- v4 free-flow combo state ----
  comboHits = 0; // consecutive landed hits (the combo counter)
  comboDmg = 0; // total damage dealt during the current combo
  chainT = 0; // frames left in the chain window (refreshed per landed hit)
  whiffs = 0; // consecutive whiffed swings (2 = combo drop)
  chainPos = 0; // position of the current swing inside the 5-hit string
  finisher = false; // current swing is the 5th-hit finisher
  atkFrame = '1_1'; // sprite frame of the current swing
  swingLanded = false; // current swing connected with something
  queuedBtn: 'punch' | 'kick' | null = null; // buffered continuation
  punchCyc = -1; // punch frame cycle cursor
  kickCyc = -1; // kick frame cycle cursor
  rankTier = 0; // highest rank tier reached this combo (sfx trigger)
  swingId = 0;
  held: Enemy | null = null;
  knees = 0;
  airAtk = false;
  withKnife = false;
  carrying: Obstacle | null = null; // lane object held overhead (v2)

  reset(x: number, y: number): void {
    this.x = x; this.y = y; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.face = 1;
    this.hp = this.maxHp;
    this.meter = 0;
    this.knifeUses = 0;
    this.state = 'idle';
    this.t = 0; this.invuln = 0; this.flashT = 0;
    this.comboHits = 0; this.comboDmg = 0; this.chainT = 0; this.whiffs = 0;
    this.chainPos = 0; this.finisher = false; this.swingLanded = false;
    this.queuedBtn = null; this.punchCyc = -1; this.kickCyc = -1; this.rankTier = 0;
    this.held = null; this.knees = 0; this.airAtk = false;
    this.carrying = null; this.withKnife = false;
  }

  get onGround(): boolean { return this.z <= 0; }
  get busy(): boolean {
    return this.state !== 'idle' && this.state !== 'walk';
  }

  private set(s: PState): void {
    this.state = s;
    this.t = 0;
  }

  // ---------- damage intake ----------
  hurt(hit: HitInfo, g: GameCtx): boolean {
    if (this.invuln > 0 || this.state === 'dead' || this.state === 'down' || this.state === 'getup' || this.state === 'victory') return false;
    if (this.state === 'grab' || this.state === 'knee') this.releaseHeld(g, false);
    if (this.carrying) this.setDown(g); // drop the object when hit
    this.endCombo(g); // taking damage breaks the combo
    this.hp -= hit.dmg;
    this.flashT = 8;
    g.fx.spark(this.x, this.y - 40, true);
    g.fx.popup(this.x, this.y - 66, '-' + hit.dmg, '#ff6b6b');
    g.fx.shake(3);
    g.hitStop(4);
    g.haptics.hurt(); // v6: 30ms buzz when the player takes a hit
    if (this.hp <= 0) {
      this.hp = 0;
      this.set('dead');
      this.vz = 2.6;
      this.vx = hit.dir * 2;
      g.audio.ko();
    } else if (hit.down) {
      this.set('down');
      this.vz = 2.4;
      this.vx = hit.dir * hit.kb;
      g.audio.ko();
    } else {
      this.set('hurt');
      this.vx = hit.dir * hit.kb * 0.5;
      g.audio.hurtPlayer();
    }
    return true;
  }

  private releaseHeld(g: GameCtx, thrown: boolean): void {
    if (!this.held) return;
    const e = this.held;
    this.held = null;
    if (thrown) {
      e.thrown(this.face, g);
    } else {
      e.escapeHold(g);
    }
  }

  // ---------- v4 combo bookkeeping ----------
  // +10% cumulative damage per hit in the chain, capped at +50%
  get comboMult(): number {
    return 1 + 0.1 * Math.min(STRING_MAX, this.comboHits);
  }
  scaledDmg(base: number): number {
    return Math.round(base * this.comboMult);
  }

  // called by the engine each time a punch/kick swing connects with a foe
  registerHit(g: GameCtx, dmg: number): void {
    const first = !this.swingLanded;
    this.swingLanded = true;
    this.whiffs = 0;
    this.comboHits++;
    this.chainT = CHAIN_WINDOW;
    this.comboDmg += dmg;
    if (this.comboHits >= 2) g.addMeter(0.06); // G-meter bonus on chained hits
    const tier = comboRankTier(this.comboHits);
    let rankedUp = false;
    if (tier > this.rankTier) {
      this.rankTier = tier;
      rankedUp = true;
      g.audio.rankUp();
    }
    // v6 haptics: finisher 40ms > rank-up double pulse > plain hit 10ms
    if (this.finisher && first) g.haptics.finisher();
    else if (rankedUp) g.haptics.rankUp();
    else g.haptics.hit();
    if (this.finisher && first) {
      // FINISHER: flash + long hit-stop (+ brief slow-mo once combo >= 5)
      g.fx.flash = 4;
      g.hitStop(9);
      if (this.comboHits >= 5) g.slowMo(6);
    }
  }

  endCombo(g: GameCtx): void {
    if (this.comboHits >= 2) {
      g.fx.popup(this.x, this.y - 86, this.comboHits + ' HITS +' + this.comboDmg, '#f5c542', 80);
    }
    this.comboHits = 0;
    this.comboDmg = 0;
    this.chainT = 0;
    this.whiffs = 0;
    this.rankTier = 0;
  }

  // ---------- attack box for engine ----------
  attackBox(): AttackBox | null {
    const mk = (reach: number, dmg: number, kb: number, down: boolean): AttackBox => ({
      x0: this.face === 1 ? this.x + 6 : this.x - 6 - reach,
      x1: this.face === 1 ? this.x + 6 + reach : this.x - 6,
      y: this.y,
      laneTol: 13,
      dmg, kb, down,
      id: this.swingId,
    });
    if (this.state === 'punch') {
      const active = this.t >= 4 && this.t <= 8;
      if (!active) return null;
      if (this.withKnife) return this.finisher ? mk(50, 18, 3, true) : mk(50, 15, 2, false);
      if (this.finisher) return mk(38, 13, 3.5, true);
      return mk(34, 7, 1.5, false);
    }
    if (this.state === 'kick') {
      if (this.t < 7 || this.t > 12) return null;
      if (this.finisher) return mk(46, 18, 4, true);
      return mk(44, 11, 2.5, false);
    }
    if (this.state === 'jumpkick') {
      return mk(40, 14, 3, true);
    }
    if (this.state === 'knee') {
      if (this.t < 4 || this.t > 8) return null;
      return mk(30, 6, 1, false);
    }
    return null;
  }

  // ---------- update ----------
  update(g: GameCtx): void {
    this.t++;
    this.animT++;
    if (this.invuln > 0) this.invuln--;
    if (this.flashT > 0) this.flashT--;
    // chain window decay — combo drops when it runs out
    if (this.chainT > 0) {
      this.chainT--;
      if (this.chainT === 0) this.endCombo(g);
    }
    const inp = g.input;

    switch (this.state) {
      case 'idle':
      case 'walk': {
        let dx = (inp.down.right ? 1 : 0) - (inp.down.left ? 1 : 0);
        let dy = (inp.down.down ? 1 : 0) - (inp.down.up ? 1 : 0);
        if (dx !== 0 && dy !== 0) { dx *= 0.8; dy *= 0.8; }
        const oldX = this.x;
        this.x = clamp(this.x + dx * 1.4, g.camX + 12, Math.min(g.camX + VW - 12, g.stageLen - 10));
        this.y = clamp(this.y + dy * 1.0, LANE_TOP, LANE_BOT);
        this.x = blockObjects(g.obstacles, oldX, this.x, this.y, this.z);
        if (dx !== 0) this.face = dx > 0 ? 1 : -1;
        this.state = dx !== 0 || dy !== 0 ? 'walk' : 'idle';

        if (inp.pressed.jump) {
          this.set('jump');
          this.vz = 4.6;
          this.airAtk = false;
          g.audio.jump();
        } else if (inp.pressed.special && this.meter >= 1) {
          this.meter -= 1;
          this.hp = Math.max(1, this.hp - 5);
          this.set('special');
          g.audio.special();
          g.fx.flash = 6;
        } else if (inp.pressed.punch) {
          // grab check: stunned enemy in reach
          const e = this.findGrabbable(g);
          if (e) {
            this.set('grab');
            this.held = e;
            this.knees = 0;
            this.face = e.x >= this.x ? 1 : -1;
            e.getHeld(g);
            g.audio.grab();
          } else {
            // lift check: DOWN+Z near an object, or Z while touching it
            const o = this.findLiftable(g);
            if (o) this.lift(o, g);
            else this.startSwing('punch', g);
          }
        } else if (inp.pressed.kick) {
          this.startSwing('kick', g);
        }
        break;
      }

      case 'carry': {
        if (!this.carrying) { this.set('idle'); break; }
        let dx = (inp.down.right ? 1 : 0) - (inp.down.left ? 1 : 0);
        let dy = (inp.down.down ? 1 : 0) - (inp.down.up ? 1 : 0);
        if (dx !== 0 && dy !== 0) { dx *= 0.8; dy *= 0.8; }
        const oldX = this.x;
        // walk speed -40% while hauling
        this.x = clamp(this.x + dx * 1.4 * 0.6, g.camX + 12, Math.min(g.camX + VW - 12, g.stageLen - 10));
        this.y = clamp(this.y + dy * 1.0 * 0.6, LANE_TOP, LANE_BOT);
        this.x = blockObjects(g.obstacles, oldX, this.x, this.y, this.z);
        if (dx !== 0) this.face = dx > 0 ? 1 : -1;
        if (inp.pressed.jump) {
          this.setDown(g); // object drops, then jump
          this.set('jump');
          this.vz = 4.6;
          this.airAtk = false;
          g.audio.jump();
        } else if (inp.pressed.punch) {
          this.setDown(g); // Z: set down gently
          this.set('idle');
        } else if (inp.pressed.kick) {
          // X: THROW forward along the lane
          const o = this.carrying;
          this.carrying = null;
          o.y = this.y;
          o.launch(this.face, false, g);
          this.set('throw');
        }
        break;
      }

      case 'punch':
      case 'kick': {
        // free-flow: either button buffers the next hit of the string
        if (this.t >= 4) {
          if (inp.pressed.punch) this.queuedBtn = 'punch';
          else if (inp.pressed.kick) this.queuedBtn = 'kick';
        }
        const dur = this.state === 'punch' ? (this.finisher ? 18 : 14) : this.finisher ? 24 : 20;
        if (this.t >= dur) {
          if (!this.swingLanded) {
            this.whiffs++;
            if (this.whiffs >= 2) this.endCombo(g); // 2 consecutive whiffs drop the combo
          }
          if (this.queuedBtn) this.startSwing(this.queuedBtn, g);
          else this.set('idle');
        }
        break;
      }

      case 'jump':
      case 'jumpkick': {
        this.vz -= GRAV;
        this.z += this.vz;
        const dx = (inp.down.right ? 1 : 0) - (inp.down.left ? 1 : 0);
        this.x = clamp(this.x + dx * 1.2, g.camX + 12, Math.min(g.camX + VW - 12, g.stageLen - 10));
        if (dx !== 0 && this.state === 'jump') this.face = dx > 0 ? 1 : -1;
        if (this.state === 'jump' && (inp.pressed.punch || inp.pressed.kick)) {
          this.state = 'jumpkick';
          this.swingId = swingCounter++;
          g.audio.swing();
        }
        if (this.z <= 0) {
          this.z = 0;
          this.vz = 0;
          this.set('idle');
          g.audio.land();
          g.fx.ring(this.x, this.y, 14, '#8a8f9c');
        }
        break;
      }

      case 'special': {
        // BYZANTINE SLAM: spin + shockwave, engine applies the hit at t==10
        if (this.t === 10) {
          g.fx.ring(this.x, this.y - 10, 120, '#7fd858');
          g.fx.ring(this.x, this.y - 10, 80, '#f5c542');
          g.fx.shake(7);
          g.fx.flash = 5;
          g.hitStop(6);
        }
        if (this.t % 3 === 0) this.face = this.face === 1 ? -1 : 1; // spin flip
        if (this.t >= 44) {
          this.face = 1;
          this.set('idle');
        }
        break;
      }

      case 'hurt': {
        this.x += this.vx;
        this.vx *= 0.85;
        if (this.t >= 14) this.set('idle');
        break;
      }

      case 'down':
      case 'dead': {
        this.vz -= GRAV;
        this.z += this.vz;
        this.x += this.vx;
        if (this.z <= 0) {
          this.z = 0;
          if (this.vz < -1.2) {
            this.vz = -this.vz * 0.4; // bounce
            this.vx *= 0.5;
            g.audio.land();
          } else {
            this.vz = 0;
            this.vx = 0;
          }
        }
        if (this.state === 'down' && this.t >= 44) {
          this.set('getup');
          this.invuln = 70;
        }
        break;
      }

      case 'getup': {
        if (this.t >= 18) this.set('idle');
        break;
      }

      case 'grab': {
        if (!this.held) { this.set('idle'); break; }
        // hold enemy in front
        this.held.x = this.x + this.face * 18;
        this.held.y = this.y;
        if (inp.pressed.punch) {
          this.set('knee');
          this.swingId = swingCounter++;
        } else if (inp.pressed.kick || this.t > 200) {
          this.set('throw');
          g.audio.throwSfx();
          this.releaseHeld(g, true);
        }
        break;
      }

      case 'knee': {
        if (this.held) {
          this.held.x = this.x + this.face * 18;
          this.held.y = this.y;
        }
        if (this.t >= 14) {
          this.knees++;
          if (!this.held || this.knees >= 2) {
            this.set('throw');
            g.audio.throwSfx();
            this.releaseHeld(g, true);
          } else {
            this.set('grab');
          }
        }
        break;
      }

      case 'throw': {
        if (this.t >= 18) this.set('idle');
        break;
      }

      case 'victory':
        break;
    }
  }

  // Free-flow swing starter (v4): button picks the branch, chain position the
  // string slot. Z = fast hit (next punch frame), X = heavy hit (next kick
  // frame). The 5th landed-hit slot is always the FINISHER.
  private startSwing(btn: 'punch' | 'kick', g: GameCtx): void {
    const pos = (this.comboHits % STRING_MAX) + 1;
    this.chainPos = pos;
    this.finisher = pos === STRING_MAX;
    this.withKnife = btn === 'punch' && this.knifeUses > 0;
    if (this.withKnife) this.knifeUses--;
    if (this.withKnife) {
      this.atkFrame = '1_2'; // knife stab keeps its own frame
    } else if (btn === 'punch') {
      this.punchCyc = (this.punchCyc + 1) % PUNCH_FR.length;
      this.atkFrame = this.finisher ? PUNCH_FR[PUNCH_FR.length - 1] : PUNCH_FR[this.punchCyc];
    } else {
      this.kickCyc = (this.kickCyc + 1) % KICK_FR.length;
      this.atkFrame = this.finisher ? KICK_FR[KICK_FR.length - 1] : KICK_FR[this.kickCyc];
    }
    this.swingLanded = false;
    this.queuedBtn = null;
    this.swingId = swingCounter++;
    this.set(btn);
    g.audio.swing();
  }

  private findGrabbable(g: GameCtx): Enemy | null {
    for (const e of g.enemies) {
      if (!e.alive || e.state !== 'stun') continue;
      if (Math.abs(e.x - this.x) < 26 && Math.abs(e.y - this.y) < 12) return e;
    }
    return null;
  }

  // ---------- lane objects: lift / carry / throw ----------
  private findLiftable(g: GameCtx): Obstacle | null {
    const inp = g.input;
    // v7 touch fix: thumbs have no DOWN chord and 8-way stick lane alignment
    // is imprecise, so on touch the lane window AND the proximity reach are
    // generous — a P tap anywhere near an object lifts it instead of whiffing
    // a punch that would smash the (hp=1) object. Desktop rule is UNCHANGED.
    const touch = inp.touchMode;
    for (const o of g.obstacles) {
      if (o.mode !== 'idle' || o.removeMe || !o.cfg.liftable) continue;
      const dx = Math.abs(o.x - this.x);
      if (Math.abs(o.y - this.y) >= (touch ? 17 : 12)) continue;
      if (dx < o.cfg.halfW + (touch ? 24 : 14) && (inp.down.down || dx <= o.cfg.halfW + (touch ? 20 : 8))) return o;
    }
    return null;
  }

  private lift(o: Obstacle, g: GameCtx): void {
    o.mode = 'held';
    this.carrying = o;
    this.face = o.x >= this.x ? 1 : -1;
    this.set('carry');
    g.audio.lift();
    g.haptics.hit(); // v7: tactile confirm that the lift triggered (touch only)
    g.fx.popup(this.x, this.y - 76, g.input.touchMode ? 'K THROW / P DROP' : 'X THROW / Z DROP', '#c8ccd4');
  }

  setDown(g: GameCtx): void {
    const o = this.carrying;
    if (!o) return;
    this.carrying = null;
    o.mode = 'idle';
    o.x = clamp(this.x + this.face * (o.cfg.halfW + 8), 12, g.stageLen - 12);
    o.y = this.y;
    g.audio.land();
  }

  // ---------- draw ----------
  draw(ctx2d: CanvasRenderingContext2D, g: GameCtx): void {
    const sx = Math.round(this.x - g.camX);
    const sy = Math.round(this.y - this.z);
    // shadow
    ctx2d.globalAlpha = clamp(0.4 - this.z / 200, 0.08, 0.4);
    ctx2d.fillStyle = '#000';
    ctx2d.beginPath();
    ctx2d.ellipse(sx, this.y + 2, 16 - this.z * 0.04, 5 - this.z * 0.015, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;

    // invuln blink
    if (this.invuln > 0 && (this.animT & 4) !== 0 && this.state !== 'getup') return;

    let key = '0_0';
    switch (this.state) {
      case 'idle': key = IDLE_FR[(this.animT >> 3) & 3]; break;
      case 'walk': key = WALK_FR[Math.floor(this.animT / 6) & 3]; break;
      case 'punch': key = this.withKnife ? '1_2' : this.atkFrame; break;
      case 'kick': key = this.atkFrame; break;
      case 'jump': key = this.vz > 0 ? ((this.animT & 8) === 0 ? '2_0' : '2_5') : '2_2'; break;
      case 'jumpkick': key = '1_4'; break;
      case 'hurt': key = '3_3'; break;
      case 'down': case 'dead': key = '3_3'; break;
      case 'getup': key = '3_3'; break;
      case 'grab': case 'knee': key = this.state === 'knee' ? '1_3' : '0_0'; break;
      case 'throw': key = '1_5'; break;
      case 'carry': key = WALK_FR[Math.floor(this.animT / 6) & 3]; break;
      case 'special': key = '2_0'; break;
      case 'victory': key = (this.animT & 8) === 0 ? '2_0' : '2_1'; break;
    }
    const img = g.frames.get(key);
    if (!img) return;
    const dw = img.width * SCALE;
    const dh = img.height * SCALE;

    ctx2d.save();
    if (this.flashT > 0) ctx2d.filter = 'brightness(3)';
    // finisher gleam while the 5th-hit swing is out
    else if (this.finisher && (this.state === 'punch' || this.state === 'kick') && this.t <= 14) {
      ctx2d.filter = 'brightness(1.8)';
    }
    const lying = (this.state === 'down' || this.state === 'dead') && this.z <= 0 && this.t > 10;
    if (lying) {
      ctx2d.translate(sx, this.y - 4);
      ctx2d.rotate((this.face * -Math.PI) / 2);
      ctx2d.drawImage(img, -dw / 2, -dh * 0.6, dw, dh);
    } else {
      ctx2d.translate(sx, sy);
      if (this.face === -1) ctx2d.scale(-1, 1);
      // bottom-center anchor: feet on ground line
      ctx2d.drawImage(img, -dw / 2, -dh, dw, dh);
      // knife in hand during slash
      if (this.state === 'punch' && this.withKnife && this.t >= 4 && this.t <= 8) {
        ctx2d.drawImage(g.art.knife, dw * 0.30, -dh * 0.72, 20, 9);
      }
    }
    ctx2d.restore();

    // carried lane object held overhead (Final Fight style)
    if (this.carrying) {
      const oi = g.art[this.carrying.kind];
      const bob = (this.animT & 8) === 0 ? 0 : -1;
      ctx2d.drawImage(oi, sx - (oi.width >> 1), Math.round(sy - dh - oi.height + 6 + bob));
    }
  }
}
