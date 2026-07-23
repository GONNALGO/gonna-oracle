// THE WHALE OF WALL STREET — Stage 3 boss. Also defines the shared boss contract.
import { clamp, GRAV, LANE_BOT, LANE_TOP } from './types';
import type { Facing, HitInfo } from './types';
import type { GameCtx } from './ctx';

export type BState = 'intro' | 'idle' | 'swing' | 'flop' | 'summon' | 'stun' | 'dead';

export type BossKind = 'whale' | 'darkgonna' | 'golem' | 'fud';

export interface BossAttack {
  x0: number;
  x1: number;
  laneTol: number;
  dmg: number;
  kb: number;
  down: boolean;
}

// Contract every boss implements (HP bar w/ name, intro text, arena cam lock,
// slow-mo death, phase summons — wired in engine/hud).
export interface BossLike {
  x: number;
  y: number;
  z: number;
  face: Facing;
  hp: number;
  maxHp: number;
  state: string;
  t: number;
  animT: number;
  flashT: number;
  hitPlayer: boolean;
  lastHitId: number;
  swingId: number;
  alive: boolean;
  removeMe: boolean;
  readonly kind: BossKind;
  readonly name: string; // shown on the HP bar
  readonly introLine: string; // popup when the fight starts
  readonly deathLine: string; // overlay text while dying
  readonly slowmo: number; // slow-mo frames on death (0 = none)
  hurt(hit: HitInfo, g: GameCtx): boolean;
  attackBox(): BossAttack | null;
  update(g: GameCtx): void;
  draw(ctx2d: CanvasRenderingContext2D, g: GameCtx): void;
}

export class Boss {
  x: number;
  y = 172;
  z = 0;
  vx = 0;
  vz = 0;
  face: Facing = -1;
  hp = 300;
  maxHp = 300;
  state: BState = 'intro';
  t = 0;
  animT = 0;
  flashT = 0;
  atkCd = 60;
  dmgAccum = 0;
  summoned66 = false;
  summoned33 = false;
  swingId = 0;
  hitPlayer = false;
  lastHitId = 0;
  alive = true;
  removeMe = false;
  readonly kind: BossKind = 'whale';
  readonly name = 'THE WHALE OF WALL STREET';
  readonly introLine = 'YOUR COINS. MY OCEAN.';
  readonly deathLine = 'MARKET CAP REACHED!';
  readonly slowmo = 0;

  constructor(x: number) {
    this.x = x;
  }

  get rage(): boolean { return this.hp < this.maxHp * 0.25; }

  private set(s: BState): void {
    this.state = s;
    this.t = 0;
  }

  hurt(hit: HitInfo, g: GameCtx): boolean {
    if (!this.alive || this.state === 'intro' || this.state === 'dead') return false;
    this.hp -= hit.dmg;
    this.flashT = 5;
    this.dmgAccum += hit.dmg;
    g.fx.spark(this.x + hit.dir * 20, this.y - this.z - 70, hit.down);
    g.fx.popup(this.x + hit.dir * 14, this.y - this.z - 100, '-' + hit.dmg, '#ffe08a');
    g.addMeter(0.1);
    g.hitStop(3);
    g.audio.punch();
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.set('dead');
      g.audio.explode();
      g.fx.shake(10);
      g.fx.flash = 8;
      g.fx.coinsBurst(this.x, this.y - 60, 40);
    } else if (this.dmgAccum >= 55 && this.state !== 'stun') {
      this.dmgAccum = 0;
      this.set('stun');
      g.fx.popup(this.x, this.y - 120, 'STAGGERED!', '#7fd858');
    }
    return true;
  }

  attackBox(): BossAttack | null {
    if (!this.alive) return null;
    if (this.state === 'swing' && this.t >= 26 && this.t <= 33) {
      const reach = 74;
      return {
        x0: this.face === 1 ? this.x : this.x - reach,
        x1: this.face === 1 ? this.x + reach : this.x,
        laneTol: 20, dmg: 15, kb: 5, down: true,
      };
    }
    return null;
  }

  update(g: GameCtx): void {
    this.t++;
    this.animT++;
    if (this.flashT > 0) this.flashT--;
    if (this.atkCd > 0) this.atkCd--;
    const p = g.player;
    const spd = this.rage ? 0.85 : 0.55;

    switch (this.state) {
      case 'intro': {
        if (this.t === 1) g.fx.popup(this.x - 40, this.y - 130, this.introLine, '#f5c542', 110);
        this.x -= 1.1;
        if (this.t > 70) this.set('idle');
        break;
      }
      case 'idle': {
        this.face = p.x >= this.x ? 1 : -1;
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        if (Math.abs(dy) > 8) this.y = clamp(this.y + Math.sign(dy) * spd * 0.8, LANE_TOP, LANE_BOT);
        if (Math.abs(dx) > 60) this.x += Math.sign(dx) * spd;
        // summon punks at HP thresholds
        if (!this.summoned66 && this.hp <= this.maxHp * 0.66) {
          this.summoned66 = true;
          this.set('summon');
        } else if (!this.summoned33 && this.hp <= this.maxHp * 0.33) {
          this.summoned33 = true;
          this.set('summon');
        } else if (this.atkCd <= 0 && p.state !== 'dead') {
          if (Math.abs(dx) < 78 && Math.abs(dy) < 22) {
            this.set('swing');
            this.hitPlayer = false;
          } else if (Math.abs(dx) > 90) {
            this.set('flop');
            this.hitPlayer = false;
          }
        }
        break;
      }
      case 'swing': {
        if (this.t === 26) g.audio.swing();
        if (this.t >= 56) {
          this.set('idle');
          this.atkCd = this.rage ? 40 : 70;
        }
        break;
      }
      case 'flop': {
        if (this.t < 24) {
          // crouch telegraph
          if (this.t === 1) g.audio.jump();
        } else if (this.t === 24) {
          const dx = p.x - this.x;
          const air = 34;
          this.vx = clamp(dx / air, -5, 5);
          this.vz = 5.2;
        } else {
          this.vz -= GRAV;
          this.z += this.vz;
          this.x += this.vx;
          if (this.z <= 0) {
            this.z = 0;
            this.vz = 0;
            this.vx = 0;
            // shockwave!
            g.audio.explode();
            g.fx.shake(9);
            g.fx.ring(this.x, this.y, 110, '#f5c542');
            g.fx.ring(this.x, this.y, 70, '#7fd858');
            g.fx.debris(this.x, this.y, '#f5c542', '#8a8f9c', 12);
            if (p.z <= 0 && Math.abs(p.x - this.x) < 95 && Math.abs(p.y - this.y) < 42) {
              p.hurt({ dmg: 18, kb: 5, down: true, dir: p.x >= this.x ? 1 : -1 }, g);
            }
            this.set('idle');
            this.atkCd = this.rage ? 50 : 90;
          }
        }
        break;
      }
      case 'summon': {
        if (this.t === 20) {
          g.spawnEnemy('gecko', -1);
          g.spawnEnemy('gecko', 1);
          g.fx.popup(this.x, this.y - 120, 'PUMP IT!', '#f5c542');
        }
        if (this.t >= 60) { this.set('idle'); this.atkCd = 40; }
        break;
      }
      case 'stun': {
        if (this.t >= 40) this.set('idle');
        break;
      }
      case 'dead': {
        if (this.t === 1) g.fx.coinsBurst(this.x, this.y - 40, 20);
        if (this.t % 14 === 0 && this.t < 120) {
          g.fx.debris(this.x + (Math.random() - 0.5) * 80, this.y - Math.random() * 80, '#f5c542', '#3b6fd4', 6);
          g.audio.punch();
        }
        if (this.t > 200) this.removeMe = true;
        break;
      }
    }
  }

  draw(ctx2d: CanvasRenderingContext2D, g: GameCtx): void {
    const sx = Math.round(this.x - g.camX);
    const sy = Math.round(this.y - this.z);
    // shadow
    ctx2d.globalAlpha = clamp(0.4 - this.z / 300, 0.1, 0.4);
    ctx2d.fillStyle = '#000';
    ctx2d.beginPath();
    ctx2d.ellipse(sx, this.y + 3, 52, 9, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;

    let img = g.art.boss.idle;
    if (this.state === 'swing' && this.t >= 20) img = g.art.boss.swing;
    if (this.state === 'flop' && this.t >= 20) img = g.art.boss.flop;

    ctx2d.save();
    if (this.flashT > 0) ctx2d.filter = 'brightness(3)';
    if (this.state === 'dead') {
      const fall = Math.min(1, this.t / 60);
      ctx2d.globalAlpha = this.t > 140 ? Math.max(0, 1 - (this.t - 140) / 60) : 1;
      ctx2d.translate(sx, this.y);
      ctx2d.rotate(fall * (Math.PI / 2) * (this.face === 1 ? 1 : -1));
      ctx2d.drawImage(img, -img.width / 2, -img.height);
    } else {
      ctx2d.translate(sx, sy);
      if (this.face === -1) ctx2d.scale(-1, 1);
      ctx2d.drawImage(img, -img.width / 2, -img.height);
    }
    ctx2d.restore();
    ctx2d.globalAlpha = 1;
  }
}
