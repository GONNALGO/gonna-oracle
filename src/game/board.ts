// v9.1 — GLOBAL LEADERBOARD: every SEAL lives on-chain as a 0-ALGO payment to
// the treasury with a GONNAFIGHT|1 note. Anyone can read the board — no wallet
// needed. Indexer note-prefix query + pagination, malformed notes ignored,
// results cached 5 min in localStorage.
import * as wallet from './wallet';
import { isSkin } from './skins';
import type { SkinId } from './skins';

const INDEXERS = ['https://mainnet-idx.algonode.cloud', 'https://mainnet-idx.4160.nodely.dev'];
const PREFIX_B64 = typeof btoa !== 'undefined' ? btoa('GONNAFIGHT|') : '';
const KEY_BOARD = 'gonna.board'; // {ts, entries}
const CACHE_MS = 5 * 60 * 1000;
const PAGE = 200;
const CAP = 1000;
export const TOP_N = 50;

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
}

export type BoardTab = 'wallets' | 'gonnas';
export type BoardStatus = 'idle' | 'loading' | 'ready' | 'error';

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

// strict pipe-format parse — anything malformed is silently ignored
function parseNote(b64: string): Omit<BoardEntry, 'sender' | 'round' | 'txid'> | null {
  let text: string;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    text = new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
  const f = text.split('|');
  if (f.length !== 9) return null;
  if (f[0] !== 'GONNAFIGHT' || f[1] !== '1') return null;
  const score = Number(f[2]);
  if (!/^\d+$/.test(f[2]) || !Number.isSafeInteger(score) || score < 0) return null;
  const stage = Number(f[3]);
  if (!/^\d+$/.test(f[3]) || stage < 1 || stage > 6) return null;
  if (f[4] !== '0' && f[4] !== '1') return null;
  const continues = Number(f[5]);
  if (!/^\d+$/.test(f[5]) || continues < 0 || continues > 9999) return null;
  const assetId = Number(f[6]);
  if (!/^\d+$/.test(f[6]) || !Number.isSafeInteger(assetId) || assetId < 0) return null;
  const skin = f[7].toLowerCase();
  return {
    score,
    stage,
    win: f[4] === '1' ? 1 : 0,
    continues,
    assetId,
    skin: isSkin(skin) ? skin : 'gonna',
    msg: f[8].slice(0, 32),
  };
}

interface IdxTx {
  id?: string;
  sender?: string;
  note?: string;
  'confirmed-round'?: number;
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
  if (!force && data.status === 'ready' && Date.now() - data.ts < CACHE_MS) return Promise.resolve(data);
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

// ranking: score desc -> continues asc -> confirmed-round asc; best entry per
// key (wallet address / NFT assetId), TOP_N rows
export function ranked(tab: BoardTab): BoardEntry[] {
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
    if (out.length >= TOP_N) break;
  }
  return out;
}
