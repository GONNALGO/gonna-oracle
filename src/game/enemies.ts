// The 4 enemy types: STREET GECKO PUNK, ALGO-BOT drone, WHALE BRUTE, KNIFE SNEK.
import { chance, clamp, GRAV, LANE_BOT, LANE_TOP, VW } from './types';
import type { Facing, HitInfo } from './types';
import type { GameCtx } from './ctx';
import { blockObjects, blockingAt } from './items';
import type { Obstacle } from './items';

export type EnemyKind =
  | 'gecko' | 'drone' | 'whale' | 'snek' | 'ninja' | 'coinsnek' | 'bouncer'
  | 'moltov' | 'bull' | 'cultist'; // v5

export type EState =
  | 'enter' | 'seek' | 'attack' | 'recover' | 'reposition'
  | 'stun' | 'down' | 'getup' | 'held' | 'thrown' | 'block' | 'dead' | 'windup'
  | 'channel'; // v5: cultist revive ritual

interface Stats {
  hp: number;
  spd: number;
  dmg: number;
  range: number;
  score: number;
}

const STATS: Record<EnemyKind, Stats> = {
  gecko: { hp: 20, spd: 0.7, dmg: 6, range: 26, score: 100 },
  drone: { hp: 15, spd: 0.9, dmg: 8, range: 60, score: 150 },
  whale: { hp: 60, spd: 0.42, dmg: 12, range: 64, score: 400 },
  snek: { hp: 25, spd: 1.05, dmg: 7, range: 66, score: 200 },
  ninja: { hp: 30, spd: 1.25, dmg: 7, range: 30, score: 250 }, // NINJA GECKO (v3)
  coinsnek: { hp: 25, spd: 0.95, dmg: 8, range: 92, score: 250 }, // COIN SNEK (v3)
  bouncer: { hp: 60, spd: 0.55, dmg: 12, range: 64, score: 500 }, // BOUNCER WHALE (v3)
  moltov: { hp: 30, spd: 1.0, dmg: 4, range: 26, score: 300 }, // MOLTOTOV SNEK (v5): kiter, area denial
  bull: { hp: 70, spd: 0.5, dmg: 14, range: 40, score: 600 }, // RIOT SHIELD BULL (v5): frontal-immune wall
  cultist: { hp: 35, spd: 0.9, dmg: 6, range: 120, score: 500 }, // FUD CULTIST (v5): revives + heals
};

function isBrute(k: EnemyKind): boolean {
  return k === 'whale' || k === 'bouncer';
}

// v5: a living FUD CULTIST keeps corpses revivable
function cultistAlive(g: GameCtx): boolean {
  for (const e of g.enemies) if (e.alive && e.kind === 'cultist') return true;
  return false;
}

let eSwing = 10000;

export class Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  face: Facing = -1;
  hp: number;
  maxHp: number;
  state: EState = 'enter';
  t = 0;
  animT = 0;
  invuln = 0;
  flashT = 0;
  alive = true; // still in play (dead plays out anim then removed)
  removeMe = false;
  atkCd = 0; // attack cooldown
  swingId = 0;
  hoverPhase = Math.random() * 6.28;
  // dive attack (drone)
  diveTX = 0;
  diveTY = 0;
  hitPlayer = false; // current swing already connected
  lieT = 0;
  lastHitId = 0;
  heldObj: Obstacle | null = null; // whale holding a trash can (v2)
  melee = false; // moltov: close bite vs molotov throw (v5)
  turnCd = 0; // bull: slow turning — the back stays open ~45 frames (v5)
  ritualT = 330; // cultist: revive countdown, fires every ~6s (v5)
  // v8 watchdog bookkeeping (engine): frames spent unreachable + rescue count
  badT = 0;
  snaps = 0;

  constructor(kind: EnemyKind, x: number, y: number, side: Facing) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.face = side === 1 ? 1 : -1; // walking direction into screen
    this.hp = this.maxHp = STATS[kind].hp;
    if (kind === 'drone') this.z = 26;
  }

  private set(s: EState): void {
    this.state = s;
    this.t = 0;
  }

  // ---------- damage intake ----------
  hurt(hit: HitInfo, g: GameCtx): boolean {
    if (!this.alive || this.state === 'dead') return false;
    if (this.state === 'down' && this.z <= 0) return false; // lying: invulnerable (FF style)
    if (this.invuln > 0) return false;
    // RIOT SHIELD BULL (v5): IMMUNE to frontal damage — clang, spark, no
    // damage, no stagger. Beatable from behind / pierce (throws, slam, booms).
    if (this.kind === 'bull' && !hit.pierce && hit.dir !== this.face && this.state !== 'held' && this.state !== 'thrown') {
      g.audio.clang();
      g.fx.spark(this.x + this.face * 18, this.y - this.z - 36, false);
      g.fx.popup(this.x, this.y - this.z - 62, 'CLANG!', '#c8ccd4');
      g.hitStop(2);
      return false;
    }
    // brutes block frontal hits sometimes (thrown objects & explosions pierce)
    if (!hit.pierce && isBrute(this.kind) && this.state === 'seek' && hit.dir !== this.face && chance(0.25)) {
      this.set('block');
      g.audio.block();
      g.fx.spark(this.x + this.face * 14, this.y - 36, false);
      return false;
    }
    if (this.heldObj) this.dropObj(g); // interrupted wind-up: can falls
    this.hp -= hit.dmg;
    this.flashT = 6;
    g.fx.spark(this.x + hit.dir * 6, this.y - this.z - 34, hit.down);
    g.fx.popup(this.x, this.y - this.z - 58, '-' + hit.dmg, '#ffe08a');
    g.addMeter(0.12);
    g.hitStop(hit.down ? 5 : 4);
    g.fx.shake(hit.down ? 3.5 : 1.5);
    if (this.hp <= 0) {
      this.die(hit, g);
    } else if (hit.down) {
      this.set('down');
      this.vz = 2.6;
      this.vx = hit.dir * hit.kb;
      if (this.kind === 'drone') this.z = Math.max(this.z, 4);
      g.audio.hitHard();
    } else {
      this.set('stun');
      this.vx = hit.dir * hit.kb * 0.6;
      g.audio.punch();
    }
    return true;
  }

  private die(hit: HitInfo, g: GameCtx): void {
    this.alive = false;
    this.set('dead');
    this.vz = 2.8;
    this.vx = hit.dir * 2.2;
    this.lieT = 0;
    g.audio.ko();
    g.addScore(STATS[this.kind].score);
    g.fx.popup(this.x, this.y - 70, '+' + STATS[this.kind].score, '#7fd858');
  }

  // drop a carried trash can back to the ground (interrupted / released)
  dropObj(g: GameCtx): void {
    const o = this.heldObj;
    if (!o) return;
    this.heldObj = null;
    o.mode = 'idle';
    o.x = clamp(this.x + this.face * (o.cfg.halfW + 8), 12, g.stageLen - 12);
    o.y = this.y;
  }

  getHeld(g: GameCtx): void {
    this.set('held');
    this.vx = 0; this.vz = 0;
    if (this.kind === 'drone') this.z = 20;
    g.audio.grab();
  }

  escapeHold(g: GameCtx): void {
    if (!this.alive || this.state !== 'held') return; // v8: never re-animate a corpse
    this.set('stun');
    this.t = 8;
    g.audio.swing();
  }

  // v5: raised from the dead by a FUD CULTIST at 50% HP
  revive(g: GameCtx): void {
    this.alive = true;
    this.removeMe = false;
    this.hp = Math.ceil(this.maxHp * 0.5);
    this.lieT = 0;
    this.vx = 0;
    this.vz = 0;
    this.z = 0;
    this.flashT = 0;
    this.hitPlayer = false;
    this.invuln = 40;
    this.set('getup');
    g.fx.ring(this.x, this.y - 8, 34, '#b45aff');
    g.fx.ring(this.x, this.y - 8, 20, '#5a3699');
    g.fx.popup(this.x, this.y - 66, 'REVIVED', '#d89aff');
    g.fx.debris(this.x, this.y - 20, '#7b4bc9', '#b45aff', 10);
  }

  thrown(dir: Facing, g: GameCtx): void {
    if (!this.alive) return; // v8: a corpse stays a corpse (no walking dead)
    this.set('thrown');
    this.face = dir;
    this.vx = dir * 6.5;
    this.vz = 3.2;
    this.z = Math.max(this.z, 6);
    this.swingId = eSwing++;
    this.hitPlayer = false;
    this.invuln = 0;
    g.audio.throwSfx();
  }

  // ---------- attack box vs player ----------
  attackActive(): boolean {
    if (!this.alive) return false;
    if (this.state === 'thrown') return false; // handled vs enemies
    if (this.kind === 'gecko') return this.state === 'attack' && this.t >= 12 && this.t <= 15;
    if (this.kind === 'snek') return this.state === 'attack' && this.t >= 8 && this.t <= 22;
    if (isBrute(this.kind)) return this.state === 'attack' && this.t >= 24 && this.t <= 60;
    if (this.kind === 'drone') return this.state === 'attack' && this.t >= 18;
    if (this.kind === 'ninja') return this.state === 'attack' && this.t >= 6 && this.t <= 24;
    if (this.kind === 'bull') return this.state === 'attack' && this.t >= 20 && this.t <= 56;
    if (this.kind === 'moltov') return this.state === 'attack' && this.melee && this.t >= 8 && this.t <= 14;
    return false; // coinsnek/moltov-throw/cultist use projectiles instead
  }

  attackReach(): { x0: number; x1: number; laneTol: number; dmg: number; kb: number; down: boolean } {
    const s = STATS[this.kind];
    if (isBrute(this.kind)) {
      return { x0: this.x - 16, x1: this.x + 16, laneTol: 14, dmg: s.dmg, kb: 4, down: true };
    }
    if (this.kind === 'drone') {
      return { x0: this.x - 14, x1: this.x + 14, laneTol: 16, dmg: s.dmg, kb: 3, down: true };
    }
    if (this.kind === 'bull') {
      // shield charge: long frontal box, heavy knockdown
      return {
        x0: this.face === 1 ? this.x : this.x - 24,
        x1: this.face === 1 ? this.x + 24 : this.x,
        laneTol: 14,
        dmg: s.dmg,
        kb: 5,
        down: true,
      };
    }
    if (this.kind === 'moltov') {
      // frail close-range bite
      return {
        x0: this.face === 1 ? this.x : this.x - 26,
        x1: this.face === 1 ? this.x + 26 : this.x,
        laneTol: 11,
        dmg: s.dmg,
        kb: 1.5,
        down: false,
      };
    }
    const reach = this.kind === 'snek' ? 30 : this.kind === 'ninja' ? 28 : 24;
    return {
      x0: this.face === 1 ? this.x : this.x - reach,
      x1: this.face === 1 ? this.x + reach : this.x,
      laneTol: this.kind === 'snek' || this.kind === 'ninja' ? 12 : 11,
      dmg: s.dmg,
      kb: this.kind === 'snek' ? 3 : this.kind === 'ninja' ? 2 : 1.5,
      down: this.kind === 'snek',
    };
  }

  // ---------- update ----------
  update(g: GameCtx): void {
    this.t++;
    this.animT++;
    if (this.invuln > 0) this.invuln--;
    if (this.flashT > 0) this.flashT--;
    if (this.atkCd > 0) this.atkCd--;
    if (this.turnCd > 0) this.turnCd--;
    const p = g.player;
    const st = STATS[this.kind];
    const prevX = this.x;

    switch (this.state) {
      case 'enter': {
        // walk onto screen
        this.x += this.face * st.spd * 1.4;
        const inX = this.x > g.camX + 20 && this.x < g.camX + VW - 20;
        if (inX) this.set('seek');
        break;
      }
      case 'seek': {
        const dx0 = p.x - this.x;
        // ---- v5: MOLTOTOV SNEK — kite the player, lob fire from afar ----
        if (this.kind === 'moltov') {
          this.face = dx0 >= 0 ? 1 : -1;
          const dy = p.y - this.y;
          if (Math.abs(dy) > 6) this.y = clamp(this.y + Math.sign(dy) * st.spd * 0.8, LANE_TOP, LANE_BOT);
          const adx = Math.abs(dx0);
          if (adx < 70) {
            this.x -= Math.sign(dx0) * st.spd * 1.25; // frail: flee when close
          } else if (adx > 150) {
            this.x += Math.sign(dx0) * st.spd;
          }
          this.x = clamp(this.x, g.camX - 30, g.camX + VW + 30);
          if (this.atkCd <= 0 && p.state !== 'dead' && Math.abs(dy) < 16) {
            if (adx < 44) {
              this.melee = true; // desperate bite
              this.set('attack');
              this.hitPlayer = false;
              this.swingId = eSwing++;
            } else if (adx < 215) {
              this.melee = false; // molotov lob
              this.set('attack');
              this.hitPlayer = false;
            }
          }
          break;
        }
        // ---- v5: RIOT SHIELD BULL — slow wall, slow to turn, shield charge ----
        if (this.kind === 'bull') {
          const want = dx0 >= 0 ? 1 : -1;
          if (want !== this.face && this.turnCd <= 0) {
            this.face = want;
            this.turnCd = 45; // the blind side stays open a moment
          }
          const dy = p.y - this.y;
          if (Math.abs(dy) > 6) this.y = clamp(this.y + Math.sign(dy) * st.spd * 0.8, LANE_TOP, LANE_BOT);
          if (Math.abs(dx0) > st.range - 10) this.x += this.face * st.spd;
          this.x = clamp(this.x, g.camX - 30, g.camX + VW + 30);
          if (this.atkCd <= 0 && p.state !== 'dead' && Math.abs(dy) < 14 && Math.abs(dx0) < 160) {
            this.set('attack');
            this.hitPlayer = false;
            this.swingId = eSwing++;
          }
          break;
        }
        // ---- v5: FUD CULTIST — stays far, FUD orbs, revive ritual ~6s ----
        if (this.kind === 'cultist') {
          this.face = dx0 >= 0 ? 1 : -1;
          const dy = p.y - this.y;
          if (Math.abs(dy) > 8) this.y = clamp(this.y + Math.sign(dy) * st.spd * 0.7, LANE_TOP, LANE_BOT);
          const adx = Math.abs(dx0);
          if (adx < 95) {
            this.x -= Math.sign(dx0) * st.spd * 1.1; // drift away
          } else if (adx > 185) {
            this.x += Math.sign(dx0) * st.spd * 0.8;
          }
          this.x = clamp(this.x, g.camX - 30, g.camX + VW + 30);
          // revive countdown
          this.ritualT--;
          if (this.ritualT <= 0) {
            if (this.findRitualTarget(g)) {
              this.set('channel');
            } else {
              this.ritualT = 90; // nothing to do yet: retry soon
            }
            break;
          }
          if (this.atkCd <= 0 && p.state !== 'dead' && adx < 235 && Math.abs(dy) < 60) {
            this.set('attack');
            this.hitPlayer = false;
          }
          break;
        }
        this.face = p.x >= this.x ? 1 : -1;
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        // align lane first, then close in X
        if (Math.abs(dy) > 6) {
          this.y = clamp(this.y + Math.sign(dy) * st.spd * 0.8, LANE_TOP, LANE_BOT);
        }
        const wantX = this.kind === 'gecko' ? st.range - 4 : st.range;
        if (Math.abs(dx) > wantX) {
          this.x += Math.sign(dx) * st.spd;
        } else if (this.kind === 'coinsnek' && Math.abs(dx) < 56) {
          this.x -= Math.sign(dx) * st.spd * 0.7; // keep spitting distance
        }
        this.x = clamp(this.x, g.camX - 30, g.camX + VW + 30);
        // hover bob for drone
        if (this.kind === 'drone') {
          this.hoverPhase += 0.08;
          this.z = 24 + Math.sin(this.hoverPhase) * 5;
        }
        if (this.atkCd <= 0 && Math.abs(dy) < 13 && Math.abs(dx) < st.range + 6 && p.state !== 'dead') {
          this.set('attack');
          this.hitPlayer = false;
          this.swingId = eSwing++;
          if (this.kind === 'drone') {
            this.diveTX = p.x;
            this.diveTY = p.y;
          }
        } else if (isBrute(this.kind) && this.atkCd <= 0 && p.state !== 'dead' && this.grabCan(g)) {
          // brute picked up a trash can -> windup state set inside grabCan
        } else if (this.kind === 'ninja' && this.atkCd <= 0 && chance(0.012)) {
          // lane hop
          this.set('reposition');
          this.vy = chance(0.5) ? 1 : -1;
          this.vz = 2.6;
        } else if (this.atkCd <= 0 && chance(0.004)) {
          this.set('reposition');
          this.vy = chance(0.5) ? 1 : -1;
        }
        break;
      }
      case 'reposition': {
        this.y = clamp(this.y + this.vy * st.spd * (this.kind === 'ninja' ? 1.7 : 1), LANE_TOP, LANE_BOT);
        if (this.kind === 'drone') {
          this.hoverPhase += 0.08;
          this.z = 24 + Math.sin(this.hoverPhase) * 5;
        }
        if (this.kind === 'ninja') {
          // lane hop: quick arc between lanes
          this.vz -= GRAV;
          this.z = Math.max(0, this.z + this.vz);
          if (this.t > 26) { this.z = 0; this.vz = 0; this.set('seek'); this.atkCd = 14; }
        } else if (this.t > 50) { this.set('seek'); this.atkCd = 20; }
        break;
      }
      case 'attack': {
        if (this.kind === 'gecko') {
          if (this.t >= 26) { this.set('recover'); this.atkCd = 40 + Math.random() * 30; }
        } else if (this.kind === 'snek') {
          // dash forward with blade
          if (this.t >= 8 && this.t <= 22) this.x += this.face * 4.6;
          if (this.t >= 34) { this.set('recover'); this.atkCd = 50 + Math.random() * 40; }
        } else if (this.kind === 'ninja') {
          // dash + double hit (second window re-arms at t 15)
          if (this.t >= 6 && this.t <= 24) this.x += this.face * 4.4;
          if (this.t === 15) this.hitPlayer = false;
          if (this.t >= 32) { this.set('recover'); this.atkCd = 36 + Math.random() * 26; }
        } else if (this.kind === 'coinsnek') {
          // spit a $GONNA coin
          if (this.t === 10) {
            g.spawnProj('coin', this.x + this.face * 16, this.y, this.face * 3.4);
            g.audio.swing();
          }
          if (this.t >= 28) { this.set('recover'); this.atkCd = 80 + Math.random() * 50; }
        } else if (isBrute(this.kind)) {
          // charge
          if (this.t >= 24 && this.t <= 60) {
            this.x += this.face * (this.kind === 'bouncer' ? 4.2 : 3.2);
            if (this.t % 6 === 0) g.fx.ring(this.x, this.y, 10, '#8a8f9c');
          }
          if (this.t >= 88) { this.set('recover'); this.atkCd = 70 + Math.random() * 40; }
        } else if (this.kind === 'moltov') {
          if (this.melee) {
            // desperate bite (frail in melee)
            if (this.t >= 22) { this.set('recover'); this.atkCd = 70 + Math.random() * 30; }
          } else {
            // wind up, then lob the molotov at the player's position
            if (this.t < 16) this.flashT = (this.t & 4) < 2 ? 2 : 0;
            if (this.t === 16) {
              this.flashT = 0;
              g.spawnProj('molotov', this.x + this.face * 10, this.y, 0, p.x, p.y);
              g.audio.molotov();
            }
            if (this.t >= 34) { this.set('recover'); this.atkCd = 120 + Math.random() * 50; }
          }
        } else if (this.kind === 'bull') {
          // paw the ground (telegraph), then shield charge along the lane
          if (this.t < 20) {
            this.flashT = (this.t & 4) < 2 ? 2 : 0;
            if (this.t === 1) g.fx.popup(this.x, this.y - 78, '!', '#ff6b6b');
          } else if (this.t <= 56) {
            this.flashT = 0;
            this.x += this.face * 4.2;
            if (this.t % 6 === 0) g.fx.ring(this.x, this.y, 10, '#c8ccd4');
          } else if (this.t >= 84) {
            this.set('recover');
            this.atkCd = 100 + Math.random() * 40;
          }
        } else if (this.kind === 'cultist') {
          // cast a slow FUD orb
          if (this.t === 10) {
            g.spawnProj('fudorb', this.x + this.face * 14, this.y, this.face * 1.7);
            g.audio.chant();
          }
          if (this.t >= 26) { this.set('recover'); this.atkCd = 150 + Math.random() * 60; }
        } else {
          // drone dive
          if (this.t < 18) {
            // telegraph hover
            this.flashT = this.t % 6 < 3 ? 2 : 0;
          } else if (this.t === 18) {
            const dx = this.diveTX - this.x;
            const dy = this.diveTY - this.y;
            const dist = Math.max(1, Math.hypot(dx, dy));
            const frames = Math.min(26, dist / 3.4);
            this.vx = (dx / dist) * (dist / frames);
            this.vy = (dy / dist) * (dist / frames);
            this.vz = -(this.z / frames);
            g.audio.swing();
          } else if (this.z > 0.5) {
            this.x += this.vx;
            this.y = clamp(this.y + this.vy, LANE_TOP, LANE_BOT);
            this.z = Math.max(0, this.z + this.vz);
          } else {
            this.z = 0;
            this.set('recover');
            this.atkCd = 60 + Math.random() * 40;
          }
        }
        break;
      }
      case 'recover': {
        if (this.kind === 'drone' && this.z < 24) {
          this.z += 1.4; // rise back
        }
        if (this.t >= (isBrute(this.kind) || this.kind === 'bull' ? 30 : 18)) this.set('seek');
        break;
      }
      case 'block': {
        if (this.t >= 16) this.set('seek');
        break;
      }
      case 'stun': {
        this.x += this.vx;
        this.vx *= 0.8;
        if (this.kind === 'drone') this.z = Math.max(0, this.z - 1);
        if (this.t >= 15) this.set('seek');
        break;
      }
      case 'down':
      case 'thrown':
      case 'dead': {
        this.vz -= GRAV;
        this.z += this.vz;
        this.x += this.vx;
        if (this.z <= 0) {
          this.z = 0;
          if (this.vz < -1.4) {
            this.vz = -this.vz * 0.35;
            this.vx *= 0.5;
            g.audio.land();
            g.fx.ring(this.x, this.y, 12, '#8a8f9c');
          } else {
            this.vz = 0;
            this.vx = 0;
            // v8: a finished knockback slide must LAND inside the walkable
            // band and the stage (mid-flight may leave both, landing may not)
            this.y = clamp(this.y, LANE_TOP, LANE_BOT);
            this.x = clamp(this.x, 8, g.stageLen - 8);
          }
        }
        if (this.state === 'thrown' && this.z <= 0 && this.vz === 0) {
          // thrown enemy lands knocked down
          this.set('down');
          this.t = 20;
          break;
        }
        if (this.state === 'down' && this.z <= 0 && this.vz === 0) {
          this.lieT++;
          if (this.lieT > 34) {
            this.set('getup');
            this.invuln = 50;
          }
        }
        if (this.state === 'dead' && this.z <= 0 && this.vz === 0) {
          this.lieT++;
          // v5: corpses linger (revivable) while a FUD CULTIST still lives
          if (this.lieT > (cultistAlive(g) ? 400 : 70)) this.removeMe = true;
        }
        break;
      }
      case 'getup': {
        // v8: drones always rise back to hover height while getting up
        if (this.kind === 'drone' && this.z < 24) this.z += 1.4;
        if (this.t >= 20) { this.set('seek'); this.atkCd = 30; }
        break;
      }
      case 'windup': {
        // whale telegraphing a trash-can throw (dodge: change lane or jump)
        const o = this.heldObj;
        if (!o) { this.flashT = 0; this.set('seek'); break; }
        this.flashT = (this.t & 8) < 4 ? 2 : 0;
        if (this.t === 1) g.fx.popup(this.x, this.y - 76, '!', '#ff6b6b');
        if (this.t >= 46) {
          this.flashT = 0;
          this.heldObj = null;
          this.face = g.player.x >= this.x ? 1 : -1;
          o.y = this.y;
          o.launch(this.face, true, g);
          this.set('recover');
          this.atkCd = 150;
        }
        break;
      }
      case 'held': {
        // position set by player; timer safety
        if (this.t > 240) this.escapeHold(g);
        break;
      }
      case 'channel': {
        // FUD CULTIST revive ritual: telegraphed "!", then the dead rise
        if (this.t === 1) {
          g.fx.popup(this.x, this.y - 74, '!', '#b45aff');
          g.audio.chant();
        }
        this.flashT = (this.t & 6) < 3 ? 2 : 0; // violet surge
        if (this.t % 10 === 0) g.fx.ring(this.x, this.y - 6, 22, '#5a3699');
        if (this.t >= 55) {
          this.flashT = 0;
          this.doRitual(g);
          this.ritualT = 360; // every ~6s
          this.set('recover');
          this.atkCd = 50;
        }
        break;
      }
    }

    // solid lane objects: block horizontal movement (walk around them)
    if (this.state === 'enter' || this.state === 'seek' || this.state === 'reposition' || this.state === 'attack') {
      const bx = blockObjects(g.obstacles, prevX, this.x, this.y, this.z);
      if (bx !== this.x) {
        this.x = bx;
        if (this.state === 'enter' || this.state === 'seek') {
          // v8: walk AROUND the blocker — nudge the lane position OUT of the
          // blocking object's lane band (the old code nudged toward the lane
          // CENTER, which is inside most objects' bands: the enemy could get
          // stuck forever off-screen in the spawn corridor -> wave soft-lock)
          const ob = blockingAt(g.obstacles, this.x, this.y, this.z);
          if (ob) {
            const upOK = ob.y - ob.cfg.laneHalf >= LANE_TOP;
            const downOK = ob.y + ob.cfg.laneHalf <= LANE_BOT;
            let dirY: number = this.y < ob.y ? -1 : 1;
            if (dirY < 0 && !upOK) dirY = 1;
            if (dirY > 0 && !downOK) dirY = -1;
            this.y = clamp(this.y + dirY * 1.2, LANE_TOP, LANE_BOT);
          }
        }
      }
    }
  }

  // ---- v5: FUD CULTIST ritual ----
  // true when there is a revivable corpse or a wounded ally nearby
  private findRitualTarget(g: GameCtx): boolean {
    for (const e of g.enemies) {
      if (e === this || e.removeMe) continue;
      if (Math.abs(e.x - this.x) > 240) continue;
      if (!e.alive && e.state === 'dead' && e.z <= 0) return true;
      if (e.alive && e.hp < e.maxHp) return true;
    }
    return false;
  }

  // raise the nearest corpse at 50% HP + mend the living
  private doRitual(g: GameCtx): void {
    let best: Enemy | null = null;
    let bestD = 1e9;
    for (const e of g.enemies) {
      if (e === this || e.removeMe || e.alive || e.state !== 'dead' || e.z > 0) continue;
      const d = Math.abs(e.x - this.x);
      if (d < 240 && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) best.revive(g);
    for (const e of g.enemies) {
      if (e === this || e === best || !e.alive || e.hp >= e.maxHp) continue; // best keeps its 50%
      if (Math.abs(e.x - this.x) > 220) continue;
      e.hp = Math.min(e.maxHp, e.hp + 12);
      g.fx.popup(e.x, e.y - 62, '+12', '#b45aff');
      g.fx.ring(e.x, e.y - 8, 16, '#7b4bc9');
    }
    g.audio.revive();
    g.fx.ring(this.x, this.y - 10, 60, '#7b4bc9');
  }

  // whale: pick up a nearby trash can (returns true when grabbed)
  private grabCan(g: GameCtx): boolean {
    for (const o of g.obstacles) {
      if (o.kind !== 'can' || o.mode !== 'idle' || o.removeMe) continue;
      if (Math.abs(o.x - this.x) < 22 && Math.abs(o.y - this.y) < 12 && chance(0.04)) {
        this.heldObj = o;
        o.mode = 'held';
        this.face = g.player.x >= this.x ? 1 : -1;
        this.set('windup');
        g.audio.lift();
        return true;
      }
    }
    return false;
  }

  // ---------- draw ----------
  frame(g: GameCtx): HTMLCanvasElement {
    const a = g.art;
    const wk = (this.animT >> 3) & 1;
    switch (this.kind) {
      case 'gecko':
        if (this.state === 'attack' && this.t >= 8) return a.gecko[2];
        return a.gecko[wk];
      case 'drone':
        if (this.state === 'attack' && this.t >= 14) return a.drone[2];
        return a.drone[wk];
      case 'whale':
        if (this.state === 'block' || this.state === 'windup') return a.whale[3];
        if (this.state === 'attack' && this.t >= 20) return a.whale[2];
        return a.whale[wk];
      case 'bouncer':
        if (this.state === 'block' || this.state === 'windup') return a.bouncer[3];
        if (this.state === 'attack' && this.t >= 20) return a.bouncer[2];
        return a.bouncer[wk];
      case 'ninja':
        if (this.state === 'attack' && this.t >= 4) return a.ninja[2];
        return a.ninja[wk];
      case 'coinsnek':
        if (this.state === 'attack' && this.t >= 4 && this.t <= 18) return a.coinsnek[2];
        return a.coinsnek[wk];
      case 'snek':
        if (this.state === 'attack' && this.t >= 6 && this.t <= 24) return a.snek[2];
        return a.snek[wk];
      case 'moltov':
        if (this.state === 'attack' && !this.melee && this.t >= 4) return a.moltov[2];
        return a.moltov[wk];
      case 'bull':
        if (this.state === 'attack' && this.t >= 14) return a.bull[2];
        return a.bull[wk];
      case 'cultist':
        if (this.state === 'channel') return a.cultist[2];
        if (this.state === 'attack' && this.t >= 4 && this.t <= 16) return a.cultist[2];
        return a.cultist[wk];
    }
  }

  draw(ctx2d: CanvasRenderingContext2D, g: GameCtx): void {
    const sx = Math.round(this.x - g.camX);
    const sy = Math.round(this.y - this.z);
    // fade out corpse (only in its last ~30 frames; lingers while a cultist lives)
    let alpha = 1;
    if (this.state === 'dead') {
      const lim = cultistAlive(g) ? 400 : 70;
      if (this.lieT > lim - 30) alpha = Math.max(0, (lim - this.lieT) / 30);
    }
    // shadow
    ctx2d.globalAlpha = clamp(0.35 - this.z / 220, 0.06, 0.35) * alpha;
    ctx2d.fillStyle = '#000';
    const shw = isBrute(this.kind) || this.kind === 'bull' ? 24 : this.kind === 'snek' || this.kind === 'coinsnek' || this.kind === 'moltov' ? 18 : 14;
    ctx2d.beginPath();
    ctx2d.ellipse(sx, this.y + 2, shw, 4.5, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = alpha;

    const img = this.frame(g);
    const lying = (this.state === 'down' || this.state === 'dead' || this.state === 'thrown') && this.z <= 0 && this.t > 8;
    ctx2d.save();
    if (this.flashT > 0) ctx2d.filter = 'brightness(3)';
    if (this.invuln > 0 && this.state === 'getup' && (this.animT & 4) !== 0) ctx2d.globalAlpha = 0.4 * alpha;
    if (lying) {
      ctx2d.translate(sx, this.y - 4);
      ctx2d.rotate((this.face * -Math.PI) / 2);
      ctx2d.drawImage(img, -img.width / 2, -img.height * 0.6);
    } else {
      ctx2d.translate(sx, sy);
      if (this.face === -1) ctx2d.scale(-1, 1);
      ctx2d.drawImage(img, -img.width / 2, -img.height); // bottom-center anchor
    }
    ctx2d.restore();
    ctx2d.globalAlpha = 1;

    // trash can held overhead during wind-up
    if (this.heldObj) {
      const oi = g.art[this.heldObj.kind];
      ctx2d.drawImage(oi, sx - (oi.width >> 1), Math.round(sy - img.height - oi.height + 6));
    }

    // hp pip bar for brutes (incl. the RIOT SHIELD BULL)
    if ((isBrute(this.kind) || this.kind === 'bull') && this.alive && this.hp < this.maxHp) {
      ctx2d.fillStyle = '#101018';
      ctx2d.fillRect(sx - 16, sy - 70, 32, 4);
      ctx2d.fillStyle = '#e23b3b';
      ctx2d.fillRect(sx - 15, sy - 69, (30 * this.hp) / this.maxHp, 2);
    }
  }
}
