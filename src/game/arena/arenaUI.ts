// THE ARENA — the staking piazza of GONNA FIGHT. Three mobile-first screens
// inside one canvas scene (see engine.ts), Capcom pixel-art, degen copy:
//   CREATE CARD — tap-through wizard: VISIBILITY / FORMAT / BATTLE (with a
//                 slot-machine SHUFFLE for RANDOM) / STAKE / FIGHTER -> the
//                 card preview + SIGN & STAKE
//   THE BOARD   — the single square: live feed, live cards with coin piles
//                 sized by stake, live seat/timer lines, FILLING FAST /
//                 CLOSING SOON / QUANTUM SEAL (Falcon) badges, gold CLAIM
//   VERSUS      — card detail: two seals face to face, the pot pulses in the
//                 middle, accept flow -> verdict under a rain of GOLD coins
//                 (NEVER white flashes — fades are black or gold)
// All chain access goes through chainAdapter.ts (MOCK by default).
import { drawText, drawTextSh, textWidth } from '../font';
import { hasDevOracle } from './devOracle';
import { mosaicBorder, drawCrown } from '../screens';
import { VH, VW, clamp } from '../types';
import type { ViewFit } from '../fit';
import type { Input } from '../input';
import type { Art } from '../sprites';
import * as wallet from '../wallet';
import { SKIN_INFO, skinPortrait } from '../skins';
import type { SkinId } from '../skins';
import { getArenaAdapter, arenaMode, feeLine, fmtAgo, fmtAmount, fmtCountdown, fmtGonna, fmtStake, splitPot } from './chainAdapter';
import { explorerTxUrl, getTxid } from './testnetKit';
import { connectArenaWallet } from './arenaWallet';
import { qaActive, qaScore } from './qaSigner';
import type { Challenge, ChallengeConfig, FighterPick, HistoryEntry, LegacyStats, Visibility } from './chainAdapter';
import { arenaAddress, arenaPlayer, arenaSession } from './arenaWallet';
import { renderShareCard, shareCardBlob, shareText, shareUrl } from './shareCard';

const GOLD = '#f5c542';
const GOLD_DK = '#b8860b';
const FLUO = '#39FF14';
const GREEN = '#7fd858';
const INK = '#070a14';
const PANEL = '#0d1118';
const GRAY = '#8a8f9c';
const DIM = '#5a5f6c';
const RED = '#e23b3b';
const PQCYAN = '#57c8d8';

export type ArenaAction = { act: 'none' } | { act: 'move' } | { act: 'title' } | { act: 'run'; stageMode: 'full' | 'stage'; stageIdx: number };

interface Hot {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
}

type Screen = 'board' | 'create' | 'versus' | 'history' | 'histcard' | 'legacy' | 'share' | 'notfound' | 'seal';
type WizardStep = 'visibility' | 'format' | 'battle' | 'stake' | 'fighter' | 'confirm';

const STAGE_NAMES = ['GHETTO GONNA', 'PUMP HARBOR', 'WALL STREET', 'CONSENSUS', 'THE HOUSE', 'LAUNCHPAD', 'THRONE ROOM'];
const SEAT_OPTS = [4, 8, 12];
const DUR_OPTS: { label: string; secs: number }[] = [
  { label: '4H', secs: 4 * 3600 },
  { label: '12H', secs: 12 * 3600 },
  { label: '24H', secs: 24 * 3600 },
];
const STAKE_OPTS = [10_000_000, 100_000_000, 1_000_000_000];
const CUSTOM_STEP = 10_000_000;
const CUSTOM_MAX = 10_000_000_000;

// mock fighter shelf: owned NFT skins (real holdings when a wallet is on)
interface FighterOpt {
  pick: FighterPick;
  owned: boolean;
}
const MOCK_SHELF: FighterOpt[] = [
  { pick: { skin: 'gonna', assetId: null, name: 'GONNA' }, owned: true },
  { pick: { skin: 'fire', assetId: 7007, name: 'GONNA 7' }, owned: true },
  { pick: { skin: 'rainbow', assetId: 7042, name: 'GONNA 42' }, owned: true },
  { pick: { skin: 'alien', assetId: 7066, name: 'GONNA 66' }, owned: false },
  { pick: { skin: 'acid', assetId: 7099, name: 'GONNA 99' }, owned: false },
];

interface CoinFx {
  x: number;
  y: number;
  vy: number;
  t: number;
}

export class ArenaUI {
  private screen: Screen = 'board';
  // v11: PLAY -> SEAL -> SIGN. The contract needs the creator score INSIDE
  // the create group, so the run happens BEFORE the atomic group is signed.
  private sealedScore: number | null = null;
  // v12: CONTINUE — 5 ALGO flat, MAX 1 per player per match, SAME SEED on
  // the retry, best-of-2 (the sealed score never gets worse).
  private sealRole: 'creator' | 'joiner' = 'creator';
  private sealBest = 0;
  private sealRuns = 0;
  private sealDraftId = ''; // creator pre-create payment ref
  private pendingRun = false; // set after a paid continue; engine polls it
  private continuePaying = false;
  private hots: Hot[] = [];
  private focus = 0;
  private busy = false;
  private err = '';
  private errT = 0;
  // board
  private cards: Challenge[] = [];
  private mine: Challenge[] = []; // v13: my open cards (creator or seated)
  private page = 0; // v10.3: paginated board (3 cards/page)
  private feedLines: string[] = [];
  private feedT = 0;
  // history + legacy
  private hist: HistoryEntry[] = [];
  private histDetail: HistoryEntry | null = null; // v13: tappable history rows
  private histPage = 0;
  private legacy: LegacyStats | null = null;
  // share sheet (v10.4)
  private shareMsg = '';
  private shareMsgT = 0;
  // v11: wallet connect feedback (board header)
  private walletMsg = '';
  private walletMsgT = 0;
  // v14.2: board status line (RUN DISCARDED etc.) — heads the LIVE feed
  private notice = '';
  private framesRef: Map<string, HTMLImageElement> | null = null;
  // v10.5: SHOW CARD — DOM overlay with a REAL <img> (native context menu)
  private showOverlay: HTMLDivElement | null = null;
  private showOverlayUrl = '';
  // v11.2: manual copy fallback (clipboard blocked)
  private copyOverlay: HTMLDivElement | null = null;
  // create wizard
  private step: WizardStep = 'visibility';
  private cfg: ChallengeConfig = this.defaultCfg();
  private shuffleT = -1; // -1 = idle; >=0 frames into the SHUFFLE animation
  private shuffleTarget = 0;
  private fighterOpts: FighterOpt[] = MOCK_SHELF;
  // versus
  private current: Challenge | null = null;
  private myScore = 0;
  // CUSTOM stake native input (mobile keyboard), managed in stepStake
  private stakeInput: HTMLInputElement | null = null;
  private stakeInputPrev = 0;
  private fitRef: ViewFit | null = null;
  private touchRef = false;
  private verdict = false; // verdict overlay up (coin rain)
  private coinRain: CoinFx[] = [];
  private rematchOf: number | null = null;

  // ---------- helpers ----------
  private defaultCfg(): ChallengeConfig {
    return {
      visibility: 'public',
      format: 'duel',
      seatsTotal: 8,
      durationSecs: 12 * 3600,
      stageMode: 'full',
      stageIdx: null,
      stake: 100_000_000,
      fighter: { skin: 'gonna', assetId: null, name: 'GONNA' },
    };
  }

  private adapter() {
    return getArenaAdapter();
  }

  private bestScore(): number {
    try {
      const raw = window.localStorage.getItem('gonna.best');
      const j = raw ? (JSON.parse(raw) as { score?: number }) : null;
      return typeof j?.score === 'number' ? j.score : 0;
    } catch {
      return 0;
    }
  }

  private fighterShelf(): FighterOpt[] {
    const e = wallet.getEligibility();
    if (wallet.isConnected() && e.nfts.length > 0) {
      const opts: FighterOpt[] = [{ pick: { skin: 'gonna', assetId: null, name: 'GONNA' }, owned: true }];
      for (const n of e.nfts) opts.push({ pick: { skin: n.skin, assetId: n.id, name: n.name }, owned: true });
      return opts;
    }
    return MOCK_SHELF; // mock: owned flags drive the QA flow
  }

  open(deepDuel?: number | null): void {
    this.closeStakeInput(false);
    this.closeShowCard();
    this.closeCopyOverlay();
    this.screen = 'board';
    this.step = 'visibility';
    this.cfg = this.defaultCfg();
    this.current = null;
    this.verdict = false;
    this.coinRain = [];
    this.err = '';
    this.focus = 0;
    this.page = 0;
    this.histPage = 0;
    this.fighterOpts = this.fighterShelf();
    this.shareMsg = '';
    this.notice = '';
    void this.refreshBoard();
    void this.refreshHistory();
    this.buildFeed();
    // v10.4 deep-link: ?duel=<id> lands straight on the card detail
    if (deepDuel != null) {
      void this.adapter()
        .getChallenge(deepDuel)
        .then((ch) => {
          if (ch) {
            this.current = ch;
            this.screen = 'versus';
            this.verdict = false;
            this.coinRain = [];
            this.focus = 0;
          } else {
            this.screen = 'notfound'; // 404 lore
          }
        })
        .catch(() => {
          this.screen = 'notfound';
        });
    }
  }

  private async refreshBoard(): Promise<void> {
    try {
      const a = this.adapter();
      const open = await a.listOpenChallenges();
      // my PRIVATE cards ride the board too (only I can see them)
      const me = arenaAddress();
      const mine = me ? await a.myChallenges(me) : [];
      const seen = new Set(open.map((c) => c.id));
      const all = [...open, ...mine.filter((c) => !seen.has(c.id))];
      // v10.3: BOARD = live action only (resolved/claimed auto-archive to
      // HISTORY). Soonest deadline first — CLOSING SOON floats to the top;
      // my expired claimables pin above everything (action needed)
      const claimable = (c: Challenge) => c.status === 'expired' && c.players.some((p) => p.address === me);
      this.cards = all
        .filter((c) => c.status === 'open' || c.status === 'full' || c.status === 'expired')
        .sort((x, y) => Number(claimable(y)) - Number(claimable(x)) || x.deadline - y.deadline);
      // v13: MY OPEN CARDS strip (the "lost private card" fix) — everything
      // live where I'm the creator OR seated, public and private alike
      this.mine = me
        ? all.filter((c) => (c.status === 'open' || c.status === 'full') && (c.creator === me || c.players.some((p) => p.address === me)))
        : [];
    } catch {
      this.cards = [];
      this.mine = [];
    }
    this.buildFeed();
  }

  private async refreshHistory(): Promise<void> {
    try {
      this.hist = await this.adapter().listHistory();
      this.legacy = await this.adapter().legacyStats(arenaAddress());
    } catch {
      this.hist = [];
      this.legacy = null;
    }
  }

  private buildFeed(): void {
    // live piazza chatter — fresh lines derive from real mock state
    const lines: string[] = [
      'WHALE_X JUST CLAIMED 2M FROM GEKKORIDER',
      'A PRIVATE 100M DUEL HAS BEEN SEALED',
      'LIL_LIZARD IS FARMING THE THRONE ROOM',
      'ANON_404 APED INTO A 12 SEAT TABLE',
    ];
    for (const c of this.cards.slice(0, 4)) {
      lines.push(c.creatorName + ' POSTED ' + fmtStake(c.stake) + ' - ' + c.seatsTotal + ' SEATS');
    }
    lines.push('SILVIO WATCHES. THE PIT PROVIDES.');
    if (this.notice) lines.unshift(this.notice); // v14.2: status wins the head
    this.feedLines = lines;
    this.feedT = 0;
  }

  // ---------- input ----------
  key(inp: Input): ArenaAction {
    if (inp.pressed.pause) {
      inp.pressed.pause = false;
      if (this.showOverlay || this.copyOverlay) {
        this.closeShowCard(); // ESC dismisses DOM overlays first
        this.closeCopyOverlay();
        return { act: 'move' };
      }
      return this.back();
    }
    if (this.hots.length > 0) {
      if (inp.pressed.up || inp.pressed.left) {
        this.focus = (this.focus + this.hots.length - 1) % this.hots.length;
        return { act: 'move' };
      }
      if (inp.pressed.down || inp.pressed.right) {
        this.focus = (this.focus + 1) % this.hots.length;
        return { act: 'move' };
      }
      if (inp.pressed.start) {
        const h = this.hots[clamp(this.focus, 0, this.hots.length - 1)];
        if (h) return this.activate(h.id);
      }
    }
    return { act: 'none' };
  }

  tap(gx: number, gy: number): ArenaAction {
    // LAST matching hot wins: small overlay buttons (CLAIM) sit on top of the
    // full-row card hotspot they are drawn inside
    for (let i = this.hots.length - 1; i >= 0; i--) {
      const h = this.hots[i];
      if (gx >= h.x && gx <= h.x + h.w && gy >= h.y && gy <= h.y + h.h) {
        this.focus = i;
        return this.activate(h.id);
      }
    }
    return { act: 'none' };
  }

  private back(): ArenaAction {
    this.closeStakeInput(true); // ESC/back commits a pending custom stake
    this.closeShowCard(); // and drops lingering DOM overlays
    this.closeCopyOverlay();
    if (this.screen === 'create') {
      // step back through the wizard
      const order: WizardStep[] = ['visibility', 'format', 'battle', 'stake', 'fighter', 'confirm'];
      const i = order.indexOf(this.step);
      if (i > 0) {
        this.step = order[i - 1];
        this.focus = 0;
        return { act: 'move' };
      }
      this.screen = 'board';
      void this.refreshBoard();
      return { act: 'move' };
    }
    if (this.screen === 'versus') {
      if (this.verdict) {
        this.verdict = false;
        this.coinRain = [];
        return { act: 'move' };
      }
      this.screen = 'board';
      this.current = null;
      void this.refreshBoard();
      void this.refreshHistory();
      return { act: 'move' };
    }
    if (this.screen === 'histcard') {
      this.histDetail = null;
      this.screen = 'history';
      this.focus = 0;
      return { act: 'move' };
    }
    if (this.screen === 'history' || this.screen === 'legacy' || this.screen === 'notfound') {
      this.screen = 'board';
      this.focus = 0;
      return { act: 'move' };
    }
    if (this.screen === 'seal') {
      // v14.2: DISCARD abandons EVERYTHING — no tx was ever sent, nothing to
      // clean up; back to THE PIT board with a status line, NOT the wizard.
      this.resetSeal();
      this.screen = 'board';
      this.focus = 0;
      this.notice = 'RUN DISCARDED - NO TX SENT';
      void this.refreshBoard();
      return { act: 'move' };
    }
    if (this.screen === 'share') {
      this.screen = 'versus';
      this.focus = 0;
      return { act: 'move' };
    }
    return { act: 'title' }; // board -> title (ESC / tilt back)
  }

  private fail(msg: string): ArenaAction {
    // v14.2: 44 chars fit the toast (44x6px < VW-80) — 'WALLET NOT
    // RESPONDING - RECONNECT AND RETRY' must survive untruncated.
    this.err = msg.toUpperCase().slice(0, 44);
    this.errT = 240; // 4s — a wallet error must be READABLE, not a blink
    console.debug('[arena] UI error:', this.err);
    return { act: 'none' };
  }

  // ---------- CUSTOM stake: native keyboard (v10.2, Prince's request) ------
  // An overlaid HTML input with inputmode="numeric" gets the PHONE keyboard
  // on mobile and normal typing on desktop; the canvas value syncs live.
  private openStakeInput(): void {
    if (this.stakeInput) return;
    const el = document.createElement('input');
    el.id = 'arena-stake-input';
    el.type = 'text';
    el.inputMode = 'numeric';
    el.pattern = '[0-9]*';
    el.autocomplete = 'off';
    el.value = String(Number.isFinite(this.cfg.stake) && this.cfg.stake > 0 ? this.cfg.stake : 10_000_000);
    el.style.position = 'fixed';
    el.style.zIndex = '9999';
    el.style.background = '#0d1118';
    el.style.color = '#f5c542';
    el.style.border = '1px solid #b8860b';
    el.style.textAlign = 'center';
    el.style.fontFamily = 'monospace';
    el.style.padding = '0';
    el.style.outline = 'none';
    el.style.caretColor = '#39FF14';
    this.stakeInputPrev = this.cfg.stake;
    el.addEventListener('input', () => {
      // digits only, live sync into the wizard config
      const digits = el.value.replace(/\D/g, '').slice(0, 12); // max 1T
      if (el.value !== digits) el.value = digits;
      this.cfg.stake = digits === '' ? 0 : Math.min(1_000_000_000_000, Number(digits));
    });
    el.addEventListener('keydown', (ev) => {
      ev.stopPropagation(); // keep the game Input handler out while typing
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.closeStakeInput(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.closeStakeInput(false);
      }
    });
    // the mousedown default action that FOLLOWS our tap handler steals focus
    // right after we grab it — treat early blurs as focus-steals and reclaim
    const openedAt = performance.now();
    el.addEventListener('blur', () => {
      if (performance.now() - openedAt < 350) {
        setTimeout(() => {
          if (this.stakeInput === el) el.focus();
        }, 0);
        return;
      }
      this.closeStakeInput(true); // real blur (tap outside / keyboard dismissed)
    });
    document.body.appendChild(el);
    this.stakeInput = el;
    el.focus(); // sync: inside the tap gesture, so mobile keyboards open
    el.select();
    setTimeout(() => {
      if (this.stakeInput === el && document.activeElement !== el) el.focus();
    }, 50);
  }

  private closeStakeInput(commit: boolean): void {
    const el = this.stakeInput;
    if (!el) return;
    this.stakeInput = null;
    if (commit) {
      // validate on close: min 1 $GONNA; empty/rekt -> sensible 10M default
      if (!Number.isFinite(this.cfg.stake) || this.cfg.stake < 1) this.cfg.stake = 10_000_000;
      this.cfg.stake = Math.min(1_000_000_000_000, Math.floor(this.cfg.stake));
    } else {
      this.cfg.stake = this.stakeInputPrev;
    }
    el.remove();
  }

  // overlay position tracks the canvas letterbox (same pattern as the engine's
  // SAVE RECORD msg input — fit offsets are CSS px, see engine.placeMsgInput)
  private placeStakeInput(): void {
    const el = this.stakeInput;
    const f = this.fitRef;
    if (!el || !f) return;
    el.style.left = Math.round(f.fitOffX + 126 * f.fitScale) + 'px';
    el.style.top = Math.round(f.fitOffY + 114 * f.fitScale) + 'px';
    el.style.width = Math.round(132 * f.fitScale) + 'px';
    el.style.height = Math.round(24 * f.fitScale) + 'px';
    // iOS Safari auto-zooms on focused inputs < 16px — go 16px on touch
    el.style.fontSize = Math.max(this.touchRef ? 16 : 10, Math.round(10 * f.fitScale)) + 'px';
  }

  // ---------- v10.4: SHARE ----------
  // the poster fighter: challenger NFT portrait, or the base GONNA frame
  private fighterImage(ch: Challenge): CanvasImageSource | null {
    const skin = (ch.players[0]?.fighter.skin ?? 'gonna') as SkinId;
    if (skin !== 'gonna') {
      const p = skinPortrait(skin);
      if (p) return p;
    }
    return this.framesRef?.get('0_0') ?? null;
  }

  private openShareSheet(): ArenaAction {
    const ch = this.current;
    if (!ch) return { act: 'none' };
    this.screen = 'share';
    this.shareMsg = '';
    this.focus = 0;
    // mobile-first: if the platform can share FILES, fire the NATIVE sheet
    // with the generated card PNG (still inside the tap's transient gesture)
    void (async () => {
      try {
        const blob = await shareCardBlob(renderShareCard(ch, this.fighterImage(ch)));
        const file = new File([blob], 'gonna-pit-card-' + ch.id + '.png', { type: 'image/png' });
        const nav = navigator as Navigator & {
          canShare?: (d: { files: File[] }) => boolean;
          share?: (d: { files?: File[]; text?: string }) => Promise<void>;
        };
        if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], text: shareText(ch) + ' ' + shareUrl(ch.id) });
          this.shareMsg = 'SHARED - GO FETCH DEGENS';
          this.shareMsgT = 240;
        }
      } catch { /* cancelled or unsupported: the four fallbacks stay up */ }
    })();
    return { act: 'move' };
  }

  // ---------- v10.5: SHOW CARD overlay (real <img>, native save UX) --------
  // Desktop: right-click -> Save image as. Mobile: long-press -> Save to
  // Photos. A blob URL keeps the native context menu working everywhere.
  private openShowCard(): void {
    const ch = this.current;
    if (!ch || this.showOverlay) return;
    void (async () => {
      try {
        const blob = await shareCardBlob(renderShareCard(ch, this.fighterImage(ch)));
        const url = URL.createObjectURL(blob);
        const isTouch = 'ontouchstart' in window || (window.matchMedia?.('(pointer: coarse)').matches ?? false);
        const back = document.createElement('div');
        back.id = 'arena-showcard';
        back.style.cssText =
          'position:fixed;inset:0;z-index:10000;background:rgba(5,6,10,0.92);' +
          'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;';
        const img = document.createElement('img');
        img.id = 'arena-showcard-img';
        img.src = url;
        img.alt = 'GONNA FIGHT - THE PIT challenge card';
        img.style.cssText =
          'max-width:92vw;max-height:70vh;object-fit:contain;image-rendering:pixelated;' +
          'border:2px solid #b8860b;box-shadow:0 0 24px rgba(245,197,66,0.25);';
        img.addEventListener('click', (ev) => ev.stopPropagation()); // never close ON the card
        const cap = document.createElement('div');
        cap.textContent = isTouch ? 'LONG-PRESS — SAVE TO PHOTOS' : 'RIGHT-CLICK — SAVE IMAGE AS';
        cap.style.cssText = 'color:#f5c542;font:12px monospace;letter-spacing:1px;text-align:center;';
        const close = document.createElement('button');
        close.id = 'arena-showcard-close';
        close.textContent = 'CLOSE';
        close.style.cssText =
          'background:#14100a;color:#f5c542;border:2px solid #b8860b;font:bold 14px monospace;' +
          'padding:10px 28px;letter-spacing:2px;cursor:pointer;';
        close.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.closeShowCard();
        });
        back.appendChild(img);
        back.appendChild(cap);
        back.appendChild(close);
        back.addEventListener('click', () => this.closeShowCard()); // tap-outside closes
        document.body.appendChild(back);
        this.showOverlay = back;
        this.showOverlayUrl = url;
      } catch {
        this.fail('RENDER REKT - TRY AGAIN');
      }
    })();
  }

  private closeShowCard(): void {
    const o = this.showOverlay;
    if (!o) return;
    this.showOverlay = null;
    if (this.showOverlayUrl) {
      URL.revokeObjectURL(this.showOverlayUrl);
      this.showOverlayUrl = '';
    }
    o.remove();
  }

  // ---------- v11.2: manual-copy overlay (clipboard-blocked fallback) ------
  private openCopyOverlay(link: string): void {
    if (this.copyOverlay) return;
    const back = document.createElement('div');
    back.id = 'arena-copylink';
    back.style.cssText =
      'position:fixed;inset:0;z-index:10000;background:rgba(5,6,10,0.92);' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;';
    const inp = document.createElement('input');
    inp.id = 'arena-copylink-input';
    inp.readOnly = true;
    inp.value = link;
    inp.style.cssText =
      'width:92vw;max-width:560px;background:#0d1118;color:#f5c542;border:2px solid #b8860b;' +
      'font:14px monospace;padding:12px;text-align:center;';
    inp.addEventListener('click', (ev) => ev.stopPropagation());
    const cap = document.createElement('div');
    cap.textContent = 'COPY IT MANUALLY';
    cap.style.cssText = 'color:#39FF14;font:12px monospace;letter-spacing:1px;';
    const close = document.createElement('button');
    close.id = 'arena-copylink-close';
    close.textContent = 'CLOSE';
    close.style.cssText =
      'background:#14100a;color:#f5c542;border:2px solid #b8860b;font:bold 14px monospace;' +
      'padding:10px 28px;letter-spacing:2px;cursor:pointer;';
    close.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.closeCopyOverlay();
    });
    back.appendChild(inp);
    back.appendChild(cap);
    back.appendChild(close);
    back.addEventListener('click', () => this.closeCopyOverlay());
    document.body.appendChild(back);
    this.copyOverlay = back;
    inp.focus();
    inp.select();
    inp.setSelectionRange(0, link.length); // mobile Safari wants the range API
  }

  private closeCopyOverlay(): void {
    const o = this.copyOverlay;
    if (!o) return;
    this.copyOverlay = null;
    o.remove();
  }

  // ---------- actions ----------
  private activate(id: string): ArenaAction {
    if (this.busy) return { act: 'none' };
    // any other tap commits + dismisses the native stake keyboard
    if (id !== 'stake:custom') this.closeStakeInput(true);
    // navigation
    if (id === 'back') return this.back();
    if (id === 'history') {
      this.screen = 'history';
      this.histPage = 0;
      this.focus = 0;
      void this.refreshHistory();
      return { act: 'move' };
    }
    if (id === 'legacy') {
      this.screen = 'legacy';
      this.focus = 0;
      void this.refreshHistory();
      return { act: 'move' };
    }
    if (id === 'create') {
      this.screen = 'create';
      this.step = 'visibility';
      this.focus = 0;
      this.err = '';
      this.notice = '';
      this.resetSeal(); // fresh card, fresh runs
      this.sealDraftId = 'D' + Date.now().toString(36);
      this.sealRole = 'creator';
      return { act: 'move' };
    }
    if (id.startsWith('card:')) {
      const c = this.cards.find((x) => x.id === Number(id.slice(5)));
      if (c) {
        this.current = c;
        this.screen = 'versus';
        this.verdict = false;
        this.coinRain = [];
        this.focus = 0;
        this.myScore = this.bestScore();
        this.resetSeal();
        return { act: 'move' };
      }
      return { act: 'none' };
    }
    // v14.2: MY CARDS cycling — hop between my open cards straight from the
    // card detail (arrows are hotspots, so keyboard focus+START works too)
    if (id === 'mine:prev' || id === 'mine:next') {
      const mi = this.current ? this.mine.findIndex((m) => m.id === this.current!.id) : -1;
      if (mi < 0 || this.mine.length < 2) return { act: 'none' };
      const ni = (mi + (id === 'mine:next' ? 1 : this.mine.length - 1)) % this.mine.length;
      this.current = this.mine[ni];
      this.verdict = false;
      this.coinRain = [];
      this.focus = 0;
      this.myScore = this.bestScore();
      this.resetSeal();
      return { act: 'move' };
    }
    if (id === 'page:prev') {
      this.page = Math.max(0, this.page - 1);
      return { act: 'move' };
    }
    if (id === 'page:next') {
      // v14.3: clamp with the SAME pageSize the renderer uses (2 when MY OPEN CARDS eats a row)
      const pageSize = this.mine.length > 0 ? 2 : 3;
      this.page = Math.min(Math.max(0, Math.ceil(this.cards.length / pageSize) - 1), this.page + 1);
      return { act: 'move' };
    }
    if (id.startsWith('hist:')) {
      const h = this.hist[Number(id.slice(5))];
      if (h) {
        this.histDetail = h;
        this.screen = 'histcard';
        this.focus = 0;
      }
      return { act: 'move' };
    }
    if (id === 'hview') {
      // v13: the on-chain box is deleted after payout — the proof lives on
      // the explorer (resolve txid remembered by recordTxid)
      const h = this.histDetail;
      if (h) {
        try {
          const m = JSON.parse(window.localStorage.getItem('gonna.arena.txids') ?? '{}') as Record<string, string>;
          const txid = m[String(h.id)];
          if (txid) window.open('https://testnet.explorer.perawallet.app/tx/' + txid, '_blank');
        } catch { /* no storage */ }
      }
      return { act: 'none' };
    }
    if (id === 'hpage:prev') {
      this.histPage = Math.max(0, this.histPage - 1);
      return { act: 'move' };
    }
    if (id === 'hpage:next') {
      this.histPage = Math.min(Math.max(0, Math.ceil(this.hist.length / 5) - 1), this.histPage + 1);
      return { act: 'move' };
    }
    if (id.startsWith('claim:')) return this.doClaim(Number(id.slice(6)));

    // ---- v10.4: SHARE (private cards, owner only, while live) ----
    if (id === 'viewchain') {
      const ch = this.current;
      const txid = ch ? getTxid(ch.id) : null;
      if (txid) window.open(explorerTxUrl(txid), '_blank', 'noopener');
      return { act: 'move' };
    }
    if (id === 'wallet') {
      // testnet: real Pera connect (chainId 416002); mock: mainnet gate wallet
      this.walletMsgT = 0;
      console.debug('[arena] CONNECT — wallet connect start');
      void this.run(
        () => connectArenaWallet('pera'),
        (addr) => {
          this.walletMsg = 'CONNECTED ' + addr.slice(0, 6) + '..' + addr.slice(-4);
          this.walletMsgT = 240;
        },
      );
      return { act: 'move' };
    }
    if (id === 'share') return this.openShareSheet();
    if (id === 'share:show') {
      this.openShowCard(); // v10.5: DOM overlay, real <img>, native save UX
      return { act: 'move' };
    }
    if (id === 'share:x' || id === 'share:tg') {
      const ch = this.current;
      if (!ch) return { act: 'none' };
      const url = shareUrl(ch.id);
      const text = shareText(ch);
      const intent =
        id === 'share:x'
          ? 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text + '\n' + url)
          : 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text);
      window.open(intent, '_blank', 'noopener');
      this.shareMsg = id === 'share:x' ? 'POSTED ON X - TAG THE WHALES' : 'SENT TO THE TG TRENCHES';
      this.shareMsgT = 240;
      return { act: 'move' };
    }
    if (id === 'share:copy') {
      const ch = this.current;
      if (!ch) return { act: 'none' };
      const link = shareUrl(ch.id);
      // HONEST clipboard: COPIED only on a real write; if the browser blocks
      // it (iframes/previews), open the manual-copy overlay instead
      void (async () => {
        try {
          await navigator.clipboard.writeText(link);
          this.shareMsg = 'LINK COPIED - GO PASTE IT';
          this.shareMsgT = 240;
        } catch {
          this.openCopyOverlay(link);
        }
      })();
      return { act: 'move' };
    }
    if (id === 'share:save') {
      const ch = this.current;
      if (!ch) return { act: 'none' };
      void (async () => {
        try {
          const blob = await shareCardBlob(renderShareCard(ch, this.fighterImage(ch)));
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'gonna-pit-card-' + ch.id + '.png';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
          this.shareMsg = 'CARD SAVED - 1200X630 OG QUALITY';
          this.shareMsgT = 240;
        } catch {
          this.shareMsg = 'RENDER REKT - TRY AGAIN';
          this.shareMsgT = 240;
        }
      })();
      return { act: 'move' };
    }

    // ---- wizard ----
    if (id === 'vis:public' || id === 'vis:private') {
      this.cfg.visibility = id === 'vis:public' ? 'public' : 'private';
      this.step = 'format';
      this.focus = 0;
      return { act: 'move' };
    }
    if (id === 'fmt:duel') {
      this.cfg.format = 'duel';
      this.step = 'battle';
      this.focus = 0;
      return { act: 'move' };
    }
    if (id === 'fmt:open') {
      this.cfg.format = 'open'; // reveals seats/duration + NEXT
      return { act: 'move' };
    }
    if (id === 'fmt:next') {
      this.step = 'battle';
      this.focus = 0;
      return { act: 'move' };
    }
    if (id.startsWith('seats:')) {
      this.cfg.seatsTotal = Number(id.slice(6));
      return { act: 'move' };
    }
    if (id.startsWith('dur:')) {
      this.cfg.durationSecs = Number(id.slice(4));
      return { act: 'move' };
    }
    if (id === 'bat:full') {
      this.cfg.stageMode = 'full';
      this.cfg.stageIdx = null;
      this.step = 'stake';
      this.focus = 0;
      return { act: 'move' };
    }
    if (id === 'bat:single') {
      this.cfg.stageMode = 'single'; // reveals the stage picker
      return { act: 'move' };
    }
    if (id === 'bat:next') {
      this.step = 'stake';
      this.focus = 0;
      return { act: 'move' };
    }
    if (id.startsWith('bat:stage:')) {
      this.cfg.stageMode = 'single';
      this.cfg.stageIdx = Number(id.slice(10));
      this.step = 'stake';
      this.focus = 0;
      return { act: 'move' };
    }
    if (id === 'bat:random') {
      // SHUFFLE: slot-machine reels, the target is drawn NOW and the reels
      // brake onto it (staggered stops, no white flash — gold spark burst)
      this.cfg.stageMode = 'random';
      this.shuffleTarget = Math.floor(Math.random() * 7);
      this.shuffleT = 0;
      return { act: 'move' };
    }
    // v10.2: EXACT stake ids FIRST — 'stake:minus'/'stake:plus' used to fall
    // into the startsWith('stake:') preset branch (Number('minus') = NaN and
    // a bogus jump to the fighter step). Presets are matched last + guarded.
    if (id === 'stake:minus') {
      this.cfg.stake = Math.max(CUSTOM_STEP, (Number.isFinite(this.cfg.stake) ? this.cfg.stake : 10_000_000) - CUSTOM_STEP);
      return { act: 'move' };
    }
    if (id === 'stake:plus') {
      this.cfg.stake = Math.min(CUSTOM_MAX, (Number.isFinite(this.cfg.stake) ? this.cfg.stake : 0) + CUSTOM_STEP);
      return { act: 'move' };
    }
    if (id === 'stake:custom') {
      // Prince's request: the amount field summons the native phone keyboard
      this.openStakeInput();
      return { act: 'move' };
    }
    if (id === 'stake:next') {
      this.step = 'fighter';
      this.focus = 0;
      return { act: 'move' };
    }
    if (id.startsWith('stake:')) {
      const v = Number(id.slice(6));
      if (!Number.isFinite(v) || v < 1) return this.fail('BAD STAKE DEGEN');
      this.cfg.stake = v;
      this.step = 'fighter'; // preset stake taps straight through
      this.focus = 0;
      return { act: 'move' };
    }
    if (id.startsWith('fighter:')) {
      const i = Number(id.slice(8));
      const o = this.fighterOpts[i];
      if (!o) return { act: 'none' };
      if (!o.owned) return this.fail('NOT YOURS YET DEGEN');
      this.cfg.fighter = { ...o.pick };
      this.step = 'confirm';
      this.focus = 0;
      return { act: 'move' };
    }
    if (id === 'playrun') {
      // QA shortcut (?qa=1): the deterministic score is sealed instantly so
      // E2E stays assertable without a live beat-em-up run
      this.sealRole = 'creator';
      if (!this.sealDraftId) this.sealDraftId = 'D' + Date.now().toString(36);
      if (qaActive()) {
        this.onRunFinished(qaScore());
        return { act: 'move' };
      }
      return {
        act: 'run',
        stageMode: this.cfg.stageMode === 'full' ? 'full' : 'stage',
        stageIdx: this.cfg.stageMode === 'full' ? 0 : (this.cfg.stageIdx ?? 0),
      };
    }
    // v12: CONTINUE — pay 5 ALGO to the treasury, replay the SAME run, seal
    // the best of the two. One per player per match.
    if (id === 'continue') {
      if (this.sealRuns !== 1) return this.fail('CONTINUE ALREADY USED');
      if (this.continuePaying) return { act: 'none' };
      const refId = this.sealRole === 'creator' ? this.sealDraftId : String(this.current?.id ?? 0);
      if (this.adapter().mode === 'testnet') {
        this.continuePaying = true;
        console.debug('[arena] CONTINUE — 5 ALGO payment start (ref ' + refId + ')');
        void this.run(
          async () => {
            const kit = await import('./testnetKit');
            const idp = (window as unknown as { __arenaIdProvider?: () => Promise<{ address: string; sign: import('./testnetKit').TxSignFn } | null> }).__arenaIdProvider;
            const me = idp ? await idp() : null;
            if (!me) throw new Error('WALLET NOT CONNECTED - TAP CONNECT');
            const txns = await kit.buildContinuePayment({ sender: me.address, refId });
            const txid = await kit.signSend(me.sign, txns);
            try {
              window.localStorage.setItem('gonna.continue|' + refId + '|' + me.address, txid);
            } catch { /* no storage */ }
            return txid;
          },
          () => {
            this.continuePaying = false;
            this.pendingRun = true; // engine picks it up next frame
          },
        );
        return { act: 'move' };
      }
      // mock: no payment — straight into run 2
      this.pendingRun = true;
      return { act: 'move' };
    }
    if (id === 'seal:discard') return this.back();
    if (id === 'sign') return this.sealRole === 'joiner' ? this.doSubmit() : this.doSign();

    // ---- versus ----
    if (id === 'accept') return this.doAccept();
    if (id === 'submit') {
      // v12: the joiner plays too — PLAY YOUR RUN -> SEAL -> SIGN SCORE
      const c = this.current;
      if (!c) return { act: 'none' };
      this.resetSeal();
      this.sealRole = 'joiner';
      if (qaActive()) {
        this.onRunFinished(qaScore());
        return { act: 'move' };
      }
      return {
        act: 'run',
        stageMode: c.stageMode === 'full' ? 'full' : 'stage',
        stageIdx: c.stageMode === 'full' ? 0 : (c.stageIdx ?? 0),
      };
    }
    if (id === 'resolve') return this.doResolve();
    if (id === 'vclaim') return this.doClaim(this.current ? this.current.id : -1);
    if (id === 'close') return this.doEarlyClose();
    if (id === 'rematch') return this.doRematch();
    return { act: 'none' };
  }

  private async run<T>(job: () => Promise<T>, ok: (r: T) => void): Promise<void> {
    this.busy = true;
    try {
      ok(await job());
    } catch (e) {
      // v14.2: EVERY failure is visible — console breadcrumb + red UI line
      console.debug('[arena] op failed:', e);
      this.fail(e instanceof Error ? e.message : 'REKT - TRY AGAIN');
    } finally {
      this.busy = false; // the button ALWAYS comes back (timeout included)
    }
  }

  // v11: the engine calls this when the ARENA run ends — the score is SEALED
  // v12: best-of-2 — a CONTINUE retry can only RAISE the sealed score
  onRunFinished(score: number): void {
    const s = Math.max(0, Math.floor(score));
    this.sealedScore = s;
    this.sealRuns++;
    if (s > this.sealBest) this.sealBest = s;
    this.pendingRun = false;
    this.screen = 'seal';
    this.err = '';
    this.focus = 0;
  }

  onRunAborted(): void {
    this.sealedScore = null;
    this.pendingRun = false;
    if (this.screen === 'seal') this.screen = this.sealRole === 'joiner' ? 'versus' : 'board';
  }

  // engine polls this every frame in the arena scene: after a paid CONTINUE
  // the retry starts as soon as the payment confirms (async tap handlers
  // cannot return an action)
  pollPendingRun(): ArenaAction | null {
    if (!this.pendingRun) return null;
    this.pendingRun = false;
    const stageMode = this.sealRole === 'creator'
      ? (this.cfg.stageMode === 'full' ? 'full' : 'stage')
      : (this.current?.stageMode === 'full' ? 'full' : 'stage');
    const stageIdx = this.sealRole === 'creator'
      ? (this.cfg.stageMode === 'full' ? 0 : (this.cfg.stageIdx ?? 0))
      : (this.current?.stageMode === 'full' ? 0 : (this.current?.stageIdx ?? 0));
    return { act: 'run', stageMode, stageIdx };
  }

  private resetSeal(): void {
    this.sealedScore = null;
    this.sealBest = 0;
    this.sealRuns = 0;
    this.pendingRun = false;
    this.continuePaying = false;
  }

  private doSign(): ArenaAction {
    const cfg: ChallengeConfig = { ...this.cfg };
    if (cfg.stageMode === 'random' && this.shuffleT >= 0) cfg.stageIdx = this.shuffleTarget;
    // never a dead click: on testnet a real create NEEDS a sealed run score
    if (this.adapter().mode === 'testnet' && !qaActive() && this.sealedScore === null) {
      return this.fail('PLAY YOUR RUN FIRST');
    }
    // v12: sign the BEST of the runs; a 2nd run carries the payment ref
    const best = this.sealBest > 0 ? this.sealBest : this.sealedScore;
    if (best !== null) cfg.sealedScore = best;
    if (this.sealRuns >= 2) cfg.continueRefId = this.sealDraftId;
    const player = arenaPlayer(cfg.fighter);
    console.debug('[arena] SIGN & STAKE — create start (score ' + (cfg.sealedScore ?? 'none') + ')');
    void this.run(
      () => this.adapter().createChallenge(cfg, player),
      (c) => {
        this.current = c;
        this.screen = 'versus';
        this.verdict = false;
        this.rematchOf = null; // the rematch became its own card
        this.resetSeal(); // consumed — the score lives on-chain now
        this.focus = 0;
        this.buildFeed();
      },
    );
    return { act: 'move' };
  }

  private doAccept(): ArenaAction {
    const c = this.current;
    if (!c) return { act: 'none' };
    const player = arenaPlayer({ skin: 'gonna', assetId: null, name: 'GONNA' });
    console.debug('[arena] ACCEPT & STAKE — join start (card #' + c.id + ')');
    void this.run(
      () => this.adapter().join(c.id, player),
      (nc) => {
        this.current = nc;
      },
    );
    return { act: 'move' };
  }

  private doSubmit(): ArenaAction {
    const c = this.current;
    if (!c) return { act: 'none' };
    const me = arenaAddress();
    // v12: sign the BEST sealed run; a post-CONTINUE score carries the
    // on-chain payment ref (the oracle verifies the receipt before signing).
    // QA mode plays a DETERMINISTIC score so E2E verdicts are assertable.
    const score = this.sealBest > 0 ? this.sealBest : (qaActive() ? qaScore() : this.myScore > 0 ? this.myScore : 4200 + Math.floor(Math.random() * 900));
    const opts = this.sealRuns >= 2 ? { continueRefId: String(c.id) } : undefined;
    console.debug('[arena] SIGN SCORE — submit start (card #' + c.id + ', score ' + score + ')');
    void this.run(
      () => this.adapter().submitScore(c.id, me, score, opts),
      (nc) => {
        this.current = nc;
        this.resetSeal();
        this.screen = 'versus';
      },
    );
    return { act: 'move' };
  }

  private doResolve(): ArenaAction {
    const c = this.current;
    if (!c) return { act: 'none' };
    console.debug('[arena] RESOLVE — start (card #' + c.id + ')');
    void this.run(
      () => this.adapter().resolve(c.id),
      (nc) => {
        this.current = nc;
        this.startVerdict(nc);
      },
    );
    return { act: 'move' };
  }

  private doClaim(id: number): ArenaAction {
    const me = arenaAddress();
    console.debug('[arena] CLAIM — start (card #' + id + ')');
    void this.run(
      () => this.adapter().claim(id, me),
      () => {
        this.buildFeed();
        void this.refreshBoard();
        void this.refreshHistory(); // claimed matches count in MY LEGACY
        // v10.3: the match is archived now — update the versus copy in place
        if (this.current && this.current.id === id) {
          this.current.status = this.current.status === 'resolved' ? 'claimed' : 'closed';
        }
      },
    );
    return { act: 'move' };
  }

  private doEarlyClose(): ArenaAction {
    const c = this.current;
    if (!c) return { act: 'none' };
    const me = arenaAddress();
    void this.run(
      () => this.adapter().earlyClose(c.id, me),
      (nc) => {
        this.current = nc;
      },
    );
    return { act: 'move' };
  }

  private doRematch(): ArenaAction {
    const c = this.current;
    if (!c) return { act: 'none' };
    this.rematchOf = c.id;
    // same rules, fresh card — the wizard pre-fills from the last battle
    this.cfg = {
      visibility: c.visibility,
      format: c.format,
      seatsTotal: c.seatsTotal,
      durationSecs: c.durationSecs,
      stageMode: c.stageMode,
      stageIdx: c.stageIdx,
      stake: c.stake,
      fighter: { ...this.cfg.fighter },
    };
    this.verdict = false;
    this.coinRain = [];
    this.screen = 'create';
    this.step = 'confirm';
    this.focus = 0;
    return { act: 'move' };
  }

  // verdict overlay + GOLD coin rain over the winner (never white)
  private startVerdict(c: Challenge): void {
    this.verdict = true;
    this.coinRain = [];
    const meAddr = arenaAddress();
    const won = c.winner !== null && c.winner === meAddr;
    const n = won ? 90 : 36; // the winner drowns in gold
    for (let i = 0; i < n; i++) {
      this.coinRain.push({
        x: Math.random() * VW,
        y: -Math.random() * 160,
        vy: 1 + Math.random() * 2.2,
        t: 200 + Math.random() * 120,
      });
    }
  }

  // ---------- per-frame ----------
  tick(): void {
    if (this.errT > 0) this.errT--;
    if (this.shareMsgT > 0) this.shareMsgT--;
    if (this.walletMsgT > 0) this.walletMsgT--;
    this.feedT++;
    if (this.feedT > 220) {
      this.feedT = 0;
      if (this.feedLines.length > 1) this.feedLines.push(this.feedLines.shift()!);
    }
    if (this.shuffleT >= 0 && this.shuffleT < 200) this.shuffleT++;
    for (const c of this.coinRain) {
      c.y += c.vy;
      c.vy += 0.03;
      if (c.y > VH + 8) {
        c.y = -8;
        c.x = Math.random() * VW;
        c.vy = 1 + Math.random() * 2;
      }
      c.t--;
    }
    if (this.coinRain.length > 0) this.coinRain = this.coinRain.filter((c) => c.t > 0);
  }

  // ---------- draw ----------
  draw(c: CanvasRenderingContext2D, frame: number, art: Art, touch: boolean, fit?: ViewFit, frames?: Map<string, HTMLImageElement>): void {
    this.hots = [];
    this.fitRef = fit ?? this.fitRef;
    this.touchRef = touch;
    this.framesRef = frames ?? this.framesRef;
    // native stake keyboard only lives on the STAKE step
    if (this.stakeInput && (this.screen !== 'create' || this.step !== 'stake')) this.closeStakeInput(true);
    c.fillStyle = INK;
    c.fillRect(0, 0, VW, VH);
    // drifting void stars (same family as SAVE RECORD)
    for (let i = 0; i < 28; i++) {
      const sx = (i * 137 + ((frame >> 3) * (1 + (i & 3)))) % VW;
      const sy = (i * 71) % VH;
      c.fillStyle = (i & 1) ? '#101a30' : '#14202a';
      c.fillRect(sx, sy, 1, 1);
    }
    mosaicBorder(c);
    if (this.screen === 'board') this.drawBoard(c, frame);
    else if (this.screen === 'create') this.drawCreate(c, frame, art);
    else if (this.screen === 'history') this.drawHistory(c, frame);
    else if (this.screen === 'histcard') this.drawHistCard(c, frame);
    else if (this.screen === 'legacy') this.drawLegacy(c, frame);
    else if (this.screen === 'share') this.drawShare(c, frame);
    else if (this.screen === 'seal') this.drawSeal(c, frame);
    else if (this.screen === 'notfound') this.drawNotfound(c, frame);
    else this.drawVersus(c, frame, art);
    // gold coin rain rides over the versus verdict
    if (this.coinRain.length > 0) {
      for (const p of this.coinRain) {
        this.pixelCoin(c, Math.round(p.x), Math.round(p.y), frame);
      }
    }
    // error toast (black strip, red text — never a flash)
    if (this.errT > 0 && this.err) {
      c.fillStyle = 'rgba(7,10,20,0.92)';
      c.fillRect(40, VH - 44, VW - 80, 12);
      drawTextSh(c, this.err, VW / 2, VH - 41, 1, RED, 'center');
    }
    if (!touch) drawText(c, 'ESC BACK', VW - 8, VH - 11, 1, DIM, 'right');
    if (this.focus >= this.hots.length) this.focus = 0;
  }

  private btn(c: CanvasRenderingContext2D, frame: number, h: Omit<Hot, 'id'> & { id: string }, label: string, opts: { gold?: boolean; green?: boolean; dim?: boolean; small?: boolean; disabled?: boolean } = {}): void {
    // disabled: drawn but NEVER focusable/tappable (no hotspot registered)
    const lit = !opts.disabled && this.hots.length === this.focus;
    if (!opts.disabled) this.hots.push(h);
    c.fillStyle = opts.disabled ? '#0a0c12' : opts.gold ? '#14100a' : opts.green ? '#0f2408' : PANEL;
    c.fillRect(h.x, h.y, h.w, h.h);
    c.strokeStyle = opts.disabled ? '#232838' : lit ? '#ffffff' : opts.gold ? ((frame & 16) !== 0 ? GOLD : GOLD_DK) : opts.green ? ((frame & 16) !== 0 ? GREEN : '#3fae4a') : '#3a3f4c';
    c.lineWidth = 1;
    c.strokeRect(h.x + 0.5, h.y + 0.5, h.w - 1, h.h - 1);
    const color = opts.disabled ? DIM : opts.dim ? DIM : opts.gold ? GOLD : opts.green ? GREEN : '#c8ccd4';
    drawTextSh(c, label, h.x + h.w / 2, h.y + Math.floor((h.h - 7) / 2), 1, lit ? '#ffffff' : color, 'center');
    if (lit && (frame & 16) !== 0) drawText(c, '>', h.x + 3, h.y + Math.floor((h.h - 7) / 2), 1, GREEN);
  }

  // 6x6 gold pixel coin (arena money, never white)
  private pixelCoin(c: CanvasRenderingContext2D, x: number, y: number, frame: number): void {
    const spin = (frame >> 2) & 3;
    const w = spin === 1 || spin === 3 ? 4 : 6; // cheap spin shimmer
    c.fillStyle = GOLD_DK;
    c.fillRect(x + (6 - w) / 2, y, w, 6);
    c.fillStyle = GOLD;
    c.fillRect(x + (6 - w) / 2, y + 1, w, 4);
    if (w > 4) {
      c.fillStyle = '#fff3c4';
      c.fillRect(x + 2, y + 1, 1, 2);
    }
  }

  // coin pile sized by stake tier: 10M=3, 100M=5, 1B=8 coins
  private coinPile(c: CanvasRenderingContext2D, x: number, y: number, stake: number, frame: number): void {
    const n = stake >= 1_000_000_000 ? 8 : stake >= 100_000_000 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const cx = x + (i % 3) * 7 + ((i / 3) | 0) * 2;
      const cy = y - ((i / 3) | 0) * 5;
      this.pixelCoin(c, cx, cy, frame + i * 3);
    }
  }

  // ⚛ QUANTUM SEAL — pixel atom badge for Falcon (PQ) accounts
  private quantumSeal(c: CanvasRenderingContext2D, x: number, y: number, frame: number): void {
    const glow = (frame & 16) !== 0;
    c.strokeStyle = glow ? PQCYAN : '#2e7a86';
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, 11, 11);
    c.fillStyle = PQCYAN;
    c.fillRect(x + 5, y + 2, 2, 8); // vertical orbit
    c.fillRect(x + 2, y + 5, 8, 2); // horizontal orbit
    c.fillStyle = glow ? '#ffffff' : PQCYAN;
    c.fillRect(x + 5, y + 5, 2, 2); // nucleus
  }

  private stageIcon(c: CanvasRenderingContext2D, art: Art, idx: number, x: number, y: number, s: number): void {
    const tiles: (HTMLCanvasElement | null)[] = [
      art.gecko[0], art.snek[0], art.coinsnek[0], art.golem.idle, art.bull[0], art.fud.idle, art.boss.idle,
    ];
    const t = tiles[clamp(idx, 0, 6)];
    c.fillStyle = '#0d1a12';
    c.fillRect(x, y, s, s);
    c.strokeStyle = GOLD_DK;
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    if (t) this.drawFit(c, t, x + 2, y + 2, s - 4);
    drawText(c, String(idx + 1), x + 2, y + s - 8, 1, '#ffffff');
  }

  private drawHeader(c: CanvasRenderingContext2D, title: string, sub: string): void {
    drawTextSh(c, title, VW / 2, 8, 2, GOLD, 'center', GOLD_DK);
    if (sub) drawText(c, sub, VW / 2, 26, 1, GRAY, 'center');
  }

  // ---------- THE BOARD ----------
  private drawBoard(c: CanvasRenderingContext2D, frame: number): void {
    // v10.1: no-overlap vertical rhythm — title block (10..24), subtitle (30),
    // LIVE feed on its OWN dedicated strip (44..55), cards start at y=60
    drawTextSh(c, 'THE PIT', VW / 2, 10, 2, GOLD, 'center', GOLD_DK);
    drawText(c, 'THE STAKING PIT', VW / 2, 30, 1, DIM, 'center');
    // v11: testnet mode tag + wallet connect (real Pera, chainId 416002)
    if (arenaMode() === 'testnet') {
      drawTextSh(c, 'TESTNET', 10, 4, 1, FLUO, 'left', '#0a3d00');
      const addr = arenaAddress();
      const isAnon = addr.startsWith('ANON') || addr.startsWith('DEGEN');
      if (this.walletMsgT > 0 && this.walletMsg) {
        drawText(c, this.walletMsg, VW - 10, 4, 1, FLUO, 'right');
      } else if (isAnon) {
        this.btn(c, frame, { id: 'wallet', x: VW - 96, y: 2, w: 88, h: 12 }, 'CONNECT', { green: true });
      } else {
        drawText(c, addr.slice(0, 6) + '..' + addr.slice(-4), VW - 10, 4, 1, GOLD, 'right');
      }
    }
    c.fillStyle = '#04140a';
    c.fillRect(4, 44, VW - 8, 11);
    const line = this.feedLines.length > 0 ? this.feedLines[0] : 'THE PIT IS LISTENING';
    drawText(c, 'LIVE> ' + line, 10, 46, 1, FLUO);

    // v13: MY OPEN CARDS — compact chips strip under the feed (mobile-first:
    // zero extra screens, thumb-reachable, private cards included)
    // v14.2: render ALL of my cards — the strip wraps to a second row before
    // it ever overflows the header; only a true overflow (2 full rows) falls
    // back to a +N counter.
    let TOP = 60;
    if (this.mine.length > 0) {
      drawText(c, 'MY OPEN CARDS:', 10, 58, 1, GOLD);
      let cx = 10 + textWidth('MY OPEN CARDS:', 1) + 8;
      let cy = 56;
      let shown = 0;
      for (let mi = 0; mi < this.mine.length; mi++) {
        const mc = this.mine[mi];
        const label = '#' + mc.id + (mc.visibility === 'private' ? '*' : '');
        const cw = textWidth(label, 1) + 10;
        if (cx + cw > VW - 8) {
          if (cy !== 56) break; // second row full too — +N counter below
          cx = 10; // wrap to the second chip row
          cy = 72;
        }
        this.btn(c, frame, { id: 'card:' + mc.id, x: cx, y: cy, w: cw, h: 12 }, label, { small: true, gold: true });
        cx += cw + 6;
        shown++;
      }
      if (shown < this.mine.length) drawText(c, '+' + (this.mine.length - shown), cx, cy + 2, 1, DIM);
      TOP = cy === 72 ? 92 : 76;
    }
    const ROW_H = 44;
    const me = arenaAddress();
    const rows = this.cards;
    if (rows.length === 0) {
      drawTextSh(c, 'NO LIVE CARDS - POST THE FIRST ONE', VW / 2, 100, 1, GRAY, 'center');
    }
    // v10.3: paginated — 3 cards per page (2 when MY OPEN CARDS eats a row)
    const pageSize = this.mine.length > 0 ? 2 : 3;
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    this.page = clamp(this.page, 0, pages - 1);
    for (let i = 0; i < pageSize; i++) {
      const ri = this.page * pageSize + i;
      const card = rows[ri];
      if (!card) break;
      const y = TOP + i * ROW_H;
      const mine = me !== null && card.players.some((p) => p.address === me);
      const live = card.status === 'open' || card.status === 'full';
      const freeSeats = card.seatsTotal - card.players.length;
      const msLeft = card.deadline - Date.now();
      const claimable = mine && card.status === 'expired';
      // row panel
      c.fillStyle = mine ? '#101a10' : PANEL;
      c.fillRect(8, y, VW - 16 - 22, ROW_H - 4);
      c.strokeStyle = mine ? '#2e5a26' : '#232838';
      c.lineWidth = 1;
      c.strokeRect(8.5, y + 0.5, VW - 16 - 23, ROW_H - 5);
      // coin pile proportional to the stake
      this.coinPile(c, 14, y + 30, card.stake, frame + i * 7);
      const tx = 44;
      const fmt = card.format === 'duel' ? 'DUEL' : 'OPEN TABLE';
      drawText(c, fmtStake(card.stake) + ' ' + fmt + (card.visibility === 'private' ? ' (PRIVATE)' : ''), tx, y + 4, 1, GOLD);
      const seatLine = card.players.length + '/' + card.seatsTotal + ' SEATS - ' + fmtCountdown(card.deadline) + ' LEFT';
      drawText(c, seatLine, tx, y + 14, 1, live ? GREEN : GRAY);
      // v10.3: status gets a DEDICATED right slot; the BY line truncates
      // before it (no more BY YOU_DEGEN / EXPIRED pileups)
      const statusTxt = live ? '' : card.status.toUpperCase();
      const statusX = claimable ? VW - 102 : VW - 40;
      const maxChars = Math.max(8, Math.floor(((statusTxt ? statusX - textWidth(statusTxt, 1) - 10 : VW - 40) - tx) / 6));
      const stage = card.stageMode === 'full' ? 'FULL RUN' : 'STAGE ' + (card.stageIdx !== null ? card.stageIdx + 1 : '?') + ' ' + STAGE_NAMES[card.stageIdx ?? 0];
      const byLine = stage + ' - BY ' + card.creatorName;
      drawText(c, byLine.length > maxChars ? byLine.slice(0, maxChars) : byLine, tx, y + 24, 1, DIM);
      if (statusTxt) {
        drawText(c, statusTxt, statusX, y + 24, 1, statusTxt === 'CLAIMED' ? GOLD : RED, 'right');
      }
      // badges (top-right of the row)
      let bx = VW - 32;
      if (card.creatorType === 'falcon') {
        this.quantumSeal(c, bx - 12, y + 3, frame);
        bx -= 16;
      }
      if (live && freeSeats <= 2 && freeSeats > 0) {
        if ((frame & 16) !== 0) drawText(c, 'FILLING FAST', bx - textWidth('FILLING FAST', 1), y + 6, 1, RED);
        bx -= textWidth('FILLING FAST', 1) + 8;
      }
      if (live && msLeft < 3600_000) {
        drawText(c, 'CLOSING SOON', bx - textWidth('CLOSING SOON', 1), y + 6, 1, '#ff8a3c');
      }
      // whole row opens the VERSUS detail; CLAIM is pushed AFTER it so the
      // smaller gold button wins the tap (tap() matches in reverse order)
      this.hots.push({ id: 'card:' + card.id, x: 8, y, w: VW - 16 - 22, h: ROW_H - 4 });
      if (claimable) {
        this.btn(c, frame, { id: 'claim:' + card.id, x: VW - 96, y: y + 22, w: 60, h: 14 }, 'CLAIM', { gold: true });
      }
    }
    // v10.3: page keys on the right rail + PAGE indicator
    // v14.2: the NEXT key rides the LAST card row (pageSize, not a hardcoded
    // 3) — with MY OPEN CARDS up, 3 rows would put it ON the BACK button
    // (the stray white-bordered box the Prince screenshotted).
    if (this.page > 0) this.btn(c, frame, { id: 'page:prev', x: VW - 26, y: TOP, w: 18, h: 14 }, '<', { small: true });
    if (this.page < pages - 1) this.btn(c, frame, { id: 'page:next', x: VW - 26, y: TOP + pageSize * ROW_H - 14, w: 18, h: 14 }, '>', { small: true });
    if (pages > 1) drawText(c, 'PAGE ' + (this.page + 1) + '/' + pages, VW - 104, 190, 1, DIM, 'right');
    // footer: CREATE CARD / HISTORY / MY LEGACY / BACK
    this.btn(c, frame, { id: 'create', x: 8, y: 198, w: 100, h: 14 }, 'CREATE CARD', { gold: true });
    this.btn(c, frame, { id: 'history', x: 116, y: 198, w: 80, h: 14 }, 'HISTORY');
    this.btn(c, frame, { id: 'legacy', x: 204, y: 198, w: 80, h: 14 }, 'MY LEGACY');
    this.btn(c, frame, { id: 'back', x: 292, y: 198, w: 78, h: 14 }, 'BACK');
  }

  // ---------- CREATE CARD ----------
  private drawCreate(c: CanvasRenderingContext2D, frame: number, art: Art): void {
    this.drawHeader(c, 'CREATE CARD', 'STEP: ' + this.stepLabel());
    if (this.step === 'visibility') this.stepVisibility(c, frame);
    else if (this.step === 'format') this.stepFormat(c, frame);
    else if (this.step === 'battle') this.stepBattle(c, frame, art);
    else if (this.step === 'stake') this.stepStake(c, frame);
    else if (this.step === 'fighter') this.stepFighter(c);
    else this.stepConfirm(c, frame);
    this.btn(c, frame, { id: 'back', x: 8, y: 198, w: 70, h: 14 }, 'BACK');
  }

  private stepLabel(): string {
    switch (this.step) {
      case 'visibility': return 'WHO SEES IT';
      case 'format': return 'THE RULES';
      case 'battle': return 'THE BATTLE';
      case 'stake': return 'THE STAKE';
      case 'fighter': return 'YOUR FIGHTER';
      case 'confirm': return 'SIGN IT';
    }
  }

  private stepVisibility(c: CanvasRenderingContext2D, frame: number): void {
    drawText(c, 'VISIBILITY', VW / 2, 48, 1, GRAY, 'center');
    this.btn(c, frame, { id: 'vis:public', x: 52, y: 66, w: 280, h: 28 }, 'PUBLIC - THE PIT', { green: true });
    drawText(c, 'EVERY DEGEN SEES IT ON THE SQUARE', VW / 2, 98, 1, DIM, 'center');
    this.btn(c, frame, { id: 'vis:private', x: 52, y: 116, w: 280, h: 28 }, 'PRIVATE - LINK ONLY', { gold: true });
    drawText(c, 'SEALED. ONLY WHO HOLDS THE LINK', VW / 2, 148, 1, DIM, 'center');
  }

  private stepFormat(c: CanvasRenderingContext2D, frame: number): void {
    drawText(c, 'FORMAT', VW / 2, 42, 1, GRAY, 'center');
    this.btn(c, frame, { id: 'fmt:duel', x: 42, y: 54, w: 300, h: 22 }, 'DUEL - FIRST WALLET TAKES ALL', { gold: this.cfg.format === 'duel' });
    this.btn(c, frame, { id: 'fmt:open', x: 42, y: 80, w: 300, h: 22 }, 'OPEN TABLE - UP TO 12 DEGENS', { gold: this.cfg.format === 'open' });
    if (this.cfg.format === 'open') {
      drawText(c, 'SEATS', 42, 112, 1, GRAY);
      for (let i = 0; i < SEAT_OPTS.length; i++) {
        const s = SEAT_OPTS[i];
        this.btn(c, frame, { id: 'seats:' + s, x: 100 + i * 76, y: 108, w: 64, h: 18 }, String(s), { gold: this.cfg.seatsTotal === s, dim: this.cfg.seatsTotal !== s });
      }
      drawText(c, 'DURATION', 42, 138, 1, GRAY);
      for (let i = 0; i < DUR_OPTS.length; i++) {
        const d = DUR_OPTS[i];
        this.btn(c, frame, { id: 'dur:' + d.secs, x: 100 + i * 76, y: 134, w: 64, h: 18 }, d.label, { gold: this.cfg.durationSecs === d.secs, dim: this.cfg.durationSecs !== d.secs });
      }
      this.btn(c, frame, { id: 'fmt:next', x: 122, y: 162, w: 140, h: 18 }, 'NEXT', { green: true });
    }
  }

  private stepBattle(c: CanvasRenderingContext2D, frame: number, art: Art): void {
    drawText(c, 'BATTLE', VW / 2, 40, 1, GRAY, 'center');
    this.btn(c, frame, { id: 'bat:full', x: 42, y: 50, w: 300, h: 20 }, 'FULL RUN - ALL 7 STAGES', { gold: this.cfg.stageMode === 'full' });
    this.btn(c, frame, { id: 'bat:single', x: 42, y: 74, w: 300, h: 20 }, 'SINGLE STAGE - PICK YOUR GROUND', { gold: this.cfg.stageMode === 'single' });
    this.btn(c, frame, { id: 'bat:random', x: 42, y: 98, w: 300, h: 20 }, 'RANDOM - TRUST THE SHUFFLE', { gold: this.cfg.stageMode === 'random' });
    if (this.cfg.stageMode === 'single') {
      for (let i = 0; i < 7; i++) {
        const x = 66 + (i % 4) * 64;
        const y = 126 + Math.floor(i / 4) * 40;
        const r = { id: 'bat:stage:' + i, x, y, w: 32, h: 32 };
        const lit = this.hots.length === this.focus;
        this.hots.push(r);
        this.stageIcon(c, art, i, x, y, 32);
        if (lit) {
          c.strokeStyle = '#ffffff';
          c.strokeRect(x - 1.5, y - 1.5, 35, 35);
        }
      }
      return;
    }
    if (this.cfg.stageMode === 'random' && this.shuffleT >= 0) this.drawShuffle(c, frame, art);
  }

  // slot-machine SHUFFLE: 3 reels brake onto the drawn stage (staggered stops)
  private drawShuffle(c: CanvasRenderingContext2D, frame: number, art: Art): void {
    const t = this.shuffleT;
    const stops = [70, 100, 130];
    for (let r = 0; r < 3; r++) {
      const x = 122 + r * 50;
      const y = 128;
      const stopped = t >= stops[r];
      const idx = stopped ? this.shuffleTarget : Math.floor(t / 3 + r * 2) % 7;
      this.stageIcon(c, art, idx, x, y, 40);
      c.strokeStyle = stopped ? ((frame & 8) !== 0 ? GOLD : '#fff3c4') : '#3a3f4c';
      c.lineWidth = 1;
      c.strokeRect(x - 1.5, y - 1.5, 43, 43);
      if (stopped) this.pixelCoin(c, x + 17, y - 8, frame + r * 5); // gold sparkle on lock
    }
    if (t >= 140) {
      this.cfg.stageIdx = this.shuffleTarget;
      drawTextSh(c, 'LOCKED: ' + STAGE_NAMES[this.shuffleTarget], VW / 2, 176, 1, GOLD, 'center');
      this.btn(c, frame, { id: 'bat:next', x: 122, y: 192, w: 140, h: 16 }, 'NEXT', { green: true });
    } else if ((frame & 8) !== 0) {
      drawText(c, 'SHUFFLING...', VW / 2, 176, 1, FLUO, 'center');
    }
  }

  private stepStake(c: CanvasRenderingContext2D, frame: number): void {
    drawText(c, 'STAKE - $GONNA PER SEAT', VW / 2, 46, 1, GRAY, 'center');
    for (let i = 0; i < STAKE_OPTS.length; i++) {
      const s = STAKE_OPTS[i];
      this.btn(c, frame, { id: 'stake:' + s, x: 22 + i * 120, y: 62, w: 100, h: 24 }, fmtStake(s), { gold: this.cfg.stake === s });
    }
    drawText(c, 'CUSTOM - TAP THE FIELD TO TYPE', VW / 2, 102, 1, GRAY, 'center');
    this.btn(c, frame, { id: 'stake:minus', x: 72, y: 114, w: 44, h: 24 }, '-');
    // the amount field is a LIVE hotspot: tapping it raises the native keyboard
    const fieldLit = this.hots.length === this.focus;
    this.hots.push({ id: 'stake:custom', x: 126, y: 114, w: 132, h: 24 });
    c.fillStyle = PANEL;
    c.fillRect(126, 114, 132, 24);
    c.strokeStyle = this.stakeInput ? ((frame & 8) !== 0 ? FLUO : GOLD) : fieldLit ? '#ffffff' : GOLD_DK;
    c.lineWidth = 1;
    c.strokeRect(126.5, 114.5, 131, 23);
    drawTextSh(c, fmtGonna(this.cfg.stake), VW / 2, 122, 1, GOLD, 'center'); // thousands separators
    if (this.stakeInput) {
      if ((frame & 16) !== 0) drawText(c, '_', VW / 2 + textWidth(fmtGonna(this.cfg.stake), 1) / 2 + 2, 122, 1, FLUO);
    } else {
      drawText(c, 'TAP', 252, 122, 1, DIM, 'right');
    }
    this.placeStakeInput();
    this.btn(c, frame, { id: 'stake:plus', x: 268, y: 114, w: 44, h: 24 }, '+');
    this.coinPile(c, VW / 2 - 12, 156, this.cfg.stake, frame);
    this.btn(c, frame, { id: 'stake:next', x: 122, y: 170, w: 140, h: 18 }, 'NEXT', { green: true });
  }

  private stepFighter(c: CanvasRenderingContext2D): void {
    drawText(c, 'FIGHTER - NFT SKIN IF YOU OWN IT', VW / 2, 44, 1, GRAY, 'center');
    const opts = this.fighterOpts;
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i];
      const x = 22 + (i % 5) * 70;
      const y = 58 + Math.floor(i / 5) * 74;
      const r = { id: 'fighter:' + i, x, y, w: 60, h: 62 };
      const lit = this.hots.length === this.focus;
      this.hots.push(r);
      c.fillStyle = o.owned ? '#101a10' : '#0a0c12';
      c.fillRect(x, y, 60, 62);
      c.strokeStyle = lit ? '#ffffff' : o.owned ? '#2e5a26' : '#232838';
      c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, 59, 61);
      const skin = o.pick.skin as SkinId;
      const info = SKIN_INFO[skin] ?? SKIN_INFO.gonna;
      const port = skinPortrait(skin);
      if (port && o.owned) this.drawFit(c, port, x + 18, y + 4, 24);
      else {
        c.fillStyle = o.owned ? info.accent : '#1a1e28';
        c.fillRect(x + 18, y + 4, 24, 24);
      }
      drawText(c, o.pick.name.slice(0, 9), x + 30, y + 32, 1, o.owned ? '#c8ccd4' : DIM, 'center');
      drawText(c, o.owned ? 'OWNED' : 'LOCKED', x + 30, y + 44, 1, o.owned ? GREEN : DIM, 'center');
      if (this.cfg.fighter.assetId === o.pick.assetId && this.cfg.fighter.skin === o.pick.skin) {
        drawCrown(c, x + 24, y - 6);
      }
    }
    if (!wallet.isConnected()) drawText(c, 'MOCK SHELF - CONNECT FOR REAL NFTS', VW / 2, 170, 1, DIM, 'center');
  }

  private stepConfirm(c: CanvasRenderingContext2D, frame: number): void {
    const x = 52;
    const w = 280;
    c.fillStyle = PANEL;
    c.fillRect(x, 42, w, 116);
    c.strokeStyle = (frame & 16) !== 0 ? GOLD : GOLD_DK;
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, 42.5, w - 1, 115);
    // v10.1: no crown here — it crowded the STEP label (clean 8px header gap)
    const lines: [string, string][] = [
      ['CARD', this.cfg.visibility === 'public' ? 'PUBLIC - THE PIT' : 'PRIVATE - LINK ONLY'],
      ['FORMAT', this.cfg.format === 'duel' ? 'DUEL - TAKES ALL' : 'OPEN ' + this.cfg.seatsTotal + ' SEATS - ' + Math.round(this.cfg.durationSecs / 3600) + 'H'],
      ['BATTLE', this.cfg.stageMode === 'full' ? 'FULL RUN - 7 STAGES' : 'STAGE ' + ((this.cfg.stageIdx ?? 0) + 1) + ' ' + STAGE_NAMES[this.cfg.stageIdx ?? 0]],
      ['STAKE', fmtStake(this.cfg.stake) + ' $GONNA A SEAT'],
      ['FIGHTER', this.cfg.fighter.name],
    ];
    for (let i = 0; i < lines.length; i++) {
      drawText(c, lines[i][0], x + 10, 50 + i * 13, 1, DIM);
      drawText(c, lines[i][1], x + w - 10, 50 + i * 13, 1, i === 3 ? GOLD : '#c8ccd4', 'right');
    }
    // FEE ENGINE: Falcon (PQ) accounts pay the resource-based fee
    const acct = arenaSession().accountType;
    drawTextSh(c, 'NETWORK FEE: ' + feeLine('create', acct, this.adapter().mode === 'testnet'), VW / 2, 120, 1, acct === 'falcon' ? PQCYAN : GRAY, 'center');
    if (acct === 'falcon') {
      drawText(c, 'FALCON ACCOUNT - PQ SIGNATURE PRICING', VW / 2, 132, 1, DIM, 'center');
      this.quantumSeal(c, x + 10, 120, frame);
    }
    if (this.rematchOf !== null) drawText(c, 'REMATCH OF CARD #' + this.rematchOf, VW / 2, 144, 1, '#ff8a3c', 'center');
    // testnet oracle status — the master link (#oracle=) arms the dev key
    if (this.adapter().mode === 'testnet') {
      const armed = hasDevOracle();
      drawTextSh(c, armed ? 'ORACLE ARMED - TESTNET DEV KEY' : 'ORACLE OFFLINE - USE THE MASTER LINK', VW / 2, 152, 1, armed ? FLUO : '#ff4444', 'center', armed ? '#0a3d00' : '#2a0505');
    }
    // v11: PLAY -> SEAL -> SIGN. The run comes FIRST — the oracle-sealed
    // score travels inside the atomic create group.
    this.btn(c, frame, { id: 'playrun', x: 92, y: 162, w: 200, h: 22 }, 'PLAY YOUR RUN', { green: true });
    drawText(c, 'YOUR SCORE GETS SEALED - YOU SIGN AFTER', VW / 2, 190, 1, GRAY, 'center');
  }

  // ---------- v11/v12: SEAL screen (post-run, pre-sign) ----------------------
  private drawSeal(c: CanvasRenderingContext2D, frame: number): void {
    const joiner = this.sealRole === 'joiner';
    const ch = this.current;
    const title = joiner ? 'SCORE SEALED' : 'SCORE SEALED';
    this.drawHeader(c, title, joiner && ch ? 'CARD #' + ch.id : this.cfg.format === 'duel' ? 'DUEL - TAKES ALL' : 'OPEN TABLE');
    const score = this.sealBest > 0 ? this.sealBest : (this.sealedScore ?? 0);
    drawTextSh(c, String(score).padStart(7, '0'), VW / 2, 62, 2, GOLD, 'center', '#4a3005');
    if (this.sealRuns >= 2) {
      drawTextSh(c, 'BEST OF 2 - CONTINUE USED', VW / 2, 90, 1, '#ff8a3c', 'center', '#2a1503');
    } else if ((frame & 16) !== 0) {
      drawTextSh(c, 'SCORE SEALED BY ORACLE', VW / 2, 90, 1, FLUO, 'center', '#0a3d00');
    }
    const x = 22, w = VW - 44;
    const stake = joiner && ch ? ch.stake : this.cfg.stake;
    const pot = joiner && ch ? ch.stake * ch.seatsTotal : (this.cfg.format === 'duel' ? this.cfg.stake * 2 : this.cfg.stake * this.cfg.seatsTotal);
    const lines: [string, string][] = [
      ['STAKE', fmtStake(stake) + ' $GONNA A SEAT'],
      ['POT', fmtStake(pot) + ' $GONNA'],
      ['FEE', feeLine(joiner ? 'submit' : 'create', arenaSession().accountType, this.adapter().mode === 'testnet')],
      ['FIGHTER', this.cfg.fighter.name],
    ];
    for (let i = 0; i < lines.length; i++) {
      drawText(c, lines[i][0], x + 10, 104 + i * 12, 1, DIM);
      drawText(c, lines[i][1], x + w - 10, 104 + i * 12, 1, i <= 1 ? GOLD : '#c8ccd4', 'right');
    }
    this.btn(c, frame, { id: 'sign', x: 92, y: 156, w: 200, h: 20 }, this.busy ? 'SIGNING...' : joiner ? 'SIGN SCORE' : 'SIGN & STAKE', { gold: true });
    if (this.sealRuns < 2) {
      this.btn(c, frame, { id: 'continue', x: 92, y: 180, w: 200, h: 14 }, this.continuePaying ? 'PAYING 5 ALGO...' : 'CONTINUE - 5 ALGO - BEST OF 2', { green: true });
    }
    this.btn(c, frame, { id: 'seal:discard', x: 122, y: 200, w: 140, h: 12 }, 'DISCARD - NO TX SENT', { dim: true });
  }

  // v10.4: aspect-preserving blit — a sprite inside a seal is FIT, never squashed
  private drawFit(c: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, box: number): void {
    const iw = (img as HTMLCanvasElement).width || (img as HTMLImageElement).naturalWidth || 0;
    const ih = (img as HTMLCanvasElement).height || (img as HTMLImageElement).naturalHeight || 0;
    if (!iw || !ih) return;
    const s = Math.min(box / iw, box / ih);
    const w = Math.max(1, Math.round(iw * s));
    const h = Math.max(1, Math.round(ih * s));
    c.drawImage(img, Math.round(x + (box - w) / 2), Math.round(y + (box - h) / 2), w, h);
  }

  // ---------- VERSUS (card detail) ----------
  private sealFace(c: CanvasRenderingContext2D, frame: number, x: number, y: number, name: string, skin: string, pq: boolean, lit: boolean): void {
    // pixel seal: double ring, breathing gold for the leader / live card
    const pulse = (frame & 16) !== 0;
    c.strokeStyle = lit ? (pulse ? GOLD : GOLD_DK) : '#3a3f4c';
    c.lineWidth = 2;
    c.strokeRect(x - 21, y - 21, 42, 42);
    c.strokeStyle = lit ? GOLD_DK : '#232838';
    c.lineWidth = 1;
    c.strokeRect(x - 17.5, y - 17.5, 35, 35);
    const info = SKIN_INFO[skin as SkinId] ?? SKIN_INFO.gonna;
    const port = skinPortrait(skin as SkinId) ?? (skin === 'gonna' ? this.framesRef?.get('0_0') ?? null : null);
    if (port) this.drawFit(c, port, x - 14, y - 14, 28);
    else {
      c.fillStyle = info.accent;
      c.fillRect(x - 14, y - 14, 28, 28);
    }
    if (pq) this.quantumSeal(c, x + 12, y - 26, frame);
    drawText(c, name.slice(0, 12), x, y + 26, 1, lit ? GOLD : GRAY, 'center');
  }

  private drawVersus(c: CanvasRenderingContext2D, frame: number, art: Art): void {
    const card = this.current;
    if (!card) {
      this.screen = 'board';
      return;
    }
    const me = arenaAddress();
    const seated = me !== null && card.players.some((p) => p.address === me);
    const live = card.status === 'open' || card.status === 'full';
    const title = fmtStake(card.stake) + (card.format === 'duel' ? ' DUEL' : ' OPEN TABLE');
    const stage = card.stageMode === 'full' ? 'FULL RUN - ALL 7 STAGES' : 'STAGE ' + ((card.stageIdx ?? 0) + 1) + ' ' + STAGE_NAMES[card.stageIdx ?? 0];
    this.drawHeader(c, title, stage);
    // v10.1: the PRIVATE tag lives bottom-left — never next to the card title
    if (card.visibility === 'private') drawText(c, 'PRIVATE - LINK ONLY', 10, VH - 11, 1, '#b45aff');

    // the two sigilli face to face (first two seats); extra seats queue below
    // v10.1 vertical rhythm: seals 51..93, names 98, scores 110, pot 56..92
    const p0 = card.players[0] ?? null;
    const p1 = card.players[1] ?? null;
    this.sealFace(c, frame, 92, 72, p0 ? p0.name : card.creatorName, p0 ? p0.fighter.skin : 'gonna', (p0?.accountType ?? card.creatorType) === 'falcon', card.winner !== null && card.winner === (p0?.address ?? card.creator));
    if (p1) {
      this.sealFace(c, frame, VW - 92, 72, p1.name, p1.fighter.skin, p1.accountType === 'falcon', card.winner !== null && card.winner === p1.address);
    } else {
      // empty seal: the open seat waits
      c.strokeStyle = '#232838';
      c.lineWidth = 2;
      c.strokeRect(VW - 92 - 21, 72 - 21, 42, 42);
      if ((frame & 32) !== 0) drawText(c, '???', VW - 92, 68, 1, DIM, 'center');
      drawText(c, 'OPEN SEAT', VW - 92, 98, 1, DIM, 'center');
    }
    // scores under the seals once revealed
    if (card.status === 'resolved' || card.status === 'claimed') {
      if (p0) drawText(c, String(p0.score).padStart(6, '0'), 92, 110, 1, '#c8ccd4', 'center');
      if (p1) drawText(c, String(p1.score).padStart(6, '0'), VW - 92, 110, 1, '#c8ccd4', 'center');
    }
    // the pot pulses at the center (gold heartbeat, never white)
    const beat = Math.sin(frame / 9) * 0.5 + 0.5;
    c.strokeStyle = beat > 0.5 ? GOLD : GOLD_DK;
    c.lineWidth = 1;
    const pr = 24 + Math.round(beat * 4);
    c.strokeRect(VW / 2 - pr / 2 - 6 + 0.5, 56 + 0.5, pr + 12, 34);
    this.coinPile(c, VW / 2 - 12, 72, card.stake, frame);
    drawTextSh(c, fmtStake(card.pot), VW / 2, 92, 1, GOLD, 'center');

    // status line (clear of the seals' name row)
    const seatLine = card.players.length + '/' + card.seatsTotal + ' SEATS';
    if (live) drawText(c, seatLine + ' - ' + fmtCountdown(card.deadline) + ' LEFT', VW / 2, 124, 1, GREEN, 'center');
    else drawText(c, card.status.toUpperCase(), VW / 2, 124, 1, card.status === 'claimed' ? GOLD : RED, 'center');
    if (card.players.length > 2) drawText(c, '+' + (card.players.length - 2) + ' MORE DEGENS SEATED', VW / 2, 134, 1, DIM, 'center');

    // ---- action zone ----
    if (this.busy) {
      if ((frame & 8) !== 0) drawTextSh(c, 'SIGNING... CHECK YOUR WALLET', VW / 2, 148, 1, GOLD, 'center');
    } else if (this.verdict && (card.status === 'resolved' || card.status === 'claimed')) {
      this.drawVerdict(c, frame, card);
    } else {
      const acct = arenaSession().accountType;
      const testnet = this.adapter().mode === 'testnet';
      const myEntry = card.players.find((p) => p.address === me) ?? null;
      const joiners = card.players.slice(1);
      const tableFull = card.players.length >= card.seatsTotal;
      const allSigned = card.players.length > 0 && card.players.every((p) => p.score > 0);
      // contract truth: resolve is allowed when (full && all signed) OR
      // (deadline passed && at least one JOINER signed). Never before.
      const joinerSigned = joiners.some((p) => p.score > 0);
      const resolvable = (live && tableFull && allSigned) || (card.status === 'expired' && joinerSigned);
      // mock mirrors it honestly: at least one opponent seated, all played
      const mockResolvable = card.players.length >= 2 && allSigned;
      const canResolve = testnet ? resolvable : mockResolvable;
      // on testnet the creator_score is COMMITTED AT CREATE (seat 0, oracle
      // signed) — the owner never owes a score; only a joiner who has not
      // played yet does.
      const iOweScore = seated && myEntry !== null && myEntry.score === 0;
      let ay = 148;
      if (live && !seated && card.creator === me) {
        // v13 self-join guard: you cannot fight yourself (the contract would
        // reject it anyway — seat 0 is already you)
        drawTextSh(c, 'YOUR CARD, DEGEN', VW / 2, ay + 2, 1, GOLD, 'center', '#4a3005');
        drawText(c, 'SHARE IT OR CLOSE IT', VW / 2, ay + 14, 1, GRAY, 'center');
        ay += 26;
      } else if (live && !seated) {
        drawText(c, 'NETWORK FEE: ' + feeLine('join', acct, testnet), VW / 2, ay, 1, acct === 'falcon' ? PQCYAN : GRAY, 'center');
        ay += 12;
        this.btn(c, frame, { id: 'accept', x: 92, y: ay, w: 200, h: 20 }, 'ACCEPT & STAKE ' + fmtStake(card.stake), { gold: true });
        ay += 24;
      } else if (live && seated && (testnet ? iOweScore : card.players.some((p) => p.score === 0))) {
        drawText(c, 'NETWORK FEE: ' + feeLine('submit', acct, testnet), VW / 2, ay, 1, acct === 'falcon' ? PQCYAN : GRAY, 'center');
        ay += 10;
        this.btn(c, frame, { id: 'submit', x: 92, y: ay, w: 200, h: 18 }, 'SUBMIT SCORE', { green: true });
        ay += 20;
        // v14: seated but NO SCORE SEALED — the refund path must be visible.
        // The contract pays the stake back via claim() once the deadline
        // passes on an unresolved match; until then the button stays locked
        // (drawn dim, no hotspot) with a live countdown on the label.
        if (iOweScore) {
          const dl = new Date(card.deadline).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
          drawText(c, 'NO SCORE SEALED - CLAIMABLE AT ' + dl, VW / 2, ay, 1, '#ff8a3c', 'center');
          ay += 10;
          const claimOpen = Date.now() >= card.deadline;
          this.btn(
            c,
            frame,
            { id: 'vclaim', x: 92, y: ay, w: 200, h: 12 },
            claimOpen ? 'CLAIM STAKE BACK' : 'CLAIM STAKE BACK ' + fmtCountdown(card.deadline),
            claimOpen ? { gold: true } : { disabled: true },
          );
          ay += 16;
        } else {
          ay += 4;
        }
      } else if ((live && seated && canResolve) || (card.status === 'expired' && seated && joinerSigned)) {
        this.btn(c, frame, { id: 'resolve', x: 92, y: ay, w: 200, h: 20 }, 'RESOLVE THE BATTLE', { gold: true });
        ay += 24;
      } else if (live && seated) {
        // committed but nobody can resolve yet — wait it out (or shill it)
        const waitLine = tableFull
          ? 'WAITING FOR SCORES...'
          : card.creator === me
            ? 'YOUR CARD, DEGEN - SHARE IT OR CLOSE IT'
            : 'WAITING FOR A CHALLENGER...';
        if ((frame & 16) !== 0) drawTextSh(c, waitLine, VW / 2, ay + 4, 1, FLUO, 'center', '#0a3d00');
        ay += 18;
      } else if (!testnet && card.status === 'resolved' && card.winner === me) {
        // mock-only: on testnet the pot is paid INSIDE resolve (inner axfer)
        this.btn(c, frame, { id: 'vclaim', x: 92, y: ay, w: 200, h: 20 }, 'CLAIM THE POT', { gold: true });
        ay += 24;
      } else if (card.status === 'expired' && seated) {
        this.btn(c, frame, { id: 'vclaim', x: 92, y: ay, w: 200, h: 20 }, 'CLAIM YOUR STAKE BACK', { gold: true });
        ay += 24;
      }
      // creator emergency brake on an open card
      if (live && card.creator === me) {
        this.btn(c, frame, { id: 'close', x: 122, y: Math.min(ay, 190), w: 140, h: 12 }, 'EARLY CLOSE', { dim: true });
      }
    }
    // v11.1: SHARE — owner only, while live, PUBLIC and PRIVATE alike
    // (the whole point of ?duel= is that anyone can open the card)
    if (card.creator === me && live && !this.verdict) {
      this.btn(c, frame, { id: 'share', x: VW - 86, y: 30, w: 78, h: 12 }, 'SHARE', { gold: true });
    }
    // v14.2: several of MY cards live? Cycle them without leaving the detail
    const mi = this.mine.findIndex((m) => m.id === card.id);
    if (this.mine.length > 1 && mi >= 0) {
      this.btn(c, frame, { id: 'mine:prev', x: 8, y: 198, w: 26, h: 14 }, '<', { small: true });
      this.btn(c, frame, { id: 'mine:next', x: 40, y: 198, w: 26, h: 14 }, '>', { small: true });
      drawText(c, 'MY CARDS ' + (mi + 1) + '/' + this.mine.length, 74, 202, 1, DIM);
    }
    this.btn(c, frame, { id: 'back', x: 292, y: 198, w: 78, h: 14 }, 'BACK');
    void art;
  }

  // ---------- SHARE SHEET (v10.4) ----------
  private drawShare(c: CanvasRenderingContext2D, frame: number): void {
    const ch = this.current;
    this.drawHeader(c, 'SHARE THE CHALLENGE', ch ? fmtStake(ch.stake) + ' ' + (ch.visibility === 'private' ? 'PRIVATE ' : '') + (ch.format === 'duel' ? 'DUEL' : 'TABLE') : '');
    const btns: [string, string][] = [
      ['share:x', 'SHARE ON X'],
      ['share:tg', 'SHARE ON TELEGRAM'],
      ['share:show', 'SHOW CARD'],
      ['share:copy', 'COPY LINK'],
      ['share:save', 'SAVE CARD'],
    ];
    for (let i = 0; i < btns.length; i++) {
      this.btn(c, frame, { id: btns[i][0], x: 52, y: 56 + i * 24, w: 280, h: 20 }, btns[i][1], { gold: i >= 2 });
    }
    if (this.shareMsgT > 0 && this.shareMsg) drawTextSh(c, this.shareMsg, VW / 2, 184, 1, FLUO, 'center');
    else drawText(c, 'PNG 1200X630 - OG COVER QUALITY', VW / 2, 184, 1, DIM, 'center');
    this.btn(c, frame, { id: 'back', x: 292, y: 198, w: 78, h: 14 }, 'BACK');
  }

  // ---------- 404 deep-link (v10.4) ----------
  private drawNotfound(c: CanvasRenderingContext2D, frame: number): void {
    drawTextSh(c, '404', VW / 2, 52, 4, GOLD, 'center', GOLD_DK);
    drawTextSh(c, 'CHALLENGE NOT FOUND', VW / 2, 100, 2, RED, 'center');
    drawText(c, 'THE VOID ATE THIS CARD', VW / 2, 128, 1, GRAY, 'center');
    drawText(c, 'SILVIO DOES NOT REMEMBER THIS DUEL', VW / 2, 140, 1, DIM, 'center');
    if ((frame & 16) !== 0) this.pixelCoin(c, VW / 2 - 3, 156, frame);
    this.btn(c, frame, { id: 'back', x: 92, y: 172, w: 200, h: 18 }, 'BACK TO THE PIT', { gold: true });
  }

  // verdict: black veil + gold coin rain (the rain is drawn over everything
  // in draw()) — loser gets the REMATCH siren in flashing gold
  // v10.1: verdict blocks are stacked BELOW the seals with clean 8px+ gaps —
  // veil 118..194, winner line 126, near-miss 148, REMATCH 164..186 (BACK 198)
  private drawVerdict(c: CanvasRenderingContext2D, frame: number, card: Challenge): void {
    c.fillStyle = 'rgba(5,6,10,0.78)';
    c.fillRect(0, 118, VW, 76);
    const me = arenaAddress();
    const won = card.winner !== null && card.winner === me;
    const wname = card.players.find((p) => p.address === card.winner)?.name ?? '???';
    if (won) {
      drawTextSh(c, 'YOU WON THE POT', VW / 2, 126, 2, GOLD, 'center', GOLD_DK);
      drawTextSh(c, fmtStake(card.pot) + ' $GONNA INCOMING', VW / 2, 148, 1, FLUO, 'center', '#0a3d00');
    } else {
      const myScore = card.players.find((p) => p.address === me)?.score ?? 0;
      const winScore = card.players.find((p) => p.address === card.winner)?.score ?? 0;
      const diff = Math.max(0, winScore - myScore);
      drawTextSh(c, wname + ' TAKES IT', VW / 2, 126, 2, GOLD, 'center', GOLD_DK);
      drawTextSh(c, 'YOU LOST BY ' + diff + ' POINTS - REMATCH?', VW / 2, 148, 1, RED, 'center');
    }
    // REMATCH — flashing gold (frame-blink border, never white)
    const flash = (frame & 8) !== 0;
    const r = { id: 'rematch', x: 112, y: 164, w: 160, h: 22 };
    const lit = this.hots.length === this.focus;
    this.hots.push(r);
    c.fillStyle = flash ? '#241c08' : '#14100a';
    c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeStyle = flash || lit ? GOLD : GOLD_DK;
    c.lineWidth = flash ? 2 : 1;
    c.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    drawTextSh(c, 'REMATCH', r.x + r.w / 2, r.y + 7, 1, flash ? '#fff3c4' : GOLD, 'center');
    // v11: VIEW ON CHAIN — testnet explorer link for the resolve tx
    if (getTxid(card.id)) {
      this.btn(c, frame, { id: 'viewchain', x: VW / 2 - 60, y: 190, w: 120, h: 10 }, 'VIEW ON CHAIN', { green: true });
    }
  }

  // ---------- HISTORY (v10.3) ----------
  private stageLabel(stageMode: string, stageIdx: number | null): string {
    return stageMode === 'full' ? 'FULL RUN' : 'STAGE ' + ((stageIdx ?? 0) + 1) + ' ' + STAGE_NAMES[stageIdx ?? 0];
  }

  // v14: the contract pays INSIDE resolve (winner + 5% treasury fee, one
  // atomic group) — a settled match is a PAID match. UNCLAIMED may only mark
  // genuinely claimable states (mock pots awaiting claim; nothing on-chain).
  private histPaid(h: HistoryEntry): boolean {
    if (h.claimed) return true;
    if (this.adapter().mode === 'testnet') return true;
    return getTxid(h.id) !== null; // local record of the resolve tx
  }

  private drawHistory(c: CanvasRenderingContext2D, frame: number): void {
    this.drawHeader(c, 'HISTORY', 'EVERY BATTLE LEAVES A SCAR');
    const ROW_H = 30;
    const TOP = 40;
    const pages = Math.max(1, Math.ceil(this.hist.length / 5));
    this.histPage = clamp(this.histPage, 0, pages - 1);
    if (this.hist.length === 0) {
      drawTextSh(c, 'NO BATTLES SETTLED YET', VW / 2, 100, 1, GRAY, 'center');
    }
    for (let i = 0; i < 5; i++) {
      const h = this.hist[this.histPage * 5 + i];
      if (!h) break;
      const y = TOP + i * ROW_H;
      c.fillStyle = PANEL;
      c.fillRect(8, y, VW - 16, ROW_H - 4);
      c.strokeStyle = '#232838';
      c.lineWidth = 1;
      c.strokeRect(8.5, y + 0.5, VW - 17, ROW_H - 5);
      this.coinPile(c, 14, y + 16, h.stake, frame + i * 5);
      const takes = splitPot(h.stake, h.pot, h.players.length).takes;
      const head = (h.winnerName + ' TOOK ' + fmtAmount(takes)).slice(0, 34);
      drawText(c, head, 40, y + 4, 1, GOLD);
      if (this.histPaid(h)) drawText(c, 'PAID', VW - 14, y + 4, 1, GOLD, 'right');
      else if ((frame & 16) !== 0) drawText(c, 'UNCLAIMED', VW - 14, y + 4, 1, '#ff8a3c', 'right');
      const sub = (h.format === 'duel' ? 'DUEL' : 'OPEN ' + h.seats) + ' - ' + this.stageLabel(h.stageMode, h.stageIdx) + ' - ' + fmtAgo(h.resolvedAt);
      drawText(c, sub.slice(0, 40), 40, y + 15, 1, DIM);
      // v13: history rows are tappable — tap opens the battle detail
      this.hots.push({ id: 'hist:' + (this.histPage * 5 + i), x: 8, y, w: VW - 16, h: ROW_H - 4 });
    }
    // paging keys (same pattern as the BOARD)
    if (this.histPage > 0) this.btn(c, frame, { id: 'hpage:prev', x: 8, y: 198, w: 34, h: 14 }, '<', { small: true });
    if (this.histPage < pages - 1) this.btn(c, frame, { id: 'hpage:next', x: 50, y: 198, w: 34, h: 14 }, '>', { small: true });
    if (pages > 1) drawText(c, 'PAGE ' + (this.histPage + 1) + '/' + pages, 96, 202, 1, DIM);
    this.btn(c, frame, { id: 'back', x: 292, y: 198, w: 78, h: 14 }, 'BACK');
  }

  // ---------- v13: battle detail (tappable history rows) -------------------
  private drawHistCard(c: CanvasRenderingContext2D, frame: number): void {
    const h = this.histDetail;
    if (!h) { this.screen = 'history'; return; }
    this.drawHeader(c, 'BATTLE #' + h.id, h.format === 'duel' ? 'DUEL - TAKES ALL' : 'OPEN TABLE - ' + h.seats + ' SEATS');
    let y = 44;
    drawTextSh(c, h.winnerName + ' TOOK THE POT', VW / 2, y, 1, GOLD, 'center', '#4a3005');
    y += 12;
    // contenders + scores
    for (const p of h.players.slice(0, 4)) {
      const win = p.address === h.winner;
      drawText(c, (p.name || 'DEGEN').slice(0, 16), 24, y, 1, win ? GOLD : '#c8ccd4');
      drawText(c, String(p.score).padStart(7, '0'), VW - 24, y, 1, win ? GOLD : GRAY, 'right');
      if (win) drawText(c, 'W', VW - 24 - textWidth('0000000', 1) - 10, y, 1, FLUO);
      y += 10;
    }
    y += 4;
    // v14: honest settlement math — pool = stake x seats taken, the contract
    // keeps 5% (treasury fee) inside resolve, the winner takes the rest
    const sp = splitPot(h.stake, h.pot, h.players.length);
    const lines: [string, string][] = [
      ['STAGE', this.stageLabel(h.stageMode, h.stageIdx)],
      ['STAKE', fmtAmount(h.stake) + ' $GONNA A SEAT'],
      ['POT', fmtAmount(sp.pool) + ' $GONNA'],
      ['FEE', fmtAmount(sp.fee) + ' $GONNA (5%)'],
      ['WINNER TAKES', fmtAmount(sp.takes) + ' $GONNA'],
      ['SETTLED', new Date(h.resolvedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
    ];
    for (const [k, v] of lines) {
      drawText(c, k, 24, y, 1, DIM);
      drawText(c, v, VW - 24, y, 1, k === 'WINNER TAKES' ? GOLD : '#c8ccd4', 'right');
      y += 11;
    }
    const paid = this.histPaid(h);
    drawText(c, paid ? 'POT PAID ON-CHAIN' : 'POT STILL UNCLAIMED', VW / 2, y + 2, 1, paid ? GOLD : '#ff8a3c', 'center');
    // VIEW ON CHAIN only when we actually remember the resolve txid
    let txid: string | null = null;
    try {
      txid = (JSON.parse(window.localStorage.getItem('gonna.arena.txids') ?? '{}') as Record<string, string>)[String(h.id)] ?? null;
    } catch { /* no storage */ }
    if (txid) this.btn(c, frame, { id: 'hview', x: 92, y: 180, w: 200, h: 14 }, 'VIEW ON CHAIN', { gold: true });
    this.btn(c, frame, { id: 'back', x: 147, y: 198, w: 90, h: 14 }, 'BACK');
  }

  // ---------- MY LEGACY (v10.3) ----------
  private drawLegacy(c: CanvasRenderingContext2D, frame: number): void {
    this.drawHeader(c, 'MY LEGACY', arenaSession().connected ? arenaSession().label : 'ANON DEGEN - MOCK IDENTITY');
    const s = this.legacy;
    const rows: [string, string, string][] = [
      ['MATCHES PLAYED', s ? String(s.played) : '-', '#c8ccd4'],
      ['WINS', s ? String(s.wins) : '-', GREEN],
      ['LOSSES', s ? String(s.losses) : '-', RED],
      ['OPEN', s ? String(s.open) : '-', '#ff8a3c'],
      ['WIN RATE', s ? s.winRate + '%' : '-', '#c8ccd4'],
      ['$GONNA WON', s ? fmtGonna(s.won) : '-', GOLD],
      ['$GONNA LOST', s ? fmtGonna(s.lost) : '-', RED],
      ['NET', s ? (s.net >= 0 ? '+' : '-') + fmtGonna(Math.abs(s.net)) : '-', s && s.net < 0 ? RED : GREEN],
      ['BEST WIN', s ? fmtGonna(s.bestWin) : '-', GOLD],
    ];
    for (let i = 0; i < rows.length; i++) {
      const y = 42 + i * 14;
      drawText(c, rows[i][0], 70, y, 1, DIM);
      drawText(c, rows[i][1], 314, y, 1, rows[i][2], 'right');
    }
    if (s && s.played === 0) drawText(c, 'NO SCARS YET - POST A CARD', VW / 2, 176, 1, GRAY, 'center');
    drawText(c, 'EVERY WALLET WRITES ITS LEGEND ON-CHAIN', VW / 2, 184, 1, DIM, 'center');
    if (this.legacy && this.legacy.wins > 0 && (frame & 16) !== 0) drawCrown(c, VW / 2 + 62, 8);
    this.btn(c, frame, { id: 'back', x: 292, y: 198, w: 78, h: 14 }, 'BACK');
  }

  // ---------- CI / QA info ----------
  get info(): {
    screen: Screen;
    step: WizardStep;
    busy: boolean;
    err: string;
    page: number;
    pages: number;
    histPage: number;
    cards: { id: number; stake: number; seats: string; status: string; falcon: boolean; visibility: Visibility }[];
    history: { id: number; winner: string; pot: number; claimed: boolean; ago: string }[];
    legacy: LegacyStats | null;
    cfg: ChallengeConfig;
    shuffle: { active: boolean; t: number; target: number };
    current: { id: number; status: string; players: number; winner: string | null; pot: number } | null;
    verdict: boolean;
    coins: number;
    feed: string[];
    hots: { id: string; x: number; y: number; w: number; h: number }[];
  } {
    return {
      screen: this.screen,
      step: this.step,
      busy: this.busy,
      err: this.errT > 0 ? this.err : '',
      page: this.page,
      pages: Math.max(1, Math.ceil(this.cards.length / 3)),
      histPage: this.histPage,
      cards: this.cards.map((c) => ({
        id: c.id,
        stake: c.stake,
        seats: c.players.length + '/' + c.seatsTotal,
        status: c.status,
        falcon: c.creatorType === 'falcon',
        visibility: c.visibility,
      })),
      history: this.hist.map((h) => ({ id: h.id, winner: h.winnerName, pot: h.pot, claimed: h.claimed, ago: fmtAgo(h.resolvedAt) })),
      legacy: this.legacy ? { ...this.legacy } : null,
      cfg: { ...this.cfg },
      shuffle: { active: this.shuffleT >= 0, t: this.shuffleT, target: this.shuffleTarget },
      current: this.current
        ? { id: this.current.id, status: this.current.status, players: this.current.players.length, winner: this.current.winner, pot: this.current.pot }
        : null,
      verdict: this.verdict,
      coins: this.coinRain.length,
      feed: [...this.feedLines],
      hots: this.hots.map((h) => ({ ...h })),
    };
  }
}
