// v9.1 — GLOBAL LEADERBOARD: every SEAL lives on-chain as a 0-ALGO payment to
// the treasury with a GONNAFIGHT| note. Anyone can read the board — no wallet
// needed. Indexer note-prefix query + pagination, malformed notes ignored,
// results cached 5 min in localStorage.
// v9.2 — THE ARENA: note v2 telemetry (timeSec/deaths/maxCombo) parsed with
// full v1 backward compatibility, sortable columns, podium badges
// (BYZANTINE CLEAR / SPEED DEMON / COMBO KING), NEW tag (<24h), stage names,
// $GONNA-branded thousands-separated scores, 3-level drill-down grouping
// (board -> player/fighter card -> run card).
import * as wallet from './wallet';
import { isSkin } from './skins';
import type { SkinId } from './skins';
import { b64ToBytes } from './b64';

const INDEXERS = ['https://mainnet-idx.algonode.cloud', 'https://mainnet-idx.4160.nodely.dev'];
// v9.3.1: precomputed base64 of 'GONNAFIGHT|' — no btoa literal (server AV false positive)
const PREFIX_B64 = 'R09OTkFGSUdIVHw=';
const KEY_BOARD = 'gonna.board'; // {ts, entries}
const CACHE_MS = 5 * 60 * 1000;
const PAGE = 200;
const CAP = 1000;
export const TOP_N = 50;
export const NEW_MS = 24 * 60 * 60 * 1000; // a seal is NEW for 24h

// v9.3.7: THE SOVEREIGN — winner of COMPETITION 01 (BOTH thrones: top wallet
// AND top GONNA NFT). This is FOREVER: the coin was minted, the flag is set,
// the badge never leaves his rows. (Ceremony: gonna.sovereign.v1)
export const SOVEREIGN = '7XB3ADS5HLBXFJH6NGY7S4Z5AJ6FYT7JOSDALYTOO3SIW3BCAC2Y2NQK4I'; // friedbean.algo
export const SOVEREIGN_ASSET = 3564239452; // GONNA404 — the TOP GONNAS throne

// v9.2: stage shown as its name, not a bare number (stages.ts sub titles)
export const STAGE_NAMES = [
  'GHETTO GONNA',
  'PUMP HARBOR',
  'BYZANTINE WALL STREET',
  'TEMPLE OF CONSENSUS',
  'THE HOUSE',
  'MOON LAUNCHPAD',
  'THE THRONE ROOM', // v9.5
] as const;
export function stageName(stage: number): string {
  return STAGE_NAMES[Math.min(7, Math.max(1, stage)) - 1];
}

// $GONNA-branded score with thousands separators: 7350 -> "7,350 $GONNA"
export function fmtScore(score: number, brand = true): string {
  const s = String(Math.max(0, Math.floor(score))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return brand ? s + ' $GONNA' : s;
}
export function fmtTime(sec: number | null): string {
  if (sec === null) return '-';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

export interface BoardEntry {
  sender: string;
  score: number;
  stage: number; // 1-6
  win: 0 | 1;
  continues: number;
  assetId: number; // 0 = free default GONNA
  skin: SkinId;
  msg: string;
  round: number; // confirmed-round
  txid: string;
  // v9.2: v2 telemetry (null on legacy v1 seals — they show only what they have)
  v: 1 | 2;
  timeSec: number | null;
  deaths: number | null;
  maxCombo: number | null;
  ts: number; // round-time (unix seconds, 0 when the indexer gave none)
}

export type BoardTab = 'wallets' | 'gonnas';
export type BoardStatus = 'idle' | 'loading' | 'ready' | 'error';
// v9.2 sortable columns
export type SortCol = 'score' | 'stage' | 'time' | 'deaths' | 'continues' | 'combo';
export const SORT_COLS: SortCol[] = ['score', 'stage', 'time', 'deaths', 'continues', 'combo'];

export interface BoardData {
  status: BoardStatus;
  entries: BoardEntry[];
  ts: number;
  fromCache: boolean;
}

const data: BoardData = { status: 'idle', entries: [], ts: 0, fromCache: false };
let busy: Promise<BoardData> | null = null;

export function boardState(): BoardData {
  return data;
}

// BYZANTINE CLEAR crown: won the whole game without a single continue
export function isCrown(e: BoardEntry): boolean {
  return e.win === 1 && e.continues === 0;
}
// v9.2: NEW tag — sealed within the last 24h
export function isNew(e: BoardEntry, now = Date.now()): boolean {
  return e.ts > 0 && now - e.ts * 1000 < NEW_MS;
}

// strict pipe-format parse — anything malformed is silently ignored.
// v9.2: BOTH grammars accepted — v1 (9 fields) and v2 (12 fields).
function parseNote(b64: string): Omit<BoardEntry, 'sender' | 'round' | 'txid' | 'ts'> | null {
  let text: string;
  try {
    text = new TextDecoder().decode(b64ToBytes(b64)); // v9.3.1: no atob literal
  } catch {
    return null;
  }
  const f = text.split('|');
  if (f[0] !== 'GONNAFIGHT') return null;
  const isV1 = f[1] === '1' && f.length === 9;
  const isV2 = f[1] === '2' && f.length === 12;
  if (!isV1 && !isV2) return null;
  const uint = (s: string, max: number): number | null => {
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n < 0 || n > max) return null;
    return n;
  };
  const score = uint(f[2], Number.MAX_SAFE_INTEGER);
  if (score === null) return null;
  const stage = uint(f[3], 6);
  if (stage === null || stage < 1) return null;
  if (f[4] !== '0' && f[4] !== '1') return null;
  const win = (f[4] === '1' ? 1 : 0) as 0 | 1;
  let continues: number | null;
  let assetId: number | null;
  let skin: string;
  let msg: string;
  let timeSec: number | null = null;
  let deaths: number | null = null;
  let maxCombo: number | null = null;
  if (isV1) {
    continues = uint(f[5], 9999);
    assetId = uint(f[6], Number.MAX_SAFE_INTEGER);
    skin = f[7].toLowerCase();
    msg = f[8];
  } else {
    timeSec = uint(f[5], 359999);
    deaths = uint(f[6], 9999);
    continues = uint(f[7], 9999);
    maxCombo = uint(f[8], 99999);
    assetId = uint(f[9], Number.MAX_SAFE_INTEGER);
    skin = f[10].toLowerCase();
    msg = f[11];
    if (timeSec === null || deaths === null || maxCombo === null) return null;
  }
  if (continues === null || assetId === null) return null;
  return {
    score,
    stage,
    win,
    continues,
    assetId,
    skin: isSkin(skin) ? skin : 'gonna',
    msg: msg.slice(0, 32),
    v: isV1 ? 1 : 2,
    timeSec,
    deaths,
    maxCombo,
  };
}

interface IdxTx {
  id?: string;
  sender?: string;
  note?: string;
  'confirmed-round'?: number;
  'round-time'?: number;
  'tx-type'?: string;
}

function readCache(): boolean {
  try {
    const raw = window.localStorage.getItem(KEY_BOARD);
    if (!raw) return false;
    const c = JSON.parse(raw) as { ts: number; entries: BoardEntry[] };
    if (!c || !Array.isArray(c.entries) || Date.now() - c.ts >= CACHE_MS) return false;
    data.entries = c.entries;
    data.ts = c.ts;
    data.status = 'ready';
    data.fromCache = true;
    return true;
  } catch {
    return false;
  }
}

function writeCache(): void {
  try {
    window.localStorage.setItem(KEY_BOARD, JSON.stringify({ ts: data.ts, entries: data.entries }));
  } catch { /* storage unavailable */ }
}

async function idxFetch(path: string): Promise<unknown> {
  let lastErr: unknown = null;
  for (const base of INDEXERS) {
    try {
      const r = await fetch(base + path);
      if (r.ok) return await r.json();
      lastErr = new Error('http ' + r.status);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('indexer unreachable');
}

export function fetchBoard(force: boolean): Promise<BoardData> {
  if (busy) return busy;
  // fresh in-memory copy or 5-min localStorage cache: no network hit
  if (!force && data.status === 'ready' && Date.now() - data.ts < CACHE_MS) {
    data.fromCache = true;
    return Promise.resolve(data);
  }
  if (!force && readCache()) return Promise.resolve(data);
  data.status = 'loading';
  busy = (async () => {
    try {
      const entries: BoardEntry[] = [];
      let next = '';
      for (;;) {
        const path =
          '/v2/transactions?address=' + wallet.SEAL_TREASURY +
          '&note-prefix=' + encodeURIComponent(PREFIX_B64) +
          '&limit=' + PAGE +
          (next ? '&next=' + encodeURIComponent(next) : '');
        const j = (await idxFetch(path)) as { transactions?: IdxTx[]; 'next-token'?: string };
        for (const tx of j.transactions ?? []) {
          if (!tx || typeof tx.note !== 'string' || typeof tx.sender !== 'string') continue;
          const p = parseNote(tx.note);
          if (!p) continue; // malformed: ignored
          entries.push({
            ...p,
            sender: tx.sender,
            round: typeof tx['confirmed-round'] === 'number' ? tx['confirmed-round'] : 0,
            txid: typeof tx.id === 'string' ? tx.id : '',
            ts: typeof tx['round-time'] === 'number' ? tx['round-time'] : 0,
          });
          if (entries.length >= CAP) break;
        }
        next = typeof j['next-token'] === 'string' ? j['next-token'] : '';
        if (!next || entries.length >= CAP) break;
      }
      data.entries = entries;
      data.ts = Date.now();
      data.status = 'ready';
      data.fromCache = false;
      writeCache();
    } catch {
      data.status = 'error';
    }
    busy = null;
    return data;
  })();
  return busy;
}

// base ranking: score desc -> continues asc -> confirmed-round asc; best entry
// per key (wallet address / NFT assetId)
function dedupe(tab: BoardTab): BoardEntry[] {
  const sorted = [...data.entries].sort(
    (a, b) => b.score - a.score || a.continues - b.continues || a.round - b.round,
  );
  const seen = new Set<string | number>();
  const out: BoardEntry[] = [];
  for (const e of sorted) {
    if (tab === 'gonnas' && e.assetId === 0) continue; // NFT athletes only
    const k = tab === 'wallets' ? e.sender : e.assetId;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

// v9.2: sortable columns — the deduped arena list re-sorted by the chosen
// column (dir: -1 desc, 1 asc). Default = $GONNA desc. Missing v1 telemetry
// always sinks to the bottom regardless of direction.
export function ranked(tab: BoardTab, sort?: { col: SortCol; dir: 1 | -1 }): BoardEntry[] {
  const rows = dedupe(tab);
  const col = sort?.col ?? 'score';
  const dir = sort?.dir ?? -1;
  const val = (e: BoardEntry): number | null => {
    switch (col) {
      case 'score': return e.score;
      case 'stage': return e.stage;
      case 'time': return e.timeSec;
      case 'deaths': return e.deaths;
      case 'continues': return e.continues;
      case 'combo': return e.maxCombo;
    }
  };
  rows.sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va === null && vb === null) return b.score - a.score || a.continues - b.continues || a.round - b.round;
    if (va === null) return 1; // unknown telemetry always last
    if (vb === null) return -1;
    if (va !== vb) return (va - vb) * dir;
    // stable tiebreak keeps the arena order meaningful
    return b.score - a.score || a.continues - b.continues || a.round - b.round;
  });
  return rows.slice(0, TOP_N);
}

// v9.2 podium badges, computed per TAB view:
// SPEED DEMON = fastest winning seal in the tab (v2 timeSec, wins only)
// COMBO KING  = best maxCombo chain in the tab (v2 maxCombo)
export function badgeKeys(tab: BoardTab): { speed: string | number | null; combo: string | number | null } {
  const rows = dedupe(tab);
  const key = (e: BoardEntry): string | number => (tab === 'wallets' ? e.sender : e.assetId);
  let speed: string | number | null = null;
  let speedT = Infinity;
  let combo: string | number | null = null;
  let comboN = -1;
  for (const e of rows) {
    if (e.win === 1 && e.timeSec !== null && e.timeSec < speedT) {
      speedT = e.timeSec;
      speed = key(e);
    }
    if (e.maxCombo !== null && e.maxCombo > comboN) {
      comboN = e.maxCombo;
      combo = key(e);
    }
  }
  return { speed, combo };
}

// v9.2: MY RANK — 1-based position of a wallet's best seal in the arena
export function rankOfWallet(sender: string): number {
  const rows = dedupe('wallets');
  for (let i = 0; i < rows.length; i++) if (rows[i].sender === sender) return i + 1;
  return 0; // not on the board
}
// rank of a freshly sealed run within the wallets arena (ACT 4 reveal):
// how many OTHER wallets sit strictly above it under the base ranking
export function rankOfEntry(e: { sender: string; score: number; continues: number; round: number }): number {
  const rows = dedupe('wallets').filter((r) => r.sender !== e.sender);
  let above = 0;
  for (const r of rows) {
    if (r.score > e.score || (r.score === e.score && (r.continues < e.continues || (r.continues === e.continues && r.round < e.round)))) above++;
  }
  return above + 1;
}

// ---------- v9.2: L2 cards (same seal data, grouped client-side) ----------
export function sealsBySender(sender: string): BoardEntry[] {
  return data.entries.filter((e) => e.sender === sender).sort((a, b) => b.round - a.round);
}
export function sealsByAsset(assetId: number): BoardEntry[] {
  return data.entries.filter((e) => e.assetId === assetId && assetId > 0).sort((a, b) => b.round - a.round);
}

export interface CareerCard {
  seals: number;
  best: number;
  totalPts: number;
  playTimeSec: number; // summed v2 timeSec (v1 seals contribute 0)
  wins: number;
  crowns: number;
  deaths: number; // summed v2 deaths
  bestCombo: number; // best v2 maxCombo
  favSkin: SkinId; // most-sealed skin
  favAsset: number; // most-sealed NFT (0 = free GONNA)
}

export function careerOf(entries: BoardEntry[]): CareerCard {
  const skinN = new Map<SkinId, number>();
  const assetN = new Map<number, number>();
  const c: CareerCard = {
    seals: entries.length,
    best: 0,
    totalPts: 0,
    playTimeSec: 0,
    wins: 0,
    crowns: 0,
    deaths: 0,
    bestCombo: 0,
    favSkin: 'gonna',
    favAsset: 0,
  };
  for (const e of entries) {
    c.best = Math.max(c.best, e.score);
    c.totalPts += e.score;
    if (e.timeSec !== null) c.playTimeSec += e.timeSec;
    if (e.win === 1) c.wins++;
    if (isCrown(e)) c.crowns++;
    if (e.deaths !== null) c.deaths += e.deaths;
    if (e.maxCombo !== null) c.bestCombo = Math.max(c.bestCombo, e.maxCombo);
    skinN.set(e.skin, (skinN.get(e.skin) ?? 0) + 1);
    assetN.set(e.assetId, (assetN.get(e.assetId) ?? 0) + 1);
  }
  let bn = -1;
  for (const [s, n] of skinN) if (n > bn) { bn = n; c.favSkin = s; }
  bn = -1;
  for (const [a, n] of assetN) if (n > bn) { bn = n; c.favAsset = a; }
  return c;
}

// fighter card extra: current owner = sender of the most recent seal
export function currentOwner(assetId: number): string | null {
  const seals = sealsByAsset(assetId);
  return seals.length > 0 ? seals[0].sender : null;
}
