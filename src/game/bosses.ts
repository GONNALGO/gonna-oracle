// v3 bosses: DARK GONNA (S4), SLOT GOLEM (S5), EMPEROR FUD (S6 final).
// All follow the BossLike contract from boss.ts (HP bar w/ name, intro text,
// arena cam lock, slow-mo death, phase summons).
import { chance, clamp, GRAV, LANE_BOT, LANE_TOP, rand, VW } from './types';
import type { Facing, HitInfo } from './types';
import type { GameCtx } from './ctx';
import { Boss } from './boss';
import type { BossAttack, BossKind, BossLike } from './boss';

export function makeBoss(kind: BossKind, x: number): BossLike {
  switch (kind) {
    case 'darkgonna': return new DarkGonna(x);
    case 'golem': return new SlotGolem(x);
    case 'fud': return new EmperorFud(x);
    case 'gonna404': return new Gonna404(x);
    default: return new Boss(x);
  }
}

// shared damage intake (whale contract: flash, meter, hitStop, stagger, death fx)
function bossHurt(b: DarkGonna | SlotGolem | EmperorFud, hit: HitInfo, g: GameCtx, staggerAt: number): boolean {
  if (!b.alive || b.state === 'intro' || b.state === 'dead') return false;
  b.hp -= hit.dmg;
  b.flashT = 5;
  b.dmgAccum += hit.dmg;
  g.fx.spark(b.x + hit.dir * 16, b.y - b.z - 50, hit.down);
  g.fx.popup(b.x + hit.dir * 12, b.y - b.z - 80, '-' + hit.dmg, '#ffe08a');
  g.addMeter(0.1);
  g.hitStop(3);
  g.audio.punch();
  if (b.hp <= 0) {
    b.hp = 0;
    b.alive = false;
    b.setDead();
    g.audio.explode();
    g.fx.shake(10);
    g.fx.flash = 8;
  } else if (b.dmgAccum >= staggerAt && b.state !== 'stun' && b.state !== 'storm') {
    b.dmgAccum = 0;
    b.setStun();
    g.fx.popup(b.x, b.y - 110, 'STAGGERED!', '#7fd858');
  }
  return true;
}

// ---------------- DARK GONNA — the evil doppelganger (Stage 4) ----------------
type DGState = 'intro' | 'idle' | 'combo' | 'kick' | 'jumpkick' | 'slam' | 'stun' | 'dead';

const DG_IDLE = ['0_0', '0_1', '0_3', '0_5'];
const DG_WALK = ['3_0', '3_1', '3_2', '3_5'];
const DG_SCALE = 0.55;

export class DarkGonna implements BossLike {
  x: number;
  y = 178;
  z = 0;
  vx = 0;
  vz = 0;
  face: Facing = -1;
  hp = 220;
  maxHp = 220;
  state: DGState = 'intro';
  t = 0;
  animT = 0;
  flashT = 0;
  atkCd = 50;
  slamCd = 240;
  dmgAccum = 0;
  comboN = 1;
  queued = false;
  lockX = 0;
  lockY = 0;
  hitPlayer = false;
  lastHitId = 0;
  swingId = 0;
  alive = true;
  removeMe = false;
  dropped = false;
  readonly kind: BossKind = 'darkgonna';
  readonly name = 'DARK GONNA';
  readonly introLine = 'ONLY ONE LIZARD WEARS THE CROWN';
  readonly deathLine = 'THE CROWN IS YOURS!';
  readonly slowmo = 50;
  private dark: Map<string, HTMLCanvasElement> | null = null;

  constructor(x: number) {
    this.x = x;
  }

  get rage(): boolean { return this.hp < this.maxHp * 0.25; }

  private set(s: DGState): void {
    this.state = s;
    this.t = 0;
  }
  setDead(): void { this.set('dead'); }
  setStun(): void { this.set('stun'); }

  hurt(hit: HitInfo, g: GameCtx): boolean {
    return bossHurt(this, hit, g, 48);
  }

  attackBox(): BossAttack | null {
    if (!this.alive) return null;
    const mk = (reach: number, dmg: number, kb: number, down: boolean): BossAttack => ({
      x0: this.face === 1 ? this.x + 4 : this.x - 4 - reach,
      x1: this.face === 1 ? this.x + 4 + reach : this.x - 4,
      laneTol: 13, dmg, kb, down,
    });
    if (this.state === 'combo' && this.t >= 4 && this.t <= 8) {
      if (this.comboN === 3) return mk(38, 11, 4, true);
      return mk(34, 7, 2, false);
    }
    if (this.state === 'kick' && this.t >= 9 && this.t <= 14) return mk(46, 14, 4, true);
    if (this.state === 'jumpkick' && this.z > 4) return mk(40, 12, 3, true);
    return null;
  }

  update(g: GameCtx): void {
    this.t++;
    this.animT++;
    if (this.flashT > 0) this.flashT--;
    if (this.atkCd > 0) this.atkCd--;
    if (this.slamCd > 0) this.slamCd--;
    const p = g.player;
    const spd = this.rage ? 1.25 : 0.95;

    switch (this.state) {
      case 'intro': {
        if (this.t === 1) g.fx.popup(this.x - 60, this.y - 110, this.introLine, '#ff6b6b', 130);
        this.x -= 1.2;
        if (this.t > 80) this.set('idle');
        break;
      }
      case 'idle': {
        this.face = p.x >= this.x ? 1 : -1;
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        if (Math.abs(dy) > 6) this.y = clamp(this.y + Math.sign(dy) * spd * 0.85, LANE_TOP, LANE_BOT);
        if (Math.abs(dx) > 36) this.x += Math.sign(dx) * spd;
        if (this.atkCd <= 0 && p.state !== 'dead') {
          const adx = Math.abs(dx);
          const ady = Math.abs(dy);
          if (adx < 42 && ady < 14) {
            this.comboN = 1;
            this.queued = false;
            this.set(chance(0.62) ? 'combo' : 'kick');
            this.swingId++;
            this.hitPlayer = false;
            g.audio.swing();
          } else if (this.slamCd <= 0 && adx > 60 && adx < 200) {
            this.set('slam');
            this.hitPlayer = false;
          } else if (adx >= 44 && adx < 160 && chance(0.5)) {
            this.set('jumpkick');
            this.vz = 4.6;
            this.vx = clamp(dx / 30, -4.4, 4.4);
            this.swingId++;
            this.hitPlayer = false;
            g.audio.jump();
          }
        }
        break;
      }
      case 'combo': {
        // mirror of the player's 3-punch chain
        if (this.t >= 5 && (this.rage || chance(0.06))) this.queued = true;
        if (this.t < 8) this.x += this.face * 1.4;
        if (this.t === 8) this.hitPlayer = false; // next punch can connect
        const dur = this.comboN === 3 ? 20 : 15;
        if (this.t >= dur) {
          if (this.queued && this.comboN < 3) {
            this.comboN++;
            this.queued = false;
            this.swingId++;
            this.hitPlayer = false;
            this.set('combo');
            g.audio.swing();
          } else {
            this.set('idle');
            this.atkCd = this.rage ? 30 : 55;
          }
        }
        break;
      }
      case 'kick': {
        if (this.t >= 26) {
          this.set('idle');
          this.atkCd = this.rage ? 36 : 65;
        }
        break;
      }
      case 'jumpkick': {
        this.vz -= GRAV;
        this.z += this.vz;
        this.x += this.vx;
        if (this.z <= 0) {
          this.z = 0;
          this.vz = 0;
          g.audio.land();
          g.fx.ring(this.x, this.y, 16, '#5a3699');
          this.set('idle');
          this.atkCd = this.rage ? 34 : 60;
        }
        break;
      }
      case 'slam': {
        // BYZANTINE SLAM (dark): telegraph locks the target lane — dodge by changing lane
        if (this.t === 1) {
          this.lockX = p.x;
          this.lockY = p.y;
          g.audio.jump();
        }
        if (this.t < 30) {
          this.flashT = (this.t & 6) < 3 ? 2 : 0;
          if (this.t % 8 === 0) g.fx.ring(this.lockX, this.lockY, 30, '#7b4bc9');
          if (this.t === 1) g.fx.popup(this.x, this.y - 96, 'DARK SLAM!', '#c9a7ff');
        } else if (this.t === 30) {
          this.flashT = 0;
          const air = 32;
          this.vx = clamp((this.lockX - this.x) / air, -6, 6);
          this.vz = 5.4;
        } else {
          this.vz -= GRAV;
          this.z += this.vz;
          this.x += this.vx;
          if (this.z <= 0) {
            this.z = 0;
            this.vz = 0;
            this.vx = 0;
            g.audio.explode();
            g.fx.shake(8);
            g.fx.ring(this.x, this.y, 95, '#7b4bc9');
            g.fx.ring(this.x, this.y, 60, '#e23b3b');
            g.fx.debris(this.x, this.y, '#7b4bc9', '#101018', 12);
            if (p.z < 24 && Math.abs(p.x - this.x) < 70 && Math.abs(p.y - this.y) < 40) {
              p.hurt({ dmg: 16, kb: 5, down: true, dir: p.x >= this.x ? 1 : -1 }, g);
            }
            this.set('idle');
            this.atkCd = this.rage ? 40 : 70;
            this.slamCd = this.rage ? 200 : 320;
          }
        }
        break;
      }
      case 'stun': {
        if (this.t >= 36) this.set('idle');
        break;
      }
      case 'dead': {
        // dissolves into green pixels
        if (this.t % 5 === 0 && this.t < 130) {
          g.fx.debris(this.x + rand(-14, 14), this.y - rand(0, 60), '#3fae4a', '#7fd858', 4);
          if (this.t % 20 === 0) g.audio.punch();
        }
        if (this.t === 110 && !this.dropped) {
          this.dropped = true;
          g.dropItem('liz', this.x, this.y);
          g.fx.popup(this.x, this.y - 90, 'GOLDEN LIZARD 1UP!', '#f5c542', 90);
          g.audio.oneUp();
        }
        if (this.t > 190) this.removeMe = true;
        break;
      }
    }
  }

  private darkFrames(g: GameCtx): Map<string, HTMLCanvasElement> {
    if (!this.dark) {
      this.dark = new Map();
      const keys = [...DG_IDLE, ...DG_WALK, '1_1', '1_2', '1_3', '1_4', '1_5', '2_0', '2_2', '2_5', '3_3'];
      for (const k of keys) {
        const img = g.frames.get(k);
        if (!img) continue;
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const cx = c.getContext('2d')!;
        cx.imageSmoothingEnabled = false;
        // dark/red palette swap of the player's own frames
        cx.filter = 'grayscale(0.9) brightness(0.42) sepia(1) saturate(5) hue-rotate(-50deg)';
        cx.drawImage(img, 0, 0);
        cx.filter = 'none';
        // glowing red eyes
        cx.fillStyle = '#ff2a2a';
        cx.fillRect(Math.round(img.width * 0.5), Math.round(img.height * 0.15), 5, 4);
        cx.fillRect(Math.round(img.width * 0.5) + 8, Math.round(img.height * 0.15), 5, 4);
        this.dark.set(k, c);
      }
    }
    return this.dark;
  }

  draw(ctx2d: CanvasRenderingContext2D, g: GameCtx): void {
    const sx = Math.round(this.x - g.camX);
    const sy = Math.round(this.y - this.z);
    // shadow
    ctx2d.globalAlpha = clamp(0.4 - this.z / 220, 0.08, 0.4);
    ctx2d.fillStyle = '#000';
    ctx2d.beginPath();
    ctx2d.ellipse(sx, this.y + 2, 16 - this.z * 0.04, 5 - this.z * 0.015, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;

    let key = '0_0';
    switch (this.state) {
      case 'intro':
      case 'idle': key = DG_IDLE[(this.animT >> 3) & 3]; break;
      case 'combo': key = this.comboN === 1 ? '1_1' : this.comboN === 2 ? '1_2' : '1_3'; break;
      case 'kick': key = this.t < 13 ? '1_4' : '1_5'; break;
      case 'jumpkick': key = '1_4'; break;
      case 'slam': key = this.z > 0 ? (this.vz > 0 ? '2_0' : '2_2') : '2_5'; break;
      case 'stun': key = '3_3'; break;
      case 'dead': key = '3_3'; break;
    }
    const img = this.darkFrames(g).get(key);
    if (!img) return;
    const dw = img.width * DG_SCALE;
    const dh = img.height * DG_SCALE;

    ctx2d.save();
    if (this.flashT > 0) ctx2d.filter = 'brightness(3)';
    if (this.state === 'dead') {
      ctx2d.globalAlpha = this.t > 40 ? Math.max(0, 1 - (this.t - 40) / 90) : 1;
    }
    ctx2d.translate(sx, sy);
    if (this.face === -1) ctx2d.scale(-1, 1);
    ctx2d.drawImage(img, -dw / 2, -dh, dw, dh);
    ctx2d.restore();
    ctx2d.globalAlpha = 1;
  }
}

// ---------------- SLOT GOLEM — the house incarnate (Stage 5) ----------------
type SGState = 'intro' | 'idle' | 'coins' | 'slots' | 'stomp' | 'stun' | 'dead';

export class SlotGolem implements BossLike {
  x: number;
  y = 176;
  z = 0;
  face: Facing = -1;
  hp = 260;
  maxHp = 260;
  state: SGState = 'intro';
  t = 0;
  animT = 0;
  flashT = 0;
  atkCd = 60;
  slotsCd = 300;
  dmgAccum = 0;
  jackpot = false;
  hitPlayer = false;
  lastHitId = 0;
  swingId = 0;
  alive = true;
  removeMe = false;
  rained = false;
  readonly kind: BossKind = 'golem';
  readonly name = 'SLOT GOLEM';
  readonly introLine = 'THE HOUSE ALWAYS WINS';
  readonly deathLine = 'JACKPOT! THE HOUSE FALLS!';
  readonly slowmo = 60;

  constructor(x: number) {
    this.x = x;
  }

  private set(s: SGState): void {
    this.state = s;
    this.t = 0;
  }
  setDead(): void { this.set('dead'); }
  setStun(): void { this.set('stun'); }

  hurt(hit: HitInfo, g: GameCtx): boolean {
    return bossHurt(this, hit, g, 58);
  }

  attackBox(): BossAttack | null {
    return null; // all attacks are projectiles / telegraphed AoE
  }

  update(g: GameCtx): void {
    this.t++;
    this.animT++;
    if (this.flashT > 0) this.flashT--;
    if (this.atkCd > 0) this.atkCd--;
    if (this.slotsCd > 0) this.slotsCd--;
    const p = g.player;

    // JACKPOT MODE under 50% HP
    if (!this.jackpot && this.alive && this.hp <= this.maxHp * 0.5) {
      this.jackpot = true;
      g.fx.popup(this.x, this.y - 120, 'JACKPOT MODE!', '#f5c542', 100);
      g.fx.flash = 5;
      g.audio.oneUp();
    }
    const spd = this.jackpot ? 0.85 : 0.5;
    const cdScale = this.jackpot ? 0.55 : 1;

    switch (this.state) {
      case 'intro': {
        if (this.t === 1) g.fx.popup(this.x - 60, this.y - 120, this.introLine, '#f5c542', 130);
        this.x -= 0.9;
        if (this.t > 80) this.set('idle');
        break;
      }
      case 'idle': {
        this.face = p.x >= this.x ? 1 : -1;
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        if (Math.abs(dy) > 8) this.y = clamp(this.y + Math.sign(dy) * spd * 0.8, LANE_TOP, LANE_BOT);
        if (Math.abs(dx) > 66) this.x += Math.sign(dx) * spd;
        if (this.atkCd <= 0 && p.state !== 'dead') {
          if (Math.abs(dx) < 76 && Math.abs(dy) < 22) {
            this.set('stomp');
          } else if (this.slotsCd <= 0) {
            this.set('slots');
          } else if (Math.abs(dx) > 70) {
            this.set('coins');
          }
        }
        break;
      }
      case 'coins': {
        // 3-coin volley along adjacent lanes
        if (this.t === 8 || this.t === 18 || this.t === 28) {
          const off = this.t === 18 ? 0 : this.t === 8 ? -14 : 14;
          g.spawnProj('coin', this.x + this.face * 42, clamp(this.y + off, LANE_TOP, LANE_BOT), this.face * (this.jackpot ? 4.4 : 3.6));
          g.audio.swing();
        }
        if (this.t >= 44) {
          this.set('idle');
          this.atkCd = Math.round(95 * cdScale);
        }
        break;
      }
      case 'slots': {
        // reel spin telegraph, then BAR = nothing / 777 = explosion on the player's spot
        if (this.t === 1) g.fx.popup(this.x, this.y - 122, 'SPINNING...', '#c8ccd4', 60);
        if (this.t < 62) {
          this.flashT = (this.t & 8) < 4 ? 2 : 0;
          if (this.t % 12 === 0) g.audio.uiMove();
        } else if (this.t === 62) {
          this.flashT = 0;
          if (chance(0.45)) {
            // 7 7 7 — explosion telegraphed by the spin; dodge by moving away
            const ex = p.x;
            const ey = p.y;
            g.fx.popup(this.x, this.y - 122, '7 7 7 !', '#ff6b6b', 70);
            g.audio.explode();
            g.fx.shake(9);
            g.fx.flash = 6;
            g.fx.ring(ex, ey - 8, 80, '#f5c542');
            g.fx.ring(ex, ey - 8, 52, '#e23b3b');
            g.fx.debris(ex, ey - 12, '#f5c542', '#e23b3b', 14);
            if (p.z < 30 && Math.abs(p.x - ex) < 52 && Math.abs(p.y - ey) < 34) {
              p.hurt({ dmg: 20, kb: 5, down: true, dir: p.x >= ex ? 1 : -1 }, g);
            }
          } else {
            g.fx.popup(this.x, this.y - 122, 'BAR... NOTHING', '#8a8f9c', 60);
            g.audio.block();
          }
          this.slotsCd = Math.round((this.jackpot ? 300 : 480) * 1);
        }
        if (this.t >= 84) {
          this.set('idle');
          this.atkCd = Math.round(70 * cdScale);
        }
        break;
      }
      case 'stomp': {
        if (this.t < 20) {
          this.flashT = (this.t & 6) < 3 ? 2 : 0;
        } else if (this.t === 20) {
          this.flashT = 0;
          g.audio.explode();
          g.fx.shake(8);
          g.fx.ring(this.x, this.y, 115, '#f5c542');
          g.fx.ring(this.x, this.y, 70, '#c8ccd4');
          g.fx.debris(this.x, this.y, '#f5c542', '#7a1a2a', 10);
          if (p.z < 12 && Math.abs(p.x - this.x) < 110 && Math.abs(p.y - this.y) < 46) {
            p.hurt({ dmg: 14, kb: 4, down: true, dir: p.x >= this.x ? 1 : -1 }, g);
          }
        }
        if (this.t >= 42) {
          this.set('idle');
          this.atkCd = Math.round(85 * cdScale);
        }
        break;
      }
      case 'stun': {
        if (this.t >= 40) this.set('idle');
        break;
      }
      case 'dead': {
        // explodes into a rain of collectible $GONNA coins
        if (this.t === 1) {
          g.fx.coinsBurst(this.x, this.y - 60, 30);
          for (let i = 0; i < 14; i++) g.dropItem('coinG', this.x + rand(-70, 70), clamp(this.y + rand(-20, 20), LANE_TOP, LANE_BOT));
        }
        if (this.t % 12 === 0 && this.t < 130) {
          g.fx.debris(this.x + rand(-40, 40), this.y - rand(0, 90), '#f5c542', '#7a1a2a', 6);
          if (this.t % 24 === 0) g.audio.coin();
        }
        if (this.t === 60) g.fx.coinsBurst(this.x, this.y - 40, 20);
        if (this.t > 200) this.removeMe = true;
        break;
      }
    }
  }

  draw(ctx2d: CanvasRenderingContext2D, g: GameCtx): void {
    const sx = Math.round(this.x - g.camX);
    const sy = Math.round(this.y - this.z);
    ctx2d.globalAlpha = 0.4;
    ctx2d.fillStyle = '#000';
    ctx2d.beginPath();
    ctx2d.ellipse(sx, this.y + 3, 44, 8, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;

    let img = g.art.golem.idle;
    if (this.state === 'coins' || this.state === 'slots') img = g.art.golem.attack;
    if (this.state === 'stomp' && this.t >= 14) img = g.art.golem.stomp;

    ctx2d.save();
    if (this.flashT > 0) ctx2d.filter = 'brightness(3)';
    if (this.state === 'dead') {
      ctx2d.globalAlpha = this.t > 120 ? Math.max(0, 1 - (this.t - 120) / 70) : 1;
      const fall = Math.min(1, this.t / 70);
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

// ---------------- EMPEROR FUD — final boss (Stage 6) ----------------
type FState = 'intro' | 'idle' | 'swing' | 'summon' | 'storm' | 'charge' | 'slam' | 'stun' | 'dead';

export class EmperorFud implements BossLike {
  x: number;
  y = 176;
  z = 0;
  vx = 0;
  vz = 0;
  face: Facing = -1;
  hp = 350;
  maxHp = 350;
  state: FState = 'intro';
  t = 0;
  animT = 0;
  flashT = 0;
  atkCd = 70;
  stormCd = 200;
  dmgAccum = 0;
  summoned80 = false;
  summoned55 = false;
  hitPlayer = false;
  lastHitId = 0;
  swingId = 0;
  alive = true;
  removeMe = false;
  readonly kind: BossKind = 'fud';
  readonly name = 'EMPEROR FUD';
  readonly introLine = 'BOW BEFORE EMPEROR FUD';
  readonly deathLine = 'FUD ELIMINATED. TO THE MOON.';
  readonly slowmo = 150;

  constructor(x: number) {
    this.x = x;
  }

  get phase(): number {
    const f = this.hp / this.maxHp;
    return f > 0.6 ? 1 : f > 0.3 ? 2 : 3;
  }

  private set(s: FState): void {
    this.state = s;
    this.t = 0;
  }
  setDead(): void { this.set('dead'); }
  setStun(): void { this.set('stun'); }

  hurt(hit: HitInfo, g: GameCtx): boolean {
    return bossHurt(this, hit, g, 72);
  }

  attackBox(): BossAttack | null {
    if (!this.alive) return null;
    if (this.state === 'swing' && this.t >= 22 && this.t <= 30) {
      const reach = 96;
      return {
        x0: this.face === 1 ? this.x : this.x - reach,
        x1: this.face === 1 ? this.x + reach : this.x,
        laneTol: 22, dmg: 16, kb: 5, down: true,
      };
    }
    if (this.state === 'charge' && this.t >= 16 && this.t <= 56) {
      return {
        x0: this.x - 40,
        x1: this.x + 40,
        laneTol: 20, dmg: 16, kb: 5, down: true,
      };
    }
    return null;
  }

  update(g: GameCtx): void {
    this.t++;
    this.animT++;
    if (this.flashT > 0) this.flashT--;
    if (this.atkCd > 0) this.atkCd--;
    if (this.stormCd > 0) this.stormCd--;
    const p = g.player;
    const ph = this.phase;
    const spd = ph === 3 ? 0.9 : 0.5;

    switch (this.state) {
      case 'intro': {
        if (this.t === 1) g.fx.popup(this.x - 70, this.y - 160, this.introLine, '#c9a7ff', 140);
        this.x -= 0.8;
        if (this.t > 90) this.set('idle');
        break;
      }
      case 'idle': {
        this.face = p.x >= this.x ? 1 : -1;
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        if (Math.abs(dy) > 10) this.y = clamp(this.y + Math.sign(dy) * spd * 0.7, LANE_TOP, LANE_BOT);
        if (Math.abs(dx) > 76) this.x += Math.sign(dx) * spd;
        // phase summons
        if (!this.summoned80 && this.hp <= this.maxHp * 0.8) {
          this.summoned80 = true;
          this.set('summon');
        } else if (!this.summoned55 && this.hp <= this.maxHp * 0.55) {
          this.summoned55 = true;
          this.set('summon');
        } else if (this.atkCd <= 0 && p.state !== 'dead') {
          if (ph === 2 && this.stormCd <= 0) {
            this.set('storm');
          } else if (ph === 3 && Math.abs(dx) > 90) {
            this.set(chance(0.5) ? 'charge' : 'slam');
            this.hitPlayer = false;
          } else if (Math.abs(dx) < 100 && Math.abs(dy) < 24) {
            this.set('swing');
            this.hitPlayer = false;
          } else if (ph === 3) {
            this.set('charge');
            this.hitPlayer = false;
          }
        }
        break;
      }
      case 'swing': {
        if (this.t === 22) g.audio.swing();
        if (this.t >= 52) {
          this.set('idle');
          this.atkCd = ph === 3 ? 36 : 64;
        }
        break;
      }
      case 'summon': {
        if (this.t === 20) {
          g.spawnEnemy('ninja', -1);
          g.spawnEnemy(ph === 1 ? 'ninja' : 'coinsnek', 1);
          g.fx.popup(this.x, this.y - 160, 'FUD RISES!', '#c9a7ff');
          g.audio.lift();
        }
        if (this.t >= 56) {
          this.set('idle');
          this.atkCd = 40;
        }
        break;
      }
      case 'storm': {
        // FUD STORM: red projectile rain, telegraphed ground shadows
        if (this.t === 1) {
          g.fx.popup(this.x, this.y - 160, 'FUD STORM!', '#ff6b6b', 90);
          g.audio.special();
        }
        if (this.t > 10 && this.t < 140 && this.t % 22 === 0) {
          for (let i = 0; i < 4; i++) {
            const tx = i < 2 ? p.x + rand(-50, 50) : g.camX + rand(40, VW - 40);
            const ty = i < 2 ? p.y + rand(-18, 18) : rand(LANE_TOP + 4, LANE_BOT);
            g.spawnProj('fud', clamp(tx, g.camX + 20, g.camX + VW - 20), clamp(ty, LANE_TOP, LANE_BOT), 0);
          }
        }
        if (this.t >= 150) {
          this.set('idle');
          this.atkCd = 50;
          this.stormCd = 260;
        }
        break;
      }
      case 'charge': {
        // rage charge across the arena
        if (this.t < 16) {
          this.flashT = (this.t & 6) < 3 ? 2 : 0;
          if (this.t === 1) g.fx.popup(this.x, this.y - 160, '!', '#ff6b6b');
        } else {
          this.flashT = 0;
          if (this.t === 16) g.audio.swing();
          if (this.t <= 56) {
            this.x += this.face * 5.2;
            this.x = clamp(this.x, g.camX + 46, g.camX + VW - 46);
            if (this.t % 5 === 0) g.fx.ring(this.x, this.y, 14, '#7b4bc9');
          }
        }
        if (this.t >= 66) {
          this.set('idle');
          this.atkCd = 30;
        }
        break;
      }
      case 'slam': {
        // rage leap + AoE slam
        if (this.t < 22) {
          this.flashT = (this.t & 6) < 3 ? 2 : 0;
          if (this.t === 1) g.audio.jump();
        } else if (this.t === 22) {
          this.flashT = 0;
          const air = 34;
          this.vx = clamp((p.x - this.x) / air, -5.5, 5.5);
          this.vz = 5.6;
        } else {
          this.vz -= GRAV;
          this.z += this.vz;
          this.x += this.vx;
          if (this.z <= 0) {
            this.z = 0;
            this.vz = 0;
            this.vx = 0;
            g.audio.explode();
            g.fx.shake(11);
            g.fx.flash = 4;
            g.fx.ring(this.x, this.y, 120, '#f5c542');
            g.fx.ring(this.x, this.y, 80, '#7b4bc9');
            g.fx.debris(this.x, this.y, '#f5c542', '#7b4bc9', 14);
            if (p.z < 24 && Math.abs(p.x - this.x) < 95 && Math.abs(p.y - this.y) < 46) {
              p.hurt({ dmg: 20, kb: 6, down: true, dir: p.x >= this.x ? 1 : -1 }, g);
            }
            this.set('idle');
            this.atkCd = 34;
          }
        }
        break;
      }
      case 'stun': {
        if (this.t >= 34) this.set('idle');
        break;
      }
      case 'dead': {
        // slow-mo golden explosion (engine reads `slowmo`)
        if (this.t === 1) {
          g.fx.flash = 10;
          g.fx.shake(12);
          g.fx.coinsBurst(this.x, this.y - 80, 40);
          g.fx.popup(this.x, this.y - 170, this.deathLine, '#f5c542', 170);
        }
        if (this.t % 10 === 0 && this.t < 160) {
          g.fx.debris(this.x + rand(-55, 55), this.y - rand(0, 130), '#f5c542', '#b8860b', 7);
          g.fx.ring(this.x + rand(-40, 40), this.y - rand(0, 60), 40, '#f5c542');
          if (this.t % 30 === 0) g.audio.explode();
        }
        if (this.t === 90) g.fx.coinsBurst(this.x, this.y - 60, 30);
        if (this.t > 230) this.removeMe = true;
        break;
      }
    }
  }

  draw(ctx2d: CanvasRenderingContext2D, g: GameCtx): void {
    const sx = Math.round(this.x - g.camX);
    const sy = Math.round(this.y - this.z);
    ctx2d.globalAlpha = clamp(0.42 - this.z / 300, 0.1, 0.42);
    ctx2d.fillStyle = '#000';
    ctx2d.beginPath();
    ctx2d.ellipse(sx, this.y + 3, 58, 10, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;

    let img = g.art.fud.idle;
    if (this.state === 'swing' && this.t >= 14) img = g.art.fud.swing;
    if (this.state === 'charge' && this.t >= 16) img = g.art.fud.charge;
    if (this.state === 'slam' || this.state === 'storm') img = g.art.fud.slam;

    ctx2d.save();
    if (this.flashT > 0) ctx2d.filter = 'brightness(3)';
    if (this.state === 'dead') {
      ctx2d.globalAlpha = this.t > 150 ? Math.max(0, 1 - (this.t - 150) / 70) : 1;
      ctx2d.translate(sx, sy);
      if (this.face === -1) ctx2d.scale(-1, 1);
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


// ---------------- GONNA 404 — the Sovereign's echo (Stage 7, v9.5) ----------------
// The champion's own ghost: REAL rainbow skin frames, the player's moveset,
// the record's signature 10-hit combo, glitch teleport (NOT FOUND), rainbow rage.
// Entrance: the golden statue minted in THE MINTING cracks open on the pedestal.

import { skinFramesLoaded } from './skins';
import { THRONE_FX } from './stages';

type G4State = 'intro' | 'idle' | 'combo' | 'combo10' | 'kick' | 'jumpkick' | 'teleport' | 'stun' | 'dead';

const G4_IDLE = ['0_0', '0_1', '0_3', '0_5'];
const G4_WALK = ['3_0', '3_1', '3_2', '3_5'];
const G4_SCALE = 0.55;
const G4_RAINBOW = ['#ff5a5a', '#ffb02e', '#f5d76e', '#39ff14', '#3cc9ff', '#b07eff'];

function g4tint(img: HTMLImageElement | HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

export class Gonna404 implements BossLike {
  x: number;
  y = 178;
  z = 0;
  vx = 0;
  vz = 0;
  face: Facing = -1;
  hp = 420; // tankier than FUD (350): the final throne
  maxHp = 420;
  state: G4State = 'intro';
  t = 0;
  animT = 0;
  flashT = 0;
  atkCd = 70;
  tpCd = 0;
  comboN = 1;
  queued = false;
  dmgAccum = 0;
  hitPlayer = false;
  lastHitId = 0;
  swingId = 0;
  alive = true;
  removeMe = false;
  readonly kind: BossKind = 'gonna404';
  readonly name = 'GONNA 404';
  readonly introLine = 'THE SOVEREIGN ANSWERS';
  readonly deathLine = '404: FOUND';
  readonly slowmo = 50;
  private lastPhase = 1;
  private statueCv: HTMLCanvasElement | null = null;

  constructor(x: number) {
    this.x = x;
  }

  get phase(): number {
    const r = this.hp / this.maxHp;
    return r > 0.6 ? 1 : r > 0.25 ? 2 : 3;
  }
  get rage(): boolean {
    return this.phase === 3;
  }

  private set(s: G4State): void {
    this.state = s;
    this.t = 0;
  }
  setDead(): void {
    this.set('dead');
  }
  setStun(): void {
    this.set('stun');
  }

  hurt(hit: HitInfo, g: GameCtx): boolean {
    if (!this.alive || this.state === 'intro' || this.state === 'dead') return false;
    if (this.state === 'teleport') return false; // NOT FOUND — he is not there
    this.hp -= hit.dmg;
    this.flashT = 5;
    this.dmgAccum += hit.dmg;
    g.fx.spark(this.x + hit.dir * 16, this.y - this.z - 50, hit.down);
    g.fx.popup(this.x + hit.dir * 12, this.y - this.z - 80, '-' + hit.dmg, '#ffe08a');
    g.addMeter(0.1);
    g.hitStop(3);
    g.audio.punch();
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.setDead();
      g.audio.explode();
      g.fx.shake(10);
      // NO white flash. The throne deserves gold.
      g.fx.ring(this.x, this.y - 50, 90, '#f5c542');
      g.fx.ring(this.x, this.y - 50, 60, '#39ff14');
    } else if (this.dmgAccum >= 52 && this.state !== 'stun') {
      this.dmgAccum = 0;
      this.setStun();
      g.fx.popup(this.x, this.y - 110, 'STAGGERED!', '#7fd858');
    }
    return true;
  }

  attackBox(): BossAttack | null {
    if (!this.alive) return null;
    const mk = (reach: number, dmg: number, kb: number, down: boolean): BossAttack => ({
      x0: this.face === 1 ? this.x + 4 : this.x - 4 - reach,
      x1: this.face === 1 ? this.x + 4 + reach : this.x - 4,
      laneTol: 13,
      dmg,
      kb,
      down,
    });
    if (this.state === 'combo' && this.t >= 4 && this.t <= 8) {
      if (this.comboN === 3) return mk(38, 11, 4, true);
      return mk(34, 7, 2, false);
    }
    // THE SIGNATURE: 10 rapid hits — the 218,540 combo
    if (this.state === 'combo10') {
      const sub = this.t % 7;
      if (sub >= 2 && sub <= 4) return mk(36, 4, 1.5, this.comboN >= 10);
    }
    if (this.state === 'kick' && this.t >= 9 && this.t <= 14) return mk(46, 14, 4, true);
    if (this.state === 'jumpkick' && this.z > 4) return mk(40, 12, 3, true);
    return null;
  }

  update(g: GameCtx): void {
    this.t++;
    this.animT++;
    if (this.flashT > 0) this.flashT--;
    if (this.atkCd > 0) this.atkCd--;
    if (this.tpCd > 0) this.tpCd--;
    if (THRONE_FX.gasp > 0) THRONE_FX.gasp--;
    const p = g.player;
    const spd = this.rage ? 1.5 : this.phase === 2 ? 1.15 : 1.0;

    // phase transitions are EVENTS
    if (this.phase !== this.lastPhase && this.alive) {
      this.lastPhase = this.phase;
      if (this.phase === 2) {
        g.fx.popup(this.x, this.y - 118, 'CONNECTION LOST', '#3cc9ff', 90);
        g.fx.debris(this.x, this.y - 50, '#3cc9ff', '#b07eff', 16);
        this.tpCd = 60;
      } else if (this.phase === 3) {
        g.fx.popup(this.x, this.y - 118, 'RAINBOW RAGE', '#ff5a5a', 90);
        g.fx.debris(this.x, this.y - 50, '#ff5a5a', '#f5d76e', 16);
        g.fx.shake(5);
        THRONE_FX.rage = true;
      }
    }

    switch (this.state) {
      case 'intro': {
        // THE CONTINUITY BOMB: the statue you minted cracks open
        if (this.t === 1) {
          this.x = g.camX + 250; // snap to the pedestal
          this.face = -1;
        }
        if (this.t === 40) {
          g.audio.thud();
          g.fx.debris(this.x, this.y - 80, '#8a6518', '#f5c542', 6);
          g.fx.shake(2);
        }
        if (this.t === 75) {
          g.audio.thud();
          g.fx.popup(this.x, this.y - 130, '...', '#f5d76e', 60);
          g.fx.debris(this.x, this.y - 70, '#8a6518', '#f5c542', 8);
          g.fx.shake(3);
        }
        if (this.t === 105) {
          // the explosion: gold everywhere, the rainbow walks out
          g.audio.explode();
          g.fx.debris(this.x, this.y - 70, '#f5c542', '#8a6518', 24);
          g.fx.coinsBurst(this.x, this.y - 80, 18);
          g.fx.ring(this.x, this.y - 60, 80, '#f5c542');
          g.fx.shake(8);
          THRONE_FX.gasp = 50; // the crowd gasps
        }
        if (this.t === 125) g.fx.popup(this.x - 70, this.y - 120, this.introLine, '#f5c542', 120);
        if (this.t > 160) this.set('idle');
        break;
      }
      case 'idle': {
        this.face = p.x >= this.x ? 1 : -1;
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        if (Math.abs(dy) > 6) this.y = clamp(this.y + Math.sign(dy) * spd * 0.85, LANE_TOP, LANE_BOT);
        if (Math.abs(dx) > 36) this.x += Math.sign(dx) * spd;
        if (this.atkCd <= 0 && p.state !== 'dead') {
          const adx = Math.abs(dx);
          const ady = Math.abs(dy);
          // glitch teleport: phase 2+, from mid-range, often in rage
          if (this.phase >= 2 && this.tpCd <= 0 && adx > 50 && adx < 260 && chance(this.rage ? 0.8 : 0.45)) {
            this.set('teleport');
            g.audio.jump();
          } else if (adx < 42 && ady < 14) {
            this.comboN = 1;
            this.queued = false;
            // the signature 10-hit is rare in p1, common later
            if (chance(this.phase === 1 ? 0.18 : 0.34)) {
              this.set('combo10');
              g.fx.popup(this.x, this.y - 112, '218,540!', '#f5c542', 60);
            } else {
              this.set(chance(0.62) ? 'combo' : 'kick');
            }
            this.swingId++;
            this.hitPlayer = false;
            g.audio.swing();
          } else if (adx >= 44 && adx < 160 && chance(0.5)) {
            this.set('jumpkick');
            this.vz = 4.6;
            this.vx = clamp(dx / 30, -4.4, 4.4);
            this.swingId++;
            this.hitPlayer = false;
            g.audio.jump();
          }
        }
        break;
      }
      case 'combo': {
        if (this.t >= 5 && (this.rage || chance(0.06))) this.queued = true;
        if (this.t < 8) this.x += this.face * 1.4;
        if (this.t === 8) this.hitPlayer = false;
        const dur = this.comboN === 3 ? 20 : 15;
        if (this.t >= dur) {
          if (this.queued && this.comboN < 3) {
            this.comboN++;
            this.queued = false;
            this.swingId++;
            this.hitPlayer = false;
            this.set('combo');
            g.audio.swing();
          } else {
            this.set('idle');
            this.atkCd = this.rage ? 26 : 50;
          }
        }
        break;
      }
      case 'combo10': {
        // 10 sub-hits of 7 frames: relentless forward pressure
        if (this.t % 7 === 0) {
          this.comboN = Math.min(10, Math.floor(this.t / 7) + 1);
          this.swingId++;
          this.hitPlayer = false;
          if (this.t > 0) g.audio.swing();
        }
        if (this.t % 7 < 4) this.x += this.face * (this.rage ? 2.2 : 1.6);
        if (this.t >= 70) {
          this.set('idle');
          this.atkCd = this.rage ? 50 : 90;
          this.comboN = 1;
        }
        break;
      }
      case 'kick': {
        if (this.t >= 26) {
          this.set('idle');
          this.atkCd = this.rage ? 30 : 60;
        }
        break;
      }
      case 'jumpkick': {
        this.vz -= GRAV;
        this.z += this.vz;
        this.x += this.vx;
        if (this.z <= 0) {
          this.z = 0;
          this.vz = 0;
          g.audio.land();
          g.fx.ring(this.x, this.y, 16, '#b07eff');
          this.set('idle');
          this.atkCd = this.rage ? 30 : 55;
        }
        break;
      }
      case 'teleport': {
        if (this.t === 1) {
          g.fx.popup(this.x, this.y - 100, 'NOT FOUND', '#3cc9ff', 46);
          for (let i = 0; i < 6; i++) {
            g.fx.debris(this.x + rand(-16, 16), this.y - rand(10, 80), G4_RAINBOW[i], '#101018', 3);
          }
          THRONE_FX.gasp = 40; // the crowd gasps at the glitch
        }
        if (this.t === 22) {
          // reappear BEHIND the player, already swinging
          const side = p.face === 1 ? -1 : 1;
          this.x = clamp(p.x + side * 44, g.camX + 20, g.camX + VW - 20);
          this.y = clamp(p.y + rand(-8, 8), LANE_TOP, LANE_BOT);
          this.face = p.x >= this.x ? 1 : -1;
          g.audio.land();
          for (let i = 0; i < 6; i++) {
            g.fx.debris(this.x + rand(-14, 14), this.y - rand(10, 80), G4_RAINBOW[5 - i], '#101018', 3);
          }
          this.swingId++;
          this.hitPlayer = false;
          this.set('kick');
          this.tpCd = this.rage ? 170 : 300;
          this.atkCd = this.rage ? 34 : 60;
        }
        break;
      }
      case 'stun': {
        if (this.t >= 36) this.set('idle');
        break;
      }
      case 'dead': {
        THRONE_FX.rage = false;
        // dissolves into rainbow pixels while the crowd throws coins
        if (this.t % 4 === 0 && this.t < 120) {
          const col = G4_RAINBOW[(this.t >> 2) % G4_RAINBOW.length];
          g.fx.debris(this.x + rand(-16, 16), this.y - rand(0, 70), col, '#f5d76e', 4);
          if (this.t % 20 === 0) g.audio.punch();
        }
        if (this.t === 30 || this.t === 70 || this.t === 110) g.fx.coinsBurst(this.x, this.y - 60, 12);
        if (this.t > 165) this.removeMe = true;
        break;
      }
    }
  }

  private frame(g: GameCtx, key: string): HTMLImageElement | HTMLCanvasElement | null {
    const rb = skinFramesLoaded('rainbow');
    const img = rb?.get(key) ?? g.frames.get(key) ?? null;
    return img;
  }

  draw(ctx2d: CanvasRenderingContext2D, g: GameCtx): void {
    const sx = Math.round(this.x - g.camX);
    const sy = Math.round(this.y - this.z);

    // ---- the statue (intro, before the explosion) ----
    if (this.state === 'intro' && this.t < 105) {
      const base = this.frame(g, '0_0');
      if (!base) return;
      if (!this.statueCv) {
        const shade = g4tint(base, '#8a6518');
        const main = g4tint(base, '#f5c542');
        const glint = g4tint(base, '#f5d76e');
        const cv = document.createElement('canvas');
        cv.width = base.width + 1;
        cv.height = base.height + 1;
        const cx = cv.getContext('2d')!;
        cx.imageSmoothingEnabled = false;
        cx.drawImage(shade, 1, 1);
        cx.drawImage(main, 0, 0);
        cx.drawImage(glint, 0, 0, glint.width, Math.floor(glint.height * 0.38), 0, 0, glint.width, Math.floor(glint.height * 0.38));
        this.statueCv = cv;
      }
      const st = this.statueCv;
      const sc = 0.85; // monumental
      const dw = st.width * sc;
      const dh = st.height * sc;
      const py = this.y - 22; // on the pedestal
      // pedestal shadow
      ctx2d.globalAlpha = 0.35;
      ctx2d.fillStyle = '#000';
      ctx2d.beginPath();
      ctx2d.ellipse(sx, this.y - 20, 26, 7, 0, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.globalAlpha = 1;
      ctx2d.save();
      ctx2d.translate(sx, py);
      ctx2d.scale(-1, 1); // faces the incoming player
      ctx2d.drawImage(st, -dw / 2, -dh, dw, dh);
      ctx2d.restore();
      // cracks spread after the first thuds
      if (this.t > 40) {
        ctx2d.strokeStyle = this.t > 75 ? '#fff2c0' : '#8a6518';
        ctx2d.lineWidth = 1;
        const n = this.t > 75 ? 5 : 2;
        for (let i = 0; i < n; i++) {
          ctx2d.beginPath();
          const x0 = sx - 14 + ((i * 37 + 11) % 28);
          ctx2d.moveTo(x0, py - dh + 8 + i * 12);
          ctx2d.lineTo(x0 + 6, py - dh + 22 + i * 12);
          ctx2d.lineTo(x0 - 3, py - dh + 34 + i * 12);
          ctx2d.stroke();
        }
      }
      return;
    }

    // ---- glitch teleport: he is NOT THERE ----
    if (this.state === 'teleport' && this.t < 22) {
      for (let i = 0; i < 8; i++) {
        const gx = sx + Math.round(Math.sin(this.t * 1.7 + i * 2.3) * 20);
        const gy = sy - 10 - i * 9;
        ctx2d.globalAlpha = 0.7 - i * 0.07;
        ctx2d.fillStyle = G4_RAINBOW[i % G4_RAINBOW.length];
        ctx2d.fillRect(gx, gy, 10 - i, 3);
      }
      ctx2d.globalAlpha = 1;
      return;
    }

    // shadow
    ctx2d.globalAlpha = clamp(0.4 - this.z / 220, 0.08, 0.4);
    ctx2d.fillStyle = '#000';
    ctx2d.beginPath();
    ctx2d.ellipse(sx, this.y + 2, 16 - this.z * 0.04, 5 - this.z * 0.015, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;

    // rainbow rage aura
    if (this.rage && this.state !== 'dead') {
      const ri = (this.animT >> 2) % G4_RAINBOW.length;
      ctx2d.globalAlpha = 0.22 + 0.1 * Math.sin(this.animT * 0.15);
      ctx2d.fillStyle = G4_RAINBOW[ri];
      ctx2d.beginPath();
      ctx2d.ellipse(sx, this.y + 2, 24, 8, 0, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.globalAlpha = 1;
    }

    let key = '0_0';
    switch (this.state) {
      case 'intro':
      case 'idle': {
        const moving = Math.abs(g.player.x - this.x) > 36;
        key = moving ? G4_WALK[(this.animT >> 3) & 3] : G4_IDLE[(this.animT >> 3) & 3];
        break;
      }
      case 'combo': key = this.comboN === 1 ? '1_1' : this.comboN === 2 ? '1_2' : '1_3'; break;
      case 'combo10': key = ['1_1', '1_2', '1_3'][(this.t / 7 | 0) % 3]; break;
      case 'kick':
      case 'teleport': key = this.t < 13 ? '1_4' : '1_5'; break;
      case 'jumpkick': key = '1_4'; break;
      case 'stun': key = '3_3'; break;
      case 'dead': key = '3_3'; break;
    }
    const img = this.frame(g, key);
    if (!img) return;
    const dw = img.width * G4_SCALE;
    const dh = img.height * G4_SCALE;
    ctx2d.save();
    if (this.flashT > 0) ctx2d.filter = 'brightness(3)';
    if (this.state === 'dead') {
      ctx2d.globalAlpha = this.t > 30 ? Math.max(0, 1 - (this.t - 30) / 100) : 1;
    }
    ctx2d.translate(sx, sy);
    if (this.face === -1) ctx2d.scale(-1, 1);
    ctx2d.drawImage(img, -dw / 2, -dh, dw, dh);
    ctx2d.restore();
    ctx2d.globalAlpha = 1;
  }
}
