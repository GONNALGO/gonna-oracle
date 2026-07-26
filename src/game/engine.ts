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
import { clamp, comboRankName, LANE_BOT, LANE_TOP, rand, VH, VW } from './types';
import type { Facing } from './types';
import type { GameCtx } from './ctx';
import { drawHud } from './hud';
import { drawTextSh } from './font';
import { Haptics, TouchControls } from './touch';
import { computeFit } from './fit';
import type { ViewFit } from './fit';
import { drawClear, drawContinue, drawGameOver, drawIntro, drawMarketCap, drawTitle, drawVictory, TITLE_CONNECT_BTN, TITLE_FIGHTER_BTN, TITLE_MASCOTS, titleFighterLabelRect } from './screens';
import type { Tally } from './screens';
import * as wallet from './wallet';
import { GateUI } from './gateui';
import type { GateAction } from './gateui';
import { loadFighter, loadSkinFrames, loadSkinMap, loadSkinPortraits, saveFighter } from './skins';
import type { Fighter } from './skins';

type Scene = 'title' | 'intro' | 'play' | 'clear' | 'gameover' | 'continue' | 'victory' | 'connect' | 'gate' | 'fighter';

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
  // ---- v9: THE GATE + CHOOSE YOUR FIGHTER ----
  pframes: Map<string, HTMLImageElement> | null = null; // GameCtx: selected skin frames
  private gate = new GateUI();
  private fighter: Fighter = loadFighter();
  private gateNext = 1; // stage idx waiting behind the gate
  private connectFromTitle = false; // v9.0.1: connect flow started on the title -> land on fighter select
  // v6.1: internal letterbox — canvas is full-bleed, game view fitted by transform
  fit: ViewFit = computeFit(VW, VH, 1, false, false);
  zoomOn = false; // portrait ZOOM preference (persisted in localStorage)
  onFitChange: (() => void) | null = null; // Game.tsx refit callback
  // per-frame view scratch (zero allocation)
  private vScale = 1;
  private vOffX = 0;
  private vOffY = 0;
  private vClipW = VW;

  private constructor(ctx: CanvasRenderingContext2D, art: Art, frames: Map<string, HTMLImageElement>) {
    this.ctx = ctx;
    this.art = art;
    this.frames = frames;
    for (let i = 0; i < 48; i++) this.projs.push(new Proj());
    this.input.anyKey = () => this.onAnyGesture();
    try {
      this.zoomOn = window.localStorage.getItem('gonna.zoom') === '1';
    } catch { /* storage unavailable: session-only zoom */ }
    this.touch = new TouchControls(ctx.canvas, this.input, this.haptics, {
      sceneName: () => this.scene,
      isPaused: () => this.paused,
      togglePause: () => this.togglePause(),
      toggleMute: () => this.audio.toggleMute(),
      anyTap: () => this.onAnyGesture(),
      zoomOn: () => this.zoomOn,
      toggleZoom: () => this.toggleZoom(),
      uiTap: (x, y) => this.uiTap(x, y),
    });
    // v9: desktop mouse drives the same canvas-UI hotspots as touch taps
    ctx.canvas.addEventListener('pointerdown', this.onMouseDown);
    // v9 boot: wallet session restore + skin assets + persisted fighter
    wallet.init();
    // v9.0.1: the wallet app killed the session -> back to the connect scene
    wallet.onSessionEnded(() => {
      if (this.scene === 'gate' || this.scene === 'fighter') {
        this.connectFromTitle = false;
        this.openGateScene('connect', this.gateNext);
      }
    });
    void loadSkinMap().catch(() => { /* gate falls back to $GONNA-only checks */ });
    loadSkinPortraits();
    this.applySkinFrames();
  }

  private onMouseDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return; // touch goes through TouchControls
    this.uiTap(e.clientX, e.clientY);
  };

  // v9: CSS-px tap -> game coords -> scene hotspot. true = consumed.
  private uiTap(x: number, y: number): boolean {
    const s = this.scene;
    if (s !== 'connect' && s !== 'gate' && s !== 'fighter' && s !== 'title') return false;
    const f = this.fit;
    const gx = (x - f.fitOffX) / f.fitScale;
    const gy = (y - f.fitOffY) / f.fitScale;
    if (s === 'title') {
      const hit = (b: { x: number; y: number; w: number; h: number }) => gx >= b.x && gx <= b.x + b.w && gy >= b.y && gy <= b.y + b.h;
      if (hit(TITLE_FIGHTER_BTN)) {
        this.openFighter();
        return true;
      }
      if (hit(TITLE_CONNECT_BTN)) {
        this.openConnectTitle();
        return true;
      }
      return false; // any other title tap stays "press start"
    }
    this.handleGateAction(this.gate.tap(gx, gy));
    return true; // gate scenes swallow every tap (no accidental start)
  }

  // v6.1: called by Game.tsx on boot and every viewport/rotation change
  setViewport(f: ViewFit): void {
    this.fit = f;
    this.touch.setViewport(f);
  }

  // v6.1: portrait FIT <-> ZOOM toggle (touch ZOOM button)
  toggleZoom(): void {
    this.zoomOn = !this.zoomOn;
    try {
      window.localStorage.setItem('gonna.zoom', this.zoomOn ? '1' : '0');
    } catch { /* ignore */ }
    this.audio.uiSelect();
    if (this.onFitChange) this.onFitChange();
  }

  // audio unlock + title track kickoff, shared by keyboard and touch
  private onAnyGesture(): void {
    this.audio.ensure();
    if (this.scene === 'title' && !this.titleTrack) {
      this.titleTrack = true;
      this.audio.playTrack('title');
    }
  }

  // ---------- v9 gate / fighter flow ----------
  private openFighter(): void {
    this.setScene('fighter');
    this.gate.open('fighter');
    this.audio.uiSelect();
  }

  private openGateScene(s: 'connect' | 'gate', nextStage: number): void {
    this.gateNext = nextStage;
    this.setScene(s);
    this.gate.open(s);
    this.audio.uiSelect();
  }

  // v9.0.1: CONNECT WALLET from the title — connected? straight to fighter select.
  private openConnectTitle(): void {
    this.audio.uiSelect();
    if (wallet.isConnected()) {
      this.openFighter();
      return;
    }
    this.connectFromTitle = true;
    this.openGateScene('connect', 1);
  }

  private applySkinFrames(): void {
    const skin = this.fighter.skin;
    if (skin === 'gonna') {
      this.pframes = null;
      return;
    }
    loadSkinFrames(skin)
      .then((m) => {
        if (this.fighter.skin === skin) this.pframes = m;
      })
      .catch(() => {
        this.pframes = null; // frames missing: stay on the base GONNA
      });
  }

  private applyFighter(f: Fighter): void {
    this.fighter = f;
    saveFighter(f);
    this.applySkinFrames();
  }

  private handleGateAction(a: GateAction): void {
    if (a.act === 'move') this.audio.uiMove();
    else if (a.act === 'title') {
      this.connectFromTitle = false;
      this.setScene('title');
      this.audio.uiSelect();
      if (!this.titleTrack) {
        this.titleTrack = true;
        this.audio.playTrack('title');
      }
    } else if (a.act === 'fighter') {
      this.applyFighter(a.fighter);
      this.audio.uiSelect();
      this.audio.rankUp(); // gold confirm arpeggio
      // let the gold flash breathe, then back to the title
      window.setTimeout(() => {
        if (this.scene === 'fighter') this.setScene('title');
      }, 450);
    }
  }

  // gate scenes poll the wallet: seamless continue as soon as eligible
  private updateGateScene(): void {
    this.sceneT++;
    this.gate.tick();
    this.handleGateAction(this.gate.key(this.input));
    const connected = wallet.isConnected();
    const elig = wallet.getEligibility();
    if (this.scene === 'connect') {
      if (connected && elig.checked && !elig.busy) {
        if (elig.ok) this.passGateOrFighter();
        else this.openGateScene('gate', this.gateNext);
      }
    } else if (this.scene === 'gate') {
      if (!connected) this.openGateScene('connect', this.gateNext); // disconnected: start over
      else if (elig.checked && elig.ok) this.passGateOrFighter();
    }
  }

  // title-started connect flow lands on CHOOSE YOUR FIGHTER; the mid-game gate loads the stage
  private passGateOrFighter(): void {
    if (this.connectFromTitle) {
      this.connectFromTitle = false;
      this.openFighter();
      return;
    }
    this.passGate();
  }

  private passGate(): void {
    this.connectFromTitle = false;
    this.loadStage(this.gateNext);
    this.stageIdx = this.gateNext;
    this.setScene('intro');
    this.audio.fanfare();
  }

  static async boot(canvas: HTMLCanvasElement): Promise<Game> {
    const frames = await loadFrames();
    const art = buildArt();
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    return new Game(ctx, art, frames);
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener('pointerdown', this.onMouseDown);
    wallet.onSessionEnded(null);
    this.touch.destroy();
    this.input.destroy();
    this.audio.destroy();
  }

  // v6 touch II button + v7 desktop P/ESC — play-scene pause with audio freeze
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

  // ---- v9 wallet / fighter debug (window.__gonna) ----
  get walletInfo(): { provider: string | null; address: string | null; connecting: boolean; mocked: boolean } {
    const w = wallet.getWallet();
    return { provider: w.provider, address: w.address, connecting: w.connecting, mocked: w.mocked };
  }
  get eligibilityInfo(): { checked: boolean; ok: boolean; algo: number; gonna: number; nftCount: number; source: string | null; busy: boolean; error: boolean } {
    const e = wallet.getEligibility();
    return { checked: e.checked, ok: e.ok, algo: e.algo, gonna: e.gonna, nftCount: e.nfts.length, source: e.source, busy: e.busy, error: e.error };
  }
  get ownedNfts(): { id: number; name: string; skin: string }[] {
    return wallet.getEligibility().nfts.map((n) => ({ id: n.id, name: n.name, skin: n.skin }));
  }
  get fighterInfo(): { skin: string; assetId: number | null; name: string } {
    return { skin: this.fighter.skin, assetId: this.fighter.assetId, name: this.fighter.name };
  }
  // v9.0.2 CI: NFD identity shown in place of the address (segment/addr + active flag)
  get identityInfo(): { address: string | null; segment: string | null; active: boolean; source: string | null; label: string } {
    const id = wallet.getIdentity();
    return { address: id.address, segment: id.segment, active: id.active, source: id.source, label: wallet.identityLabel(26) };
  }
  // CI: inject a wallet state (null = disconnect). Persisted for reload tests.
  debugMockWallet(m: wallet.MockWallet | null): void {
    wallet.setMock(m);
    if (this.scene === 'fighter') this.gate.open('fighter'); // rebuild for the new holdings
  }
  debugOpenFighter(): void {
    this.openFighter();
  }
  // CI: jump straight to the end-of-stage-1 tally so one Enter hits the gate
  debugGateCheck(): void {
    this.stageIdx = 0;
    this.loadStage(0);
    this.tally = { timeBonus: 0, coinBonus: 0, shown: true, count: 1 };
    this.tallyApplied = true;
    this.setScene('clear');
  }
  debugRefreshEligibility(): void {
    void wallet.refreshEligibility(true);
  }
  // v9.0.1 CI: title layout bboxes (no-overlap assertion) + live fx in SCREEN coords
  get titleLayout(): {
    fighterLabel: { x: number; y: number; w: number; h: number } | null;
    fighterBtn: { x: number; y: number; w: number; h: number };
    connectBtn: { x: number; y: number; w: number; h: number };
    connectLabel: string;
    mascots: { x: number; y: number; w: number; h: number }[];
  } {
    return {
      fighterLabel: titleFighterLabelRect(this.fighter.name),
      fighterBtn: TITLE_FIGHTER_BTN,
      connectBtn: TITLE_CONNECT_BTN,
      connectLabel: wallet.isConnected() ? wallet.identityLabel(13) : 'CONNECT',
      mascots: TITLE_MASCOTS,
    };
  }
  get fxScreen(): { rings: { x: number; y: number; r: number }[]; parts: { x: number; y: number }[]; pops: { x: number; y: number; txt: string }[] } {
    return this.fx.debugScreen(this.camX);
  }
  // CI: fighter-select / gate screen internals
  get gateInfo(): { scene: string; mode: string; cursor: number; rowCount: number; teaser: boolean; flashing: boolean; uiFighter: { skin: string; assetId: number | null; name: string } } {
    const f = this.gate.uiFighter;
    return {
      scene: this.gate.scene,
      mode: this.gate.mode,
      cursor: this.gate.cursor,
      rowCount: this.gate.rowCount,
      teaser: this.gate.teaserOpen,
      flashing: this.gate.flashing,
      uiFighter: { skin: f.skin, assetId: f.assetId, name: f.name },
    };
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
    this.touch.releaseAll(); // the confirming tap must not leak into the intro
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
    // no held control may leak across a scene cut (joystick ghost / stuck button)
    this.touch.releaseAll();
  }

  // ---------- main loop ----------
  step(): void {
    if (this.paused) {
      // v7: P/ESC resumes from desktop too (touch resumes via the II button)
      if (this.input.pressed.pause) {
        this.input.pressed.pause = false;
        this.togglePause();
      }
      this.input.postUpdate(); // swallow buffered edges while frozen
      return;
    }
    this.frame++;
    const inp = this.input;
    if (inp.pressed.mute) {
      this.audio.toggleMute();
      inp.pressed.mute = false;
    }
    // v7: desktop pause (P / ESC) — same veil + sim freeze as the touch II button
    // v9: only consume the edge in play/paused — menu scenes use ESC as BACK
    if (inp.pressed.pause && (this.scene === 'play' || this.paused)) {
      inp.pressed.pause = false;
      this.togglePause();
    }

    switch (this.scene) {
      case 'title': {
        this.sceneT++;
        if (inp.pressed.fighter) this.openFighter(); // v9: T = CHOOSE YOUR FIGHTER
        else if (inp.pressed.special) this.openConnectTitle(); // v9.0.1: C = CONNECT WALLET
        else if (inp.pressed.start) this.startNewGame();
        break;
      }
      case 'connect':
      case 'gate': {
        this.updateGateScene();
        break;
      }
      case 'fighter': {
        this.sceneT++;
        this.gate.tick();
        this.handleGateAction(this.gate.key(inp));
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
            this.audio.uiSelect(); // v7: the victory track plays under the tally
          }
        } else if (inp.pressed.start) {
          const next = this.stageIdx + 1;
          // v9: THE GATE — the Stage 1 -> 2 transition belongs to holders
          if (next === 1 && !wallet.isEligible()) {
            this.audio.uiSelect();
            this.openGateScene(wallet.isConnected() ? 'gate' : 'connect', next);
          } else {
            this.stageIdx = next;
            this.loadStage(next);
            this.setScene('intro');
            this.audio.uiSelect();
          }
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

    this.watchdog(); // v8: never leave a wave soft-locked
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
        this.audio.playTrack('gameover'); // v7: composed game-over jingle
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
        this.audio.playTrack('victory'); // v7: victory jingle under the credits
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
    this.audio.playTrack('victory'); // v7: composed victory jingle loop
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

  // ---- v8: unreachable-enemy watchdog (Silvio's safety net) ----
  // A living enemy that stays unreachable for >4s (outside the walkable band,
  // outside the stage/camera reach, invalid z, or stuck in 'enter') is snapped
  // back to a valid lane position near the player in the approach state.
  // An enemy that keeps becoming unreachable right after being rescued is
  // hopeless: it is executed WITHOUT score so the wave can always clear.
  private watchdog(): void {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const yBad = !isFinite(e.y) || e.y < LANE_TOP - 18 || e.y > LANE_BOT + 18;
      const xBad =
        !isFinite(e.x) ||
        e.x < -40 || e.x > this.stageLen + 40 ||
        e.x < this.camX - 80 || e.x > this.camX + VW + 80;
      const zBad = !isFinite(e.z) || e.z < -1 || e.z >= 40;
      const enterStuck = e.state === 'enter' && e.t > 300; // walk-in never legitimately exceeds ~2s
      if (!(yBad || xBad || zBad || enterStuck)) {
        e.badT = 0;
        continue;
      }
      e.badT++;
      if (e.badT <= 240) continue; // 4s of continuous unreachability tolerated
      e.badT = 0;
      e.snaps++;
      if (e.snaps > 2) {
        // LAST RESORT: unrescuable — execute without score and let the wave clear
        e.alive = false;
        e.state = 'dead';
        e.t = 5; // past the t===1 drop hook: no coins, no KO count
        e.lieT = 55; // corpse fades out quickly
        e.vx = 0;
        e.vz = 0;
        e.z = 0;
        e.y = clamp(isFinite(e.y) ? e.y : (LANE_TOP + LANE_BOT) / 2, LANE_TOP, LANE_BOT);
        e.x = clamp(isFinite(e.x) ? e.x : p.x, 8, this.stageLen - 8);
        continue;
      }
      // snap back to the nearest valid lane position near the player
      e.x = clamp(p.x + (isFinite(e.x) && e.x < p.x ? -72 : 72), this.camX + 24, this.camX + VW - 24);
      e.y = clamp(p.y + (e.snaps & 1 ? 14 : -14), LANE_TOP, LANE_BOT);
      e.z = e.kind === 'drone' ? 24 : 0;
      e.vx = 0;
      e.vy = 0;
      e.vz = 0;
      e.invuln = 0;
      e.hitPlayer = false;
      e.atkCd = 30;
      e.state = 'seek';
      e.t = 0;
      this.fx.ring(e.x, e.y - e.z - 10, 24, '#7fd858');
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

  // v6.1: set a game-view transform + clip; fill=true lays the black base inside the view
  private applyView(scale: number, offX: number, offY: number, crop: number, clipW: number, fill: boolean): void {
    const c = this.ctx;
    const f = this.fit;
    c.setTransform(
      f.dpr * scale, 0, 0, f.dpr * scale,
      f.dpr * (offX - crop * scale), f.dpr * offY,
    );
    c.beginPath();
    c.rect(crop, 0, clipW, VH);
    c.clip();
    if (fill) {
      c.fillStyle = '#000';
      c.fillRect(crop, 0, clipW, VH);
    }
  }

  // world pass view (zoom-aware); overlay/scene passes use the FIT view
  private worldView(crop: number, fill: boolean): void {
    this.applyView(this.vScale, this.vOffX, this.vOffY, crop, this.vClipW, fill);
  }
  private fitView(fill: boolean): void {
    const f = this.fit;
    this.applyView(f.fitScale, f.fitOffX, f.fitOffY, 0, VW, fill);
  }

  // ---------- render ----------
  render(): void {
    const c = this.ctx;
    const f = this.fit;
    c.imageSmoothingEnabled = false;
    // full-viewport black base (device px) — the internal letterbox
    c.save();
    c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, f.cssW, f.cssH);
    c.restore();

    // pick the effective view: ZOOM applies only while a stage is on screen
    const s = this.scene;
    const inStage =
      !!this.stage &&
      s !== 'title' && s !== 'intro' && s !== 'victory' &&
      s !== 'connect' && s !== 'gate' && s !== 'fighter'; // v9
    const zoomed = f.zoom && inStage;
    this.vScale = zoomed ? f.zoomScale : f.fitScale;
    this.vOffX = zoomed ? 0 : f.fitOffX; // ZOOM centers the cropped window via cropX
    this.vOffY = f.fitOffY;
    let crop = 0;
    if (zoomed) {
      // zoom camera: player centered, window clamped inside the 384px stage view
      crop = clamp(this.player.x - this.camX - f.zoomVisW / 2, 0, Math.max(0, VW - f.zoomVisW));
    }
    this.vClipW = zoomed ? Math.min(f.zoomVisW + 1, VW - crop) : VW;

    if (this.scene === 'title') {
      c.save();
      this.fitView(true);
      // v9.0.1: the CONNECT button shows the short address once connected
      // v9.0.2: it shows the NFD segment instead (green active / gray inactive)
      const idColor = wallet.identityColor();
      const connectLabel = wallet.isConnected()
        ? wallet.identityLabel(13)
        : this.touchActive
          ? 'CONNECT'
          : 'C CONNECT';
      drawTitle(c, this.frame, this.art, this.fighter.name, this.touchActive, connectLabel, idColor ?? '#f5c542');
      c.restore();
      return;
    }
    // v9: THE GATE + CHOOSE YOUR FIGHTER (full-screen canvas scenes)
    if (this.scene === 'connect' || this.scene === 'gate' || this.scene === 'fighter') {
      c.save();
      this.fitView(true);
      this.gate.draw(c, this.frame, this.art, this.frames, this.touchActive);
      c.restore();
      return;
    }
    if (this.scene === 'intro' && this.stage) {
      c.save();
      this.fitView(true);
      drawIntro(c, this.stage.name, this.stage.sub, this.sceneT);
      c.restore();
      return;
    }
    if (this.scene === 'victory') {
      c.save();
      this.fitView(true);
      drawVictory(c, { score: this.score, timeFrames: this.totalFrames, kos: this.kos }, this.sceneT, this.finalVictory);
      c.restore();
      return;
    }
    if (!this.stage) return;

    // ---- world (cropped in ZOOM) ----
    const shX = this.fx.shakeX;
    const shY = this.fx.shakeY;
    c.save();
    this.worldView(crop, true);
    c.save();
    c.translate(Math.round(shX), Math.round(shY));
    c.drawImage(this.stage.far, Math.round(-this.camX * 0.25), 0);
    c.drawImage(this.stage.mid, Math.round(-this.camX * 0.55), 0);
    if (this.stage.back) this.stage.back(c, this.camX, this.frame); // v8: animated billboards/tickers/sea
    c.drawImage(this.stage.ground, Math.round(this.camX), 0, VW, 84, 0, 140, VW, 84);
    if (this.stage.props) this.stage.props(c, this.camX, this.frame); // v8: sidewalk props (world depth)

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

    this.fx.drawWorld(c, this.camX); // v9.0.1 BUG C: world coords -> screen
    if (this.stage.front) this.stage.front(c, this.camX, this.frame); // v8: weather + foreground silhouettes
    if (this.fx.flash > 0) {
      c.globalAlpha = this.fx.flash / 10;
      c.fillStyle = '#fff';
      c.fillRect(-4, -4, VW + 8, VH + 8);
      c.globalAlpha = 1;
    }
    c.restore(); // shake
    c.restore(); // world view

    // ---- overlays (always the full uncropped view: HUD is never cut by ZOOM) ----
    c.save();
    this.fitView(false);
    drawHud(c, this, this.score, this.timeLeft, this.goArrow, this.frame, this.audio.muted);
    if (this.scene === 'clear') drawClear(c, this.tally, this.score);
    if (this.scene === 'gameover') drawGameOver(c, this.sceneT);
    if (this.scene === 'continue') drawContinue(c, this.continueCount, this.sceneT);
    if (this.boss && !this.boss.alive) drawMarketCap(c, this.boss.t, this.boss.deathLine);

    // v6/v7: pause veil (touch II button, desktop P/ESC)
    if (this.paused) {
      c.fillStyle = 'rgba(4,5,10,0.55)';
      c.fillRect(0, 0, VW, VH);
      drawTextSh(c, 'PAUSED', VW / 2, 96, 3, '#f5c542', 'center');
      drawTextSh(c, this.touchActive ? 'TAP II TO RESUME' : 'P / ESC TO RESUME', VW / 2, 124, 1, '#c8ccd4', 'center');
    }
    c.restore(); // overlay view
  }

  // rendered after everything, every scene — cheap no-op on desktop
  renderTouch(): void {
    this.touch.draw(this.ctx);
  }
}
