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
import type { ItemKind, ObstacleKind } from './items';
import { Proj } from './proj';
import type { ProjKind } from './proj';
import { buildMintStage, buildStage, MINT_FX, resetMintFx } from './stages';
import type { StageDef } from './stages';
import { drawMintHud, MINT_FLAWLESS_TIME, MINT_SECONDS, MintState } from './mint';
import { clamp, comboRankName, LANE_BOT, LANE_TOP, VH, VW } from './types';
import type { Facing } from './types';
import type { GameCtx } from './ctx';
// ---- v15: THE DESCENT ----
import { hashSeed, makeRng, makeRngFromLabel, mathRng, randomSeedLabel, setSeededSim } from './rng';
import type { Rng } from './rng';
import { aliveCap, bossBonus, buildDescentStage, composeWave, heavySlots, isRangedKind, newDescent, rampHp, rampSpd, rangedCap, rollBonus, saveBestWave, scoreMult, themePool, THREAT, waveClearBonus, wavePoints, ZONE_ADV } from './descent';
import type { DescentState } from './descent';
import { drawBonusAuras, drawBonusPips, drawBossWarning, drawDescentGrade, drawMultJuice, drawWaveSlam } from './descentFX';
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
import { arenaMode, setLinkStageHint } from './arena/chainAdapter';
import type { SealedRunInfo } from './arena/chainAdapter';
import { adoptOracleFromHash } from './arena/oracleLink';
import { encodeInputLogB64, INPUT_LOG_CAP, maskFromDown, ARENA_RUN_CKPT_KEY } from './arena/inputLog';
import { buildVer } from './ver';
// v10.4: ?duel=<id> parsed once per page load (StrictMode double-boot safe)
// v15.2.8: ?st=<0-6> rides single-mode share links — the committed level hint
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
  // ---- v15: THE DESCENT ----
  rng: Rng = makeRng(0x9e3779b9); // GameCtx: reseeded per stage/run
  descent: DescentState | null = null; // GameCtx: non-null during THE DESCENT

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
    // v17.0.11 (Prince edge-swipe report): OS-level gestures armor.
    document.addEventListener('visibilitychange', this.onVisChange);
    window.addEventListener('pagehide', this.onPageHide);
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

  // v17.0.11: the OS steals the screen mid-run (edge-swipe back preview, app
  // switch, control center) -> freeze the sim so enemies never hit a
  // defenseless player. REPLAY-SAFE BY CONSTRUCTION: paused frames return
  // before the recorder, so the tape stays identical on both sides.
  private onVisChange = (): void => {
    if (typeof document === 'undefined') return;
    if (document.hidden && this.scene === 'play' && !this.paused && this.arenaRun) this.togglePause();
  };

  // v17.0.11: last-chance tape snapshot when the page is being unloaded
  // (a COMPLETED edge swipe kills the page — without this the run is gone).
  private onPageHide = (): void => {
    this.saveRunCheckpoint();
  };

  // v17.0.11: snapshot the LIVE tape (levels+edges prefix + current score) to
  // sessionStorage every 300 recorded frames. A prefix replays byte-exact to
  // the saved score, so a recovered checkpoint signs like any sealed run.
  private saveRunCheckpoint(): void {
    try {
      if (!this.arenaRun || !this.inputLogMasks || this.inputLogFrames === 0) return;
      const frames = this.inputLogFrames;
      const build = buildVer();
      const seedLabel = this.descent ? this.descent.seedLabel : (this.arenaRunSeedLabel ?? 'UNSEEDED');
      const inputLogB64 = encodeInputLogB64({
        v: 3,
        build,
        seedLabel,
        frames,
        truncated: this.inputLogTruncated,
        masks: this.inputLogMasks.subarray(0, frames),
        edges: this.inputLogEdges ? this.inputLogEdges.subarray(0, frames) : null,
      });
      sessionStorage.setItem(ARENA_RUN_CKPT_KEY, JSON.stringify({
        seedLabel,
        frames,
        durationSec: frames / 60,
        build,
        score: Math.max(0, Math.floor(this.score)),
        stageMode: this.arenaRun.stageMode,
        stageIdx: this.arenaRun.stageIdx,
        inputLogB64,
        ts: Date.now(),
      }));
    } catch {
      /* storage full/blocked — the checkpoint is best-effort armor */
    }
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
  // v16 (SPEC-oracle §5): INPUT LOG v1 — one button-bitmask byte per frame,
  // recorded ONLY while a sealed arena run is live. Capped at INPUT_LOG_CAP
  // frames; an overrun is honestly flagged `truncated`, never silently cut.
  private inputLogMasks: Uint8Array | null = null;
  private inputLogEdges: Uint8Array | null = null; // v17.0.10: GIL v3 edge stream
  private inputLogFrames = 0;
  private inputLogTruncated = false;
  // v16.1 (SPEC-m2 §4): a FULL-mode arena run swaps mathRng for ONE seeded
  // campaign stream ('RUN-<cid>' — same hashSeed+mulberry32 as THE DESCENT)
  // for the WHOLE run. Non-arena gameplay never touches these (null).
  private arenaRunRng: Rng | null = null;
  private arenaRunSeedLabel: string | null = null;

  // v15: stage cards run THE DESCENT (seeded by the challenge id — same card,
  // same waves for creator & joiner). seedTag/target come from the ARENA UI.
  // v16.1: full-mode cards pass runSeed ('RUN-<cid>') — the seeded campaign.
  private startArenaRun(stageMode: 'full' | 'stage', stageIdx: number, opts?: { seedTag?: string; target?: number; runSeed?: string }): void {
    this.arenaRun = { stageMode, stageIdx };
    this.arenaRunSeedLabel = stageMode === 'full' ? (opts?.runSeed ?? null) : null;
    this.arenaRunRng = stageMode === 'full' && opts?.runSeed ? makeRngFromLabel(opts.runSeed) : null;
    this.inputLogMasks = new Uint8Array(INPUT_LOG_CAP); // v16: fresh input log per run
    this.inputLogEdges = new Uint8Array(INPUT_LOG_CAP); // v17.0.10: GIL v3 edges
    this.inputLogFrames = 0;
    // v17.0.11: a NEW run invalidates any older checkpoint (a crash in the
    // first frames must never recover a PREVIOUS card's tape)
    try { sessionStorage.removeItem(ARENA_RUN_CKPT_KEY); } catch { /* best-effort */ }
    this.inputLogTruncated = false;
    this.startNewGame(); // fresh run: score/lives/stage 0 (loadStage picks up arenaRunRng)
    if (stageMode === 'stage') {
      this.stageIdx = stageIdx;
      this.loadDescent(stageIdx, opts?.seedTag ?? randomSeedLabel(), opts?.target ?? 0);
    }
  }

  private finishArenaRun(): void {
    if (!this.arenaRun) return;
    // v17.0.11: FINAL checkpoint with the complete tape — a page kill on the
    // seal screen (before SIGN) is recoverable too. Cleared only after a
    // successful sign (arenaUI resetSeal).
    this.saveRunCheckpoint();
    // v16: seal the input log WITH the score — header build/seedLabel/frames,
    // base64, attached to the oracle sign-score body by the ARENA UI.
    // v16.1 (SPEC-m2 §2/§4): GIL v2 — frame 0 is the FIRST play frame, and a
    // FULL-mode run carries its REAL seeded campaign label ('RUN-<cid>').
    // 'UNSEEDED' survives only as the no-runSeed fallback (legacy QA path).
    const seedLabel = this.descent ? this.descent.seedLabel : (this.arenaRunSeedLabel ?? 'UNSEEDED');
    let run: SealedRunInfo | null = null;
    if (this.inputLogMasks && this.inputLogFrames > 0) {
      const build = buildVer();
      const frames = this.inputLogFrames;
      run = {
        seedLabel,
        frames,
        durationSec: frames / 60,
        build,
        inputLogB64: encodeInputLogB64({
          v: 3,
          build,
          seedLabel,
          frames,
          truncated: this.inputLogTruncated,
          masks: this.inputLogMasks.subarray(0, frames),
          edges: this.inputLogEdges ? this.inputLogEdges.subarray(0, frames) : null,
        }),
      };
    }
    this.inputLogMasks = null;
    this.inputLogEdges = null;
    if (this.descent) {
      saveBestWave(this.descent.wave, this.descent.seedLabel); // v15
      this.descent = null; // the seal screen owns the score now
    }
    this.arenaRun = null;
    this.arenaRunRng = null; // the seeded campaign stream dies with the run
    this.arenaRunSeedLabel = null;
    this.arena.onRunFinished(this.score, run);
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
          const st = sp.get('st');
          if (st !== null && /^[0-6]$/.test(st)) setLinkStageHint(bootDuelParam, Number(st)); // v15.2.8: committed level hint
          sp.delete('duel'); // consume the duel/st params, keep arena=
          sp.delete('st');
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
      this.startArenaRun(a.stageMode, a.stageIdx, { seedTag: a.seedTag, target: a.target, runSeed: a.runSeed });
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
    document.removeEventListener('visibilitychange', this.onVisChange);
    window.removeEventListener('pagehide', this.onPageHide);
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
  // v15: kill score multiplier (DESCENT combo mult x GREEN CANDLE) — 1 elsewhere
  killMult(): number {
    const d = this.descent;
    if (!d) return 1;
    return d.candleT > 0 ? scoreMult(this.player.comboHits) * 2 : scoreMult(this.player.comboHits);
  }
  spawnEnemy(kind: EnemyKind, side: Facing): void {
    const x = side === -1 ? this.camX - 24 : this.camX + VW + 24;
    const y = this.rng.range(LANE_TOP + 6, 200); // v15: seeded lane
    const e = new Enemy(kind, x, y, side === -1 ? 1 : -1);
    e.hoverPhase = this.rng.range(0, 6.28); // v15: seeded hover phase
    this.enemies.push(e);
  }
  dropItem(kind: ItemKind, x: number, y: number): void {
    this.items.push(new Item(kind, x, y, true, () => this.rng.next()));
  }
  dropCoins(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.items.push(new Item('coinG', x + this.rng.range(-10, 10), clamp(y + this.rng.range(-6, 6), LANE_TOP, 205), true, () => this.rng.next()));
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
  // CI: jump to the ARENA seal screen without a live run (mock QA)
  debugArenaSeal(role: 'creator' | 'joiner', score: number): void {
    this.arena.debugSeal(role, score);
    this.setScene('arena');
  }
  get arenaInfo(): ArenaUI['info'] {
    return this.arena.info;
  }

  // ---- v15: THE DESCENT debug (window.__gonna) ----
  // CI: free-play descent. seedLabel given => fully deterministic run.
  debugDescent(themeIdx: number, seedLabel?: string, target = 0): void {
    this.arenaRun = null; // practice: no arena seal on death
    this.arenaRunRng = null; // practice rides mathRng like any campaign
    this.arenaRunSeedLabel = null;
    this.startNewGame();
    this.stageIdx = themeIdx;
    this.loadDescent(themeIdx, seedLabel ?? randomSeedLabel(), target);
  }
  // CI/M2 (SPEC-m2 §4): seeded FULL RUN — the EXACT arena full-mode boot
  // path (startArenaRun), used by the replay harness + twin-run tests.
  debugFullRun(seedLabel: string): void {
    this.startArenaRun('full', 0, { runSeed: seedLabel });
  }
  // CI (v15.2 Prince's order): cross-theme composition audit. Runs composeWave
  // on a PRIVATE seeded stream (never touches the live run's rng) and reports
  // threat points spent / heavy slots used / ranged heads for theme x wave.
  debugCompose(theme: number, w: number, seed = 0x0152): { queue: string[]; points: number; heavies: number; ranged: number; boss: boolean; bossThreat: number; carriers: number; bonus: string | null } {
    const rng = makeRng((seed ^ (theme * 131 + w)) >>> 0);
    const plan = composeWave(theme, w, rng);
    let points = 0, heavies = 0, ranged = 0, carriers = 0;
    for (const k of plan.queue) {
      points += THREAT[k];
      heavies += heavySlots(k);
      if (isRangedKind(k)) ranged++;
      if (k === 'carrier') carriers++;
    }
    // boss waves spend most of the budget on the BOSS GATE itself (steepened
    // 1 + 0.18k depth scaling) — report the full wave threat, not just the
    // trickle, so the cross-theme audit compares apples to apples.
    const bossThreat = plan.boss ? wavePoints(theme, w) - points : 0;
    return { queue: plan.queue, points: points + bossThreat, heavies, ranged, boss: plan.boss, bossThreat, carriers, bonus: plan.carrierBonus };
  }
  // CI (v15.2): n seeded bonus rolls at wave w on a PRIVATE stream — proves
  // the unlock table (SPEED 2 / BULLET TIME 3 / LONG SHOT 4) without a run.
  debugBonusTable(w: number, n = 48): string[] {
    const rng = makeRng((0xb0415 ^ w) >>> 0);
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(rollBonus(w, rng));
    return out;
  }
  get descentInfo(): {
    active: boolean; wave: number; phase: string; seed: string; score: number; kos: number;
    queue: number; enemies: number; carriersSpawned: number; carriersEscaped: number;
    bonusDrops: number; boss: string | null; bossHp: number; mult: number; lives: number;
    aT: number; candleT: number; forgeT: number; bulletT: number; shotT: number; speedT: number; propsSpawned: number; foodProps: number; items: string[];
    dist: number; camX: number; nextTriggerX: number; goArrow: boolean;
  } | null {
    const d = this.descent;
    if (!d) return null;
    return {
      active: true,
      wave: d.wave,
      phase: d.phase,
      seed: d.seedLabel,
      score: this.score,
      kos: this.kos,
      queue: d.queue.length,
      enemies: this.enemies.filter((e) => e.alive).length,
      carriersSpawned: d.carriersSpawned,
      carriersEscaped: d.carriersEscaped,
      bonusDrops: d.bonusDrops,
      boss: this.boss ? this.boss.kind : null,
      bossHp: this.boss ? Math.round(this.boss.hp) : -1,
      mult: this.killMult(),
      lives: this.player.lives,
      aT: d.aT,
      candleT: d.candleT,
      forgeT: d.forgeT,
      bulletT: d.bulletT,
      shotT: d.shotT,
      speedT: d.speedT,
      propsSpawned: d.propsSpawned,
      foodProps: d.foodProps,
      items: this.items.map((i) => i.kind),
      dist: Math.round(d.dist),
      camX: Math.round(this.camX),
      nextTriggerX: Math.round(d.nextTriggerX),
      goArrow: this.goArrow,
    };
  }
  // FNV-1a over the whole sim-relevant snapshot — twin-run determinism hash
  private simHash(): string {
    let s = [
      this.score, this.kos, this.descent?.wave ?? -1, this.descent?.phase ?? '-',
      this.player.x.toFixed(3), this.player.y.toFixed(3), this.player.hp, this.player.comboHits,
      this.boss ? this.boss.kind + ':' + this.boss.hp.toFixed(1) + ':' + this.boss.x.toFixed(2) : '-',
    ].join('|');
    for (const e of this.enemies) {
      s += '|' + e.kind + ',' + e.x.toFixed(3) + ',' + e.y.toFixed(3) + ',' + e.hp + ',' + e.state;
    }
    for (const it of this.items) s += '|i' + it.kind + ',' + it.x.toFixed(2) + ',' + it.y.toFixed(2);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  // CI: synchronous scripted run. tape events apply at exact frames BEFORE the
  // step; hashes sampled every 60 frames. god = the player cannot die.
  debugSim(opts: {
    frames: number;
    tape?: { f: number; down?: Record<string, boolean>; press?: string[]; cmd?: string }[];
    god?: boolean;
  }): { hashes: string[]; score: number; wave: number; kos: number; seed: string } {
    if (this.scene === 'intro') this.setScene('play');
    const tape = opts.tape ?? [];
    let ti = 0;
    const hashes: string[] = [];
    for (let f = 0; f < opts.frames; f++) {
      while (ti < tape.length && tape[ti].f <= f) {
        const ev = tape[ti++];
        if (ev.down) {
          for (const k of Object.keys(ev.down)) {
            (this.input.down as unknown as Record<string, boolean>)[k] = ev.down[k];
          }
        }
        if (ev.press) {
          for (const k of ev.press) (this.input.pressed as unknown as Record<string, boolean>)[k] = true;
        }
        if (ev.cmd === 'killEnemies') this.debugKillEnemies();
        else if (ev.cmd === 'killNonCarrier') {
          for (const e of this.enemies) {
            if (e.alive && e.kind !== 'carrier') e.hurt({ dmg: 9999, kb: 1, down: true, dir: 1, pierce: true }, this);
          }
        } else if (ev.cmd === 'killBoss') this.debugHurtBoss(99999);
      }
      if (opts.god) {
        this.player.hp = this.player.maxHp; // scripted survival
        if (this.player.state === 'dead') {
          this.player.state = 'getup';
          this.player.t = 0;
        }
      }
      this.step();
      if ((f + 1) % 60 === 0) hashes.push(this.simHash());
    }
    return { hashes, score: this.score, wave: this.descent?.wave ?? -1, kos: this.kos, seed: this.descent?.seedLabel ?? '' };
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
    this.descent = null; // v15: classic campaign — THE DESCENT state dies here
    // v15: campaign keeps the EXACT v14.4 Math.random stream (zero extra
    // draws, visual noise included) — FULL RUN stays byte-equivalent.
    // v16.1 (SPEC-m2 §4): EXCEPT a full-mode ARENA run — the whole campaign
    // rides ONE seeded stream ('RUN-<cid>') so the oracle can replay it.
    // Outside arenaRun arenaRunRng is null: behavior 100% identical.
    this.rng = this.arenaRunRng ?? mathRng;
    // v15.2: same stale hit-stop/slow-mo leak plugged on the campaign side
    this.freezeT = 0;
    this.slowmoT = 0;
    setSeededSim(this.arenaRunRng !== null); // seeded run: Math.random fully out of the step
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
    this.descent = null; // v15: safety — THE MINTING is not THE DESCENT
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
      // v18.1.2 (Friedbean 100M REPLAY MISMATCH): the slow-mo cadence gate MUST
      // be a pure function of the run-local slow-mo counter. Gating on the
      // global boot frame (this.frame % 3) made WHICH tape frames advance the
      // sim depend on how long the PAGE had been alive — the oracle's
      // fresh-boot replay ran a different frame phase than the client's
      // browser, so every slow-mo episode (5-hit combo / boss kill) could
      // desync the tape and kill the replayed run. slowmoT evolves
      // identically in client & replay, so the frozen frames now land on the
      // same tape indices on both sides.
      if (this.slowmoT % 3 !== 0) {
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

  // ---------- v15.1: THE DESCENT (endless-scroll wave survival) ----------
  // Infinite forward walk through looping theme visuals; each wave owns a
  // forward zone. Seeded by the challenge id: same card = same waves for all.
  private obstacleK = 0; // descent: highest obstacle loop spawned so far
  private loadDescent(themeIdx: number, seedLabel: string, target: number): void {
    const seed = hashSeed(seedLabel) >>> 0;
    this.rng = makeRng(seed);
    // v15.2: hit-stop / slow-mo from a previous run must NOT leak into the
    // fresh one (it froze the first frames of twin-run #2 and broke seeded
    // determinism in the harness — a stale-freeze state-machine leak).
    this.freezeT = 0;
    this.slowmoT = 0;
    setSeededSim(true); // visual noise leaves Math.random alone in the sim
    themePool(themeIdx); // pre-warm the weighted pool (build-time randomness stays OUT of the step)
    this.stage = buildDescentStage(themeIdx);
    this.stageLen = 1e9; // endless — the world loops, the camera never stops
    this.enemies = [];
    this.items = [];
    this.obstacleK = 0;
    this.obstacles = [];
    this.descentObstacleTick(); // furnish the first street loops
    this.boss = null;
    this.bossSpawned = false;
    this.waveIdx = 0;
    this.waveActive = false;
    this.spawnQueue = [];
    this.camX = 0;
    this.camLock = 0;
    this.timeLeft = 0; // no clock in THE DESCENT — the HUD shows the wave
    this.stageScoreStart = this.score;
    this.goArrow = false;
    this.fx.reset();
    for (const pr of this.projs) pr.on = false;
    this.player.reset(VW / 2, 178);
    this.player.hp = this.player.maxHp;
    this.player.lives = 0; // ONE LIFE. Death seals the run.
    this.mint = null;
    this.descent = newDescent(themeIdx, seed, seedLabel, target);
    this.setScene('intro'); // THE DESCENT - <theme> title card
  }

  // the theme's street furniture repeats every loop L, offset k*L — visual
  // variety, sim-deterministic (same offsets for creator & joiner)
  private descentObstacleTick(): void {
    const stage = this.stage;
    if (!stage || !this.descent) return;
    const L = stage.len;
    const needK = Math.floor((this.camX + VW * 2) / L);
    while (this.obstacleK <= needK) {
      const off = this.obstacleK * L;
      // v15.2: +50% props per zone — full set on even loops, thinned on odd
      // (was: every loop thinned to half). Loop parity is sim-deterministic.
      const thin = this.obstacleK % 2 === 1;
      for (let i = 0; i < stage.obstacles.length; i++) {
        if (thin && i % 2 === 1) continue;
        const o = stage.obstacles[i];
        // v15.2 ENERGY (Capcom doctrine): food lives INSIDE furniture, never
        // floating free — seeded ~12% of props carry a chicken. Breaking
        // furniture = time risk = earned survival. "Never guaranteed": theme
        // defs that hardcode a chicken prop are normalized to 'random' here,
        // so the seeded 12% table is the ONLY source of guaranteed food.
        const contains = this.rng.chance(0.12) ? 'chicken' : o.contains === 'chicken' ? 'random' : o.contains;
        this.obstacles.push(new Obstacle(o.kind, o.x + off, o.y, contains));
        this.descent.propsSpawned++;
        if (contains === 'chicken') this.descent.foodProps++;
      }
      this.obstacleK++;
    }
    // prune what's far behind (never the one being carried/thrown)
    if (this.obstacles.length > 40) {
      this.obstacles = this.obstacles.filter((o) => o.mode !== 'idle' || o.x > this.camX - 160);
    }
  }

  private descentStartWave(w: number): void {
    const d = this.descent;
    if (!d || !this.stage) return;
    const plan = composeWave(d.theme, w, this.rng);
    d.wave = w;
    this.waveIdx = w; // debug mirror (waveNo)
    d.queue = plan.queue;
    d.cap = aliveCap(w);
    d.carrierBonus = plan.carrierBonus;
    d.carrierOut = false;
    d.stallT = 0;
    d.phaseT = 0;
    this.camLock = this.camX; // the zone's arena: camera locks until it's cleared
    // v15.2 FUN GUARDRAIL: every wave zone spawns at least one throwable/
    // breakable prop reachable inside the arena (seeded kind + spot).
    let hasProp = false;
    for (const o of this.obstacles) {
      if (!o.removeMe && o.cfg.liftable && o.x > this.camLock + 30 && o.x < this.camLock + VW - 30) {
        hasProp = true;
        break;
      }
    }
    if (!hasProp) {
      const propKinds: ObstacleKind[] = ['can', 'crate', 'barrel'];
      const kind = propKinds[Math.floor(this.rng.next() * propKinds.length)];
      const x = this.camLock + 60 + this.rng.next() * (VW - 120);
      const y = this.rng.range(LANE_TOP + 8, LANE_BOT - 4);
      const contains = this.rng.chance(0.12) ? 'chicken' : 'random';
      this.obstacles.push(new Obstacle(kind, x, y, contains));
      d.propsSpawned++;
      if (contains === 'chicken') d.foodProps++;
    }
    // v15.2 ENERGY: boss arenas get 2 edge props with ELEVATED food chance
    // (~25% each) — the classic "smash the barrel before the boss" beat.
    if (plan.boss) {
      for (const side of [46, VW - 46]) {
        const y = this.rng.range(LANE_TOP + 8, LANE_BOT - 4);
        const contains = this.rng.chance(0.25) ? 'chicken' : 'random';
        this.obstacles.push(new Obstacle('barrel', this.camLock + side, y, contains));
        d.propsSpawned++;
        if (contains === 'chicken') d.foodProps++;
      }
    }
    if (plan.boss && plan.bossKind) {
      d.phase = 'boss';
      d.bossKind = plan.bossKind;
      d.bossK = plan.bossK;
      // v15.2: BOSS ESCALATION — bosses are the gates; depth scaling steepened
      this.boss = makeBoss(plan.bossKind, this.camX + VW + 70, 1 + 0.18 * plan.bossK);
      this.audio.playTrack(this.stage.bossTrack);
      this.audio.gong();
      this.fx.shake(5);
    } else {
      d.phase = 'announce';
      d.bossKind = null;
      this.audio.rankUp();
    }
  }

  // throttled spawns: alive cap scales with the wave (3 / 4 / 5)
  private descentSpawnTick(d: DescentState): void {
    if (d.queue.length === 0) return;
    let alive = 0;
    let rangedAlive = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      alive++;
      if (isRangedKind(e.kind)) rangedAlive++;
    }
    if (alive >= d.cap) return;
    // v15.2 Capcom curve: HARD CAP on concurrent ranged enemies (molotov
    // sneks / FUD cultists / coin sneks): 2 for waves 1-5, 3 for 6-9, 4 after.
    // When the cap is full the next MELEE in the queue jumps the line; an
    // all-ranged queue waits. Deterministic: seeded queue, fixed scan order.
    let slot = 0;
    if (rangedAlive >= rangedCap(d.wave) && isRangedKind(d.queue[0])) {
      while (slot < d.queue.length && isRangedKind(d.queue[slot])) slot++;
      if (slot >= d.queue.length) return; // hold the ranged flood for now
    }
    const kind = d.queue.splice(slot, 1)[0];
    const side: Facing = this.rng.chance(0.5) ? -1 : 1; // seeded side
    const x = side === -1 ? this.camX - 24 : this.camX + VW + 24;
    const y = this.rng.range(LANE_TOP + 6, 200); // seeded lane
    const e = new Enemy(kind, x, y, side === -1 ? 1 : -1);
    e.hoverPhase = this.rng.range(0, 6.28);
    if (kind === 'carrier') {
      // v15 founder #4: the cue — gold ring + popup, 15s escape clock
      e.escapeT = 900;
      e.bonusDrop = d.carrierBonus;
      d.carrierOut = true;
      d.carriersSpawned++;
      this.fx.ring(clamp(x, this.camX + 14, this.camX + VW - 14), y - 8, 52, '#f5c542');
      this.fx.ring(clamp(x, this.camX + 14, this.camX + VW - 14), y - 8, 30, '#39FF14');
      this.fx.popup(clamp(x, this.camX + 70, this.camX + VW - 70), y - 84, 'BONUS CARRIER!', '#f5c542', 80);
      this.audio.oneUp();
    } else {
      // integer-rounded ramp at spawn (LOCKED)
      e.maxHp = Math.round(e.maxHp * rampHp(d.wave));
      e.hp = e.maxHp;
      e.spdMul = rampSpd(d.wave);
    }
    this.enemies.push(e);
  }

  private descentAlive(): number {
    let alive = 0;
    for (const e of this.enemies) if (e.alive) alive++;
    return alive;
  }

  private descentWaveCleared(d: DescentState): void {
    const bonus = waveClearBonus(d.wave);
    this.addScore(bonus);
    d.clearWave = d.wave;
    d.clearBonus = bonus;
    d.clearScore = this.score;
    d.phase = 'clear';
    d.phaseT = 0;
    d.nextTriggerX = this.camX + ZONE_ADV; // GO — walk into the next zone
    this.audio.rankUp();
  }

  // boss down: bonus 1000 x wave, then the BREATHE beat (5s of calm)
  private descentBossDown(): void {
    const d = this.descent;
    if (!d) return;
    const bonus = bossBonus(d.wave);
    this.addScore(bonus);
    this.fx.popup(this.player.x, this.player.y - 96, 'BOSS BONUS +' + bonus, '#f5c542', 90, 2);
    this.boss = null;
    this.haptics.ko();
    d.phase = 'breathe';
    d.phaseT = 0;
    d.nextTriggerX = this.camX + ZONE_ADV; // then GO forward again
    if (this.stage) this.audio.playTrack(this.stage.track); // pressure drops
  }

  private updateDescent(): void {
    const d = this.descent;
    if (!d) return;
    d.phaseT++;
    // ---- bonus timers ----
    if (d.aT > 0) {
      d.aT--;
      this.player.invuln = Math.max(this.player.invuln, 2); // THE A: untouchable
    }
    if (d.candleT > 0) d.candleT--;
    if (d.forgeT > 0) d.forgeT--;
    if (d.shotT > 0) d.shotT--; // v15.2 LONG SHOT
    if (d.speedT > 0) d.speedT--; // v15.2 SPEED OF THE LIZARD
    // ---- multiplier juice (founder #2): up = amber popup, lost = red pulse ----
    const mult = scoreMult(this.player.comboHits);
    if (mult > d.lastMult) {
      d.multUpT = 40;
      this.audio.rankUp();
    }
    d.lastMult = mult;
    if (d.multUpT > 0) d.multUpT--;
    if (d.multLostT > 0) d.multLostT--;

    switch (d.phase) {
      case 'announce':
        this.descentSpawnTick(d); // the wave flows in behind the slam-in
        if (d.phaseT >= 90) {
          d.phase = 'combat';
          d.phaseT = 0;
        }
        break;
      case 'combat':
        this.descentSpawnTick(d);
        break;
      case 'boss':
        this.descentSpawnTick(d); // seeded trickle under the boss
        break;
      case 'clear':
      case 'breathe': {
        // GO forward: the next wave starts when the walk reaches its zone.
        // Idling is legal — no forced scroll, the calm just holds.
        const minBeat = d.phase === 'clear' ? 40 : 240;
        if (d.phaseT >= minBeat && this.camX >= d.nextTriggerX) this.descentStartWave(d.wave + 1);
        break;
      }
    }

    // v15.1: depth + street furniture housekeeping
    if (this.camX > d.dist) d.dist = this.camX;
    this.descentObstacleTick();

    // wave-clear + anti-trickle (founder #3: waves never trickle-die)
    if (d.phase === 'announce' || d.phase === 'combat') {
      const alive = this.descentAlive();
      if (d.queue.length === 0 && alive === 0) {
        this.descentWaveCleared(d);
      } else if (d.queue.length === 0 && alive <= 2) {
        d.stallT++;
        if (d.stallT > 360) {
          // stragglers had their chance — the NEXT wave lands on top of them
          const bonus = waveClearBonus(d.wave);
          this.addScore(bonus);
          d.clearWave = d.wave;
          d.clearBonus = bonus;
          d.clearScore = this.score;
          this.fx.popup(this.camX + VW / 2, 60, 'NO MERCY +' + bonus, '#f5c542', 60);
          this.descentStartWave(d.wave + 1);
        }
      } else {
        d.stallT = 0;
      }
    }
  }

  private setScene(s: Scene): void {
    this.scene = s;
    this.sceneT = 0;
    // no held control may leak across a scene cut (joystick ghost / stuck button)
    this.touch.releaseAll();
    // v17.0.7 (Friedbean live bug, REPLAY MISMATCH): the GIL recorder stores
    // LEVELS only and the oracle replay regenerates pressed-edges from level
    // transitions. A key HELD across the intro->play cut (a human keeps
    // walking/punching through the title card) entered play with down=true
    // but no edge; the replay started from all-up and invented a phantom
    // edge -> divergent sim -> honest scores refused. Clearing the keyboard
    // levels too makes every play segment start from the SAME all-up
    // baseline the replay driver sees; a still-held key re-registers on the
    // next auto-repeat keydown, in client and replay alike.
    this.input.releaseAll();
    // v9.1: the SEAL message overlay only exists on the SAVE RECORD screen
    if (s !== 'save' && this.msgInput) this.msgInput.style.display = 'none';
  }

  // ---------- main loop ----------
  step(): void {
    // v17.0.7: gameplay buttons are muted outside play (and while paused)
    // during a sealed arena run — see input.suppressGameplay.
    this.input.suppressGameplay = this.arenaRun != null && (this.scene !== 'play' || this.paused);
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
    // v16 (SPEC-oracle §5): input log — snapshot the 8 button levels, one
    // byte per frame, ONLY while a sealed arena run is live (paused frames
    // never reach here: the sim is frozen, so nothing is recorded).
    // v16.1 (SPEC-m2 §2): GIL v2 records ONLY scene==='play' frames — the
    // intro title card never enters the buffer (START is not in the mask,
    // so its length would be unrecoverable — M2-0 finding §4.1).
    if (this.arenaRun && this.inputLogMasks && this.scene === 'play') {
      if (this.inputLogFrames < INPUT_LOG_CAP) {
        // v17.0.10 (Prince REPLAY MISMATCH, GIL v3): record the PENDING EDGE
        // mask next to the levels. A fast mobile tap can go down+up between
        // two steps — the sim consumes the edge this step while the sampled
        // level is 0, so a levels-only tape loses the press forever.
        this.inputLogMasks[this.inputLogFrames] = maskFromDown(inp.down);
        if (this.inputLogEdges) this.inputLogEdges[this.inputLogFrames] = maskFromDown(inp.pressed as never);
        this.inputLogFrames++;
        // v17.0.11: rolling checkpoint — a page kill mid-run stays recoverable
        if (this.inputLogFrames % 300 === 0) this.saveRunCheckpoint();
      } else {
        this.inputLogTruncated = true; // honest cut at the 300k cap
      }
    }
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
          if (this.descent) {
            this.openSave(0); // v15: ONE LIFE — the DESCENT death seals directly
          } else {
            this.setScene('continue');
            this.continueCount = 9;
          }
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
        // v12: a paid CONTINUE resumes the run as soon as the payment
        // confirms (the async tap handler cannot return the action itself)
        const pending = this.arena.pollPendingRun();
        if (pending) this.handleArenaAction(pending);
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
    const descent = this.descent;
    if (!descent) {
      this.timeLeft -= 1 / 60; // THE DESCENT has no clock — the wave is the HUD
      if (this.timeLeft < 0) this.timeLeft = 0;
    }
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
      // v18.1.2: run-local cadence gate (see the campaign twin above) — the
      // DESCENT slow-mo must freeze the SAME tape frames in the browser and in
      // the oracle replay, regardless of the page's boot frame phase.
      if (this.slowmoT % 3 !== 0) {
        this.fx.update();
        this.holdInput = true;
        return;
      }
    }

    const p = this.player;
    // v15: BULLET TIME — per-entity timescale. The PLAYER runs every frame;
    // the WORLD (enemies/boss/items/obstacles/projs/flames) ticks at half rate.
    let worldTick = true;
    if (descent && descent.bulletT > 0) {
      descent.bulletT--;
      worldTick = (this.totalFrames & 1) === 0;
    }
    p.update(this);

    if (worldTick) {
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
        this.dropCoins(e.x, e.y, e.kind === 'whale' || e.kind === 'bouncer' ? 5 : 2 + Math.floor(this.rng.range(0, 3)));
        if (e.kind === 'snek') this.dropItem('knife', e.x, e.y);
        else if (e.kind === 'carrier') {
          // v15: GOLDEN CARRIER down — the seeded bonus drops (escape = nothing)
          if (e.bonusDrop) {
            this.dropItem(e.bonusDrop, e.x, e.y);
            e.bonusDrop = null;
            if (descent) descent.bonusDrops++;
          }
          if (descent) descent.carrierOut = false;
        }
        else if (e.kind === 'coinsnek') {
          this.dropItem('coinG', e.x, e.y); // COIN SNEK leaves $GONNA
          this.dropCoins(e.x, e.y, 3);
        } else if (this.rng.chance(0.15)) this.dropItem(this.rng.chance(0.5) ? 'chicken' : 'coinA', e.x, e.y);
      }
      // v15: a carrier that slipped away — no drop, no score
      if (e.escaped && descent) {
        descent.carriersEscaped++;
        descent.carrierOut = false;
      }
    }
    this.enemies = this.enemies.filter((e) => !e.removeMe);

    this.watchdog(); // v8: never leave a wave soft-locked
    if (descent) this.updateDescent();
    else this.updateWaves();
    this.updateCamera();

    // player death
    if (p.state === 'dead' && p.t > 100) {
      p.lives--;
      this.deaths++; // v9.2 note v2 telemetry
      if (descent) saveBestWave(descent.wave, descent.seedLabel); // v15: ONE LIFE
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

    // stage end (non-boss) — never in THE DESCENT (infinite by design)
    if (!descent && this.stage && !this.stage.boss && this.waveIdx >= this.stage.waves.length && !this.waveActive && p.x >= this.stageLen - 26 && p.state !== 'dead') {
      this.stageClear();
    }

    // boss defeat -> stage clear tally (final boss -> FINAL VICTORY)
    // v15 DESCENT: boss down -> 1000 x wave bonus + the BREATHE beat instead
    if (this.boss && this.boss.removeMe && descent) {
      this.descentBossDown();
    } else if (this.boss && this.boss.removeMe) {
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
        const side: Facing = this.rng.chance(0.5) ? -1 : 1; // v15: seeded spawn side
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
    const dsc = this.descent;
    let maxCam = this.stageLen - VW;
    if (dsc) {
      // v15.1: combat/announce/boss = the zone's arena (camera locked);
      // clear/breathe = GO forward, camera follows the walk.
      if (dsc.phase !== 'clear' && dsc.phase !== 'breathe') maxCam = Math.min(maxCam, this.camLock);
    } else {
      if (this.waveActive) maxCam = Math.min(maxCam, this.camLock);
      if (this.stage.boss && this.bossSpawned) maxCam = Math.min(maxCam, this.stage.arenaX);
    }
    const target = clamp(this.player.x - 150, 0, maxCam);
    const d = target - this.camX;
    if (Math.abs(d) < 0.5) this.camX = target;
    else this.camX += clamp(d, -2, 2);
    // v15.1: the GO arrow is BACK in THE DESCENT — it marks the open road
    // between zones (clear/breathe), exactly like the campaign between waves.
    this.goArrow = dsc
      ? (dsc.phase === 'clear' || dsc.phase === 'breathe') && this.scene === 'play' && this.player.state !== 'dead'
      : !this.waveActive && !(this.stage.boss && this.bossSpawned) && this.scene === 'play' && this.player.state !== 'dead';
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
    const bullet = !!this.descent && this.descent.bulletT > 0;
    if (bullet) {
      // v15 BULLET TIME: world rendered offscreen -> desaturated composite,
      // then the player AGAIN at full color (the world slows, GONNA doesn't)
      const [oc, ox] = this.bulletOff();
      ox.setTransform(1, 0, 0, 1, 0, 0);
      ox.imageSmoothingEnabled = false;
      ox.fillStyle = '#000';
      ox.fillRect(0, 0, VW, VH);
      ox.save();
      ox.translate(Math.round(shX), Math.round(shY));
      this.paintWorld(ox);
      ox.restore();
      c.save();
      this.worldView(crop, true);
      c.filter = 'saturate(0.22) brightness(0.92)';
      c.drawImage(oc, 0, 0);
      c.filter = 'none';
      this.player.draw(c, this); // full color over the frozen world
      c.restore();
    } else {
      c.save();
      this.worldView(crop, true);
      c.save();
      c.translate(Math.round(shX), Math.round(shY));
      this.paintWorld(c);
      c.restore(); // shake
      c.restore(); // world view
    }

    // ---- overlays (always the full uncropped view: HUD is never cut by ZOOM) ----
    c.save();
    this.fitView(false);
    drawHud(c, this, this.score, this.timeLeft, this.goArrow, this.frame, this.audio.muted);
    if (this.descent) {
      // v15: THE DESCENT overlay stack — near-death pulse + bullet vignette
      // first (they hug the edges), then banners/popups above everything.
      drawDescentGrade(c, this, this.descent, this.frame);
      if (this.descent.phase === 'boss') drawBossWarning(c, this.descent, this.boss ? this.boss.name : '', this.frame);
      drawWaveSlam(c, this.descent);
      drawMultJuice(c, this.descent, this.player.comboHits);
      drawBonusPips(c, this.descent);
    }
    if (this.scene === 'mint' && this.mint) drawMintHud(c, this.mint, this.timeLeft, this.frame, this.touchActive); // v9.4
    if (this.scene === 'clear') drawClear(c, this.tally, this.score);
    if (this.scene === 'gameover') {
      drawGameOver(c, this.sceneT, this.descent ? { wave: this.descent.wave, seedLabel: this.descent.seedLabel } : null);
    }
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

  // v15: BULLET TIME offscreen (world desaturation pass)
  private btCanvas: HTMLCanvasElement | null = null;
  private btCtx: CanvasRenderingContext2D | null = null;
  private bulletOff(): [HTMLCanvasElement, CanvasRenderingContext2D] {
    if (!this.btCanvas) {
      this.btCanvas = document.createElement('canvas');
      this.btCanvas.width = VW;
      this.btCanvas.height = VH;
      this.btCtx = this.btCanvas.getContext('2d')!;
    }
    return [this.btCanvas, this.btCtx!];
  }

  // v15.1: tiles a layer canvas across the view at scroll offset `off` (px in
  // canvas space). At every wrap joint inside the view, the incoming tile's
  // head is alpha-blended over the outgoing tail — the loop has NO seam.
  private tileH(c: CanvasRenderingContext2D, img: HTMLCanvasElement, off: number, band: number): void {
    const W = img.width;
    for (let x = -off; x < VW; x += W) c.drawImage(img, Math.round(x), 0);
    for (let jx = -off + W; jx < VW + band; jx += W) {
      for (let i = 0; i < band; i += 2) {
        c.globalAlpha = (i + 2) / band;
        c.drawImage(img, i, 0, 2, img.height, Math.round(jx - band + i), 0, 2, img.height);
      }
    }
    c.globalAlpha = 1;
  }

  // descent: the animated billboard layer (back) loops with the mid domain's
  // parallax period; the whole layer crossfades at the boundary so mixed
  // parallax extras (sun/sea/windows) never pop. Rendered offscreen (cached).
  private backOff: [HTMLCanvasElement, CanvasRenderingContext2D] | null = null;
  private paintBackLooped(c: CanvasRenderingContext2D, stage: StageDef, vcam: number): void {
    if (!stage.back) return;
    if (!this.backOff) {
      const cv = document.createElement('canvas');
      cv.width = VW;
      cv.height = VH;
      this.backOff = [cv, cv.getContext('2d')!];
    }
    const [bc, bx] = this.backOff;
    bx.clearRect(0, 0, VW, VH);
    const Pm = stage.mid.width / 0.55; // mid-domain wrap period in camX units
    const v = ((vcam % Pm) + Pm) % Pm;
    stage.back(bx, v, this.frame);
    const edge = Math.min(v, Pm - v); // px to the nearest loop boundary
    const a = Math.min(1, edge / 200);
    if (a >= 1) c.drawImage(bc, 0, 0);
    else {
      c.save();
      c.globalAlpha = a;
      c.drawImage(bc, 0, 0);
      c.restore();
    }
  }

  // v15.1: the whole world pass, 1:1 game coords (caller sets transform +
  // shake). THE DESCENT rides the REAL camera now: the theme's layers loop
  // seamlessly (crossfaded joints), street props repeat every loop L.
  private paintWorld(c: CanvasRenderingContext2D): void {
    const stage = this.stage;
    if (!stage) return;
    const dsc = this.descent;
    const vcam = this.camX;
    if (dsc) {
      const Wf = stage.far.width, Wm = stage.mid.width;
      this.tileH(c, stage.far, Math.round((vcam * 0.25) % Wf), 48);
      this.tileH(c, stage.mid, Math.round((vcam * 0.55) % Wm), 48);
      this.paintBackLooped(c, stage, vcam);
      // ground slice with wrap at the loop period L (+ crossfaded joint)
      const L = stage.len;
      const off = Math.round(vcam % L);
      const w1 = Math.min(VW, L - off);
      c.drawImage(stage.ground, off, 0, w1, 84, 0, 140, w1, 84);
      if (w1 < VW) c.drawImage(stage.ground, 0, 0, VW - w1, 84, w1, 140, VW - w1, 84);
      if (w1 < VW + 40) {
        for (let i = 0; i < 40; i += 2) {
          c.globalAlpha = (i + 2) / 40;
          c.drawImage(stage.ground, i, 0, 2, 84, Math.round(w1 - 40 + i), 140, 2, 84);
        }
        c.globalAlpha = 1;
      }
      // street-level props are all world-depth (factor 1.0): loop exactly
      if (stage.props) {
        stage.props(c, off, this.frame);
        stage.props(c, off - L, this.frame); // fill the post-joint band
      }
    } else {
      const farOff = -Math.round((vcam * 0.25) % stage.far.width);
      c.drawImage(stage.far, farOff, 0);
      if (farOff + stage.far.width < VW) c.drawImage(stage.far, farOff + stage.far.width, 0);
      const midOff = -Math.round((vcam * 0.55) % stage.mid.width);
      c.drawImage(stage.mid, midOff, 0);
      if (midOff + stage.mid.width < VW) c.drawImage(stage.mid, midOff + stage.mid.width, 0);
      if (stage.back) stage.back(c, vcam, this.frame); // v8: animated billboards/tickers/sea
      c.drawImage(stage.ground, Math.round(vcam), 0, VW, 84, 0, 140, VW, 84);
      if (stage.props) stage.props(c, vcam, this.frame); // v8: sidewalk props (world depth)
    }

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

    if (this.descent) drawBonusAuras(c, this, this.descent, this.frame); // v15
    this.fx.drawWorld(c, this.camX); // v9.0.1 BUG C: world coords -> screen
    if (stage.front) stage.front(c, vcam, this.frame); // v8: weather + foreground silhouettes
    if (this.fx.flash > 0) {
      c.globalAlpha = this.fx.flash / 10;
      c.fillStyle = this.descent ? '#f5c542' : '#fff'; // v15: THE DESCENT flashes GOLD, never white
      c.fillRect(-4, -4, VW + 8, VH + 8);
      c.globalAlpha = 1;
    }
  }

  // rendered after everything, every scene — cheap no-op on desktop
  renderTouch(): void {
    this.touch.draw(this.ctx);
  }
}
// v9.6 stale-sw regression marker
