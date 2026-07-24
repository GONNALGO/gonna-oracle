// GONNA FIGHT engine: fixed 60Hz logic, scene machine, combat resolution, camera.
import { AudioSys } from './audio';
import { FX, FLAME_RX, FLAME_RY } from './fx';
import { Input } from './input';
import { buildArt, loadFrames } from './sprites';
import type { Art } from './sprites';
import { Player } from './player';
import { Enemy } from './enemies';
import type { EnemyKind } from './enemies';
import type { BossLike } from './boss';
import { makeBoss } from './bosses';
import { Item, Obstacle } from './items';
import type { ItemKind } from './items';
import { Proj } from './proj';
import type { ProjKind } from './proj';
import { buildStage } from './stages';
import type { StageDef } from './stages';
import { clamp, comboRankName, LANE_TOP, rand, VH, VW } from './types';
import type { Facing } from './types';
import type { GameCtx } from './ctx';
import { drawHud } from './hud';
import { drawTextSh } from './font';
import { Haptics, TouchControls } from './touch';
import { drawClear, drawContinue, drawGameOver, drawIntro, drawMarketCap, drawTitle, drawVictory } from './screens';
import type { Tally } from './screens';

type Scene = 'title' | 'intro' | 'play' | 'clear' | 'gameover' | 'continue' | 'victory';

type Drawable = Player | Enemy | BossLike | Item | Obstacle | Proj;

export class Game implements GameCtx {
  audio = new AudioSys();
  input = new Input();
  haptics = new Haptics(); // v6: no-op on desktop
  touch: TouchControls; // v6: active only on touch devices
  fx = new FX();
  art: Art;
  frames: Map<string, HTMLImageElement>;
  player = new Player();
  enemies: Enemy[] = [];
  boss: BossLike | null = null;
  items: Item[] = [];
  obstacles: Obstacle[] = [];
  projs: Proj[] = [];
  camX = 0;
  stageLen = 1920;

  private ctx: CanvasRenderingContext2D;
  private scene: Scene = 'title';
  private sceneT = 0;
  private frame = 0;
  private stageIdx = 0;
  private stage: StageDef | null = null;
  private score = 0;
  private stageScoreStart = 0;
  private kos = 0;
  private timeLeft = 200;
  private totalFrames = 0;
  private waveIdx = 0;
  private waveActive = false;
  private camLock = 0;
  private spawnQueue: EnemyKind[] = [];
  private freezeT = 0;
  private slowmoT = 0;
  private goArrow = false;
  private tally: Tally = { timeBonus: 0, coinBonus: 0, shown: false, count: 0 };
  private tallyApplied = false;
  private continueCount = 9;
  private bossSpawned = false;
  private finalVictory = false;
  private titleTrack = false;
  private drawList: Drawable[] = [];
  private holdInput = false; // true while frozen: keep edge-presses buffered
  private paused = false; // v6: touch PAUSE button (play scene only)

  private constructor(ctx: CanvasRenderingContext2D, art: Art, frames: Map<string, HTMLImageElement>) {
    this.ctx = ctx;
    this.art = art;
    this.frames = frames;
    for (let i = 0; i < 48; i++) this.projs.push(new Proj());
    this.input.anyKey = () => this.onAnyGesture();
    this.touch = new TouchControls(ctx.canvas, this.input, this.haptics, {
      sceneName: () => this.scene,
      isPaused: () => this.paused,
      togglePause: () => this.togglePause(),
      toggleMute: () => this.audio.toggleMute(),
      anyTap: () => this.onAnyGesture(),
    });
  }

  // audio unlock + title track kickoff, shared by keyboard and touch
  private onAnyGesture(): void {
    this.audio.ensure();
    if (this.scene === 'title' && !this.titleTrack) {
      this.titleTrack = true;
      this.audio.playTrack('title');
    }
  }

  static async boot(canvas: HTMLCanvasElement): Promise<Game> {
    const frames = await loadFrames();
    const art = buildArt();
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    return new Game(ctx, art, frames);
  }

  destroy(): void {
    this.touch.destroy();
    this.input.destroy();
    this.audio.destroy();
  }

  // v6: touch-only pause (keyboard layout unchanged)
  togglePause(): void {
    if (this.scene !== 'play') return;
    this.paused = !this.paused;
    this.audio.setPaused(this.paused);
    this.audio.uiSelect();
  }
  get isPaused(): boolean {
    return this.paused;
  }
  get touchActive(): boolean {
    return this.touch.active;
  }

  // ---------- GameCtx ----------
  hitStop(frames: number): void {
    this.freezeT = Math.max(this.freezeT, frames);
  }
  slowMo(frames: number): void {
    this.slowmoT = Math.max(this.slowmoT, frames);
  }
  addScore(n: number): void {
    this.score += n;
  }
  addMeter(n: number): void {
    this.player.meter = Math.min(3, this.player.meter + n);
  }
  spawnEnemy(kind: EnemyKind, side: Facing): void {
    const x = side === -1 ? this.camX - 24 : this.camX + VW + 24;
    const y = rand(LANE_TOP + 6, 200);
    this.enemies.push(new Enemy(kind, x, y, side === -1 ? 1 : -1));
  }
  dropItem(kind: ItemKind, x: number, y: number): void {
    this.items.push(new Item(kind, x, y, true));
  }
  dropCoins(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.items.push(new Item('coinG', x + rand(-10, 10), clamp(y + rand(-6, 6), LANE_TOP, 205), true));
    }
  }
  spawnProj(kind: ProjKind, x: number, y: number, vx: number, tx = 0, ty = 0): void {
    const pr = this.projs.find((q) => !q.on);
    if (pr) pr.spawn(kind, x, y, vx, tx, ty);
  }
  spawnFlame(x: number, y: number): void {
    this.fx.flame(x, y);
  }

  // ---------- debug hooks (window.__gonna) ----------
  get carriedObject(): Obstacle | null {
    return this.player.carrying;
  }
  get projectiles(): Obstacle[] {
    return this.obstacles.filter((o) => o.mode === 'thrown');
  }
  get objects(): Obstacle[] {
    return this.obstacles;
  }
  get sceneName(): string {
    return this.scene;
  }
  get stageNo(): number {
    return this.stageIdx;
  }
  get stageTitle(): string {
    return this.stage ? this.stage.name + ' - ' + this.stage.sub : '';
  }
  get waveNo(): number {
    return this.waveIdx;
  }
  get victoryIsFinal(): boolean {
    return this.finalVictory;
  }
  // ---- v4 combo debug ----
  get comboCount(): number {
    return this.player.comboHits;
  }
  get comboRank(): string {
    return comboRankName(this.player.comboHits);
  }
  get comboState(): { hits: number; rank: string; pos: number; window: number; whiffs: number; dmg: number; mult: number } {
    const p = this.player;
    return {
      hits: p.comboHits,
      rank: comboRankName(p.comboHits),
      pos: p.chainPos,
      window: p.chainT,
      whiffs: p.whiffs,
      dmg: p.comboDmg,
      mult: p.comboMult,
    };
  }
  debugStage(idx: number): void {
    this.stageIdx = idx;
    this.loadStage(idx);
    this.setScene('intro');
  }
  debugWarp(x: number): void {
    this.player.x = x;
    this.player.z = 0;
    this.player.vx = 0;
    this.camX = clamp(x - 150, 0, Math.max(0, this.stageLen - VW));
  }
  debugKillEnemies(): void {
    for (const e of this.enemies) {
      if (e.alive) e.hurt({ dmg: 9999, kb: 2, down: true, dir: 1, pierce: true }, this);
    }
  }
  debugHurtBoss(dmg: number): void {
    if (this.boss) this.boss.hurt({ dmg, kb: 0, down: false, dir: 1 }, this);
  }
  // ---- v5 debug ----
  get flameCount(): number {
    let n = 0;
    for (const f of this.fx.flames) if (f.on) n++;
    return n;
  }
  // spawn any enemy right next to the player (skips walk-in), returns it
  debugSpawn(kind: EnemyKind, dx = 90): Enemy {
    const x = clamp(this.player.x + dx, this.camX + 16, this.camX + VW - 16);
    const e = new Enemy(kind, x, this.player.y, 1);
    e.state = 'seek';
    e.face = x >= this.player.x ? -1 : 1;
    this.enemies.push(e);
    return e;
  }
  // compact per-enemy snapshot for headless assertions
  get enemyInfo(): { kind: string; state: string; hp: number; alive: boolean; x: number; y: number }[] {
    return this.enemies.map((e) => ({ kind: e.kind, state: e.state, hp: e.hp, alive: e.alive, x: Math.round(e.x), y: Math.round(e.y) }));
  }

  // ---------- scene flow ----------
  private startNewGame(): void {
    this.score = 0;
    this.kos = 0;
    this.totalFrames = 0;
    this.stageIdx = 0;
    this.finalVictory = false;
    this.player.lives = 2;
    this.loadStage(0);
    this.scene = 'intro';
    this.sceneT = 0;
    this.audio.uiSelect();
  }

  private loadStage(idx: number): void {
    this.stage = buildStage(idx);
    this.stageLen = this.stage.len;
    this.enemies = [];
    this.items = [];
    this.obstacles = this.stage.obstacles.map((o) => new Obstacle(o.kind, o.x, o.y, o.contains));
    this.boss = null;
    this.bossSpawned = false;
    this.waveIdx = 0;
    this.waveActive = false;
    this.spawnQueue = [];
    this.camX = 0;
    this.camLock = 0;
    this.timeLeft = 200;
    this.stageScoreStart = this.score;
    this.goArrow = false;
    this.fx.reset();
    for (const pr of this.projs) pr.on = false;
    this.player.reset(60, 178);
  }

  private setScene(s: Scene): void {
    this.scene = s;
    this.sceneT = 0;
  }

  // ---------- main loop ----------
  step(): void {
    if (this.paused) {
      this.input.postUpdate(); // swallow buffered edges while frozen
      return;
    }
    this.frame++;
    const inp = this.input;
    if (inp.pressed.mute) {
      this.audio.toggleMute();
      inp.pressed.mute = false;
    }

    switch (this.scene) {
      case 'title': {
        this.sceneT++;
        if (inp.pressed.start) this.startNewGame();
        break;
      }
      case 'intro': {
        this.sceneT++;
        if (this.sceneT > 150 || (this.sceneT > 30 && inp.pressed.start)) {
          this.setScene('play');
          if (this.stage) this.audio.playTrack(this.stage.track);
        }
        break;
      }
      case 'play':
        this.updatePlay();
        break;
      case 'clear': {
        this.sceneT++;
        this.player.animT++;
        this.fx.update();
        if (this.tally.count < 1) {
          this.tally.count = Math.min(1, this.tally.count + 0.015);
          if ((this.frame & 3) === 0) this.audio.uiMove();
          if (this.tally.count >= 1 && !this.tallyApplied) {
            this.tallyApplied = true;
            this.score += this.tally.timeBonus + this.tally.coinBonus;
            this.audio.fanfare();
          }
        } else if (inp.pressed.start) {
          this.stageIdx++;
          this.loadStage(this.stageIdx);
          this.setScene('intro');
          this.audio.uiSelect();
        }
        break;
      }
      case 'gameover': {
        this.sceneT++;
        this.fx.update();
        if (this.sceneT > 130) {
          this.setScene('continue');
          this.continueCount = 9;
        }
        break;
      }
      case 'continue': {
        this.sceneT++;
        if (this.sceneT % 60 === 0) {
          this.continueCount--;
          this.audio.uiMove();
        }
        if (inp.pressed.start) {
          // continue: respawn with fresh lives
          this.player.lives = 2;
          this.player.hp = this.player.maxHp;
          this.player.state = 'getup';
          this.player.t = 0;
          this.player.z = 0;
          this.player.invuln = 120;
          this.setScene('play');
          if (this.stage) this.audio.playTrack(this.boss ? this.stage.bossTrack : this.stage.track);
          this.audio.uiSelect();
        } else if (this.continueCount < 0) {
          this.setScene('title');
          this.audio.playTrack('title');
        }
        break;
      }
      case 'victory': {
        this.sceneT++;
        if (this.sceneT > 120 && inp.pressed.start) {
          this.setScene('title');
          this.audio.playTrack('title');
          this.audio.uiSelect();
        }
        break;
      }
    }
    // v4: while hit-stop / slow-mo freezes the sim, keep edge-presses buffered
    // so combo inputs are never swallowed by the freeze.
    if (this.holdInput) this.holdInput = false;
    else inp.postUpdate();
  }

  // ---------- gameplay ----------
  private updatePlay(): void {
    this.totalFrames++;
    this.timeLeft -= 1 / 60;
    if (this.timeLeft < 0) this.timeLeft = 0;

    if (this.freezeT > 0) {
      this.freezeT--;
      this.fx.update();
      this.holdInput = true;
      return;
    }
    if (this.slowmoT > 0) {
      this.slowmoT--;
      if (this.frame % 3 !== 0) {
        this.fx.update();
        this.holdInput = true;
        return;
      }
    }

    const p = this.player;
    p.update(this);

    for (const e of this.enemies) e.update(this);
    if (this.boss) this.boss.update(this);
    for (const it of this.items) it.update();
    for (const o of this.obstacles) o.update(this);
    for (const pr of this.projs) pr.update(this);

    // v5: molotov flames — damage over time while standing in the fire
    for (const f of this.fx.flames) {
      if (!f.on) continue;
      if (f.tick > 0) f.tick--;
      if (p.state === 'dead' || p.state === 'down' || p.state === 'getup' || p.state === 'victory') continue;
      if (p.z > 6 || p.invuln > 0) continue;
      if (Math.abs(p.x - f.x) < FLAME_RX - 4 && Math.abs(p.y - f.y) < FLAME_RY && f.tick <= 0) {
        f.tick = 40; // ~1.5 dmg/sec worth of ticks
        p.hp -= 3;
        p.flashT = 5;
        this.fx.popup(p.x, p.y - 66, '-3', '#ff8a3c');
        this.fx.spark(p.x, p.y - 30, false);
        this.audio.flameTick();
        if (p.hp <= 0) p.hurt({ dmg: 1, kb: 0, down: false, dir: 1 }, this);
      }
    }

    this.resolveCombat();
    this.separateEnemies();

    // boss death slow-mo (EMPEROR FUD gets the long one)
    if (this.boss && this.boss.state === 'dead' && this.boss.t === 0 && this.boss.slowmo > 0) {
      this.slowmoT = this.boss.slowmo;
    }

    // pickups
    for (const it of this.items) {
      if (it.removeMe) continue;
      if (Math.abs(it.x - p.x) < 12 && Math.abs(it.y - p.y) < 10 && it.z < 14 && p.state !== 'dead') {
        it.collect(this);
      }
    }
    this.items = this.items.filter((i) => !i.removeMe);
    this.obstacles = this.obstacles.filter((o) => !o.removeMe);

    // enemy deaths -> coins / drops / removal
    for (const e of this.enemies) {
      if (e.state === 'dead' && e.t === 1) {
        this.kos++;
        this.haptics.ko(); // v6: 20ms KO buzz
        this.dropCoins(e.x, e.y, e.kind === 'whale' || e.kind === 'bouncer' ? 5 : 2 + Math.floor(rand(0, 3)));
        if (e.kind === 'snek') this.dropItem('knife', e.x, e.y);
        else if (e.kind === 'coinsnek') {
          this.dropItem('coinG', e.x, e.y); // COIN SNEK leaves $GONNA
          this.dropCoins(e.x, e.y, 3);
        } else if (Math.random() < 0.15) this.dropItem(Math.random() < 0.5 ? 'chicken' : 'coinA', e.x, e.y);
      }
    }
    this.enemies = this.enemies.filter((e) => !e.removeMe);

    this.updateWaves();
    this.updateCamera();

    // player death
    if (p.state === 'dead' && p.t > 100) {
      p.lives--;
      if (p.lives >= 0) {
        p.hp = p.maxHp;
        p.state = 'getup';
        p.t = 0;
        p.z = 0;
        p.invuln = 120;
        p.vx = 0;
      } else {
        this.setScene('gameover');
        this.audio.stopMusic();
      }
    }

    // stage end (non-boss)
    if (this.stage && !this.stage.boss && this.waveIdx >= this.stage.waves.length && !this.waveActive && p.x >= this.stageLen - 26 && p.state !== 'dead') {
      this.stageClear();
    }

    // boss defeat -> stage clear tally (final boss -> FINAL VICTORY)
    if (this.boss && this.boss.removeMe) {
      const wasFinal = this.stage?.bossKind === 'fud';
      this.boss = null;
      this.haptics.ko(); // v6: boss KO buzz
      if (wasFinal) {
        this.finalVictory = true;
        this.setScene('victory');
        this.audio.stopMusic();
        this.audio.fanfare();
      } else {
        this.stageClear();
      }
    }

    this.fx.update();
  }

  private stageClear(): void {
    const timeBonus = Math.ceil(this.timeLeft) * 10;
    const coinBonus = this.score - this.stageScoreStart;
    this.tally = { timeBonus, coinBonus, shown: true, count: 0 };
    this.tallyApplied = false;
    this.player.state = 'victory';
    this.player.t = 0;
    this.setScene('clear');
    this.audio.stopMusic();
    this.audio.fanfare();
  }

  private resolveCombat(): void {
    const p = this.player;

    // --- player special: hits everything on screen at t==10 ---
    if (p.state === 'special' && p.t === 10) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (e.x > this.camX - 30 && e.x < this.camX + VW + 30) {
          // v5: BYZANTINE SLAM pierces the riot shield (whale guard unchanged)
          e.hurt({ dmg: 30, kb: 4, down: true, dir: e.x >= p.x ? 1 : -1, pierce: e.kind === 'bull' }, this);
        }
      }
      if (this.boss && this.boss.alive) {
        this.boss.hurt({ dmg: 40, kb: 0, down: false, dir: this.boss.x >= p.x ? 1 : -1 }, this);
      }
    }

    // --- player attack box vs enemies / boss / obstacles ---
    const box = p.attackBox();
    if (box) {
      // v4: punch/kick swings feed the free-flow combo (scaling + counter)
      const comboAtk = p.state === 'punch' || p.state === 'kick';
      const dmg = comboAtk ? p.scaledDmg(box.dmg) : box.dmg;
      for (const e of this.enemies) {
        if (!e.alive || e.lastHitId === box.id) continue;
        if (e.x > box.x0 - 8 && e.x < box.x1 + 8 && Math.abs(e.y - box.y) <= box.laneTol + 4 && e.z < 36) {
          e.lastHitId = box.id;
          if (e.hurt({ dmg, kb: box.kb, down: box.down, dir: p.face }, this) && comboAtk) {
            p.registerHit(this, dmg);
          }
        }
      }
      if (this.boss && this.boss.alive && this.boss.lastHitId !== box.id) {
        if (this.boss.x > box.x0 - 30 && this.boss.x < box.x1 + 30 && Math.abs(this.boss.y - box.y) <= 26) {
          this.boss.lastHitId = box.id;
          if (this.boss.hurt({ dmg, kb: 0, down: false, dir: p.face }, this) && comboAtk) {
            p.registerHit(this, dmg);
          }
        }
      }
      for (const o of this.obstacles) {
        if (o.mode !== 'idle' || o.lastSwing === box.id) continue;
        if (o.x > box.x0 - 10 && o.x < box.x1 + 10 && Math.abs(o.y - box.y) <= 15) {
          o.lastSwing = box.id;
          o.hurt(this);
          p.swingLanded = true; // contact with an object is not a whiff
        }
      }
    }

    // --- enemy attacks vs player ---
    for (const e of this.enemies) {
      if (!e.attackActive() || e.hitPlayer) continue;
      const r = e.attackReach();
      if (p.x > r.x0 - 8 && p.x < r.x1 + 8 && Math.abs(p.y - e.y) <= r.laneTol && p.z < 26) {
        e.hitPlayer = true;
        p.hurt({ dmg: r.dmg, kb: r.kb, down: r.down, dir: p.x >= e.x ? 1 : -1 }, this);
      }
    }

    // --- boss swing vs player ---
    if (this.boss) {
      const bb = this.boss.attackBox();
      if (bb && !this.boss.hitPlayer) {
        if (p.x > bb.x0 - 10 && p.x < bb.x1 + 10 && Math.abs(p.y - this.boss.y) <= bb.laneTol && p.z < 30) {
          this.boss.hitPlayer = true;
          p.hurt({ dmg: bb.dmg, kb: bb.kb, down: bb.down, dir: p.x >= this.boss.x ? 1 : -1 }, this);
        }
      }
    }

    // --- thrown enemies damage others ---
    for (const e of this.enemies) {
      if (e.state !== 'thrown') continue;
      for (const o of this.enemies) {
        if (o === e || !o.alive || o.lastHitId === e.swingId) continue;
        if (Math.abs(o.x - e.x) < 22 && Math.abs(o.y - e.y) < 14) {
          o.lastHitId = e.swingId;
          o.hurt({ dmg: 10, kb: 3, down: true, dir: e.face }, this);
        }
      }
      if (this.boss && this.boss.alive && this.boss.lastHitId !== e.swingId) {
        if (Math.abs(this.boss.x - e.x) < 50 && Math.abs(this.boss.y - e.y) < 30) {
          this.boss.lastHitId = e.swingId;
          this.boss.hurt({ dmg: 15, kb: 0, down: false, dir: e.face }, this);
        }
      }
    }
  }

  private separateEnemies(): void {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive || a.state === 'held' || a.state === 'thrown') continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive || b.state === 'held' || b.state === 'thrown') continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) < 16 && Math.abs(dy) < 8) {
          const push = (16 - Math.abs(dx)) * 0.12 * (dx >= 0 ? 1 : -1);
          a.x -= push;
          b.x += push;
        }
      }
    }
  }

  private updateWaves(): void {
    if (!this.stage) return;
    // boss trigger
    if (this.stage.boss && !this.bossSpawned && this.camX >= this.stage.arenaX - 1) {
      this.bossSpawned = true;
      this.boss = makeBoss(this.stage.bossKind ?? 'whale', this.camX + VW + 70);
      this.audio.playTrack(this.stage.bossTrack);
      this.goArrow = false;
      return;
    }
    if (!this.waveActive && this.waveIdx < this.stage.waves.length) {
      const w = this.stage.waves[this.waveIdx];
      // trigger when the camera reaches the trigger point
      if (this.camX >= w.triggerX) {
        this.waveActive = true;
        this.camLock = this.camX;
        this.spawnQueue = [...w.spawns];
        this.goArrow = false;
      }
    }
    if (this.waveActive) {
      let alive = 0;
      for (const e of this.enemies) if (e.alive) alive++;
      if (this.spawnQueue.length > 0 && alive < 3) {
        const kind = this.spawnQueue.shift()!;
        const side: Facing = Math.random() < 0.5 ? -1 : 1;
        this.spawnEnemy(kind, side);
      } else if (this.spawnQueue.length === 0 && alive === 0) {
        this.waveActive = false;
        this.waveIdx++;
        this.goArrow = true;
      }
    }
  }

  private updateCamera(): void {
    if (!this.stage) return;
    let maxCam = this.stageLen - VW;
    if (this.waveActive) maxCam = Math.min(maxCam, this.camLock);
    if (this.stage.boss && this.bossSpawned) maxCam = Math.min(maxCam, this.stage.arenaX);
    const target = clamp(this.player.x - 150, 0, maxCam);
    const d = target - this.camX;
    if (Math.abs(d) < 0.5) this.camX = target;
    else this.camX += clamp(d, -2, 2);
    this.goArrow = !this.waveActive && !(this.stage.boss && this.bossSpawned) && this.scene === 'play' && this.player.state !== 'dead';
  }

  // ---------- render ----------
  render(): void {
    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, VW, VH);

    if (this.scene === 'title') {
      drawTitle(c, this.frame, this.art);
      return;
    }
    if (this.scene === 'intro' && this.stage) {
      drawIntro(c, this.stage.name, this.stage.sub, this.sceneT);
      return;
    }
    if (this.scene === 'victory') {
      drawVictory(c, { score: this.score, timeFrames: this.totalFrames, kos: this.kos }, this.sceneT, this.finalVictory);
      return;
    }
    if (!this.stage) return;

    // ---- world ----
    const shX = this.fx.shakeX;
    const shY = this.fx.shakeY;
    c.save();
    c.translate(Math.round(shX), Math.round(shY));
    c.drawImage(this.stage.far, Math.round(-this.camX * 0.25), 0);
    c.drawImage(this.stage.mid, Math.round(-this.camX * 0.55), 0);
    c.drawImage(this.stage.ground, Math.round(this.camX), 0, VW, 84, 0, 140, VW, 84);

    this.fx.drawFlames(c, this.camX); // v5: ground fire burns under the fighters

    // z-sorted entities (lower Y drawn first)
    const dl = this.drawList;
    dl.length = 0;
    for (const o of this.obstacles) dl.push(o);
    for (const it of this.items) dl.push(it);
    for (const e of this.enemies) dl.push(e);
    for (const pr of this.projs) if (pr.on) dl.push(pr);
    if (this.boss) dl.push(this.boss);
    dl.push(this.player);
    dl.sort((a, b) => a.y - b.y);
    for (const d of dl) d.draw(c, this);

    this.fx.drawWorld(c);
    if (this.fx.flash > 0) {
      c.globalAlpha = this.fx.flash / 10;
      c.fillStyle = '#fff';
      c.fillRect(-4, -4, VW + 8, VH + 8);
      c.globalAlpha = 1;
    }
    c.restore();

    // ---- overlays ----
    drawHud(c, this, this.score, this.timeLeft, this.goArrow, this.frame, this.audio.muted);
    if (this.scene === 'clear') drawClear(c, this.tally, this.score);
    if (this.scene === 'gameover') drawGameOver(c, this.sceneT);
    if (this.scene === 'continue') drawContinue(c, this.continueCount, this.sceneT);
    if (this.boss && !this.boss.alive) drawMarketCap(c, this.boss.t, this.boss.deathLine);

    // v6: pause veil (touch PAUSE button)
    if (this.paused) {
      c.fillStyle = 'rgba(4,5,10,0.55)';
      c.fillRect(0, 0, VW, VH);
      drawTextSh(c, 'PAUSA', VW / 2, 96, 3, '#f5c542', 'center');
      drawTextSh(c, 'TAP II TO RESUME', VW / 2, 124, 1, '#c8ccd4', 'center');
    }
  }

  // rendered after everything, every scene — cheap no-op on desktop
  renderTouch(): void {
    this.touch.draw(this.ctx);
  }
}
