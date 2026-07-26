// v9.0 — THE GATE + CHOOSE YOUR FIGHTER. Canvas scenes in the game's own
// pixel/byzantine style: wallet connect, holder gate, fighter/athlete select,
// teaser card, wallet panel. All input (keyboard + tap hotspots) is handled
// here; the engine routes scenes, sounds and stage flow.
import { drawText, drawTextSh, textWidth } from './font';
import { mosaicBorder } from './screens';
import { VH, VW, clamp } from './types';
import type { Input } from './input';
import type { Art } from './sprites';
import {
  DEFAULT_FIGHTER, SKINS, SKIN_INFO, loadFighter, loadFavorite, loadRecents, saveFavorite,
  saveFighter, skinFramesLoaded, loadSkinFrames, skinPortrait,
} from './skins';
import type { Fighter, SkinId } from './skins';
import * as wallet from './wallet';
import type { OwnedNft } from './wallet';

export type GateScene = 'connect' | 'gate' | 'fighter';

// actions the engine must perform after key/tap handling
export type GateAction =
  | { act: 'none' }
  | { act: 'move' } // cursor moved: blip
  | { act: 'title' } // back to title
  | { act: 'fighter'; fighter: Fighter }; // fighter confirmed: apply + title

interface Btn {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Hot {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
  data: number; // cursor index / tile index
}

// ---------- tiny pixel ALGORAND logo (blocky A, neon-sign style) ----------
const ALGO_ROWS = ['001100', '011110', '110011', '110011', '111111', '110011', '110011'];
export function drawAlgoLogo(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  ctx.fillStyle = color;
  for (let r = 0; r < ALGO_ROWS.length; r++) {
    for (let c = 0; c < 6; c++) {
      if (ALGO_ROWS[r][c] === '1') ctx.fillRect(x + c * s, y + r * s, s, s);
    }
  }
}

export function fmtCompact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.floor(n).toLocaleString('en-US');
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

// ---------- wallet panel (connect/gate/fighter screens) ----------
export function drawWalletPanel(ctx: CanvasRenderingContext2D, y: number, t: number, frames: Map<string, HTMLImageElement>): void {
  const w = wallet.getWallet();
  const e = wallet.getEligibility();
  ctx.fillStyle = '#0a0e18';
  ctx.fillRect(8, y, VW - 16, 40);
  ctx.strokeStyle = '#b8860b';
  ctx.lineWidth = 1;
  ctx.strokeRect(8.5, y + 0.5, VW - 17, 39);
  // GONNA logo + Algorand neon
  drawTextSh(ctx, 'GONNA', 14, y + 4, 1, '#7fd858');
  drawAlgoLogo(ctx, 54, y + 4, 1, '#f2f2f2');
  drawText(ctx, 'ALGORAND', 63, y + 4, 1, '#c8ccd4');
  drawText(ctx, wallet.shortAddress(), VW - 14, y + 4, 1, '#8a8f9c', 'right');
  if (w.mocked) drawText(ctx, 'CI', VW - 14 - textWidth(wallet.shortAddress(), 1) - 8, y + 4, 1, '#5a5f6c');
  // balances
  drawText(ctx, 'ALGO', 14, y + 16, 1, '#8a8f9c');
  drawText(ctx, fmtCompact(e.algo), 46, y + 16, 1, '#f2f2f2');
  drawText(ctx, '$GONNA', 96, y + 16, 1, '#8a8f9c');
  drawText(ctx, fmtCompact(e.gonna), 138, y + 16, 1, e.gonna >= wallet.GONNA_THRESHOLD ? '#7fd858' : '#f5c542');
  drawText(ctx, 'NFT', 196, y + 16, 1, '#8a8f9c');
  drawText(ctx, String(e.nfts.length), 218, y + 16, 1, e.nfts.length > 0 ? '#7fd858' : '#f2f2f2');
  if (e.source === 'cache') drawText(ctx, 'CACHED', 244, y + 16, 1, '#b8860b');
  if (e.busy && (t & 16) !== 0) drawText(ctx, 'SYNC...', 296, y + 16, 1, '#8a8f9c');
  // owned-NFT sprite strip (garage style)
  const nfts = e.nfts;
  const max = Math.min(nfts.length, 11);
  for (let i = 0; i < max; i++) {
    const tx = 14 + i * 26;
    const ty = y + 24;
    ctx.fillStyle = '#101018';
    ctx.fillRect(tx, ty, 22, 13);
    ctx.strokeStyle = '#1e6b2a';
    ctx.strokeRect(tx + 0.5, ty + 0.5, 21, 12);
    const img = nfts[i].skin === 'gonna' ? frames.get('0_0') : skinPortrait(nfts[i].skin);
    if (img) ctx.drawImage(img, tx + 3, ty + 1, Math.min(20, 11 * (img.width / img.height)), 11);
    else {
      ctx.fillStyle = SKIN_INFO[nfts[i].skin].accent;
      ctx.fillRect(tx + 7, ty + 3, 8, 7);
    }
  }
  if (nfts.length > max) drawText(ctx, '+' + (nfts.length - max), 14 + max * 26, y + 28, 1, '#8a8f9c');
}

// ---------- the scene controller ----------
export class GateUI {
  scene: GateScene = 'connect';
  private buttons: Btn[] = [];
  private focus = 0; // keyboard focus over buttons
  private hots: Hot[] = []; // tap hotspots, rebuilt every draw
  private status = ''; // status / error line
  private teaser: SkinId | null = null;
  private confirmT = 0; // gold confirm flash
  private fighter: Fighter = loadFighter();

  // ---- fighter select state ----
  private gridCur = 0; // cursor over SKINS (grid mode)
  private collapsed = new Set<SkinId>();
  private rows: { kind: 'head' | 'nft'; skin: SkinId; nft: OwnedNft | null }[] = [];
  private rowCur = 0;

  open(scene: GateScene): void {
    this.scene = scene;
    this.focus = 0;
    this.status = '';
    this.teaser = null;
    this.confirmT = 0;
    if (scene === 'fighter') this.enterFighter();
    if (scene === 'connect' || scene === 'gate') void wallet.refreshEligibility(false);
  }

  get currentFighter(): Fighter {
    return this.fighter;
  }

  // ---------- fighter data helpers ----------
  private unlockedSkins(): Set<SkinId> {
    const s = new Set<SkinId>(['gonna']);
    for (const n of wallet.getEligibility().nfts) s.add(n.skin);
    return s;
  }

  private athleteMode(): boolean {
    return wallet.getEligibility().nfts.length >= 2;
  }

  private enterFighter(): void {
    const nfts = wallet.getEligibility().nfts;
    if (this.athleteMode()) {
      // keep the persisted fighter if it is still owned, else favorite, else first
      const owned = (id: number | null) => id !== null && nfts.some((n) => n.id === id);
      if (!owned(this.fighter.assetId)) {
        const fav = loadFavorite();
        const pick = (fav !== null && nfts.find((n) => n.id === fav)) || nfts[0];
        this.fighter = { skin: pick.skin, assetId: pick.id, name: pick.name };
      }
      this.rebuildRows();
      this.rowCur = this.rows.findIndex((r) => r.kind === 'nft' && r.nft!.id === this.fighter.assetId);
      if (this.rowCur < 0) this.rowCur = this.rows.findIndex((r) => r.kind === 'nft');
      if (this.rowCur < 0) this.rowCur = 0;
    } else {
      // grid mode: cursor on the persisted fighter's skin when unlocked
      const idx = SKINS.indexOf(this.fighter.skin);
      this.gridCur = idx >= 0 ? idx : 0;
      if (!this.unlockedSkins().has(SKINS[this.gridCur])) this.gridCur = 0;
      this.syncGridFighter();
    }
  }

  private rebuildRows(): void {
    this.rows = [];
    const nfts = wallet.getEligibility().nfts;
    for (const skin of SKINS) {
      const mine = nfts.filter((n) => n.skin === skin);
      if (mine.length === 0) continue;
      this.rows.push({ kind: 'head', skin, nft: null });
      if (!this.collapsed.has(skin)) {
        for (const nft of mine) this.rows.push({ kind: 'nft', skin, nft });
      }
    }
  }

  private syncGridFighter(): void {
    const skin = SKINS[this.gridCur];
    const mine = wallet.getEligibility().nfts.find((n) => n.skin === skin);
    this.fighter = mine ? { skin, assetId: mine.id, name: mine.name } : { ...DEFAULT_FIGHTER };
  }

  private confirmFighter(): GateAction {
    saveFighter(this.fighter);
    this.confirmT = 26;
    return { act: 'fighter', fighter: this.fighter };
  }

  private randomAthlete(): void {
    const nfts = wallet.getEligibility().nfts;
    if (nfts.length === 0) return;
    const pick = nfts[Math.floor(Math.random() * nfts.length)];
    this.fighter = { skin: pick.skin, assetId: pick.id, name: pick.name };
    this.collapsed.delete(pick.skin);
    this.rebuildRows();
    const i = this.rows.findIndex((r) => r.kind === 'nft' && r.nft!.id === pick.id);
    if (i >= 0) this.rowCur = i;
  }

  // async skin-frame warm-up for the big portrait (cheap: cached)
  private warmPortrait(): void {
    const s = this.fighter.skin;
    if (s !== 'gonna' && !skinFramesLoaded(s)) void loadSkinFrames(s).catch(() => { /* swatch fallback */ });
  }

  // ---------- input ----------
  // returns an action for the engine; plays no sounds itself
  key(inp: Input): GateAction {
    if (this.confirmT > 0) return { act: 'none' }; // let the gold flash play out
    if (this.teaser) {
      if (inp.pressed.start || inp.pressed.pause || inp.pressed.fighter) {
        this.teaser = null;
        return { act: 'move' };
      }
      return { act: 'none' };
    }
    if (this.scene === 'fighter') return this.keyFighter(inp);
    return this.keyButtons(inp);
  }

  private keyButtons(inp: Input): GateAction {
    const n = this.buttons.length;
    if (n === 0) return { act: 'none' };
    if (inp.pressed.left || inp.pressed.up) {
      this.focus = (this.focus + n - 1) % n;
      return { act: 'move' };
    }
    if (inp.pressed.right || inp.pressed.down) {
      this.focus = (this.focus + 1) % n;
      return { act: 'move' };
    }
    if (inp.pressed.pause || inp.pressed.fighter) return { act: 'title' };
    if (inp.pressed.start) return this.activate(this.buttons[this.focus].id);
    return { act: 'none' };
  }

  private keyFighter(inp: Input): GateAction {
    if (inp.pressed.pause || inp.pressed.fighter) return { act: 'title' };
    if (this.athleteMode()) {
      const n = this.rows.length;
      if (n === 0) return { act: 'none' };
      if (inp.pressed.up) {
        this.rowCur = (this.rowCur + n - 1) % n;
        this.rowToFighter();
        return { act: 'move' };
      }
      if (inp.pressed.down) {
        this.rowCur = (this.rowCur + 1) % n;
        this.rowToFighter();
        return { act: 'move' };
      }
      if (inp.pressed.left || inp.pressed.right) {
        this.cycleAthlete(inp.pressed.right ? 1 : -1);
        return { act: 'move' };
      }
      if (inp.pressed.punch) {
        // Z doubles as the FAVORITE star in athlete mode
        if (this.fighter.assetId !== null) {
          saveFavorite(loadFavorite() === this.fighter.assetId ? null : this.fighter.assetId);
          return { act: 'move' };
        }
        return { act: 'none' };
      }
      if (inp.pressed.kick) {
        this.randomAthlete();
        return { act: 'move' };
      }
      if (inp.pressed.start) {
        const row = this.rows[this.rowCur];
        if (row && row.kind === 'head') {
          if (this.collapsed.has(row.skin)) this.collapsed.delete(row.skin);
          else this.collapsed.add(row.skin);
          this.rebuildRows();
          this.rowCur = Math.min(this.rowCur, this.rows.length - 1);
          return { act: 'move' };
        }
        return this.confirmFighter();
      }
      return { act: 'none' };
    }
    // grid mode
    const cols = 5;
    let moved = false;
    if (inp.pressed.left) { this.gridCur = (this.gridCur + SKINS.length - 1) % SKINS.length; moved = true; }
    if (inp.pressed.right) { this.gridCur = (this.gridCur + 1) % SKINS.length; moved = true; }
    if (inp.pressed.up) { this.gridCur = (this.gridCur + SKINS.length - cols) % SKINS.length; moved = true; }
    if (inp.pressed.down) { this.gridCur = (this.gridCur + cols) % SKINS.length; moved = true; }
    if (moved) {
      this.syncGridFighter();
      return { act: 'move' };
    }
    if (inp.pressed.start) {
      const skin = SKINS[this.gridCur];
      if (this.unlockedSkins().has(skin)) return this.confirmFighter();
      this.teaser = skin; // locked -> teaser card
      return { act: 'move' };
    }
    return { act: 'none' };
  }

  private rowToFighter(): void {
    const row = this.rows[this.rowCur];
    if (row && row.kind === 'nft' && row.nft) {
      this.fighter = { skin: row.skin, assetId: row.nft.id, name: row.nft.name };
    }
  }

  private cycleAthlete(dir: 1 | -1): void {
    const nfts = wallet.getEligibility().nfts;
    if (nfts.length === 0) return;
    const idx = nfts.findIndex((n) => n.id === this.fighter.assetId);
    const next = nfts[(idx + dir + nfts.length) % nfts.length];
    this.fighter = { skin: next.skin, assetId: next.id, name: next.name };
    this.collapsed.delete(next.skin);
    this.rebuildRows();
    const i = this.rows.findIndex((r) => r.kind === 'nft' && r.nft!.id === next.id);
    if (i >= 0) this.rowCur = i;
  }

  // button activation shared by keyboard and taps
  private activate(id: string): GateAction {
    switch (id) {
      case 'pera':
      case 'defly': {
        this.status = 'OPEN ' + id.toUpperCase() + ' WALLET...';
        wallet
          .connect(id)
          .then(() => {
            this.status = 'WALLET CONNECTED - CHECKING HOLDINGS...';
          })
          .catch(() => {
            this.status = 'CONNECTION CANCELLED - TRY AGAIN';
          });
        return { act: 'move' };
      }
      case 'tinyman':
        window.open(wallet.LINK_TINYMAN, '_blank');
        return { act: 'move' };
      case 'downbad':
        window.open(wallet.LINK_DOWNBAD, '_blank');
        return { act: 'move' };
      case 'statto':
        window.open(wallet.LINK_STATTO, '_blank');
        return { act: 'move' };
      case 'recheck':
        this.status = 'CONSULTING THE INDEXER...';
        void wallet.refreshEligibility(true).then(() => {
          this.status = wallet.getEligibility().error ? 'INDEXER UNREACHABLE - TRY AGAIN' : '';
        });
        return { act: 'move' };
      case 'disconnect':
        void wallet.disconnect();
        return { act: 'move' };
      case 'back':
        return { act: 'title' };
      case 'close':
        this.teaser = null;
        return { act: 'move' };
      case 'fight':
        return this.confirmFighter();
      case 'random':
        this.randomAthlete();
        return { act: 'move' };
      case 'fav':
        if (this.fighter.assetId !== null) {
          saveFavorite(loadFavorite() === this.fighter.assetId ? null : this.fighter.assetId);
        }
        return { act: 'move' };
      case 'prev':
        this.cycleAthlete(-1);
        return { act: 'move' };
      case 'next':
        this.cycleAthlete(1);
        return { act: 'move' };
    }
    return { act: 'none' };
  }

  // tap in GAME coords; returns the action (engine decides sounds/scene cuts)
  tap(gx: number, gy: number): GateAction {
    if (this.confirmT > 0) return { act: 'none' };
    for (const h of this.hots) {
      if (gx >= h.x && gx <= h.x + h.w && gy >= h.y && gy <= h.y + h.h) {
        if (h.id.startsWith('btn:')) return this.activate(h.id.slice(4));
        if (this.scene === 'fighter') return this.tapFighter(h);
        return { act: 'none' };
      }
    }
    if (this.teaser) {
      this.teaser = null;
      return { act: 'move' };
    }
    return { act: 'none' };
  }

  private tapFighter(h: Hot): GateAction {
    if (h.id === 'tile') {
      const skin = SKINS[h.data];
      if (this.gridCur === h.data && this.unlockedSkins().has(skin)) return this.confirmFighter();
      this.gridCur = h.data;
      this.syncGridFighter();
      if (!this.unlockedSkins().has(skin)) this.teaser = skin;
      return { act: 'move' };
    }
    if (h.id === 'row') {
      const row = this.rows[h.data];
      if (!row) return { act: 'none' };
      if (row.kind === 'head') {
        if (this.collapsed.has(row.skin)) this.collapsed.delete(row.skin);
        else this.collapsed.add(row.skin);
        this.rebuildRows();
        return { act: 'move' };
      }
      if (this.rowCur === h.data) return this.confirmFighter(); // second tap = fight
      this.rowCur = h.data;
      this.rowToFighter();
      return { act: 'move' };
    }
    if (h.id === 'recent') {
      const nft = wallet.getEligibility().nfts.find((n) => n.id === h.data);
      if (!nft) return { act: 'none' };
      this.fighter = { skin: nft.skin, assetId: nft.id, name: nft.name };
      return this.confirmFighter(); // 1-tap path from RECENT FIGHTERS
    }
    return { act: 'none' };
  }

  // per-frame housekeeping (confirm flash timer)
  tick(): void {
    if (this.confirmT > 0) this.confirmT--;
    this.warmPortrait();
  }

  get flashing(): boolean {
    return this.confirmT > 0;
  }

  get teaserOpen(): boolean {
    return this.teaser !== null;
  }

  // ---- CI introspection ----
  get mode(): 'grid' | 'athlete' {
    return this.athleteMode() ? 'athlete' : 'grid';
  }
  get cursor(): number {
    return this.athleteMode() ? this.rowCur : this.gridCur;
  }
  get rowCount(): number {
    return this.rows.length;
  }
  get uiFighter(): Fighter {
    return this.fighter;
  }

  // ================================================================ DRAW
  draw(ctx: CanvasRenderingContext2D, t: number, _art: Art, frames: Map<string, HTMLImageElement>): void {
    this.hots = [];
    ctx.fillStyle = '#070a14';
    ctx.fillRect(0, 0, VW, VH);
    // starfield shimmer backdrop
    for (let i = 0; i < 28; i++) {
      const sx = (i * 137 + ((t >> 3) * (1 + (i & 3)))) % VW;
      const sy = (i * 71) % VH;
      ctx.fillStyle = (i & 1) ? '#101a30' : '#14202a';
      ctx.fillRect(sx, sy, 1, 1);
    }
    mosaicBorder(ctx);
    if (this.scene === 'connect') this.drawConnect(ctx, t);
    else if (this.scene === 'gate') this.drawGate(ctx, t, frames);
    else this.drawFighter(ctx, t, frames);
    // gold confirm flash
    if (this.confirmT > 0) {
      const a = Math.min(0.55, this.confirmT / 20);
      ctx.fillStyle = 'rgba(245,197,66,' + a.toFixed(3) + ')';
      ctx.fillRect(0, 0, VW, VH);
    }
  }

  private pushBtn(b: Btn): void {
    this.buttons.push(b);
    this.hots.push({ x: b.x, y: b.y, w: b.w, h: b.h, id: 'btn:' + b.id, data: 0 });
  }

  private drawButtons(ctx: CanvasRenderingContext2D, t: number): void {
    for (let i = 0; i < this.buttons.length; i++) {
      const b = this.buttons[i];
      const lit = i === this.focus;
      ctx.fillStyle = lit ? '#1a2a14' : '#0d1118';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = lit ? '#f5c542' : '#3a3f4c';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      drawTextSh(ctx, b.label, b.x + b.w / 2, b.y + Math.floor((b.h - 7) / 2), 1, lit ? '#f5c542' : '#c8ccd4', 'center');
      if (lit && (t & 16) !== 0) drawText(ctx, '>', b.x + 3, b.y + Math.floor((b.h - 7) / 2), 1, '#7fd858');
    }
  }

  // ---------- CONNECT screen ----------
  private drawConnect(ctx: CanvasRenderingContext2D, t: number): void {
    this.buttons = [];
    drawTextSh(ctx, 'THE GATE', VW / 2, 16, 3, '#f5c542', 'center', '#b8860b');
    drawAlgoLogo(ctx, VW / 2 - 58, 44, 2, '#f2f2f2');
    drawText(ctx, 'POWERED BY ALGORAND', VW / 2 - 40, 48, 1, '#8a8f9c');

    drawText(ctx, 'STAGE 1 IS FREE FOR ALL.', VW / 2, 66, 1, '#c8ccd4', 'center');
    drawText(ctx, 'THE GONNAVERSE BEYOND IS FOR HOLDERS:', VW / 2, 78, 1, '#c8ccd4', 'center');
    drawTextSh(ctx, '>= 1 GONNA NFT', VW / 2 - 90, 92, 1, '#7fd858');
    drawTextSh(ctx, 'OR', VW / 2, 92, 1, '#8a8f9c', 'center');
    drawTextSh(ctx, '>= 2B $GONNA', VW / 2 + 14, 92, 1, '#7fd858');

    const w = wallet.getWallet();
    if (w.connecting && (t & 8) !== 0) drawText(ctx, 'WAITING FOR WALLET...', VW / 2, 110, 1, '#f5c542', 'center');

    this.pushBtn({ id: 'pera', label: 'CONNECT PERA', x: 72, y: 116, w: 110, h: 20 });
    this.pushBtn({ id: 'defly', label: 'CONNECT DEFLY', x: 202, y: 116, w: 110, h: 20 });
    this.pushBtn({ id: 'tinyman', label: 'GET $GONNA', x: 72, y: 144, w: 110, h: 16 });
    this.pushBtn({ id: 'downbad', label: 'GET A GONNA NFT', x: 202, y: 144, w: 110, h: 16 });
    this.pushBtn({ id: 'back', label: 'BACK TO TITLE', x: 137, y: 168, w: 110, h: 14 });
    this.drawButtons(ctx, t);
    this.focus = clamp(this.focus, 0, this.buttons.length - 1);

    if (this.status) drawText(ctx, this.status, VW / 2, 192, 1, '#f5c542', 'center');
    drawText(ctx, 'MOBILE: YOUR WALLET APP OPENS AND RETURNS HERE', VW / 2, 206, 1, '#5a5f6c', 'center');
  }

  // ---------- GATE screen (connected, not eligible) ----------
  private drawGate(ctx: CanvasRenderingContext2D, t: number, frames: Map<string, HTMLImageElement>): void {
    this.buttons = [];
    drawTextSh(ctx, 'THE GONNAVERSE CONTINUES', VW / 2, 14, 2, '#f5c542', 'center', '#b8860b');
    drawTextSh(ctx, 'FOR HOLDERS', VW / 2, 32, 2, '#f5c542', 'center', '#b8860b');

    const e = wallet.getEligibility();
    drawText(ctx, 'REQUIREMENTS (MAINNET):', VW / 2, 54, 1, '#c8ccd4', 'center');
    const nftOk = e.nfts.length >= 1;
    const gonnaOk = e.gonna >= wallet.GONNA_THRESHOLD;
    drawText(ctx, 'GONNA NFTS', 96, 68, 1, '#8a8f9c');
    drawText(ctx, String(e.nfts.length) + ' / 1', VW - 96, 68, 1, nftOk ? '#7fd858' : '#e23b3b', 'right');
    drawText(ctx, '$GONNA', 96, 80, 1, '#8a8f9c');
    drawText(ctx, fmtCompact(e.gonna) + ' / 2.00B', VW - 96, 80, 1, gonnaOk ? '#7fd858' : '#e23b3b', 'right');
    if (e.busy && (t & 8) !== 0) drawText(ctx, 'CONSULTING THE INDEXER...', VW / 2, 94, 1, '#f5c542', 'center');
    else if (this.status) drawText(ctx, this.status, VW / 2, 94, 1, '#f5c542', 'center');

    drawWalletPanel(ctx, 104, t, frames);

    this.pushBtn({ id: 'tinyman', label: 'GET $GONNA', x: 32, y: 152, w: 100, h: 16 });
    this.pushBtn({ id: 'downbad', label: 'GET A GONNA NFT', x: 142, y: 152, w: 100, h: 16 });
    this.pushBtn({ id: 'recheck', label: 'RE-CHECK', x: 252, y: 152, w: 100, h: 16 });
    this.pushBtn({ id: 'disconnect', label: 'DISCONNECT', x: 87, y: 176, w: 100, h: 14 });
    this.pushBtn({ id: 'back', label: 'BACK TO TITLE', x: 197, y: 176, w: 100, h: 14 });
    this.drawButtons(ctx, t);
    this.focus = clamp(this.focus, 0, this.buttons.length - 1);

    drawText(ctx, 'HOLD TO EARN YOUR PLACE AMONG THE BYZANTINES', VW / 2, 206, 1, '#5a5f6c', 'center');
  }

  // ---------- CHOOSE YOUR FIGHTER ----------
  private drawFighter(ctx: CanvasRenderingContext2D, t: number, frames: Map<string, HTMLImageElement>): void {
    this.buttons = [];
    const athlete = this.athleteMode();
    drawTextSh(ctx, athlete ? 'ATHLETE SELECT' : 'CHOOSE YOUR FIGHTER', VW / 2, 8, 2, '#f5c542', 'center', '#b8860b');
    // leaderboard banner
    drawText(ctx, 'NFT ATHLETES ENTER THE TOP GONNAS LEADERBOARD', VW / 2, 26, 1, '#7fd858', 'center');
    drawText(ctx, 'IMMORTALIZE YOUR LIZARD', VW / 2, 35, 1, '#4a9e3a', 'center');

    this.drawPortrait(ctx, t, frames, athlete);
    if (athlete) this.drawAthleteList(ctx, t, frames);
    else this.drawSkinGrid(ctx, t, frames);

    // wallet strip (compact) when connected
    if (wallet.isConnected()) drawWalletPanel(ctx, VH - 44, t, frames);
    else drawText(ctx, 'HOLDERS UNLOCK NFT ATHLETES - PASS THE GATE', VW / 2, VH - 10, 1, '#5a5f6c', 'center');

    if ((t & 32) !== 0) drawText(ctx, 'ENTER FIGHT - ESC BACK', VW / 2, VH - 52, 1, '#8a8f9c', 'center');
    if (this.teaser) this.drawTeaser(ctx, t, frames);
  }

  private drawPortrait(ctx: CanvasRenderingContext2D, t: number, frames: Map<string, HTMLImageElement>, athlete: boolean): void {
    const f = this.fighter;
    // pedestal
    ctx.fillStyle = '#0d1a12';
    ctx.fillRect(10, 46, 130, 126);
    ctx.strokeStyle = '#1e6b2a';
    ctx.strokeRect(10.5, 46.5, 129, 125);
    const info = SKIN_INFO[f.skin];
    const IDLE = ['0_0', '0_1', '0_3', '0_5'];
    const key = IDLE[(t >> 4) & 3];
    const img = f.skin === 'gonna' ? frames.get(key) : (skinFramesLoaded(f.skin)?.get(key) ?? null);
    const BIG = 0.92;
    if (img) {
      const dw = img.width * BIG;
      const dh = img.height * BIG;
      ctx.drawImage(img, Math.round(75 - dw / 2), Math.round(170 - dh), Math.round(dw), Math.round(dh));
    } else {
      ctx.fillStyle = info.accent;
      ctx.fillRect(50, 96, 50, 74);
      if ((t & 16) !== 0) drawText(ctx, '...', 75, 128, 1, '#070a14', 'center');
    }
    // favorite star (athlete NFTs only)
    if (athlete && f.assetId !== null) {
      const fav = loadFavorite() === f.assetId;
      const sx = 126;
      const sy = 52;
      this.hots.push({ x: sx - 5, y: sy - 5, w: 18, h: 18, id: 'btn:fav', data: 0 });
      drawText(ctx, '*', sx, sy, 2, fav ? '#f5c542' : '#3a3f4c');
      if (fav) drawText(ctx, 'MVP', sx - 13, sy + 16, 1, '#f5c542');
    }
    // quick arrows on the portrait (athlete mode)
    if (athlete) {
      const ay = 100;
      this.hots.push({ x: 12, y: ay - 12, w: 18, h: 28, id: 'btn:prev', data: 0 });
      this.hots.push({ x: 120, y: ay - 12, w: 18, h: 28, id: 'btn:next', data: 0 });
      if ((t & 16) !== 0) {
        drawTextSh(ctx, '<', 16, ay, 2, '#c8ccd4');
        drawTextSh(ctx, '>', 126, ay, 2, '#c8ccd4');
      }
    }
    // name plate
    drawTextSh(ctx, f.name, 75, 178, 1, '#f5c542', 'center');
    drawText(ctx, info.label, 75, 188, 1, info.accent, 'center');
    if (athlete) {
      // FIGHT button under the name plate
      const b: Btn = { id: 'fight', label: 'FIGHT!', x: 30, y: 198, w: 90, h: 22 };
      this.pushBtn(b);
      ctx.fillStyle = '#1a2a14';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = (t & 8) !== 0 ? '#f5c542' : '#b8860b';
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      drawTextSh(ctx, 'FIGHT!', b.x + b.w / 2, b.y + 7, 1, '#f5c542', 'center');
    }
  }

  private drawSkinGrid(ctx: CanvasRenderingContext2D, t: number, frames: Map<string, HTMLImageElement>): void {
    const unlocked = this.unlockedSkins();
    const gx0 = 152;
    const gy0 = 50;
    const tw = 44;
    const th = 56;
    const gap = 4;
    for (let i = 0; i < SKINS.length; i++) {
      const skin = SKINS[i];
      const col = i % 5;
      const rowi = Math.floor(i / 5);
      const x = gx0 + col * (tw + gap);
      const y = gy0 + rowi * (th + gap);
      const open = unlocked.has(skin);
      const cur = i === this.gridCur;
      this.hots.push({ x, y, w: tw, h: th, id: 'tile', data: i });
      ctx.fillStyle = open ? '#101826' : '#0a0d14';
      ctx.fillRect(x, y, tw, th);
      ctx.strokeStyle = cur ? '#f5c542' : open ? '#1e6b2a' : '#26262e';
      ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);
      const img = skin === 'gonna' ? frames.get('0_0') : (skinPortrait(skin) ?? skinFramesLoaded(skin)?.get('0_0') ?? null);
      if (img) {
        const dh = 38;
        const dw = Math.min(tw - 8, dh * (img.width / img.height));
        ctx.drawImage(img, Math.round(x + tw / 2 - dw / 2), y + 4, Math.round(dw), dh);
        if (!open) {
          ctx.fillStyle = 'rgba(5,6,10,0.62)';
          ctx.fillRect(x + 1, y + 1, tw - 2, th - 2);
          // shimmer sweep
          const sx = x + ((t * 2 + i * 23) % (tw + 30)) - 15;
          ctx.fillStyle = 'rgba(245,197,66,0.20)';
          ctx.fillRect(sx, y + 1, 3, th - 2);
          ctx.fillRect(sx + 4, y + 1, 1, th - 2);
          // keyhole
          ctx.fillStyle = '#b8860b';
          ctx.fillRect(x + tw / 2 - 2, y + 20, 4, 4);
          ctx.fillRect(x + tw / 2 - 1, y + 24, 2, 5);
        }
      } else {
        ctx.fillStyle = SKIN_INFO[skin].accent;
        ctx.globalAlpha = open ? 1 : 0.3;
        ctx.fillRect(x + 12, y + 8, tw - 24, 30);
        ctx.globalAlpha = 1;
      }
      drawText(ctx, SKIN_INFO[skin].label, x + tw / 2, y + th - 9, 1, open ? SKIN_INFO[skin].accent : '#3a3f4c', 'center');
      if (cur && (t & 16) !== 0) drawText(ctx, '>', x - 8, y + th / 2 - 4, 1, '#7fd858');
    }
  }

  private drawAthleteList(ctx: CanvasRenderingContext2D, t: number, frames: Map<string, HTMLImageElement>): void {
    const lx = 150;
    const lw = VW - lx - 8;
    let y = 48;
    // RECENT FIGHTERS strip (owned NFTs from the last-5 list)
    const recents = loadRecents()
      .filter((k) => k.startsWith('nft:'))
      .map((k) => Number(k.slice(4)))
      .map((id) => wallet.getEligibility().nfts.find((n) => n.id === id))
      .filter((n): n is OwnedNft => !!n)
      .slice(0, 5);
    if (recents.length > 0) {
      drawText(ctx, 'RECENT FIGHTERS', lx, y, 1, '#8a8f9c');
      y += 9;
      for (let i = 0; i < recents.length; i++) {
        const x = lx + i * 34;
        this.hots.push({ x, y, w: 32, h: 26, id: 'recent', data: recents[i].id });
        const cur = this.fighter.assetId === recents[i].id;
        ctx.fillStyle = '#101826';
        ctx.fillRect(x, y, 32, 26);
        ctx.strokeStyle = cur ? '#f5c542' : '#1e6b2a';
        ctx.strokeRect(x + 0.5, y + 0.5, 31, 25);
        const img = recents[i].skin === 'gonna' ? frames.get('0_0') : skinPortrait(recents[i].skin);
        if (img) {
          const dh = 18;
          const dw = Math.min(28, dh * (img.width / img.height));
          ctx.drawImage(img, Math.round(x + 16 - dw / 2), y + 3, Math.round(dw), dh);
        }
      }
      y += 32;
    }
    // RANDOM button
    const rb: Btn = { id: 'random', label: 'RANDOM', x: lx, y, w: 52, h: 12 };
    this.pushBtn(rb);
    ctx.fillStyle = '#0d1118';
    ctx.fillRect(rb.x, rb.y, rb.w, rb.h);
    ctx.strokeStyle = '#b8860b';
    ctx.strokeRect(rb.x + 0.5, rb.y + 0.5, rb.w - 1, rb.h - 1);
    drawText(ctx, 'RANDOM', rb.x + 26, rb.y + 3, 1, '#f5c542', 'center');
    drawText(ctx, 'X RANDOM - Z STAR', lx + 58, y + 3, 1, '#5a5f6c');
    y += 16;

    // grouped athlete rows (collapsible), clipped window with scroll follow
    const listTop = y;
    const listH = VH - 48 - listTop; // stop above the wallet strip
    const rowH = 13;
    const maxVis = Math.max(1, Math.floor(listH / rowH));
    let first = 0;
    if (this.rowCur >= maxVis) first = this.rowCur - maxVis + 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(lx - 2, listTop, lw + 4, listH);
    ctx.clip();
    for (let vi = 0; vi < maxVis; vi++) {
      const ri = first + vi;
      if (ri >= this.rows.length) break;
      const row = this.rows[ri];
      const ry = listTop + vi * rowH;
      const cur = ri === this.rowCur;
      if (row.kind === 'head') {
        const mine = wallet.getEligibility().nfts.filter((n) => n.skin === row.skin).length;
        ctx.fillStyle = '#0d1118';
        ctx.fillRect(lx, ry, lw, rowH - 1);
        drawText(ctx, (this.collapsed.has(row.skin) ? '+ ' : '- ') + SKIN_INFO[row.skin].label + ' (' + mine + ')', lx + 4, ry + 3, 1, SKIN_INFO[row.skin].accent);
      } else {
        const isSel = this.fighter.assetId === row.nft!.id;
        ctx.fillStyle = isSel ? '#16240f' : '#0a0e14';
        ctx.fillRect(lx, ry, lw, rowH - 1);
        const img = row.skin === 'gonna' ? frames.get('0_0') : skinPortrait(row.skin);
        if (img) {
          const dh = 11;
          const dw = Math.min(10, dh * (img.width / img.height));
          ctx.drawImage(img, lx + 5, ry + 1, Math.round(dw), dh);
        }
        drawText(ctx, row.nft!.name, lx + 18, ry + 3, 1, isSel ? '#f5c542' : '#c8ccd4');
        if (loadFavorite() === row.nft!.id) drawText(ctx, '*', lx + lw - 10, ry + 3, 1, '#f5c542');
      }
      this.hots.push({ x: lx, y: ry, w: lw, h: rowH - 1, id: 'row', data: ri });
      if (cur && (t & 16) !== 0) drawText(ctx, '>', lx - 9, ry + 3, 1, '#7fd858');
    }
    ctx.restore();
    if (this.rows.length > maxVis) {
      drawText(ctx, (first + 1) + '-' + Math.min(this.rows.length, first + maxVis) + '/' + this.rows.length, lx + lw, listTop - 2, 1, '#5a5f6c', 'right');
    }
  }

  // ---------- teaser card (locked skin) ----------
  private drawTeaser(ctx: CanvasRenderingContext2D, t: number, frames: Map<string, HTMLImageElement>): void {
    const skin = this.teaser!;
    const info = SKIN_INFO[skin];
    ctx.fillStyle = 'rgba(4,5,10,0.88)';
    ctx.fillRect(0, 0, VW, VH);
    const px = 72;
    const py = 40;
    const pw = VW - 144;
    const ph = 144;
    ctx.fillStyle = '#0d1118';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = '#f5c542';
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    ctx.strokeStyle = '#1e6b2a';
    ctx.strokeRect(px + 3.5, py + 3.5, pw - 7, ph - 7);
    drawTextSh(ctx, 'LOCKED ATHLETE', px + pw / 2, py + 10, 2, '#f5c542', 'center', '#b8860b');
    const img = skin === 'gonna' ? frames.get('0_0') : skinPortrait(skin);
    if (img) {
      const dh = 52;
      const dw = Math.min(60, dh * (img.width / img.height));
      ctx.drawImage(img, Math.round(px + pw / 2 - dw / 2), py + 28, Math.round(dw), dh);
    }
    drawText(ctx, info.label + ' GONNA', px + pw / 2, py + 84, 1, info.accent, 'center');
    drawText(ctx, 'OWN THIS GONNA NFT TO FIGHT', px + pw / 2, py + 96, 1, '#c8ccd4', 'center');
    drawText(ctx, 'AS ' + info.label, px + pw / 2, py + 106, 1, '#c8ccd4', 'center');
    const b1: Btn = { id: 'downbad', label: 'DOWNBAD', x: px + 14, y: py + 118, w: 66, h: 14 };
    const b2: Btn = { id: 'statto', label: 'STATTO', x: px + 88, y: py + 118, w: 66, h: 14 };
    const b3: Btn = { id: 'close', label: 'CLOSE', x: px + 162, y: py + 118, w: 62, h: 14 };
    for (const b of [b1, b2, b3]) {
      this.hots.push({ x: b.x, y: b.y, w: b.w, h: b.h, id: 'btn:' + b.id, data: 0 });
      ctx.fillStyle = '#1a2a14';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = '#b8860b';
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      drawText(ctx, b.label, b.x + b.w / 2, b.y + 4, 1, '#f5c542', 'center');
    }
    if ((t & 16) !== 0) drawText(ctx, 'ESC / TAP OUTSIDE TO CLOSE', px + pw / 2, py + ph + 8, 1, '#5a5f6c', 'center');
  }
}
