// v9.1 — GLOBAL LEADERBOARD scene. Read-only, on-chain, free for all (no
// wallet needed). TOP WALLETS (best seal per sender) / TOP GONNAS (best seal
// per NFT assetId), BYZANTINE CLEAR crowns, NFD segments (green active / gray
// inactive), top 50 with arrows / tap / swipe scroll.
import { drawText, drawTextSh } from './font';
import { drawCrown, mosaicBorder } from './screens';
import { VH, VW, clamp } from './types';
import type { Input } from './input';
import * as wallet from './wallet';
import * as board from './board';
import type { BoardEntry, BoardTab } from './board';
import { SKIN_INFO, skinForAsset, skinPortrait } from './skins';

export type BoardAction =
  | { act: 'none' }
  | { act: 'move' }
  | { act: 'title' };

interface Hot {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
}

const ROW_H = 19;
const LIST_TOP = 52;
const VISIBLE = 7;
const LIST_H = VISIBLE * ROW_H;
const ROW_X = 8;
const ROW_W = VW - 16 - 24; // right column reserved for the scroll arrows
const TAB_WALLETS = { x: 30, y: 30, w: 150, h: 16 };
const TAB_GONNAS = { x: 204, y: 30, w: 150, h: 16 };
const BTN_REFRESH = { x: 24, y: 200, w: 84, h: 14 };
const BTN_BACK = { x: 276, y: 200, w: 84, h: 14 };
const BTN_UP = { x: VW - 28, y: LIST_TOP, w: 20, h: 16 };
const BTN_DOWN = { x: VW - 28, y: LIST_TOP + LIST_H - 16, w: 20, h: 16 };

export class BoardUI {
  private tab: BoardTab = 'wallets';
  private first = 0;
  private hots: Hot[] = [];
  private dragAcc = 0;

  open(): void {
    this.first = 0;
    void board.fetchBoard(false);
  }

  private refresh(): void {
    void board.fetchBoard(true);
  }

  get currentTab(): BoardTab {
    return this.tab;
  }

  private maxFirst(): number {
    return Math.max(0, board.ranked(this.tab).length - VISIBLE);
  }

  // identity label + color kind for a row's primary slot
  private primary(e: BoardEntry): { label: string; kind: 'seg-active' | 'seg-inactive' | 'addr' | 'nft' } {
    if (this.tab === 'gonnas') {
      const hit = skinForAsset(e.assetId);
      return { label: wallet.truncatePixel(hit ? hit.name.trim() : 'ASA ' + e.assetId, 16), kind: 'nft' };
    }
    return this.walletLabel(e.sender);
  }

  private walletLabel(addr: string): { label: string; kind: 'seg-active' | 'seg-inactive' | 'addr' } {
    const seg = wallet.cachedSegment(addr);
    if (seg) return { label: wallet.truncatePixel(seg.name, 20), kind: seg.active ? 'seg-active' : 'seg-inactive' };
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

  key(inp: Input): BoardAction {
    if (inp.pressed.pause || inp.pressed.fighter) return { act: 'title' };
    if (inp.pressed.left || inp.pressed.right) {
      this.tab = this.tab === 'wallets' ? 'gonnas' : 'wallets';
      this.first = 0;
      return { act: 'move' };
    }
    if (inp.pressed.up) {
      this.first = Math.max(0, this.first - 1);
      return { act: 'move' };
    }
    if (inp.pressed.down) {
      this.first = Math.min(this.maxFirst(), this.first + 1);
      return { act: 'move' };
    }
    if (inp.pressedCodes.has('KeyR')) {
      this.refresh();
      return { act: 'move' };
    }
    return { act: 'none' };
  }

  tap(gx: number, gy: number): BoardAction {
    for (const h of this.hots) {
      if (gx >= h.x && gx <= h.x + h.w && gy >= h.y && gy <= h.y + h.h) {
        if (h.id === 'tab:wallets' && this.tab !== 'wallets') {
          this.tab = 'wallets';
          this.first = 0;
          return { act: 'move' };
        }
        if (h.id === 'tab:gonnas' && this.tab !== 'gonnas') {
          this.tab = 'gonnas';
          this.first = 0;
          return { act: 'move' };
        }
        if (h.id === 'refresh') {
          this.refresh();
          return { act: 'move' };
        }
        if (h.id === 'back') return { act: 'title' };
        if (h.id === 'up') {
          this.first = Math.max(0, this.first - 1);
          return { act: 'move' };
        }
        if (h.id === 'down') {
          this.first = Math.min(this.maxFirst(), this.first + 1);
          return { act: 'move' };
        }
        return { act: 'none' };
      }
    }
    return { act: 'none' };
  }

  // swipe scroll: dy in GAME px (positive = finger moved down = list up)
  dragBy(dy: number): void {
    this.dragAcc += dy;
    while (this.dragAcc >= ROW_H / 2) {
      this.dragAcc -= ROW_H / 2;
      this.first = Math.max(0, this.first - 1);
    }
    while (this.dragAcc <= -ROW_H / 2) {
      this.dragAcc += ROW_H / 2;
      this.first = Math.min(this.maxFirst(), this.first + 1);
    }
  }

  // ---- CI introspection (__gonna.boardInfo) ----
  get info(): {
    tab: BoardTab;
    status: string;
    count: number;
    shown: number;
    fromCache: boolean;
    top: {
      rank: number;
      key: string | number;
      label: string;
      labelKind: string;
      score: number;
      stage: number;
      continues: number;
      win: number;
      crown: boolean;
      skin: string;
      msg: string;
      txid: string;
    }[];
  } {
    const st = board.boardState();
    const rows = board.ranked(this.tab);
    return {
      tab: this.tab,
      status: st.status,
      count: st.entries.length,
      shown: rows.length,
      fromCache: st.fromCache,
      top: rows.slice(0, 10).map((e, i) => {
        const p = this.primary(e);
        return {
          rank: i + 1,
          key: this.tab === 'wallets' ? e.sender : e.assetId,
          label: p.label,
          labelKind: p.kind,
          score: e.score,
          stage: e.stage,
          continues: e.continues,
          win: e.win,
          crown: board.isCrown(e),
          skin: e.skin,
          msg: e.msg,
          txid: e.txid,
        };
      }),
    };
  }

  // ================================================================ DRAW
  draw(ctx: CanvasRenderingContext2D, t: number, frames: Map<string, HTMLImageElement>, touch: boolean): void {
    this.hots = [];
    ctx.fillStyle = '#070a14';
    ctx.fillRect(0, 0, VW, VH);
    for (let i = 0; i < 28; i++) {
      const sx = (i * 137 + ((t >> 3) * (1 + (i & 3)))) % VW;
      const sy = (i * 71) % VH;
      ctx.fillStyle = (i & 1) ? '#101a30' : '#14202a';
      ctx.fillRect(sx, sy, 1, 1);
    }
    mosaicBorder(ctx);
    drawTextSh(ctx, 'GLOBAL LEADERBOARD', VW / 2, 10, 2, '#f5c542', 'center', '#b8860b');

    // tabs
    this.drawTab(ctx, TAB_WALLETS, 'TOP WALLETS', this.tab === 'wallets');
    this.drawTab(ctx, TAB_GONNAS, 'TOP GONNAS', this.tab === 'gonnas');
    this.hots.push({ ...TAB_WALLETS, id: 'tab:wallets' }, { ...TAB_GONNAS, id: 'tab:gonnas' });

    const st = board.boardState();
    const rows = board.ranked(this.tab);
    this.first = clamp(this.first, 0, this.maxFirst());

    if (st.status === 'loading' || st.status === 'idle') {
      if ((t & 16) !== 0) drawText(ctx, 'CONSULTING THE INDEXER...', VW / 2, 110, 1, '#f5c542', 'center');
    } else if (st.status === 'error') {
      drawText(ctx, 'INDEXER DOWN', VW / 2, 104, 2, '#e23b3b', 'center');
      drawText(ctx, 'HIT REFRESH TO TRY AGAIN', VW / 2, 126, 1, '#8a8f9c', 'center');
    } else if (rows.length === 0) {
      drawText(ctx, 'NO SEALS YET ON-CHAIN', VW / 2, 104, 1, '#8a8f9c', 'center');
      if ((t & 16) !== 0) drawText(ctx, 'BE THE FIRST - SEAL YOUR RUN', VW / 2, 118, 1, '#7fd858', 'center');
    } else {
      this.warmSegs(rows);
      ctx.save();
      ctx.beginPath();
      ctx.rect(ROW_X - 2, LIST_TOP, ROW_W + 4, LIST_H);
      ctx.clip();
      for (let vi = 0; vi < VISIBLE; vi++) {
        const ri = this.first + vi;
        if (ri >= rows.length) break;
        this.drawRow(ctx, t, frames, rows[ri], ri + 1, LIST_TOP + vi * ROW_H);
      }
      ctx.restore();
      // scroll arrows + position
      this.hots.push({ ...BTN_UP, id: 'up' }, { ...BTN_DOWN, id: 'down' });
      this.drawArrow(ctx, BTN_UP, true, this.first > 0);
      this.drawArrow(ctx, BTN_DOWN, false, this.first < this.maxFirst());
      if (rows.length > VISIBLE) {
        drawText(ctx, (this.first + 1) + '-' + Math.min(rows.length, this.first + VISIBLE) + '/' + rows.length, VW - 10, LIST_TOP + LIST_H + 3, 1, '#5a5f6c', 'right');
      }
    }

    // footer buttons
    this.drawBtn(ctx, BTN_REFRESH, 'REFRESH', t);
    this.drawBtn(ctx, BTN_BACK, 'BACK', t);
    this.hots.push({ ...BTN_REFRESH, id: 'refresh' }, { ...BTN_BACK, id: 'back' });
    if (st.status === 'ready') {
      drawText(ctx, st.entries.length + ' SEALS' + (st.fromCache ? ' - CACHED' : ''), VW / 2, 204, 1, '#5a5f6c', 'center');
    }
    if (!touch && (t & 32) !== 0) {
      drawText(ctx, 'ARROWS SCROLL - L/R TABS - R REFRESH - ESC BACK', VW / 2, VH - 10, 1, '#5a5f6c', 'center');
    }
  }

  private drawTab(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }, label: string, active: boolean): void {
    ctx.fillStyle = active ? '#1a2a14' : '#0d1118';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = active ? '#f5c542' : '#3a3f4c';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    drawText(ctx, label, b.x + b.w / 2, b.y + 5, 1, active ? '#f5c542' : '#8a8f9c', 'center');
  }

  private drawBtn(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }, label: string, t: number): void {
    ctx.fillStyle = '#0d1118';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = (t & 16) !== 0 ? '#f5c542' : '#b8860b';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    drawText(ctx, label, b.x + b.w / 2, b.y + 4, 1, '#f5c542', 'center');
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

  private drawRow(ctx: CanvasRenderingContext2D, t: number, frames: Map<string, HTMLImageElement>, e: BoardEntry, rank: number, y: number): void {
    void t;
    const crown = board.isCrown(e);
    ctx.fillStyle = crown ? '#14100a' : rank & 1 ? '#0a0e14' : '#0d1118';
    ctx.fillRect(ROW_X, y, ROW_W, ROW_H - 1);
    // rank
    drawText(ctx, String(rank).padStart(2, ' '), ROW_X + 3, y + 3, 1, rank <= 3 ? '#f5c542' : '#8a8f9c');
    // skin mini-sprite
    const img = e.skin === 'gonna' ? frames.get('0_0') : skinPortrait(e.skin);
    if (img) {
      const dh = 12;
      const dw = Math.min(11, dh * (img.width / img.height));
      ctx.drawImage(img, Math.round(ROW_X + 24 - dw / 2), y + 3, Math.round(dw), dh);
    } else {
      ctx.fillStyle = SKIN_INFO[e.skin].accent;
      ctx.fillRect(ROW_X + 20, y + 5, 8, 8);
    }
    // primary label: NFD segment (green/gray) / short address / NFT name
    const p = this.primary(e);
    const pColor = p.kind === 'seg-active' ? '#7fd858' : p.kind === 'seg-inactive' ? '#8a8f9c' : p.kind === 'nft' ? '#f5c542' : '#c8ccd4';
    drawText(ctx, p.label, ROW_X + 34, y + 3, 1, pColor);
    // score (right, gold) + crown
    const scoreX = ROW_X + ROW_W - 18;
    drawText(ctx, String(e.score).padStart(7, '0'), scoreX, y + 3, 1, '#f5c542', 'right');
    if (crown) drawCrown(ctx, scoreX + 6, y + 3);
    // line 2: stage / continues / message
    drawText(ctx, 'S' + e.stage + ' C' + e.continues, ROW_X + 34, y + 11, 1, '#5a5f6c');
    if (this.tab === 'gonnas') {
      const w = this.walletLabel(e.sender);
      const wColor = w.kind === 'seg-active' ? '#7fd858' : w.kind === 'seg-inactive' ? '#8a8f9c' : '#5a5f6c';
      drawText(ctx, w.label, ROW_X + 76, y + 11, 1, wColor);
      if (e.msg) drawText(ctx, wallet.truncatePixel(e.msg, 14), scoreX, y + 11, 1, '#8a8f9c', 'right');
    } else if (e.msg) {
      drawText(ctx, wallet.truncatePixel(e.msg, 24), ROW_X + 76, y + 11, 1, '#8a8f9c');
    }
  }
}
