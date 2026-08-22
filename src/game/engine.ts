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
import { buildMintStage, buildStage, MINT_FX, resetMintFx } from './stages';
import type { StageDef } from './stages';
import { drawMintHud, MINT_FLAWLESS_TIME, MINT_SECONDS, MintState } from './mint';
import { clamp, comboRankName, LANE_BOT, LANE_TOP, rand, VH, VW } from './types';
import type { Facing } from './types';
import type { GameCtx } from './ctx';
import { drawHud } from './hud';
import { drawTextSh, textWidth } from './font';
import { Haptics, TouchControls } from './touch';
import { computeFit } from './fit';
import type { ViewFit } from './fit';
import { CONTINUE_FIGHT_BTN, CONTINUE_SEAL_BTN, drawClear, drawContinue, drawGameOver, drawIntro, drawMarketCap, drawSaveRecord, drawTitle, drawVictory, SAVE_MSG_RECT, TITLE_ARENA_BTN, TITLE_BOARD_BTN, TITLE_CONNECT_BTN, TITLE_FIGHTER_BTN, TITLE_MASCOTS, titleFighterLabelRect } from './screens';
import type { SaveButton, Tally } from './screens';
import * as wallet from './wallet';
import { GateUI, FIGHTER_DISCONNECT_BTN } from './gateui';
import type { GateAction } from './gateui';
import { DEFAULT_FIGHTER, isGonnaName, loadFighter, loadSkinFrames, loadSkinMap, loadSkinPortraits, saveFighter, SKIN_INFO, skinForAsset, skinPortrait } from './skins';
import type { Fighter } from './skins';
import * as seal from './seal';
import * as board from './board';
import { BoardUI, SHARE_BTNS } from './boardui';
import type { BoardAction } from './boardui';
// ---- v9.2: THE ARENA ----
import { SealMoment } from './sealanim';
import * as share from './share';
import { shareCheckRect, shareIconRect } from './shareicons';
import { captureInstallPrompt, FsGuide } from './fsguide';
// ---- v10: THE ARENA (staking piazza) ----
import { ArenaUI } from './arena/arenaUI';
import type { ArenaAction } from './arena/arenaUI';
import { arenaMode } from './arena/chainAdapter';
import { adoptOracleFromHash } from './arena/oracleLink';
// v10.4: ?duel=<id> parsed once per page load (StrictMode double-boot safe)
let bootDuelParam: number | null | undefined;

type Scene = 'title' | 'intro' | 'play' | 'mint' | 'clear' | 'gameover' | 'continue' | 'victory' | 'connect' | 'gate' | 'fighter' | 'save' | 'board' | 'sealanim' | 'arena';

// v9.1: the run record waiting on the SAVE RECORD screen
interface SaveRec {
  score: number;
  stage: number; // 1-6
  win: 0 | 1;
  continues: number;
  fighter: Fighter;
}

type Drawable = Player | Enemy | BossLike | Item | Obstacle | Proj | MintState;

// v9.2: tiny ⛶ icon in the PAUSE menu reopens the FULLSCREEN GUIDE
const PAUSE_FS_ICON = { x: VW / 2 + 64, y: 92, w: 22, h: 22 };

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
  // ---- v9.1: SEAL + GLOBAL LEADERBOARD ----
  private board = new BoardUI();
  private continuesUsed = 0; // infinite continues, counted (BYZANTINE CLEAR = 0)
  private saveRec: SaveRec | null = null;
  private savePhase: 'edit' | 'busy' | 'done' | 'pending' | 'error' = 'edit';
  private saveErr = '';
  private saveTxid = '';
  private saveFocus = 0;
  private msgInput: HTMLInputElement | null = null; // DOM overlay (native keyboards)
  private sealReturn = false; // connect flow started from SAVE RECORD -> return there
  private swipeY: number | null = null; // board swipe scroll
  // ---- v9.2: THE SEAL MOMENT + VIRAL SHARE + FULLSCREEN GUIDE ----
  private sealAnim = new SealMoment();
  private saveMsg = ''; // the message sealed with the run (share card quote)
  private saveRank: number | null = null; // "#N IN THE GONNAVERSE" (null = unknown)
  private sharePostedX = false;
  private sharePostedTG = false;
  private shareCard: share.CardResult | null = null;
  private shareCardUrl = ''; // v9.2.2: dataURL for the DOM <img> preview (replaces the auto-download)
  private boardShareTxid = ''; // run-card share state is per-txid
  private boardPostedX = false;
  private boardPostedTG = false;
  private boardCard: share.CardResult | null = null;
  private boardCardUrl = '';
  private viewerFor: 'save' | 'board' | null = null; // v9.2.3: which VIEW CARD button opened the viewer
  // v9.2.3: the card lives in a FULLSCREEN DOM viewer (VIEW CARD button) —
  // nothing covers the game art anymore (right-click / long-press SAVE inside)
  private cardViewer = new share.CardViewer();
  // v9.2.1: REAL DOM anchors overlaid on the pixel share buttons — a genuine
  // tap on a true <a target="_blank"> is the only way iOS fires universal
  // links into the X / Telegram apps (window.open was popup-blocked + web-only)
  private shareAnchors = new share.ShareAnchors();
  private deaths = 0; // v9.2 note v2: lives lost this run
  private maxCombo = 0; // v9.2 note v2: best combo chain this run
  private guide = new FsGuide();
  // ---- v10: THE ARENA ----
  private arena = new ArenaUI();
  private sealBurst: { x: number; y: number; vx: number; vy: number; t: number; gold: boolean }[] = []; // SEAL-during-countdown pixel burst
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
    // v9.1: swipe scroll on the leaderboard (mouse drag + touch drag)
    ctx.canvas.addEventListener('pointermove', this.onPointerMove);
    // v9 boot: wallet session restore + skin assets + persisted fighter
    wallet.init();
    // v9.2.2: ATTEMPT the title music immediately on page load. Autoplay
    // policy keeps the fresh AudioContext suspended (that is fine — the
    // attempt is documented); on the FIRST pointer/key gesture anywhere,
    // onAnyGesture() resumes the context and the already-loaded TITLE loop
    // starts — music never waits for gameplay.
    this.audio.ensure();
    this.audio.playTrack('title');
    this.titleTrack = true;
    // v9.2: capture the Android install prompt for the FULLSCREEN GUIDE
    captureInstallPrompt();
    this.board.shareState = () => (this.board.currentLevel === 'run' ? { postedX: this.boardPostedX, postedTG: this.boardPostedTG } : null);
    this.cardViewer.onClose = () => {
      this.viewerFor = null; // X / ESC / tap-outside all land here
    };
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
    // v10.4: ?duel=<id> deep-link — straight into the ARENA card detail
    adoptOracleFromHash(); // #oracle= master link (testnet-only, hash scrubbed)
    this.bootArenaDeepLink();
  }

  private onMouseDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return; // touch goes through TouchControls
    // v9.2.2: a desktop mouse/touchpad pointerdown IS a first gesture too —
    // resume the AudioContext + kick the title track on ANY pointer gesture
    this.onAnyGesture();
    if (this.scene === 'board') this.swipeY = e.clientY;
    this.uiTap(e.clientX, e.clientY);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.scene !== 'board' || this.swipeY === null || (e.buttons & 1) === 0) {
      if ((e.buttons & 1) === 0) this.swipeY = null;
      return;
    }
    const dyGame = (e.clientY - this.swipeY) / this.fit.fitScale;
    this.swipeY = e.clientY;
    this.board.dragBy(dyGame);
  };

  // v9: CSS-px tap -> game coords -> scene hotspot. true = consumed.
  private uiTap(x: number, y: number): boolean {
    const s = this.scene;
    const f = this.fit;
    const gx = (x - f.fitOffX) / f.fitScale;
    const gy = (y - f.fitOffY) / f.fitScale;
    // v9.2: the FULLSCREEN GUIDE card owns every tap while it is up
    if (this.guide.visible) {
      this.guide.tap(gx, gy);
      return true;
    }
    // v9.2: tiny ⛶ icon in the PAUSE menu reopens the guide anytime
    if (s === 'play' && this.paused) {
      if (gx >= PAUSE_FS_ICON.x && gx <= PAUSE_FS_ICON.x + PAUSE_FS_ICON.w && gy >= PAUSE_FS_ICON.y && gy <= PAUSE_FS_ICON.y + PAUSE_FS_ICON.h) {
        this.guide.reopen();
        this.audio.uiSelect();
        return true;
      }
      return false; // the rest of the pause veil stays as it was
    }
    if (s === 'sealanim') {
      this.sealAnim.skip(); // THE SEAL MOMENT is skippable with a tap
      return true;
    }
    if (s === 'continue') {
      const hit = (b: { x: number; y: number; w: number; h: number }) => gx >= b.x && gx <= b.x + b.w && gy >= b.y && gy <= b.y + b.h;
      if (hit(CONTINUE_FIGHT_BTN)) {
        this.continueRun();
        return true;
      }
      if (hit(CONTINUE_SEAL_BTN)) {
        this.sealFromCountdown();
        return true;
      }
      return false;
    }
    if (s !== 'connect' && s !== 'gate' && s !== 'fighter' && s !== 'title' && s !== 'save' && s !== 'board' && s !== 'arena') return false;
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
      if (hit(TITLE_BOARD_BTN)) {
        this.openBoard();
        return true;
      }
      if (hit(TITLE_ARENA_BTN)) {
        this.openArena();
        return true;
      }
      return false; // any other title tap stays "press start"
    }
    if (s === 'save') {
      this.tapSave(gx, gy);
      return true; // never let a tap fall through to "press start"
    }
    if (s === 'board') {
      // v9.2.3: no inline preview anymore — taps go straight to the board UI
      // (VIEW CARD opens the fullscreen viewer; its DOM backdrop swallows taps)
      this.handleBoardAction(this.board.tap(gx, gy));
      return true;
    }
    if (s === 'arena') {
      // v10: THE ARENA owns every tap (canvas hotspots, no fall-through start)
      this.handleArenaAction(this.arena.tap(gx, gy));
      return true;
    }
    this.handleGateAction(this.gate.tap(gx, gy));
    return true; // gate scenes swallow every tap (no accidental start)
  }

  // v6.1: called by Game.tsx on boot and every viewport/rotation change
  setViewport(f: ViewFit): void {
    this.fit = f;
    this.touch.setViewport(f);
    this.placeMsgInput(); // v9.1: keep the DOM overlay pixel-perfect
    this.syncShareAnchors(); // v9.2.1: same for the share anchors
    this.syncCardViewer(); // v9.2.3: and the fullscreen card viewer
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
      // v9.1: a connect flow started from SAVE RECORD returns there on cancel
      if (this.sealReturn) {
        this.sealReturn = false;
        this.setScene('save');
        this.audio.uiSelect();
        return;
      }
      this.setScene('title');
      this.audio.uiSelect();
      if (!this.titleTrack) {
        this.titleTrack = true;
        this.audio.playTrack('title');
      }
    } else if (a.act === 'disconnect') {
      // v9.0.3: DISCONNECT from CHOOSE YOUR FIGHTER — wallet.disconnect() was
      // already fired by the gate UI; here the fighter goes back to the free
      // default GONNA and the flow lands on CONNECT (switching wallets), so a
      // successful reconnect returns straight to the fighter select.
      this.applyFighter({ ...DEFAULT_FIGHTER });
      this.connectFromTitle = true;
      this.openGateScene('connect', 1);
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
    // v9.1: connecting from SAVE RECORD needs no holdings — any wallet seals
    if (this.sealReturn) {
      if (connected) {
        this.sealReturn = false;
        this.setScene('save');
        this.audio.rankUp();
      }
      return;
    }
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

  // ---------- v9.1: GLOBAL LEADERBOARD ----------
  private openBoard(): void {
    this.setScene('board');
    this.board.open();
    this.audio.uiSelect();
  }

  // ---------- v10: THE ARENA ----------
  private pendingArenaDuel: number | null = null; // v10.4: ?duel=<id> deep-link
  // v11: THE ARENA — PLAY YOUR RUN -> SEAL -> SIGN. While set, the run's end
  // (stage clear / death / final victory) returns the score to the ARENA
  // seal screen instead of the campaign flow. No pending tx state survives
  // an abandoned run: nothing was signed, nothing to clean up.
  private arenaRun: { stageMode: 'full' | 'stage'; stageIdx: number } | null = null;

  private startArenaRun(stageMode: 'full' | 'stage', stageIdx: number): void {
    this.arenaRun = { stageMode, stageIdx };
    this.startNewGame(); // fresh run: score/lives/stage 0
    if (stageMode === 'stage') {
      this.stageIdx = stageIdx;
      this.loadStage(stageIdx);
      this.setScene('intro');
    }
  }

  private finishArenaRun(): void {
    if (!this.arenaRun) return;
    this.arenaRun = null;
    this.arena.onRunFinished(this.score);
    this.setScene('arena');
    this.audio.uiSelect();
  }
  private openArena(): void {
    const deep = this.pendingArenaDuel;
    this.pendingArenaDuel = null;
    this.setScene('arena');
    this.arena.open(deep);
    this.audio.uiSelect();
  }

  // v10.4: the SW bootstrap rewrites index.html — read location.search at boot
  // and, if ?duel=<id> is there, jump straight into the ARENA card detail.
  // React StrictMode boots the engine TWICE in dev: the param is parsed once
  // at module level so the surviving instance always sees it.
  private bootArenaDeepLink(): void {
    if (bootDuelParam === undefined) {
      bootDuelParam = null;
      try {
        const sp = new URLSearchParams(window.location.search);
        arenaMode(); // ?arena=testnet is read + persisted BEFORE we strip params
        const raw = sp.get('duel');
        if (raw && /^\d+$/.test(raw)) {
          bootDuelParam = Number(raw);
          sp.delete('duel'); // consume ONLY the duel param, keep arena=
          window.history.replaceState(null, '', window.location.pathname + (sp.toString() ? '?' + sp.toString() : ''));
        }
      } catch { /* no window/history: ignore */ }
    }
    if (bootDuelParam !== null) {
      this.pendingArenaDuel = bootDuelParam;
      this.openArena();
    }
  }

  private handleArenaAction(a: ArenaAction): void {
    if (a.act === 'move') this.audio.uiMove();
    else if (a.act === 'run') {
      this.startArenaRun(a.stageMode, a.stageIdx);
      this.audio.uiSelect();
    } else if (a.act === 'title') {
      this.setScene('title');
      this.audio.uiSelect();
      if (!this.titleTrack) {
        this.titleTrack = true;
        this.audio.playTrack('title');
      }
    }
  }

  private handleBoardAction(a: BoardAction): void {
    if (a.act === 'move') this.audio.uiMove();
    else if (a.act === 'title') {
      this.setScene('title');
      this.audio.uiSelect();
      if (!this.titleTrack) {
        this.titleTrack = true;
        this.audio.playTrack('title');
      }
    } else if (a.act === 'viewcard') {
      this.openBoardViewer();
    } else if (a.act === 'viewtx') {
      // v9.2.1: the real DOM anchor over VIEW TX handles the navigation
      if (a.txid) this.shareAnchors.click('board:viewtx');
    } else if (a.act === 'share') {
      this.execBoardShare(a.which);
    }
  }

  // ---------- v9.1: SAVE RECORD (SEAL) ----------
  private openSave(win: 0 | 1): void {
    this.saveRec = {
      score: this.score,
      stage: Math.min(7, this.stageIdx + 1),
      win,
      continues: this.continuesUsed,
      fighter: { ...this.fighter },
    };
    this.savePhase = 'edit';
    this.saveErr = '';
    this.saveTxid = '';
    this.saveFocus = 0;
    this.saveMsg = '';
    this.saveRank = null;
    this.sharePostedX = false;
    this.sharePostedTG = false;
    this.shareCard = null;
    this.shareCardUrl = '';
    this.viewerFor = null; // v9.2.3: card viewer starts closed
    this.saveBest(); // best score persists locally regardless of the seal
    this.setScene('save');
    this.ensureMsgInput();
    this.audio.uiSelect();
  }

  // v9.2: FIGHT ON (countdown continue — infinite continues, still counted)
  private continueRun(): void {
    this.continuesUsed++;
    this.player.lives = 2;
    this.player.hp = this.player.maxHp;
    this.player.state = 'getup';
    this.player.t = 0;
    this.player.z = 0;
    this.player.invuln = 120;
    this.setScene('play');
    if (this.stage) this.audio.playTrack(this.boss ? this.stage.bossTrack : this.stage.track);
    this.audio.uiSelect();
  }

  // v9.2: SEAL MY RECORD mid-countdown — pixel burst, then the SEAL overlay
  private sealFromCountdown(): void {
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      this.sealBurst.push({
        x: VW / 2,
        y: 116,
        vx: Math.cos(a) * (1.2 + (i % 4) * 0.5),
        vy: Math.sin(a) * (1.2 + (i % 3) * 0.5) - 0.6,
        t: 34 + (i % 5) * 5,
        gold: (i & 1) === 0,
      });
    }
    this.audio.rankUp();
    this.openSave(0);
  }

  private saveBest(): void {
    try {
      const raw = window.localStorage.getItem('gonna.best');
      const prev = raw ? (JSON.parse(raw) as { score?: number }) : null;
      if (prev && typeof prev.score === 'number' && prev.score >= this.score) return;
      window.localStorage.setItem(
        'gonna.best',
        JSON.stringify({ score: this.score, stage: this.stageIdx + 1, win: this.finalVictory ? 1 : 0, continues: this.continuesUsed, ts: Date.now() }),
      );
    } catch { /* storage unavailable */ }
  }

  private closeSave(): void {
    this.saveRec = null;
    this.removeMsgInput();
  }

  private saveToTitle(): void {
    this.closeSave();
    this.setScene('title');
    this.audio.uiSelect();
    if (!this.titleTrack) {
      this.titleTrack = true;
      this.audio.playTrack('title');
    }
  }

  // button set depends on the phase + wallet connection
  private saveButtons(): SaveButton[] {
    if (this.savePhase === 'busy') return [];
    if (this.savePhase === 'done' || this.savePhase === 'pending') {
      // v9.2.3: the SEALED screen — the game art stays clean; VIEW CARD (step
      // 1 of the 2-step guide) opens the fullscreen viewer, X/TG are step 2.
      // Taller 20px buttons so the 18px fluo icons breathe.
      // v9.2.4: the generic web-share SHARE button is GONE (redundant,
      // dead on many browsers) — VIEW TX / DONE rebalance to 2 even 156px
      // buttons (30/198, 12px gap, span 30..354).
      return [
        { id: 'viewcard', label: 'VIEW CARD', x: 112, y: 72, w: 160, h: 20 },
        { id: 'sharex', label: 'SHARE ON X', x: 30, y: 152, w: 150, h: 20, icon: 'x', posted: this.sharePostedX },
        { id: 'sharetg', label: 'SHARE ON TELEGRAM', x: 204, y: 152, w: 150, h: 20, icon: 'tg', posted: this.sharePostedTG },
        { id: 'viewtx', label: 'VIEW TX', x: 30, y: 176, w: 156, h: 20 },
        { id: 'done', label: 'DONE', x: 198, y: 176, w: 156, h: 20 },
      ];
    }
    if (this.savePhase === 'error') {
      return [
        { id: 'retry', label: 'RETRY', x: 92, y: 172, w: 90, h: 18 },
        { id: 'skip', label: 'SKIP', x: 202, y: 172, w: 90, h: 18 },
      ];
    }
    if (!wallet.isConnected()) {
      return [
        { id: 'connect', label: 'CONNECT WALLET TO SEAL', x: 62, y: 172, w: 180, h: 18 },
        { id: 'skip', label: 'SKIP', x: 262, y: 172, w: 60, h: 18 },
      ];
    }
    return [
      { id: 'seal', label: 'SEAL ON-CHAIN', x: 92, y: 172, w: 110, h: 18 },
      { id: 'skip', label: 'SKIP', x: 222, y: 172, w: 70, h: 18 },
    ];
  }

  private activateSaveButton(id: string): void {
    switch (id) {
      case 'seal':
      case 'retry':
        this.doSeal();
        break;
      case 'connect':
        this.sealReturn = true;
        this.openGateScene('connect', this.gateNext);
        break;
      case 'viewcard':
        this.openSaveViewer();
        break;
      case 'viewtx':
        // v9.2.1: real DOM anchor (allo.info, new tab — popup-blocker proof)
        this.shareAnchors.click('save:viewtx');
        break;
      case 'sharex':
        this.execShare('x');
        break;
      case 'sharetg':
        this.execShare('tg');
        break;
      case 'skip':
      case 'done':
        this.saveToTitle();
        break;
    }
  }

  // primary action for ENTER while the message input is focused
  private activateSavePrimary(): void {
    const btns = this.saveButtons();
    if (btns.length === 0) return;
    this.activateSaveButton(btns[Math.min(this.saveFocus, btns.length - 1)].id);
  }

  private tapSave(gx: number, gy: number): void {
    if (this.savePhase === 'busy') return;
    // tapping the message box focuses the DOM input (mobile keyboard) — EDIT phase only (v9.2.2)
    const r = SAVE_MSG_RECT;
    if (this.savePhase === 'edit' && gx >= r.x && gx <= r.x + r.w && gy >= r.y && gy <= r.y + r.h && this.msgInput) {
      this.msgInput.focus({ preventScroll: true });
      return;
    }
    const btns = this.saveButtons();
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      if (gx >= b.x && gx <= b.x + b.w && gy >= b.y && gy <= b.y + b.h) {
        this.saveFocus = i;
        this.audio.uiSelect();
        this.activateSaveButton(b.id);
        return;
      }
    }
  }

  private updateSaveScene(): void {
    this.sceneT++;
    if (!this.saveRec) {
      this.saveToTitle();
      return;
    }
    this.ensureMsgInput(); // re-show after a connect detour (cheap no-op otherwise)
    // v9.2.2: the message input belongs to the EDIT phase only — in done /
    // pending its placeholder would float over the card preview <img>
    if (this.msgInput) {
      const hide = this.savePhase !== 'edit';
      const hidden = this.msgInput.style.display === 'none';
      if (hide !== hidden) {
        this.msgInput.style.display = hide ? 'none' : '';
        if (!hide) this.placeMsgInput();
      }
    }
    const inp = this.input;
    const typing = this.msgInput !== null && document.activeElement === this.msgInput;
    if (inp.pressed.pause) {
      this.saveToTitle();
      return;
    }
    if (!typing && this.savePhase !== 'busy') {
      const btns = this.saveButtons();
      if (btns.length > 0) {
        if (inp.pressed.left || inp.pressed.up) {
          this.saveFocus = (this.saveFocus + btns.length - 1) % btns.length;
          this.audio.uiMove();
        } else if (inp.pressed.right || inp.pressed.down) {
          this.saveFocus = (this.saveFocus + 1) % btns.length;
          this.audio.uiMove();
        }
      }
    }
    if (inp.pressed.start && this.savePhase !== 'busy') this.activateSavePrimary();
  }

  private doSeal(): void {
    if (!this.saveRec || this.savePhase === 'busy') return;
    const rec = this.saveRec;
    const msg = this.msgInput ? this.msgInput.value : '';
    this.saveMsg = msg;
    this.savePhase = 'busy';
    this.saveErr = '';
    this.audio.rankUp();
    // v9.2: THE SEAL MOMENT begins — ACT 1 SIGNING while the wallet works
    this.sealAnim.start({ score: rec.score, win: rec.win, continues: rec.continues, skin: rec.fighter.skin });
    this.setScene('sealanim');
    seal
      .seal({
        score: rec.score,
        stage: rec.stage,
        win: rec.win,
        continues: rec.continues,
        assetId: rec.fighter.assetId,
        skin: rec.fighter.skin,
        msg,
        // v9.2 note v2: pause-immune frame time + deaths + best combo
        timeSec: Math.round(this.totalFrames / 60),
        deaths: this.deaths,
        maxCombo: this.maxCombo,
      })
      .then((o) => {
        this.saveTxid = o.txid;
        this.savePhase = o.status === 'sealed' ? 'done' : 'pending';
        this.sealAnim.confirm(o.round); // ACT 2: freeze -> flash -> GONG
        // rank for the ACT 4 reveal: leaderboard fetch, SEALED FOREVER if unknown
        const addr = wallet.getWallet().address;
        const round = o.round > 0 ? o.round : Number.MAX_SAFE_INTEGER;
        board
          .fetchBoard(false)
          .then((d) => {
            if (d.status === 'ready' && addr) {
              this.saveRank = board.rankOfEntry({ sender: addr, score: rec.score, continues: rec.continues, round });
              this.sealAnim.rank = this.saveRank;
            }
          })
          .catch(() => { /* offline: SEALED FOREVER */ });
      })
      .catch((e: unknown) => {
        console.error('[gonna] seal failed:', e);
        this.saveErr = (e instanceof Error ? e.message : 'SEAL FAILED').toUpperCase().slice(0, 38);
        this.savePhase = 'error';
        this.saveFocus = 0;
        if (this.scene === 'sealanim') this.setScene('save'); // no show on a failed seal
      });
  }

  // ---------- v9.2: VIRAL SHARE ----------
  private buildShareRec(): share.ShareRec | null {
    const rec = this.saveRec;
    if (!rec) return null;
    return {
      score: rec.score,
      stage: rec.stage,
      win: rec.win,
      continues: rec.continues,
      timeSec: Math.round(this.totalFrames / 60),
      maxCombo: this.maxCombo,
      assetId: rec.fighter.assetId ?? 0,
      skin: rec.fighter.skin,
      fighter: rec.fighter.name,
      msg: this.saveMsg,
      crown: rec.win === 1 && rec.continues === 0,
      rank: this.saveRank,
    };
  }

  // v9.2.1: the DOM anchors overlaid on the pixel share buttons. Genuine taps
  // land on REAL <a target="_blank" rel="noopener"> elements, so iOS fires the
  // universal links into the X / Telegram apps and the popup blocker never
  // engages (window.open from the canvas tap handler was treated as a
  // programmatic navigation -> prompt + web login page). Synced every frame.
  private syncShareAnchors(): void {
    if (typeof document === 'undefined') return;
    const defs: share.ShareAnchorDef[] = [];
    if (this.scene === 'save' && this.saveRec && (this.savePhase === 'done' || this.savePhase === 'pending')) {
      const r = this.buildShareRec();
      const btns = this.saveButtons();
      const bx = btns.find((b) => b.id === 'sharex');
      const bt = btns.find((b) => b.id === 'sharetg');
      const bv = btns.find((b) => b.id === 'viewtx');
      if (r && bx) defs.push({ id: 'save:sharex', rect: bx, href: share.shareUrlX(r), scheme: share.shareSchemeX(r), aria: 'Share on X', onTap: () => this.prepareSaveShare('x') });
      if (r && bt) defs.push({ id: 'save:sharetg', rect: bt, href: share.shareUrlTG(r), scheme: share.shareSchemeTG(r), aria: 'Share on Telegram', onTap: () => this.prepareSaveShare('tg') });
      if (bv && this.saveTxid) defs.push({ id: 'save:viewtx', rect: bv, href: 'https://allo.info/tx/' + this.saveTxid, scheme: null, aria: 'View the seal transaction on allo.info', onTap: () => this.audio.uiSelect() });
    } else if (this.scene === 'board' && this.board.currentLevel === 'run' && this.board.currentRun) {
      const r = this.buildBoardShareRec();
      const e = this.board.currentRun;
      if (r) {
        const bx = SHARE_BTNS.find((b) => b.id === 'share:x');
        const bt = SHARE_BTNS.find((b) => b.id === 'share:tg');
        const bv = SHARE_BTNS.find((b) => b.id === 'viewtx');
        if (bx) defs.push({ id: 'board:sharex', rect: bx, href: share.shareUrlX(r), scheme: share.shareSchemeX(r), aria: 'Share on X', onTap: () => this.prepareBoardShare('x') });
        if (bt) defs.push({ id: 'board:sharetg', rect: bt, href: share.shareUrlTG(r), scheme: share.shareSchemeTG(r), aria: 'Share on Telegram', onTap: () => this.prepareBoardShare('tg') });
        if (bv) defs.push({ id: 'board:viewtx', rect: bv, href: 'https://allo.info/tx/' + e.txid, scheme: null, aria: 'View the seal transaction on allo.info', onTap: () => this.audio.uiSelect() });
      }
    }
    this.shareAnchors.sync(defs, this.fit, this.touchActive);
  }

  // POSTED state + the 1200x630 card render — called by the DOM anchor inside
  // the SAME genuine tap; NO navigation and NO download here (v9.2.2: the
  // programmatic download click burned iOS's single-gesture navigation token,
  // killing the app-scheme jump — the card lives in the DOM <img> preview now)
  private prepareSaveShare(which: 'x' | 'tg'): void {
    const r = this.buildShareRec();
    if (!r) return;
    if (!this.shareCard) {
      const fr = this.pframes ?? this.frames;
      this.shareCard = share.renderCard(r, fr.get('0_0') ?? null);
    }
    if (which === 'x') this.sharePostedX = true;
    else this.sharePostedTG = true;
    this.audio.uiSelect();
  }

  private prepareBoardShare(which: 'x' | 'tg'): void {
    const r = this.buildBoardShareRec();
    const e = this.board.currentRun;
    if (!r || !e) return;
    if (!this.boardCard) {
      const sprite = e.skin === 'gonna' ? (this.frames.get('0_0') ?? null) : skinPortrait(e.skin);
      this.boardCard = share.renderCard(r, sprite);
    }
    if (which === 'x') this.boardPostedX = true;
    else this.boardPostedTG = true;
    this.audio.uiSelect();
  }

  // v9.2.4: X/TG only — the generic web-share path is gone (the SHARE
  // button was redundant next to VIEW CARD + the direct anchors and dead on
  // many browsers)
  private execShare(which: 'x' | 'tg'): void {
    // v9.2.1: navigation lives on the real DOM anchor (keyboard ENTER / any
    // canvas fallback tap routes through the very same anchor)
    if (!this.shareAnchors.click(which === 'x' ? 'save:sharex' : 'save:sharetg')) this.prepareSaveShare(which);
  }

  // share straight from a RUN CARD (L3 of THE ARENA)
  private execBoardShare(which: 'x' | 'tg'): void {
    if (!this.shareAnchors.click(which === 'x' ? 'board:sharex' : 'board:sharetg')) this.prepareBoardShare(which);
  }

  // v9.2.3: VIEW CARD on the SEALED screen -> fullscreen viewer (step 1 of
  // the "1 SAVE THE CARD - 2 POST IT" guide)
  private openSaveViewer(): void {
    if (!this.shareCard) {
      const r = this.buildShareRec();
      if (!r) return;
      const fr = this.pframes ?? this.frames;
      this.shareCard = share.renderCard(r, fr.get('0_0') ?? null);
    }
    this.viewerFor = 'save';
    this.audio.uiSelect();
  }

  // v9.2.3: VIEW CARD on a RUN CARD -> fullscreen viewer
  private openBoardViewer(): void {
    const e = this.board.currentRun;
    if (!e) return;
    if (!this.boardCard) {
      const sprite = e.skin === 'gonna' ? (this.frames.get('0_0') ?? null) : skinPortrait(e.skin);
      const r = this.buildBoardShareRec();
      if (r) this.boardCard = share.renderCard(r, sprite);
    }
    this.viewerFor = 'board';
    this.audio.uiSelect();
  }

  // v9.2.3: the fullscreen CARD VIEWER (RIGHT CLICK SAVE / HOLD TO SAVE).
  // Synced every frame like the anchors: open only while viewerFor matches a
  // live card source; any scene/level change closes it.
  private syncCardViewer(): void {
    if (typeof document === 'undefined') return;
    if (this.viewerFor === 'save' && this.scene === 'save' && this.saveRec && (this.savePhase === 'done' || this.savePhase === 'pending')) {
      if (!this.shareCard) {
        const r = this.buildShareRec();
        if (r) {
          const fr = this.pframes ?? this.frames;
          this.shareCard = share.renderCard(r, fr.get('0_0') ?? null);
        }
      }
      if (this.shareCard) {
        if (!this.shareCardUrl) this.shareCardUrl = this.shareCard.canvas.toDataURL('image/png');
        this.cardViewer.open('save:' + this.saveTxid + ':' + this.savePhase, this.shareCardUrl, this.touchActive);
        return;
      }
    } else if (this.viewerFor === 'board' && this.scene === 'board' && this.board.currentLevel === 'run' && this.board.currentRun) {
      const e = this.board.currentRun;
      if (!this.boardCard) {
        const r = this.buildBoardShareRec();
        const sprite = e.skin === 'gonna' ? (this.frames.get('0_0') ?? null) : skinPortrait(e.skin);
        if (r) this.boardCard = share.renderCard(r, sprite);
      }
      if (this.boardCard) {
        if (!this.boardCardUrl) this.boardCardUrl = this.boardCard.canvas.toDataURL('image/png');
        this.cardViewer.open('board:' + e.txid, this.boardCardUrl, this.touchActive);
        return;
      }
    }
    if (this.viewerFor !== null) this.viewerFor = null; // source gone -> drop the request
    this.cardViewer.close();
  }

  // share record for the currently open RUN CARD (resets the per-txid posted
  // state when a fresh card is opened)
  private buildBoardShareRec(): share.ShareRec | null {
    const e = this.board.currentRun;
    if (!e) return null;
    if (this.boardShareTxid !== e.txid) {
      // a fresh run card: reset the posted states + preview dismissal
      this.boardShareTxid = e.txid;
      this.boardPostedX = false;
      this.boardPostedTG = false;
      this.boardCard = null;
      this.boardCardUrl = '';
    }
    const nft = e.assetId > 0 ? skinForAsset(e.assetId) : null;
    return {
      score: e.score,
      stage: e.stage,
      win: e.win,
      continues: e.continues,
      timeSec: e.timeSec,
      maxCombo: e.maxCombo,
      assetId: e.assetId,
      skin: e.skin,
      fighter: nft ? nft.name.trim() : 'GONNA',
      msg: e.msg,
      crown: board.isCrown(e),
      rank: board.rankOfEntry(e),
    };
  }

  // ---------- v9.1: DOM message input (native mobile keyboards, accessible) ----------
  private ensureMsgInput(): void {
    if (typeof document === 'undefined') return;
    if (this.msgInput) {
      // re-show after a scene detour (connect-from-save)
      if (this.msgInput.style.display === 'none') {
        this.msgInput.style.display = '';
        this.placeMsgInput();
      }
      return;
    }
    const el = document.createElement('input');
    el.type = 'text';
    el.id = 'gonna-seal-msg';
    el.maxLength = seal.MSG_MAX;
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.setAttribute('autocapitalize', 'characters');
    el.setAttribute('aria-label', 'Seal message, ASCII only, max 32 characters');
    el.setAttribute('placeholder', 'TYPE YOUR MESSAGE');
    el.style.cssText =
      'position:fixed;z-index:30;box-sizing:border-box;background:transparent;border:none;outline:none;' +
      'color:#7fd858;font-family:monospace;font-weight:bold;text-transform:uppercase;padding:0 4px;caret-color:#7fd858;';
    el.addEventListener('input', () => {
      const clean = seal.cleanMsg(el.value);
      if (clean !== el.value) el.value = clean;
    });
    el.addEventListener('keydown', (e) => {
      // typing must never drive the game; ENTER confirms, ESC skips
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.activateSavePrimary();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.saveToTitle();
      }
    });
    document.body.appendChild(el);
    this.msgInput = el;
    this.placeMsgInput();
    try {
      el.focus({ preventScroll: true });
    } catch { /* older browsers */ }
  }

  private placeMsgInput(): void {
    const el = this.msgInput;
    if (!el) return;
    const f = this.fit;
    el.style.left = Math.round(f.fitOffX + SAVE_MSG_RECT.x * f.fitScale) + 'px';
    el.style.top = Math.round(f.fitOffY + SAVE_MSG_RECT.y * f.fitScale) + 'px';
    el.style.width = Math.round(SAVE_MSG_RECT.w * f.fitScale) + 'px';
    el.style.height = Math.round(SAVE_MSG_RECT.h * f.fitScale) + 'px';
    // iOS Safari auto-zooms on focused inputs < 16px — go 16px on touch
    el.style.fontSize = Math.max(this.touchActive ? 16 : 10, Math.round(9 * f.fitScale)) + 'px';
    el.style.letterSpacing = Math.max(0, Math.round(1 * f.fitScale)) + 'px';
  }

  private removeMsgInput(): void {
    if (this.msgInput) {
      this.msgInput.remove();
      this.msgInput = null;
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
    this.ctx.canvas.removeEventListener('pointerdown', this.onMouseDown);
    this.ctx.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.removeMsgInput();
    this.shareAnchors.clear(); // v9.2.1: drop the DOM share anchors too
    this.cardViewer.close(); // v9.2.3: and the fullscreen card viewer
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
  // v9.4: QA hook — jump straight into THE MINTING (dev only)
  debugMint(): void {
    this.loadMint();
    this.setScene('mint');
    if (this.stage) this.audio.playTrack(this.stage.track);
  }
  debugMintHit(dmg: number): void {
    if (this.scene === 'mint' && this.mint && !this.mint.broken) {
      this.mint.hit(this, dmg);
      if (this.mint.broken && this.timeLeft > MINT_FLAWLESS_TIME) this.mint.awardFlawless(this);
    }
  }
  get mintInfo(): { scene: boolean; hp: number; broken: boolean; done: boolean; earned: number; timeLeft: number } {
    return {
      scene: this.scene === 'mint',
      hp: this.mint?.hp ?? -1,
      broken: this.mint?.broken ?? false,
      done: this.mint?.done ?? false,
      earned: this.mint?.earned ?? 0,
      timeLeft: this.timeLeft,
    };
  }
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
  get bossInfo(): { kind: string; hp: number; state: string; x: number } | null {
    return this.boss ? { kind: this.boss.kind, hp: this.boss.hp, state: this.boss.state, x: Math.round(this.boss.x) } : null;
  }
  get playInfo(): { px: number; camX: number; wave: number; waveActive: boolean; enemies: number; queue: number; lives: number; pstate: string } {
    return {
      px: Math.round(this.player.x),
      camX: Math.round(this.camX),
      wave: this.waveIdx,
      waveActive: this.waveActive,
      enemies: this.enemies.filter((e) => e.alive).length,
      queue: this.spawnQueue.length,
      lives: this.player.lives,
      pstate: this.player.state,
    };
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
    boardBtn: { x: number; y: number; w: number; h: number };
    connectLabel: string;
    boardLabel: string; // v9.2.2: ARENA on BOTH desktop and touch (L key unchanged)
    mascots: { x: number; y: number; w: number; h: number }[];
  } {
    return {
      fighterLabel: titleFighterLabelRect(this.fighter.name),
      fighterBtn: TITLE_FIGHTER_BTN,
      connectBtn: TITLE_CONNECT_BTN,
      boardBtn: TITLE_BOARD_BTN,
      connectLabel: wallet.isConnected() ? wallet.identityLabel(14) : 'CONNECT',
      boardLabel: 'ARENA', // v9.2.2: ARENA on BOTH desktop and touch ("voglio lo stesso nome"); desktop keeps the L key
      mascots: TITLE_MASCOTS,
    };
  }
  // v9.0.3 CI: fighter-screen wallet-strip bboxes (no-overlap assertions).
  // All rects mirror the exact draw positions in gateui.drawFighter.
  get fighterLayout(): {
    panel: { x: number; y: number; w: number; h: number } | null;
    disconnectBtn: { x: number; y: number; w: number; h: number } | null;
    identityRect: { x: number; y: number; w: number; h: number } | null;
    balanceRow: { x: number; y: number; w: number; h: number } | null;
  } {
    const on = this.scene === 'fighter' && wallet.isConnected();
    if (!on) return { panel: null, disconnectBtn: null, identityRect: null, balanceRow: null };
    const py = VH - 28; // compact panel top
    const idLabel = wallet.identityLabel(26);
    const idW = textWidth(idLabel, 1);
    const e = wallet.getEligibility();
    const nftTxt = e.busy && !e.checked ? '...' : String(e.nfts.length);
    let balEnd = 218 + textWidth(nftTxt, 1);
    if (e.source === 'cache') balEnd = Math.max(balEnd, 244 + textWidth('CACHED', 1));
    return {
      panel: { x: 8, y: py, w: VW - 16, h: 26 },
      disconnectBtn: { ...FIGHTER_DISCONNECT_BTN },
      identityRect: { x: VW - 14 - idW, y: py + 4, w: idW, h: 7 },
      balanceRow: { x: 14, y: py + 15, w: balEnd - 14, h: 7 },
    };
  }
  get fxScreen(): { rings: { x: number; y: number; r: number }[]; parts: { x: number; y: number }[]; pops: { x: number; y: number; txt: string }[] } {
    return this.fx.debugScreen(this.camX);
  }
  // ---- v9.1 SEAL + LEADERBOARD debug (window.__gonna) ----
  get runInfo(): { score: number; stage: number; continuesUsed: number; win: 0 | 1 } {
    return { score: this.score, stage: this.stageIdx + 1, continuesUsed: this.continuesUsed, win: this.finalVictory ? 1 : 0 };
  }
  get saveInfo(): {
    phase: string;
    err: string;
    txid: string;
    msg: string;
    rank: number | null;
    postedX: boolean;
    postedTG: boolean;
    rec: { score: number; stage: number; win: 0 | 1; continues: number; fighter: { skin: string; assetId: number | null; name: string } } | null;
    buttons: { id: string; label: string; x: number; y: number; w: number; h: number; icon?: string | null; posted?: boolean }[];
  } {
    const rec = this.saveRec;
    return {
      phase: this.savePhase,
      err: this.saveErr,
      txid: this.saveTxid,
      msg: this.msgInput ? this.msgInput.value : '',
      rank: this.saveRank,
      postedX: this.sharePostedX,
      postedTG: this.sharePostedTG,
      rec: rec
        ? { score: rec.score, stage: rec.stage, win: rec.win, continues: rec.continues, fighter: { skin: rec.fighter.skin, assetId: rec.fighter.assetId, name: rec.fighter.name } }
        : null,
      buttons: this.scene === 'save' ? this.saveButtons() : [],
    };
  }
  // ---- v9.2: THE SEAL MOMENT / VIRAL SHARE / ARENA / FULLSCREEN GUIDE ----
  get sealAnimInfo(): { scene: boolean; act: number; actT: number; flash: string; candles: number; block: number; rank: number | null; done: boolean; skipped: boolean } {
    return { scene: this.scene === 'sealanim', ...this.sealAnim.info };
  }
  get shareInfo(): {
    xText: string;
    tgText: string;
    xUrl: string;
    tgUrl: string;
    signature: string;
    postedX: boolean;
    postedTG: boolean;
    postedSprite: boolean; // v9.2.1: POSTED! check is a DRAWN sprite, never a font glyph
    card: { w: number; h: number; hasMsg: boolean; hasSkrrt: boolean; texts: string[] } | null;
    boardCard: { w: number; h: number; hasMsg: boolean; hasSkrrt: boolean; texts: string[] } | null;
  } {
    const r = this.buildShareRec();
    const cardInfo = (c: share.CardResult | null) =>
      c ? { w: c.canvas.width, h: c.canvas.height, hasMsg: c.hasMsg, hasSkrrt: c.texts.some((t) => t.includes('SKRRT')), texts: c.texts } : null;
    return {
      xText: r ? share.shareTextX(r) : '',
      tgText: r ? share.shareTextTG(r) : '',
      xUrl: r ? share.shareUrlX(r) : '',
      tgUrl: r ? share.shareUrlTG(r) : '',
      signature: share.SIGNATURE,
      postedX: this.sharePostedX,
      postedTG: this.sharePostedTG,
      postedSprite: true, // the checkmark next to POSTED! is drawCheck(), not ✓
      card: cardInfo(this.shareCard),
      boardCard: cardInfo(this.boardCard),
    };
  }
  // ---- v9.2.1: DOM share anchors (CI) ----
  get shareAnchorInfo(): { id: string; href: string; scheme: string | null; target: string; rel: string; css: { x: number; y: number; w: number; h: number } }[] {
    return this.shareAnchors.info();
  }
  // ---- v9.2.2: card preview <img> + icon layout + audio (CI) ----
  // ---- v9.2.3: fullscreen card viewer + 2-step guide (CI) ----
  get cardViewerInfo(): { open: boolean; id: string; caption: string; captionDesktop: string; captionTouch: string; src: string; cls: string; imgCls: string; guide: string; wanted: string | null } {
    return { ...this.cardViewer.info(), guide: share.SHARE_GUIDE, wanted: this.viewerFor };
  }
  // icon vs POSTED-check bboxes on the live share buttons (no-overlap proof)
  get shareIconLayout(): { id: string; icon: { x: number; y: number; w: number; h: number } | null; check: { x: number; y: number; w: number; h: number } }[] {
    const out: { id: string; icon: { x: number; y: number; w: number; h: number } | null; check: { x: number; y: number; w: number; h: number } }[] = [];
    const btns: { id: string; x: number; y: number; w: number; h: number; icon?: string | null }[] =
      this.scene === 'save' ? this.saveButtons() : this.scene === 'board' && this.board.currentLevel === 'run' ? [...SHARE_BTNS] : [];
    for (const b of btns) {
      if (b.id !== 'sharex' && b.id !== 'sharetg' && b.id !== 'share:x' && b.id !== 'share:tg') continue;
      out.push({ id: b.id, icon: shareIconRect(b), check: shareCheckRect(b) });
    }
    return out;
  }
  get audioInfo(): { state: string; track: string | null; unlocked: boolean; muted: boolean } {
    return this.audio.info;
  }
  // CI: capture share navigations + fake page visibility for fallback tests.
  // collect != null -> navigations are recorded instead of executed;
  // hidden != null -> overrides document.hidden for the 1.2s fallback check.
  debugShareHooks(collect: string[] | null, hidden: boolean | null): void {
    share.setShareHooks({
      go: collect ? (u) => collect.push(u) : null,
      hidden: hidden === null ? null : () => hidden,
    });
  }
  get fsGuideInfo(): { platform: string | null; standalone: boolean; installAvail: boolean; visible: boolean; dismissed: boolean; autoShown: boolean; installFired: boolean } {
    return this.guide.info;
  }
  get continueInfo(): { count: number; continuesUsed: number; fightBtn: { x: number; y: number; w: number; h: number }; sealBtn: { x: number; y: number; w: number; h: number } } {
    return { count: this.continueCount, continuesUsed: this.continuesUsed, fightBtn: CONTINUE_FIGHT_BTN, sealBtn: CONTINUE_SEAL_BTN };
  }
  // CI: the generated 1200x630 share card as a PNG data URL (saved by the suite)
  debugCardPng(): string | null {
    return this.shareCard ? this.shareCard.canvas.toDataURL('image/png') : null;
  }
  debugBoardCardPng(): string | null {
    return this.boardCard ? this.boardCard.canvas.toDataURL('image/png') : null;
  }
  // CI: build the share card without tapping (layout/PNG checks)
  debugRenderCard(): void {
    const r = this.buildShareRec();
    if (!r) return;
    const fr = this.pframes ?? this.frames;
    this.shareCard = share.renderCard(r, fr.get('0_0') ?? null);
  }
  // CI: reopen / state-control for the FULLSCREEN GUIDE
  debugReopenGuide(): void {
    this.guide.reopen();
  }
  get lastSeal(): seal.SealDebug | null {
    return seal.sealDebug.last;
  }
  get boardInfo(): BoardUI['info'] {
    return this.board.info;
  }
  // name-guard unit check through the REAL loader guard
  get skinGuardInfo(): { name: string; accepted: boolean }[] {
    const samples = ['GONNA 123', 'GONNA123', ' GONNA 48', 'gonna 7', 'GONNA #42', 'CompX Galaxy Card', 'GONNA', 'GONNA X', 'GONNAVERSE 5', ''];
    return samples.map((name) => ({ name, accepted: isGonnaName(name) }));
  }
  // CI: synthesize an end-of-run SAVE RECORD screen (deterministic note tests)
  debugSaveRecord(win: 0 | 1, score = 42420): void {
    this.score = score;
    this.openSave(win);
  }
  // CI: straight to the game-over jingle (continue screen follows at t>130)
  debugGameOver(): void {
    this.setScene('gameover');
  }
  // CI: let the continue countdown expire on the next tick
  debugExpireContinue(): void {
    if (this.scene === 'continue') this.continueCount = -1;
  }
  debugOpenBoard(): void {
    this.openBoard();
  }
  // ---- v10: THE ARENA debug (window.__gonna) ----
  debugOpenArena(): void {
    this.openArena();
  }
  get arenaInfo(): ArenaUI['info'] {
    return this.arena.info;
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
    this.continuesUsed = 0; // v9.1: per-run counter, reset on a new run
    this.deaths = 0; // v9.2 note v2 telemetry
    this.maxCombo = 0;
    this.player.lives = 2;
    this.loadStage(0);
    this.scene = 'intro';
    this.sceneT = 0;
    this.touch.releaseAll(); // the confirming tap must not leak into the intro
    this.audio.uiSelect();
  }

  private loadStage(idx: number): void {
    this.stage = buildStage(idx);
    if (idx === 6) void loadSkinFrames('rainbow'); // v9.5: GONNA 404 wears the REAL rainbow skin
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

  // ---------- v9.4: THE MINTING (SF2-style bonus stage after Stage 3) ----------
  private loadMint(): void {
    this.stage = buildMintStage();
    this.stageLen = VW; // single-screen arena: camX never moves
    this.enemies = [];
    this.items = [];
    this.obstacles = [];
    this.boss = null;
    this.bossSpawned = false;
    this.waveIdx = 0;
    this.waveActive = false;
    this.spawnQueue = [];
    this.camX = 0;
    this.camLock = 0;
    this.timeLeft = MINT_SECONDS;
    this.stageScoreStart = this.score;
    this.goArrow = false;
    this.fx.reset();
    for (const pr of this.projs) pr.on = false;
    this.player.reset(96, 178);
    this.player.hp = this.player.maxHp;
    this.mint = new MintState();
    resetMintFx();
    this.setScene('intro'); // the BONUS STAGE / THE MINTING title card
  }

  private updateMint(): void {
    this.totalFrames++;
    const m = this.mint;
    if (!m) {
      this.setScene('play');
      return;
    }
    // v9.2 note v2: combo chains on the monument count toward the record
    if (this.player.comboHits > this.maxCombo) this.maxCombo = this.player.comboHits;
    // hit-stop / slow-mo freeze the sim but never the fx (same contract as play)
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
    // 40 seconds on the clock — frozen once the monument is down / results are up
    if (!m.done && !m.broken) {
      this.timeLeft -= 1 / 60;
      if (this.timeLeft <= 10) MINT_FX.klaxon = true;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        m.timeUp(this);
      }
    }
    p.update(this);
    this.updateCamera();
    if (!m.broken && !m.done) {
      // BYZANTINE SLAM hits the monument too (it's on screen, it's gold, it counts)
      if (p.state === 'special' && p.t === 10) m.hit(this, 40);
      const box = p.attackBox();
      if (box && m.lastHitId !== box.id && m.hitTest(box)) {
        m.lastHitId = box.id;
        const comboAtk = p.state === 'punch' || p.state === 'kick';
        const dmg = comboAtk ? p.scaledDmg(box.dmg) : box.dmg;
        m.hit(this, dmg);
        if (comboAtk) p.registerHit(this, dmg);
        // FLAWLESS MINT: monument down with time to spare
        if (m.broken && this.timeLeft > MINT_FLAWLESS_TIME) m.awardFlawless(this);
      }
    }
    m.update(this);
    this.fx.update();
    if (m.done && m.wrapFrames > 40 && this.input.pressed.start) {
      this.input.pressed.start = false;
      this.exitMint();
    }
  }

  private exitMint(): void {
    this.mint = null;
    this.stageIdx = 3;
    this.loadStage(3);
    this.setScene('intro');
    this.audio.uiSelect();
  }

  private mint: MintState | null = null; // v9.4: THE MINTING bonus stage state

  private setScene(s: Scene): void {
    this.scene = s;
    this.sceneT = 0;
    // no held control may leak across a scene cut (joystick ghost / stuck button)
    this.touch.releaseAll();
    // v9.1: the SEAL message overlay only exists on the SAVE RECORD screen
    if (s !== 'save' && this.msgInput) this.msgInput.style.display = 'none';
  }

  // ---------- main loop ----------
  step(): void {
    if (this.paused) {
      // v7: P/ESC resumes from desktop too (touch resumes via the II button)
      if (this.input.pressed.pause) {
        this.input.pressed.pause = false;
        // v9.2: with the FULLSCREEN GUIDE up, ESC dismisses the card instead
        if (this.guide.visible) this.guide.keyStart();
        else this.togglePause();
      }
      this.input.postUpdate(); // swallow buffered edges while frozen
      return;
    }
    this.frame++;
    const inp = this.input;
    // v9.2: SEAL-during-countdown pixel burst (short-lived overlay particles)
    if (this.sealBurst.length > 0) {
      for (const p of this.sealBurst) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08;
        p.t--;
      }
      this.sealBurst = this.sealBurst.filter((p) => p.t > 0);
    }
    // v9.2: the FULLSCREEN GUIDE card swallows START/ESC while it is up
    if (this.guide.visible && (inp.pressed.start || inp.pressed.pause)) {
      this.guide.keyStart();
      inp.pressed.start = false;
      inp.pressed.pause = false;
    }
    if (inp.pressed.mute) {
      this.audio.toggleMute();
      inp.pressed.mute = false;
    }
    // v7: desktop pause (P / ESC) — same veil + sim freeze as the touch II button
    // v9: only consume the edge in play/paused — menu scenes use ESC as BACK
    if (inp.pressed.pause && (this.scene === 'play' || this.scene === 'mint' || this.paused)) {
      inp.pressed.pause = false;
      this.togglePause();
    }

    switch (this.scene) {
      case 'title': {
        this.sceneT++;
        this.guide.maybeAutoShow('title'); // v9.2: one-shot FULLSCREEN GUIDE
        if (inp.pressed.fighter) this.openFighter(); // v9: T = CHOOSE YOUR FIGHTER
        else if (inp.pressed.special) this.openConnectTitle(); // v9.0.1: C = CONNECT WALLET
        else if (inp.pressedCodes.has('KeyL')) this.openBoard(); // v9.1: L = GLOBAL LEADERBOARD
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
          this.setScene(this.stage?.mint ? 'mint' : 'play'); // v9.4: the forge has its own scene
          if (this.stage) this.audio.playTrack(this.stage.track);
        }
        break;
      }
      case 'play':
        this.updatePlay();
        break;
      case 'mint':
        this.updateMint();
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
          // v11 ARENA RUN: a single-stage battle seals here; full runs bypass
          // the campaign gate/mint (the ARENA flow is its own path)
          if (this.arenaRun && this.arenaRun.stageMode === 'stage') {
            this.finishArenaRun();
          } else if (!this.arenaRun && next === 1 && !wallet.isEligible()) {
            // v9: THE GATE — the Stage 1 -> 2 transition belongs to holders
            this.audio.uiSelect();
            this.openGateScene(wallet.isConnected() ? 'gate' : 'connect', next);
          } else if (this.stageIdx === 2 && !this.arenaRun) {
            // v9.4: THE MINTING — the bonus forge opens after BYZANTINE WALL STREET
            this.audio.uiSelect();
            this.loadMint();
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
        // v9.2: INTERACTIVE COUNTDOWN — 3-way choice DURING the countdown
        if (inp.pressed.start) {
          this.continueRun(); // [FIGHT ON]
        } else if (inp.pressedCodes.has('KeyS')) {
          this.sealFromCountdown(); // [SEAL MY RECORD] mid-countdown
        } else if (inp.pressed.pause) {
          inp.pressed.pause = false;
          this.openSave(0); // ESC: WALK AWAY with the record
        } else if (this.continueCount < 0) {
          this.openSave(0); // v9.1: run over -> SAVE RECORD
        }
        break;
      }
      case 'sealanim': {
        // v9.2: THE SEAL MOMENT — 4 acts, skippable, then the SEALED screen
        this.sceneT++;
        const cue = this.sealAnim.update();
        if (cue.gong) this.audio.gong();
        if (cue.triumph) this.audio.triumph();
        if (cue.thud) this.audio.thud();
        if (cue.tick) this.audio.uiMove();
        if (inp.pressed.start) this.sealAnim.skip();
        else if (inp.pressed.pause) {
          inp.pressed.pause = false;
          this.sealAnim.skip();
        }
        if (this.sealAnim.done) {
          this.saveFocus = 99; // DONE (clamped to the last button)
          this.setScene('save');
        }
        break;
      }
      case 'victory': {
        this.sceneT++;
        if (this.sceneT > 120 && inp.pressed.start) {
          if (this.finalVictory) {
            // v11 ARENA RUN: a cleared full run seals instead of SAVE RECORD
            if (this.arenaRun) this.finishArenaRun();
            else this.openSave(1); // v9.1: final boss beaten -> SAVE RECORD
          } else {
            this.setScene('title');
            this.audio.playTrack('title');
            this.audio.uiSelect();
          }
        }
        break;
      }
      case 'save': {
        this.updateSaveScene();
        break;
      }
      case 'board': {
        this.sceneT++;
        this.handleBoardAction(this.board.key(inp));
        break;
      }
      case 'arena': {
        this.sceneT++;
        this.arena.tick();
        this.handleArenaAction(this.arena.key(inp));
        break;
      }
    }
    // v9.2.1: keep the DOM share anchors glued to their pixel buttons
    this.syncShareAnchors();
    // v9.2.3: same for the fullscreen card viewer (VIEW CARD)
    this.syncCardViewer();
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
    // v9.2 note v2: best combo chain this run
    if (this.player.comboHits > this.maxCombo) this.maxCombo = this.player.comboHits;

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
      this.deaths++; // v9.2 note v2 telemetry
      if (p.lives >= 0) {
        p.hp = p.maxHp;
        p.state = 'getup';
        p.t = 0;
        p.z = 0;
        p.invuln = 120;
        p.vx = 0;
      } else {
        // v11 ARENA RUN: death seals the score as-is — no continue flow
        if (this.arenaRun) {
          this.finishArenaRun();
        } else {
          this.setScene('gameover');
          this.audio.playTrack('gameover'); // v7: composed game-over jingle
        }
      }
    }

    // stage end (non-boss)
    if (this.stage && !this.stage.boss && this.waveIdx >= this.stage.waves.length && !this.waveActive && p.x >= this.stageLen - 26 && p.state !== 'dead') {
      this.stageClear();
    }

    // boss defeat -> stage clear tally (final boss -> FINAL VICTORY)
    if (this.boss && this.boss.removeMe) {
      // v9.5: FUD is no longer the end — beyond the launchpad waits THE THRONE ROOM
      const wasFinal = this.stage?.bossKind === 'gonna404';
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
    this.renderMain();
    const c = this.ctx;
    // v9.2: SEAL-during-countdown pixel burst rides over the scene
    if (this.sealBurst.length > 0) {
      c.save();
      this.fitView(false);
      for (const p of this.sealBurst) {
        c.fillStyle = p.gold ? '#f5c542' : '#39FF14';
        c.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
      }
      c.restore();
    }
    // v9.2: the FULLSCREEN GUIDE card draws above everything, every scene
    if (this.guide.visible) {
      c.save();
      this.fitView(false);
      this.guide.draw(c, this.frame);
      c.restore();
    }
  }

  private renderMain(): void {
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
      s !== 'connect' && s !== 'gate' && s !== 'fighter' && // v9
      s !== 'save' && s !== 'board' && // v9.1
      s !== 'sealanim' && // v9.2
      s !== 'arena'; // v10
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
        ? wallet.identityLabel(14) // 14 chars * 6px = 84px: fits the 88px button
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
      drawVictory(c, { score: this.score, timeFrames: this.totalFrames, kos: this.kos }, this.sceneT, this.finalVictory, this.continuesUsed === 0);
      c.restore();
      return;
    }
    // v9.1: SAVE RECORD + GLOBAL LEADERBOARD (full-screen canvas scenes)
    if (this.scene === 'save') {
      c.save();
      this.fitView(true);
      const rec = this.saveRec;
      if (rec) {
        const btns = this.saveButtons();
        const info = SKIN_INFO[rec.fighter.skin];
        drawSaveRecord(c, this.frame, {
          score: rec.score,
          stage: rec.stage,
          win: rec.win,
          continues: rec.continues,
          fighterName: rec.fighter.name,
          skinLabel: info.label,
          skinAccent: info.accent,
          phase: this.savePhase,
          err: this.saveErr,
          txid: this.saveTxid,
          msgLen: this.msgInput ? this.msgInput.value.length : 0,
          buttons: btns,
          focus: Math.min(this.saveFocus, Math.max(0, btns.length - 1)),
          touch: this.touchActive,
          rank: this.saveRank,
        });
      }
      c.restore();
      return;
    }
    if (this.scene === 'board') {
      c.save();
      this.fitView(true);
      this.board.draw(c, this.frame, this.frames, this.touchActive);
      c.restore();
      return;
    }
    // v10: THE ARENA (full-screen canvas scene, own hotspot UI)
    if (this.scene === 'arena') {
      c.save();
      this.fitView(true);
      this.arena.draw(c, this.frame, this.art, this.touchActive, this.fit, this.pframes ?? this.frames);
      c.restore();
      return;
    }
    // v9.2: THE SEAL MOMENT (4-act animation, skin-aware frames)
    if (this.scene === 'sealanim') {
      c.save();
      this.fitView(true);
      this.sealAnim.draw(c, this.pframes ?? this.frames);
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
    if (this.mint) dl.push(this.mint); // v9.4: the monument z-sorts with the player
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
    if (this.scene === 'mint' && this.mint) drawMintHud(c, this.mint, this.timeLeft, this.frame, this.touchActive); // v9.4
    if (this.scene === 'clear') drawClear(c, this.tally, this.score);
    if (this.scene === 'gameover') drawGameOver(c, this.sceneT);
    if (this.scene === 'continue') drawContinue(c, this.continueCount, this.sceneT, this.continuesUsed, this.touchActive);
    if (this.boss && !this.boss.alive) drawMarketCap(c, this.boss.t, this.boss.deathLine);

    // v6/v7: pause veil (touch II button, desktop P/ESC)
    if (this.paused) {
      c.fillStyle = 'rgba(4,5,10,0.55)';
      c.fillRect(0, 0, VW, VH);
      drawTextSh(c, 'PAUSED', VW / 2, 96, 3, '#f5c542', 'center');
      drawTextSh(c, this.touchActive ? 'TAP II TO RESUME' : 'P / ESC TO RESUME', VW / 2, 124, 1, '#c8ccd4', 'center');
      // v9.2: tiny ⛶ icon reopens the FULLSCREEN GUIDE anytime
      const g = PAUSE_FS_ICON;
      c.fillStyle = '#0d1118';
      c.fillRect(g.x, g.y, g.w, g.h);
      c.strokeStyle = '#39FF14';
      c.lineWidth = 1;
      c.strokeRect(g.x + 0.5, g.y + 0.5, g.w - 1, g.h - 1);
      const gx0 = g.x + 5;
      const gy0 = g.y + 5;
      c.fillStyle = '#39FF14';
      // four corner brackets (fullscreen glyph)
      c.fillRect(gx0, gy0, 5, 2); c.fillRect(gx0, gy0, 2, 5);
      c.fillRect(gx0 + 7, gy0, 5, 2); c.fillRect(gx0 + 10, gy0, 2, 5);
      c.fillRect(gx0, gy0 + 10, 5, 2); c.fillRect(gx0, gy0 + 7, 2, 5);
      c.fillRect(gx0 + 7, gy0 + 10, 5, 2); c.fillRect(gx0 + 10, gy0 + 7, 2, 5);
    }
    c.restore(); // overlay view
  }

  // rendered after everything, every scene — cheap no-op on desktop
  renderTouch(): void {
    this.touch.draw(this.ctx);
  }
}
// v9.6 stale-sw regression marker
