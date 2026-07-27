// v9.2 — THE ARENA: the 3-level global leaderboard. Read-only, on-chain,
// free for all (no wallet needed).
//   L1 BOARD  — TOP WALLETS / TOP GONNAS, $GONNA-branded thousands-separated
//               scores, podium gold/silver/bronze, badges (BYZANTINE CLEAR
//               crown / SPEED DEMON flame / COMBO KING burst), NEW tag <24h,
//               stage names, animated seals counter, MY RANK + green row
//               highlight, SORTABLE COLUMNS (tap headers / mobile dropdown)
//   L2 CARD   — tap a row: PLAYER CARD (by wallet) / FIGHTER CARD (by NFT):
//               career totals + full match history
//   L3 RUN    — tap a history row: RUN CARD with the full seal, big sprite,
//               message, allo.info link + the viral share buttons
import { drawText, drawTextSh, textWidth } from './font';
import { drawCrown, mosaicBorder } from './screens';
import { VH, VW, clamp } from './types';
import type { Input } from './input';
import * as wallet from './wallet';
import * as board from './board';
import type { BoardEntry, BoardTab, SortCol } from './board';
import { SKIN_INFO, skinForAsset, skinPortrait } from './skins';
import { drawCheck, drawIconTG, drawIconX, shareCheckRect, shareIconRect } from './shareicons';
import { SHARE_GUIDE } from './share';

const FLUO = '#39FF14';
const PODIUM = ['#f5c542', '#c8ccd4', '#cd7f32']; // gold / silver / bronze
const HIST_VISIBLE = 5;

export type BoardLevel = 'board' | 'player' | 'fighter' | 'run';
export type ShareWhich = 'x' | 'tg';

export type BoardAction =
  | { act: 'none' }
  | { act: 'move' }
  | { act: 'title' }
  | { act: 'viewcard' }
  | { act: 'viewtx'; txid: string }
  | { act: 'share'; which: ShareWhich };

interface Hot {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
}

const ROW_H = 24;
const LIST_TOP = 60;
const VISIBLE = 5;
const LIST_H = VISIBLE * ROW_H;
const ROW_X = 8;
const ROW_W = VW - 16 - 24; // right column reserved for the scroll arrows
const TAB_WALLETS = { x: 30, y: 28, w: 150, h: 15 };
const TAB_GONNAS = { x: 204, y: 28, w: 150, h: 15 };
const HDR_Y = 46;
// v9.2.3: footer buttons moved up to y=198 so the hint line (7px at VH-12)
// sits fully INSIDE the mosaic border (bottom band VH-4) without touching
// the button row: buttons 198..212, hint 212..219, border 220..224.
const BTN_REFRESH = { x: 14, y: 198, w: 70, h: 14 };
const BTN_MYRANK = { x: 96, y: 198, w: 92, h: 14 };
const BTN_BACK = { x: 292, y: 198, w: 78, h: 14 };
const BTN_UP = { x: VW - 28, y: LIST_TOP, w: 20, h: 16 };
const BTN_DOWN = { x: VW - 28, y: LIST_TOP + LIST_H - 16, w: 20, h: 16 };

// sortable column header strip (desktop); mobile gets the SORT BY dropdown
const COL_DEFS: { col: SortCol; label: string; x: number; w: number }[] = [
  { col: 'score', label: '$GONNA', x: 8, w: 56 },
  { col: 'stage', label: 'STAGE', x: 70, w: 50 },
  { col: 'time', label: 'TIME', x: 126, w: 44 },
  { col: 'deaths', label: 'DEATHS', x: 176, w: 56 },
  { col: 'continues', label: 'C', x: 238, w: 26 },
  { col: 'combo', label: 'COMBO', x: 270, w: 52 },
];
const SORT_DD_BTN = { x: 8, y: HDR_Y - 2, w: 130, h: 13 };
// exported for the v9.2.1 DOM share-anchor overlay (engine syncs anchors to
// these exact rects while a RUN CARD is open)
// v9.2.3: VIEW CARD joins the bottom row (step 1 of the 2-step guide — the
// inline preview is gone, the fullscreen viewer covers nothing until asked);
// 20px-tall buttons so the 18px fluo icons breathe
// v9.2.4: the generic navigator.share SHARE button is GONE (redundant next to
// VIEW CARD + the direct X/TG anchors, dead on many browsers) — the bottom row
// rebalances to 3 even 100px buttons (30/142/254, 12px gaps, span 30..354)
export const SHARE_BTNS = [
  { id: 'share:x', label: 'SHARE ON X', x: 30, y: 172, w: 150, h: 20, icon: 'x' as const },
  { id: 'share:tg', label: 'SHARE ON TELEGRAM', x: 204, y: 172, w: 150, h: 20, icon: 'tg' as const },
  { id: 'viewcard', label: 'VIEW CARD', x: 30, y: 196, w: 100, h: 20, icon: null },
  { id: 'viewtx', label: 'VIEW TX', x: 142, y: 196, w: 100, h: 20, icon: null },
  { id: 'back', label: 'BACK', x: 254, y: 196, w: 100, h: 20, icon: null },
];

export interface ShareState {
  postedX: boolean;
  postedTG: boolean;
}

export class BoardUI {
  private tab: BoardTab = 'wallets';
  private level: BoardLevel = 'board';
  private sort: { col: SortCol; dir: 1 | -1 } = { col: 'score', dir: -1 };
  private sortOpen = false; // mobile SORT BY dropdown
  private first = 0;
  private cursor = 0; // keyboard row cursor (absolute row index)
  private hots: Hot[] = [];
  private dragAcc = 0;
  private shownSeals = 0; // animated total-seals counter
  // L2/L3 selection
  private cardKey: string | number | null = null;
  private histFirst = 0;
  private histCursor = 0;
  private runEntry: BoardEntry | null = null;
  private myRankFlash = 0;
  // v9.2.3: live footer bboxes (CI no-overlap proof — the seals info used to
  // invade the BACK box and the hint line was clipped by the mosaic border)
  private sealsRect: { x: number; y: number; w: number; h: number } | null = null;
  private hintRect: { x: number; y: number; w: number; h: number } | null = null;
  // engine injects the live share state while a RUN CARD is open
  shareState: (() => ShareState | null) | null = null;

  open(): void {
    this.level = 'board';
    this.first = 0;
    this.cursor = 0;
    this.sortOpen = false;
    this.runEntry = null;
    this.cardKey = null;
    this.shownSeals = 0;
    void board.fetchBoard(false);
  }

  private refresh(): void {
    this.shownSeals = 0;
    void board.fetchBoard(true);
  }

  get currentTab(): BoardTab {
    return this.tab;
  }
  get currentLevel(): BoardLevel {
    return this.level;
  }
  get currentRun(): BoardEntry | null {
    return this.runEntry;
  }

  private rows(): BoardEntry[] {
    return board.ranked(this.tab, this.sort);
  }

  private maxFirst(): number {
    return Math.max(0, this.rows().length - VISIBLE);
  }

  // identity label + color kind for a row's primary slot
  // (draw truncates to 13px-chars; the CI info hook asks for the full label)
  private primary(e: BoardEntry, max = 13): { label: string; kind: 'seg-active' | 'seg-inactive' | 'addr' | 'nft' } {
    if (this.tab === 'gonnas') {
      const hit = skinForAsset(e.assetId);
      return { label: wallet.truncatePixel(hit ? hit.name.trim() : 'ASA ' + e.assetId, max), kind: 'nft' };
    }
    return this.walletLabel(e.sender, max);
  }

  private walletLabel(addr: string, max = 20): { label: string; kind: 'seg-active' | 'seg-inactive' | 'addr' } {
    const seg = wallet.cachedSegment(addr);
    if (seg) return { label: wallet.truncatePixel(seg.name, max), kind: seg.active ? 'seg-active' : 'seg-inactive' };
    return { label: addr.slice(0, 5) + '...' + addr.slice(-4), kind: 'addr' };
  }

  // kick async NFD resolution for the visible rows (rows redraw every frame)
  private warmSegs(rows: BoardEntry[]): void {
    for (const e of rows) {
      if (wallet.cachedSegment(e.sender) === undefined) {
        void wallet.segmentFor(e.sender).catch(() => { /* cosmetic */ });
      }
    }
  }

  // ---------- L2/L3 navigation ----------
  private openCard(e: BoardEntry): void {
    if (this.tab === 'gonnas') {
      this.level = 'fighter';
      this.cardKey = e.assetId;
    } else {
      this.level = 'player';
      this.cardKey = e.sender;
    }
    this.histFirst = 0;
    this.histCursor = 0;
    this.sortOpen = false;
  }

  private cardEntries(): BoardEntry[] {
    if (typeof this.cardKey === 'string') return board.sealsBySender(this.cardKey);
    if (typeof this.cardKey === 'number') return board.sealsByAsset(this.cardKey);
    return [];
  }

  private openRun(e: BoardEntry): void {
    this.level = 'run';
    this.runEntry = e;
  }

  private back(): 'title' | 'move' {
    if (this.level === 'run') {
      this.level = typeof this.cardKey === 'number' ? 'fighter' : 'player';
      this.runEntry = null;
      return 'move';
    }
    if (this.level === 'player' || this.level === 'fighter') {
      this.level = 'board';
      this.cardKey = null;
      return 'move';
    }
    return 'title';
  }

  // MY RANK: jump the wallets arena to the connected wallet's row
  private jumpMyRank(): void {
    const w = wallet.getWallet();
    if (!w.address) return;
    this.tab = 'wallets';
    const rows = this.rows();
    const i = rows.findIndex((e) => e.sender === w.address);
    if (i >= 0) {
      this.cursor = i;
      this.first = clamp(i - 2, 0, this.maxFirst());
      this.myRankFlash = 90;
    }
  }

  key(inp: Input): BoardAction {
    if (inp.pressed.pause || inp.pressed.fighter) {
      const b = this.back();
      return { act: b === 'title' ? 'title' : 'move' };
    }
    if (this.level === 'run') return { act: 'none' };
    if (this.level === 'player' || this.level === 'fighter') {
      const hist = this.cardEntries();
      if (inp.pressed.up) {
        this.histCursor = Math.max(0, this.histCursor - 1);
        if (this.histCursor < this.histFirst) this.histFirst = this.histCursor;
        return { act: 'move' };
      }
      if (inp.pressed.down) {
        this.histCursor = Math.min(Math.max(0, hist.length - 1), this.histCursor + 1);
        if (this.histCursor >= this.histFirst + HIST_VISIBLE) this.histFirst = this.histCursor - HIST_VISIBLE + 1;
        return { act: 'move' };
      }
      if (inp.pressed.start && hist[this.histCursor]) {
        this.openRun(hist[this.histCursor]);
        return { act: 'move' };
      }
      return { act: 'none' };
    }
    // L1 board
    if (this.sortOpen) {
      if (inp.pressed.start) {
        this.sortOpen = false;
        return { act: 'move' };
      }
      return { act: 'none' };
    }
    if (inp.pressed.left || inp.pressed.right) {
      this.tab = this.tab === 'wallets' ? 'gonnas' : 'wallets';
      this.first = 0;
      this.cursor = 0;
      return { act: 'move' };
    }
    if (inp.pressed.up) {
      this.cursor = Math.max(0, this.cursor - 1);
      if (this.cursor < this.first) this.first = this.cursor;
      return { act: 'move' };
    }
    if (inp.pressed.down) {
      const n = this.rows().length;
      this.cursor = Math.min(Math.max(0, n - 1), this.cursor + 1);
      if (this.cursor >= this.first + VISIBLE) this.first = Math.min(this.maxFirst(), this.cursor - VISIBLE + 1);
      return { act: 'move' };
    }
    if (inp.pressed.start) {
      const e = this.rows()[this.cursor];
      if (e) {
        this.openCard(e);
        return { act: 'move' };
      }
      return { act: 'none' };
    }
    if (inp.pressedCodes.has('KeyR')) {
      this.refresh();
      return { act: 'move' };
    }
    if (inp.pressedCodes.has('KeyM')) {
      this.jumpMyRank();
      return { act: 'move' };
    }
    return { act: 'none' };
  }

  tap(gx: number, gy: number): BoardAction {
    for (const h of this.hots) {
      if (!(gx >= h.x && gx <= h.x + h.w && gy >= h.y && gy <= h.y + h.h)) continue;
      const id = h.id;
      if (id === 'tab:wallets' && this.tab !== 'wallets') {
        this.tab = 'wallets';
        this.first = 0;
        this.cursor = 0;
        return { act: 'move' };
      }
      if (id === 'tab:gonnas' && this.tab !== 'gonnas') {
        this.tab = 'gonnas';
        this.first = 0;
        this.cursor = 0;
        return { act: 'move' };
      }
      if (id === 'refresh') {
        this.refresh();
        return { act: 'move' };
      }
      if (id === 'myrank') {
        this.jumpMyRank();
        return { act: 'move' };
      }
      if (id === 'back' || id === 'cardback') return { act: this.back() === 'title' ? 'title' : 'move' };
      if (id === 'up') {
        this.first = Math.max(0, this.first - 1);
        this.cursor = Math.max(0, this.cursor - 1);
        return { act: 'move' };
      }
      if (id === 'down') {
        this.first = Math.min(this.maxFirst(), this.first + 1);
        this.cursor = Math.min(Math.max(0, this.rows().length - 1), this.cursor + 1);
        return { act: 'move' };
      }
      if (id === 'sortbtn') {
        this.sortOpen = !this.sortOpen;
        return { act: 'move' };
      }
      if (id.startsWith('sort:')) {
        const col = id.slice(5) as SortCol;
        this.sort = { col, dir: this.sort.col === col ? (this.sort.dir === -1 ? 1 : -1) : -1 };
        if (this.sortOpen) this.sortOpen = false;
        this.first = 0;
        this.cursor = 0;
        return { act: 'move' };
      }
      if (id.startsWith('row:')) {
        const e = this.rows()[Number(id.slice(4))];
        if (e) this.openCard(e);
        return { act: 'move' };
      }
      if (id.startsWith('hist:')) {
        const e = this.cardEntries()[Number(id.slice(5))];
        if (e) this.openRun(e);
        return { act: 'move' };
      }
      if (id === 'viewcard' && this.runEntry) return { act: 'viewcard' };
      if (id === 'viewtx' && this.runEntry) return { act: 'viewtx', txid: this.runEntry.txid };
      if (id === 'share:x') return { act: 'share', which: 'x' };
      if (id === 'share:tg') return { act: 'share', which: 'tg' };
      return { act: 'none' };
    }
    return { act: 'none' };
  }

  // swipe scroll: dy in GAME px (positive = finger moved down = list up)
  dragBy(dy: number): void {
    this.dragAcc += dy;
    const step = this.level === 'board' ? ROW_H / 2 : 8;
    while (this.dragAcc >= step) {
      this.dragAcc -= step;
      if (this.level === 'board') this.first = Math.max(0, this.first - 1);
      else this.histFirst = Math.max(0, this.histFirst - 1);
    }
    while (this.dragAcc <= -step) {
      this.dragAcc += step;
      if (this.level === 'board') this.first = Math.min(this.maxFirst(), this.first + 1);
      else this.histFirst = Math.min(Math.max(0, this.cardEntries().length - HIST_VISIBLE), this.histFirst + 1);
    }
  }

  // ---- CI introspection (__gonna.boardInfo) ----
  get info(): {
    tab: BoardTab;
    level: BoardLevel;
    status: string;
    count: number;
    shown: number;
    fromCache: boolean;
    sort: { col: SortCol; dir: 1 | -1 };
    sortOpen: boolean;
    cursor: number;
    myRank: number;
    badges: { speed: string | number | null; combo: string | number | null };
    top: {
      rank: number;
      key: string | number;
      label: string;
      labelKind: string;
      score: number;
      scoreFmt: string;
      stage: number;
      stageName: string;
      timeSec: number | null;
      deaths: number | null;
      maxCombo: number | null;
      continues: number;
      win: number;
      v: 1 | 2;
      crown: boolean;
      speedDemon: boolean;
      comboKing: boolean;
      isNew: boolean;
      mine: boolean;
      skin: string;
      msg: string;
      txid: string;
    }[];
    footer: {
      // v9.2.3: live bboxes — the seals info must never touch a button box and
      // the hint line must sit fully inside the mosaic border (VH-4 band)
      seals: { x: number; y: number; w: number; h: number } | null;
      hint: { x: number; y: number; w: number; h: number } | null;
      back: { x: number; y: number; w: number; h: number };
      refresh: { x: number; y: number; w: number; h: number };
      myrank: { x: number; y: number; w: number; h: number } | null;
    };
    card: {
      kind: 'player' | 'fighter';
      key: string | number;
      label: string;
      owner: string | null;
      career: board.CareerCard;
      history: { score: number; stage: number; win: number; round: number; txid: string; msg: string }[];
    } | null;
    run: {
      score: number;
      stage: number;
      stageName: string;
      win: number;
      continues: number;
      timeSec: number | null;
      deaths: number | null;
      maxCombo: number | null;
      assetId: number;
      skin: string;
      msg: string;
      txid: string;
      sender: string;
      v: 1 | 2;
    } | null;
    // v9.2.4: live RUN CARD bottom-row bboxes (CI: even widths, no
    // gaps/overlaps after the generic SHARE button was removed)
    runBtns: { id: string; label: string; x: number; y: number; w: number; h: number }[];
  } {
    const st = board.boardState();
    const rows = this.rows();
    const badges = board.badgeKeys(this.tab);
    const me = wallet.getWallet().address;
    let card: {
      kind: 'player' | 'fighter';
      key: string | number;
      label: string;
      owner: string | null;
      career: board.CareerCard;
      history: { score: number; stage: number; win: number; round: number; txid: string; msg: string }[];
    } | null = null;
    if ((this.level === 'player' || this.level === 'fighter' || this.level === 'run') && this.cardKey !== null) {
      const entries = this.cardEntries();
      const isF = typeof this.cardKey === 'number';
      const nft = isF && typeof this.cardKey === 'number' ? skinForAsset(this.cardKey) : null;
      card = {
        kind: isF ? 'fighter' : 'player',
        key: this.cardKey,
        label: isF ? (nft ? nft.name.trim() : 'ASA ' + this.cardKey) : this.walletLabel(String(this.cardKey), 24).label,
        owner: isF && typeof this.cardKey === 'number' ? board.currentOwner(this.cardKey) : null,
        career: board.careerOf(entries),
        history: entries.map((e) => ({ score: e.score, stage: e.stage, win: e.win, round: e.round, txid: e.txid, msg: e.msg })),
      };
    }
    return {
      tab: this.tab,
      level: this.level,
      status: st.status,
      count: st.entries.length,
      shown: rows.length,
      fromCache: st.fromCache,
      sort: { ...this.sort },
      sortOpen: this.sortOpen,
      cursor: this.cursor,
      myRank: me ? board.rankOfWallet(me) : 0,
      badges,
      footer: {
        seals: this.sealsRect,
        hint: this.hintRect,
        back: { ...BTN_BACK },
        refresh: { ...BTN_REFRESH },
        myrank: wallet.isConnected() ? { ...BTN_MYRANK } : null,
      },
      top: rows.slice(0, 10).map((e, i) => {
        const p = this.primary(e, 24); // full segment label for the CI hook
        const key = this.tab === 'wallets' ? e.sender : e.assetId;
        return {
          rank: i + 1,
          key,
          label: p.label,
          labelKind: p.kind,
          score: e.score,
          scoreFmt: board.fmtScore(e.score),
          stage: e.stage,
          stageName: board.stageName(e.stage),
          timeSec: e.timeSec,
          deaths: e.deaths,
          maxCombo: e.maxCombo,
          continues: e.continues,
          win: e.win,
          v: e.v,
          crown: board.isCrown(e),
          speedDemon: badges.speed !== null && badges.speed === key,
          comboKing: badges.combo !== null && badges.combo === key,
          isNew: board.isNew(e),
          mine: me !== null && e.sender === me,
          skin: e.skin,
          msg: e.msg,
          txid: e.txid,
        };
      }),
      card,
      run: this.runEntry
        ? {
            score: this.runEntry.score,
            stage: this.runEntry.stage,
            stageName: board.stageName(this.runEntry.stage),
            win: this.runEntry.win,
            continues: this.runEntry.continues,
            timeSec: this.runEntry.timeSec,
            deaths: this.runEntry.deaths,
            maxCombo: this.runEntry.maxCombo,
            assetId: this.runEntry.assetId,
            skin: this.runEntry.skin,
            msg: this.runEntry.msg,
            txid: this.runEntry.txid,
            sender: this.runEntry.sender,
            v: this.runEntry.v,
          }
        : null,
      runBtns: this.level === 'run' ? SHARE_BTNS.map((b) => ({ id: b.id, label: b.label, x: b.x, y: b.y, w: b.w, h: b.h })) : [],
    };
  }

  // ================================================================ DRAW
  draw(ctx: CanvasRenderingContext2D, t: number, frames: Map<string, HTMLImageElement>, touch: boolean): void {
    this.hots = [];
    if (this.myRankFlash > 0) this.myRankFlash--;
    // animated total-seals counter
    const total = board.boardState().entries.length;
    if (this.shownSeals < total) this.shownSeals = Math.min(total, this.shownSeals + Math.max(1, Math.ceil(total / 45)));
    ctx.fillStyle = '#070a14';
    ctx.fillRect(0, 0, VW, VH);
    for (let i = 0; i < 28; i++) {
      const sx = (i * 137 + ((t >> 3) * (1 + (i & 3)))) % VW;
      const sy = (i * 71) % VH;
      ctx.fillStyle = (i & 1) ? '#101a30' : '#14202a';
      ctx.fillRect(sx, sy, 1, 1);
    }
    mosaicBorder(ctx);
    if (this.level === 'board') this.drawBoard(ctx, t, frames, touch);
    else if (this.level === 'run') this.drawRun(ctx, t, frames);
    else this.drawCard(ctx, t, frames);
  }

  // ---------------- L1: BOARD ----------------
  private drawBoard(ctx: CanvasRenderingContext2D, t: number, frames: Map<string, HTMLImageElement>, touch: boolean): void {
    drawTextSh(ctx, 'THE ARENA', VW / 2, 8, 2, '#f5c542', 'center', '#b8860b');
    this.drawTab(ctx, TAB_WALLETS, 'TOP WALLETS', this.tab === 'wallets');
    this.drawTab(ctx, TAB_GONNAS, 'TOP GONNAS', this.tab === 'gonnas');
    this.hots.push({ ...TAB_WALLETS, id: 'tab:wallets' }, { ...TAB_GONNAS, id: 'tab:gonnas' });

    const st = board.boardState();
    const rows = this.rows();
    this.first = clamp(this.first, 0, this.maxFirst());
    this.cursor = clamp(this.cursor, 0, Math.max(0, rows.length - 1));

    if (st.status === 'loading' || st.status === 'idle') {
      if ((t & 16) !== 0) drawText(ctx, 'CONSULTING THE INDEXER...', VW / 2, 110, 1, '#f5c542', 'center');
    } else if (st.status === 'error') {
      drawText(ctx, 'INDEXER DOWN', VW / 2, 104, 2, '#e23b3b', 'center');
      drawText(ctx, 'HIT REFRESH TO TRY AGAIN', VW / 2, 126, 1, '#8a8f9c', 'center');
    } else if (rows.length === 0) {
      drawText(ctx, 'NO SEALS YET ON-CHAIN', VW / 2, 104, 1, '#8a8f9c', 'center');
      if ((t & 16) !== 0) drawText(ctx, 'BE THE FIRST - SEAL YOUR RUN', VW / 2, 118, 1, '#7fd858', 'center');
    } else {
      // sortable column headers (desktop) / SORT BY dropdown (touch)
      if (touch) {
        const active = COL_DEFS.find((c) => c.col === this.sort.col)!;
        this.drawBtn(ctx, SORT_DD_BTN, 'SORT BY: ' + active.label + (this.sort.dir === -1 ? ' -' : ' +'), t, FLUO);
        this.hots.push({ ...SORT_DD_BTN, id: 'sortbtn' });
        if (this.sortOpen) {
          for (let i = 0; i < COL_DEFS.length; i++) {
            const c = COL_DEFS[i];
            const r = { x: SORT_DD_BTN.x, y: SORT_DD_BTN.y + 14 + i * 12, w: SORT_DD_BTN.w, h: 11 };
            ctx.fillStyle = c.col === this.sort.col ? '#142a10' : '#0d1118';
            ctx.fillRect(r.x, r.y, r.w, r.h);
            ctx.strokeStyle = c.col === this.sort.col ? FLUO : '#3a3f4c';
            ctx.lineWidth = 1;
            ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
            drawText(ctx, c.label + (c.col === this.sort.col ? (this.sort.dir === -1 ? ' -' : ' +') : ''), r.x + 4, r.y + 2, 1, c.col === this.sort.col ? FLUO : '#c8ccd4');
            this.hots.push({ ...r, id: 'sort:' + c.col });
          }
        }
      } else {
        for (const c of COL_DEFS) {
          const on = this.sort.col === c.col;
          drawText(ctx, c.label, c.x, HDR_Y, 1, on ? FLUO : '#5a5f6c');
          if (on) this.drawTri(ctx, c.x + textWidth(c.label, 1) + 3, HDR_Y + 1, this.sort.dir === 1);
          this.hots.push({ x: c.x - 2, y: HDR_Y - 2, w: c.w, h: 12, id: 'sort:' + c.col });
        }
      }
      this.warmSegs(rows);
      const badges = board.badgeKeys(this.tab);
      ctx.save();
      ctx.beginPath();
      ctx.rect(ROW_X - 2, LIST_TOP, ROW_W + 4, LIST_H);
      ctx.clip();
      for (let vi = 0; vi < VISIBLE; vi++) {
        const ri = this.first + vi;
        if (ri >= rows.length) break;
        this.drawRow(ctx, t, frames, rows[ri], ri + 1, LIST_TOP + vi * ROW_H, badges, ri === this.cursor);
      }
      ctx.restore();
      // scroll arrows + position
      this.hots.push({ ...BTN_UP, id: 'up' }, { ...BTN_DOWN, id: 'down' });
      this.drawArrow(ctx, BTN_UP, true, this.first > 0);
      this.drawArrow(ctx, BTN_DOWN, false, this.first < this.maxFirst());
      if (rows.length > VISIBLE) {
        drawText(ctx, (this.first + 1) + '-' + Math.min(rows.length, this.first + VISIBLE) + '/' + rows.length, VW - 10, LIST_TOP + LIST_H + 2, 1, '#5a5f6c', 'right');
      }
    }

    // footer buttons
    this.drawBtn(ctx, BTN_REFRESH, 'REFRESH', t);
    this.drawBtn(ctx, BTN_BACK, 'BACK', t);
    this.hots.push({ ...BTN_REFRESH, id: 'refresh' }, { ...BTN_BACK, id: 'back' });
    const myRankOn = wallet.isConnected();
    if (myRankOn) {
      const rank = board.rankOfWallet(wallet.getWallet().address!);
      this.drawBtn(ctx, BTN_MYRANK, rank > 0 ? 'MY RANK #' + rank : 'MY RANK', t, FLUO);
      this.hots.push({ ...BTN_MYRANK, id: 'myrank' });
    }
    // v9.2.3: the seals/cached info gets its OWN slot between the left buttons
    // and BACK — right-aligned to BACK's left edge and shortened until it
    // fits, so it can NEVER invade a button box again (user screenshot bug)
    if (st.status === 'ready') {
      const slotL = (myRankOn ? BTN_MYRANK.x + BTN_MYRANK.w : BTN_REFRESH.x + BTN_REFRESH.w) + 8;
      const slotR = BTN_BACK.x - 8;
      let label = this.shownSeals + ' SEALS' + (st.fromCache ? ' - CACHED' : '');
      if (textWidth(label, 1) > slotR - slotL) label = this.shownSeals + ' SEALS';
      if (textWidth(label, 1) <= slotR - slotL) {
        drawText(ctx, label, slotR, BTN_BACK.y + 4, 1, '#5a5f6c', 'right');
        this.sealsRect = { x: slotR - textWidth(label, 1), y: BTN_BACK.y + 4, w: textWidth(label, 1), h: 7 };
      } else {
        this.sealsRect = null;
      }
    } else {
      this.sealsRect = null;
    }
    // v9.2.3: the hint line sits fully INSIDE the checkered border (the bottom
    // mosaic band starts at VH-4, so the 7px text must end by VH-5)
    if (!touch) {
      const hint = 'ENTER CARD - L/R TABS - R REFRESH - M MY RANK - ESC BACK';
      this.hintRect = { x: Math.round(VW / 2 - textWidth(hint, 1) / 2), y: VH - 11, w: textWidth(hint, 1), h: 7 };
      if ((t & 32) !== 0) drawText(ctx, hint, VW / 2, VH - 11, 1, '#5a5f6c', 'center');
    } else {
      this.hintRect = null;
    }
  }

  private drawRow(
    ctx: CanvasRenderingContext2D,
    t: number,
    frames: Map<string, HTMLImageElement>,
    e: BoardEntry,
    rank: number,
    y: number,
    badges: { speed: string | number | null; combo: string | number | null },
    isCursor: boolean,
  ): void {
    const crown = board.isCrown(e);
    const me = wallet.getWallet().address;
    const mine = me !== null && e.sender === me;
    ctx.fillStyle = crown ? '#14100a' : rank & 1 ? '#0a0e14' : '#0d1118';
    ctx.fillRect(ROW_X, y, ROW_W, ROW_H - 2);
    if (mine) {
      // MY RANK green row highlight
      ctx.fillStyle = 'rgba(57,255,20,0.10)';
      ctx.fillRect(ROW_X, y, ROW_W, ROW_H - 2);
      ctx.strokeStyle = this.myRankFlash > 0 && (t & 8) !== 0 ? '#ffffff' : FLUO;
      ctx.lineWidth = 1;
      ctx.strokeRect(ROW_X + 0.5, y + 0.5, ROW_W - 1, ROW_H - 3);
    } else if (isCursor) {
      ctx.strokeStyle = '#3a3f4c';
      ctx.lineWidth = 1;
      ctx.strokeRect(ROW_X + 0.5, y + 0.5, ROW_W - 1, ROW_H - 3);
    }
    this.hots.push({ x: ROW_X, y, w: ROW_W, h: ROW_H - 2, id: 'row:' + (rank - 1) });
    // rank (podium colors 1-3)
    const rankColor = rank <= 3 ? PODIUM[rank - 1] : '#8a8f9c';
    drawText(ctx, String(rank).padStart(2, ' '), ROW_X + 2, y + 3, 1, rankColor);
    // skin mini-sprite
    const img = e.skin === 'gonna' ? frames.get('0_0') : skinPortrait(e.skin);
    if (img) {
      const dh = 12;
      const dw = Math.min(11, dh * (img.width / img.height));
      ctx.drawImage(img, Math.round(ROW_X + 23 - dw / 2), y + 2, Math.round(dw), dh);
    } else {
      ctx.fillStyle = SKIN_INFO[e.skin].accent;
      ctx.fillRect(ROW_X + 19, y + 4, 8, 8);
    }
    // primary label: NFD segment (green/gray) / short address / NFT name
    const p = this.primary(e);
    const pColor = p.kind === 'seg-active' ? '#7fd858' : p.kind === 'seg-inactive' ? '#8a8f9c' : p.kind === 'nft' ? '#f5c542' : '#c8ccd4';
    drawText(ctx, p.label, ROW_X + 32, y + 3, 1, pColor);
    // badges right after the label
    let bx = ROW_X + 32 + textWidth(p.label, 1) + 4;
    const key = this.tab === 'wallets' ? e.sender : e.assetId;
    if (crown) {
      drawCrown(ctx, bx, y + 3);
      bx += 14;
    }
    if (badges.speed !== null && badges.speed === key) {
      drawFlame(ctx, bx, y + 2);
      bx += 10;
    }
    if (badges.combo !== null && badges.combo === key) {
      drawBoom(ctx, bx, y + 2);
      bx += 12;
    }
    if (board.isNew(e)) {
      drawText(ctx, 'NEW', bx, y + 3, 1, (t & 16) !== 0 ? FLUO : '#1e8c0a');
    }
    // score (right, gold, $GONNA-branded with thousands separators)
    const scoreX = ROW_X + ROW_W - 4;
    drawText(ctx, board.fmtScore(e.score), scoreX, y + 3, 1, rank <= 3 ? PODIUM[rank - 1] : '#f5c542', 'right');
    // line 2: stage name / time / deaths / continues / combo / message
    let lx = ROW_X + 32;
    drawText(ctx, wallet.truncatePixel(board.stageName(e.stage), 16), lx, y + 13, 1, '#5a5f6c');
    lx += 100;
    if (e.timeSec !== null) {
      drawText(ctx, board.fmtTime(e.timeSec), lx, y + 13, 1, '#8a8f9c');
      lx += 32;
    }
    if (e.deaths !== null) {
      drawText(ctx, 'D' + e.deaths, lx, y + 13, 1, '#8a8f9c');
      lx += 18;
    }
    drawText(ctx, 'C' + e.continues, lx, y + 13, 1, '#8a8f9c');
    if (e.maxCombo !== null) {
      drawText(ctx, '  x' + e.maxCombo, lx, y + 13, 1, '#8a8f9c');
    }
    if (e.msg) drawText(ctx, wallet.truncatePixel(e.msg, 12), scoreX, y + 13, 1, '#8a8f9c', 'right');
  }

  // ---------------- L2: PLAYER / FIGHTER CARD ----------------
  private drawCard(ctx: CanvasRenderingContext2D, t: number, frames: Map<string, HTMLImageElement>): void {
    const isF = this.level === 'fighter';
    const entries = this.cardEntries();
    const career = board.careerOf(entries);
    const title = isF ? 'FIGHTER CARD' : 'PLAYER CARD';
    drawTextSh(ctx, title, VW / 2, 8, 2, '#f5c542', 'center', '#b8860b');

    // identity header
    let label: string;
    let color = '#c8ccd4';
    if (isF && typeof this.cardKey === 'number') {
      const nft = skinForAsset(this.cardKey);
      label = nft ? nft.name.trim() : 'ASA ' + this.cardKey;
      color = '#f5c542';
      const skin = nft ? nft.skin : entries[0]?.skin;
      if (skin) {
        const img = skin === 'gonna' ? frames.get('0_0') : skinPortrait(skin);
        if (img) {
          const dh = 40;
          const dw = dh * (img.width / img.height);
          ctx.drawImage(img, Math.round(30 - dw / 2), 26, Math.round(dw), dh);
        }
      }
    } else {
      const w = this.walletLabel(String(this.cardKey), 24);
      label = w.label;
      color = w.kind === 'seg-active' ? '#7fd858' : w.kind === 'seg-inactive' ? '#8a8f9c' : '#c8ccd4';
    }
    drawTextSh(ctx, label, 54, 28, 1, color);
    if (isF && typeof this.cardKey === 'number') {
      const owner = board.currentOwner(this.cardKey);
      if (owner) {
        const w = this.walletLabel(owner, 20);
        drawText(ctx, 'OWNER ' + w.label, 54, 38, 1, w.kind === 'seg-active' ? '#7fd858' : '#8a8f9c');
      }
    }

    // career totals grid (2 columns x 4 rows)
    const skinLabel = SKIN_INFO[career.favSkin].label;
    const fav = career.favAsset > 0 ? (skinForAsset(career.favAsset)?.name.trim() ?? 'ASA ' + career.favAsset) : skinLabel;
    const cells: [string, string, string][] = [
      ['SEALS', String(career.seals), '#f2f2f2'],
      ['BEST', board.fmtScore(career.best), '#f5c542'],
      ['TOTAL PTS', board.fmtScore(career.totalPts), '#f5c542'],
      ['PLAY TIME', board.fmtTime(career.playTimeSec), '#f2f2f2'],
      ['WINS', String(career.wins), '#7fd858'],
      ['CROWNS', String(career.crowns), '#f5c542'],
      ['DEATHS', String(career.deaths), '#e23b3b'],
      ['BEST COMBO', 'x' + career.bestCombo, FLUO],
    ];
    for (let i = 0; i < cells.length; i++) {
      const cx = i % 2 === 0 ? 12 : 200;
      const cy = 50 + Math.floor(i / 2) * 16;
      drawText(ctx, cells[i][0], cx, cy, 1, '#5a5f6c');
      drawText(ctx, cells[i][1], cx + 176, cy, 1, cells[i][2], 'right');
    }
    drawText(ctx, isF ? 'SKIN ' + skinLabel : 'FAVORITE ' + wallet.truncatePixel(fav, 14), 12, 50 + 4 * 16, 1, '#8a8f9c');

    // full match history (all seals, scrollable) -> tap a row for the RUN CARD
    drawText(ctx, 'MATCH HISTORY', 12, 130, 1, '#f5c542');
    const hist = entries;
    this.histFirst = clamp(this.histFirst, 0, Math.max(0, hist.length - HIST_VISIBLE));
    for (let vi = 0; vi < HIST_VISIBLE; vi++) {
      const ri = this.histFirst + vi;
      if (ri >= hist.length) break;
      const e = hist[ri];
      const y = 142 + vi * 11;
      const sel = ri === this.histCursor;
      ctx.fillStyle = sel ? '#142a10' : ri & 1 ? '#0a0e14' : '#0d1118';
      ctx.fillRect(12, y, VW - 24, 10);
      drawText(ctx, String(ri + 1).padStart(2, ' '), 16, y + 2, 1, '#5a5f6c');
      drawText(ctx, board.fmtScore(e.score, false), 40, y + 2, 1, '#f5c542');
      drawText(ctx, 'S' + e.stage + (e.win ? ' WIN' : ''), 110, y + 2, 1, e.win ? '#7fd858' : '#8a8f9c');
      if (board.isCrown(e)) drawCrown(ctx, 158, y + 1);
      drawText(ctx, 'R' + e.round, 180, y + 2, 1, '#5a5f6c');
      drawText(ctx, wallet.truncatePixel(e.msg, 14), VW - 16, y + 2, 1, '#8a8f9c', 'right');
      this.hots.push({ x: 12, y, w: VW - 24, h: 10, id: 'hist:' + ri });
    }
    if (hist.length > HIST_VISIBLE) {
      drawText(ctx, (this.histFirst + 1) + '-' + Math.min(hist.length, this.histFirst + HIST_VISIBLE) + '/' + hist.length, VW - 16, 130, 1, '#5a5f6c', 'right');
    }
    const back = { x: VW / 2 - 40, y: 206, w: 80, h: 13 };
    this.drawBtn(ctx, back, 'BACK', t);
    this.hots.push({ ...back, id: 'cardback' });
    if (hist.length === 0) drawText(ctx, 'NO SEALS YET', VW / 2, 160, 1, '#5a5f6c', 'center');
  }

  // ---------------- L3: RUN CARD ----------------
  private drawRun(ctx: CanvasRenderingContext2D, t: number, frames: Map<string, HTMLImageElement>): void {
    const e = this.runEntry;
    if (!e) return;
    drawTextSh(ctx, 'RUN CARD', VW / 2, 8, 2, FLUO, 'center', '#0a3d00');
    // big sprite
    const img = e.skin === 'gonna' ? frames.get('0_0') : skinPortrait(e.skin);
    if (img) {
      const dh = 64;
      const dw = dh * (img.width / img.height);
      ctx.drawImage(img, Math.round(46 - dw / 2), 34, Math.round(dw), dh);
    }
    if (board.isCrown(e)) drawCrown(ctx, 40, 28);
    // seal detail
    const lx = 96;
    const rx = VW - 12;
    const nft = e.assetId > 0 ? skinForAsset(e.assetId) : null;
    drawTextSh(ctx, nft ? nft.name.trim() : 'GONNA', lx, 28, 1, '#f5c542');
    const w = this.walletLabel(e.sender, 18);
    drawText(ctx, w.label, lx, 38, 1, w.kind === 'seg-active' ? '#7fd858' : w.kind === 'seg-inactive' ? '#8a8f9c' : '#c8ccd4');
    drawText(ctx, 'SCORE', lx, 52, 1, '#5a5f6c');
    drawText(ctx, board.fmtScore(e.score), rx, 52, 1, '#f5c542', 'right');
    drawText(ctx, 'STAGE', lx, 64, 1, '#5a5f6c');
    drawText(ctx, board.stageName(e.stage), rx, 64, 1, '#f2f2f2', 'right');
    drawText(ctx, 'RESULT', lx, 76, 1, '#5a5f6c');
    drawText(ctx, (e.win ? 'VICTORY' : 'GAME OVER') + '  C' + e.continues, rx, 76, 1, e.win ? '#7fd858' : '#e23b3b', 'right');
    let vy = 88;
    if (e.timeSec !== null) {
      drawText(ctx, 'TIME', lx, vy, 1, '#5a5f6c');
      drawText(ctx, board.fmtTime(e.timeSec), rx, vy, 1, '#f2f2f2', 'right');
      vy += 12;
    }
    if (e.deaths !== null) {
      drawText(ctx, 'DEATHS', lx, vy, 1, '#5a5f6c');
      drawText(ctx, String(e.deaths), rx, vy, 1, '#e23b3b', 'right');
      vy += 12;
    }
    if (e.maxCombo !== null) {
      drawText(ctx, 'MAX COMBO', lx, vy, 1, '#5a5f6c');
      drawText(ctx, 'x' + e.maxCombo, rx, vy, 1, FLUO, 'right');
      vy += 12;
    }
    drawText(ctx, 'SEAL V' + e.v + '  BLOCK ' + (e.round > 0 ? e.round : '?'), lx, vy, 1, '#5a5f6c');
    // message
    if (e.msg) drawTextSh(ctx, '"' + wallet.truncatePixel(e.msg, 30) + '"', VW / 2, 140, 1, '#ffffff', 'center');
    else drawText(ctx, '(NO MESSAGE)', VW / 2, 140, 1, '#3a3f4c', 'center');
    // v9.2.3: the 2-step pixel guide between the detail rows and the share
    // area — VIEW CARD is step 1, the X/TG buttons are step 2
    drawTextSh(ctx, SHARE_GUIDE, VW / 2, 156, 1, FLUO, 'center', '#0a3d00');
    // share buttons + VIEW CARD + VIEW TX + BACK (same viral formula as the SEALED screen)
    const share = this.shareState ? this.shareState() : null;
    for (const b of SHARE_BTNS) {
      const posted = (b.id === 'share:x' && share?.postedX) || (b.id === 'share:tg' && share?.postedTG);
      this.drawShareBtn(ctx, b, t, posted === true);
      this.hots.push({ x: b.x, y: b.y, w: b.w, h: b.h, id: b.id });
    }
  }

  private drawShareBtn(ctx: CanvasRenderingContext2D, b: { id: string; label: string; x: number; y: number; w: number; h: number; icon: 'x' | 'tg' | null }, t: number, posted: boolean): void {
    const share = b.icon !== null;
    ctx.fillStyle = posted ? '#0f2408' : '#0d1118';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = share ? ((t & 16) !== 0 ? FLUO : '#1e8c0a') : (t & 16) !== 0 ? '#f5c542' : '#b8860b';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    let tx = b.x + b.w / 2;
    // v9.2.2: big 18px official icon, solid FLUO + subtle glow, LEFT side
    if (b.icon === 'x') {
      const r = shareIconRect(b);
      drawIconX(ctx, r.x, r.y, 1, FLUO, true);
      tx += 11;
    } else if (b.icon === 'tg') {
      const r = shareIconRect(b);
      drawIconTG(ctx, r.x, r.y, 1, FLUO, true);
      tx += 11;
    }
    drawText(ctx, posted ? 'POSTED!' : b.label, tx, b.y + Math.floor((b.h - 7) / 2), 1, posted ? FLUO : share ? '#e8ecf4' : '#f5c542', 'center');
    // v9.2.2: the DRAWN pixel checkmark hugs the RIGHT edge — never over the icon
    if (posted) {
      const r = shareCheckRect(b);
      drawCheck(ctx, r.x, r.y, 1, FLUO);
    }
  }

  private drawTab(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }, label: string, active: boolean): void {
    ctx.fillStyle = active ? '#1a2a14' : '#0d1118';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = active ? '#f5c542' : '#3a3f4c';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    drawText(ctx, label, b.x + b.w / 2, b.y + 4, 1, active ? '#f5c542' : '#8a8f9c', 'center');
  }

  private drawBtn(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }, label: string, t: number, color = '#f5c542'): void {
    ctx.fillStyle = '#0d1118';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = (t & 16) !== 0 ? color : '#b8860b';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    drawText(ctx, label, b.x + b.w / 2, b.y + 4, 1, color, 'center');
  }

  private drawTri(ctx: CanvasRenderingContext2D, x: number, y: number, up: boolean): void {
    ctx.fillStyle = FLUO;
    for (let i = 0; i < 3; i++) {
      const w = 5 - i * 2;
      ctx.fillRect(x + i, up ? y + i : y + 4 - i, w, 1);
    }
  }

  private drawArrow(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }, up: boolean, enabled: boolean): void {
    ctx.fillStyle = enabled ? '#f5c542' : '#26262e';
    const cx = b.x + Math.floor(b.w / 2);
    const cy = b.y + Math.floor(b.h / 2);
    for (let i = 0; i < 5; i++) {
      const w = 1 + i * 2;
      const yy = up ? cy - 3 + i : cy + 3 - i;
      ctx.fillRect(cx - i, yy, w, 1);
    }
  }
}

// SPEED DEMON pixel flame badge
function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#ff8a3c';
  ctx.fillRect(x + 2, y, 3, 2);
  ctx.fillRect(x + 1, y + 2, 5, 3);
  ctx.fillRect(x + 2, y + 5, 4, 3);
  ctx.fillStyle = '#f5c542';
  ctx.fillRect(x + 3, y + 2, 2, 2);
  ctx.fillRect(x + 3, y + 5, 2, 2);
  ctx.fillStyle = '#e23b3b';
  ctx.fillRect(x + 2, y + 7, 4, 1);
}

// COMBO KING pixel burst badge
function drawBoom(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = FLUO;
  ctx.fillRect(x + 4, y, 1, 3);
  ctx.fillRect(x + 4, y + 6, 1, 3);
  ctx.fillRect(x, y + 4, 3, 1);
  ctx.fillRect(x + 6, y + 4, 3, 1);
  ctx.fillRect(x + 1, y + 1, 2, 2);
  ctx.fillRect(x + 6, y + 1, 2, 2);
  ctx.fillRect(x + 1, y + 6, 2, 2);
  ctx.fillRect(x + 6, y + 6, 2, 2);
  ctx.fillStyle = '#f5c542';
  ctx.fillRect(x + 3, y + 3, 3, 3);
}
