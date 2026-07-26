// THE GATE — Algorand wallet connection (Pera + Defly, mainnet, lazy-loaded)
// + $GONNA / GONNA NFT eligibility via public indexers (with 24h grace cache).
// A mock mode (window-injectable, persisted) drives the whole flow in CI.

import { loadSkinMap, skinForAsset } from './skins';
import type { SkinId } from './skins';

// ---------- official on-chain data ----------
export const GONNA_ASA = 2582294183;
export const GONNA_THRESHOLD = 2_000_000_000; // >= 2B $GONNA (display units)
export const GONNA_CREATOR = 'GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU';
export const LINK_TINYMAN = 'https://app.tinyman.org/swap?asset_in=0&asset_out=2582294183';
export const LINK_DOWNBAD = 'https://www.downbad.farm/collection/gonna';
export const LINK_STATTO = 'https://www.statto.xyz/collections/19186?tab=listings';

const INDEXERS = ['https://mainnet-idx.algonode.cloud', 'https://mainnet-idx.4160.nodely.dev'];
const GRACE_MS = 24 * 60 * 60 * 1000; // indexer down -> cache valid 24h
const KEY_WALLET = 'gonna.wallet'; // {provider, address}
const KEY_ELIG = 'gonna.elig'; // {address, ok, algo, gonna, gonnaDecimals, nfts, ts}
const KEY_MOCK = 'gonna.mockwallet'; // CI mock state
const KEY_DECIMALS = 'gonna.asa.decimals';

export type WalletProvider = 'pera' | 'defly';

export interface WalletState {
  provider: WalletProvider | null;
  address: string | null;
  connecting: boolean;
  mocked: boolean;
}

export interface OwnedNft {
  id: number;
  name: string;
  skin: SkinId;
}

export interface Eligibility {
  checked: boolean; // a result (live or grace cache) is available
  ok: boolean; // eligible: >=1 GONNA NFT or >= threshold $GONNA
  algo: number; // display ALGO
  gonna: number; // display $GONNA
  gonnaDecimals: number;
  nfts: OwnedNft[];
  ts: number; // ms epoch of the last successful check
  source: 'indexer' | 'cache' | 'mock' | null;
  busy: boolean; // a fetch is in flight
  error: boolean; // last fetch failed AND no usable cache
}

export interface MockWallet {
  address?: string;
  algo?: number; // display ALGO
  gonna?: number; // display $GONNA
  nfts?: { id: number; name: string; skin: string }[];
}

interface WalletLib {
  connect(): Promise<string[]>;
  reconnectSession(): Promise<string[]>;
  disconnect(): Promise<void> | void;
  signTransaction?: (txGroups: unknown[][], signerAddress?: string) => Promise<Uint8Array[]>;
}

const state: WalletState = { provider: null, address: null, connecting: false, mocked: false };
const elig: Eligibility = {
  checked: false, ok: false, algo: 0, gonna: 0, gonnaDecimals: 6,
  nfts: [], ts: 0, source: null, busy: false, error: false,
};

let lib: WalletLib | null = null; // live wallet instance (pera or defly)
let mock: MockWallet | null = null;

function lsGet(k: string): string | null {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string): void {
  try {
    window.localStorage.setItem(k, v);
  } catch { /* storage unavailable */ }
}
function lsDel(k: string): void {
  try {
    window.localStorage.removeItem(k);
  } catch { /* ignore */ }
}

const MOCKABLE_SKINS = ['gonna', 'invert', 'black', 'patriot', 'fire', 'rainbow', 'leaf', 'pollution', 'acid', 'alien'];

// ---------- mock mode (CI) ----------
export function setMock(m: MockWallet | null): void {
  mock = m;
  if (m) {
    lsSet(KEY_MOCK, JSON.stringify(m));
    state.mocked = true;
    state.provider = 'pera';
    state.address = m.address ?? 'MOCKWALLETX7GONNAVERSE5555555555555555555555555555';
    const nfts = normalizeMockNfts(m.nfts ?? []);
    const gonna = m.gonna ?? 0;
    applyElig({
      checked: true,
      ok: nfts.length >= 1 || gonna >= GONNA_THRESHOLD,
      algo: m.algo ?? 0,
      gonna,
      nfts,
      ts: Date.now(),
      source: 'mock',
    });
  } else {
    lsDel(KEY_MOCK);
    state.mocked = false;
    state.provider = null;
    state.address = null;
    applyElig({ checked: false, ok: false, algo: 0, gonna: 0, nfts: [], ts: 0, source: null });
  }
}

function normalizeMockNfts(list: { id: number; name: string; skin: string }[]): OwnedNft[] {
  const out: OwnedNft[] = [];
  for (const n of list) {
    const s = String(n.skin).toLowerCase();
    if (MOCKABLE_SKINS.includes(s)) {
      out.push({ id: n.id, name: n.name || 'GONNA #' + n.id, skin: s as SkinId });
    }
  }
  return out;
}

function applyElig(p: Partial<Eligibility>): void {
  Object.assign(elig, p, { busy: false, error: false });
}

// ---------- wallet libraries (lazy) ----------
async function loadLib(provider: WalletProvider): Promise<WalletLib> {
  if (lib) return lib;
  if (provider === 'pera') {
    const mod = await import('@perawallet/connect');
    lib = new mod.PeraWalletConnect({ chainId: 416001 }) as unknown as WalletLib; // mainnet
  } else {
    const mod = await import('@blockshake/defly-connect');
    lib = new mod.DeflyWalletConnect({ chainId: 416001 }) as unknown as WalletLib;
  }
  return lib;
}

export async function connect(provider: WalletProvider): Promise<string> {
  if (mock) return state.address!; // CI: already "connected"
  state.connecting = true;
  try {
    const w = await loadLib(provider);
    const accounts = await w.connect();
    if (!accounts || accounts.length === 0) throw new Error('no account selected');
    state.provider = provider;
    state.address = accounts[0];
    lsSet(KEY_WALLET, JSON.stringify({ provider, address: state.address }));
    void refreshEligibility(true);
    return state.address;
  } finally {
    state.connecting = false;
  }
}

export async function disconnect(): Promise<void> {
  if (mock) {
    setMock(null);
    return;
  }
  try {
    if (lib) await lib.disconnect();
  } catch { /* wallet already gone */ }
  lib = null;
  state.provider = null;
  state.address = null;
  lsDel(KEY_WALLET);
  lsDel(KEY_ELIG);
  applyElig({ checked: false, ok: false, algo: 0, gonna: 0, nfts: [], ts: 0, source: null });
}

// boot: restore a persisted session (mock in CI, wallet lib otherwise)
export function init(): void {
  const rawMock = lsGet(KEY_MOCK);
  if (rawMock) {
    try {
      setMock(JSON.parse(rawMock) as MockWallet);
      return;
    } catch { /* fall through to real restore */ }
  }
  const raw = lsGet(KEY_WALLET);
  if (!raw) return;
  let saved: { provider: WalletProvider; address: string };
  try {
    saved = JSON.parse(raw) as { provider: WalletProvider; address: string };
  } catch {
    return;
  }
  state.provider = saved.provider;
  state.address = saved.address;
  loadCachedElig(saved.address); // instant UI from the last good check
  void (async () => {
    try {
      const w = await loadLib(saved.provider);
      const accounts = await w.reconnectSession();
      if (!accounts || accounts.length === 0) throw new Error('session expired');
      state.address = accounts[0];
    } catch {
      // keep the persisted address in a soft state; the user can reconnect
    }
    void refreshEligibility(false);
  })();
}

function loadCachedElig(address: string): void {
  const raw = lsGet(KEY_ELIG);
  if (!raw) return;
  try {
    const c = JSON.parse(raw) as { address: string; ok: boolean; algo: number; gonna: number; gonnaDecimals?: number; nfts: OwnedNft[]; ts: number };
    if (c.address !== address) return;
    elig.checked = true;
    elig.ok = c.ok;
    elig.algo = c.algo;
    elig.gonna = c.gonna;
    elig.gonnaDecimals = c.gonnaDecimals ?? 6;
    elig.nfts = Array.isArray(c.nfts) ? c.nfts : [];
    elig.ts = c.ts;
    elig.source = 'cache';
  } catch { /* corrupt cache: ignore */ }
}

// ---------- eligibility ----------
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

async function gonnaDecimals(): Promise<number> {
  const raw = lsGet(KEY_DECIMALS);
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  const j = (await idxFetch('/v2/assets/' + GONNA_ASA)) as { asset: { params: { decimals: number } } };
  const d = j.asset.params.decimals;
  lsSet(KEY_DECIMALS, String(d));
  return d;
}

export async function refreshEligibility(force: boolean): Promise<Eligibility> {
  if (mock) return elig; // mock state is authoritative
  if (!state.address) return elig;
  if (elig.busy) return elig;
  if (!force && elig.checked && elig.source === 'indexer' && Date.now() - elig.ts < 10 * 60 * 1000) return elig;
  elig.busy = true;
  elig.error = false;
  try {
    const [dec, acct] = await Promise.all([
      gonnaDecimals(),
      idxFetch('/v2/accounts/' + state.address) as Promise<{ amount: number; assets?: { 'asset-id': number; amount: number }[] }>,
    ]);
    const assets = acct.assets ?? [];
    const holding = assets.find((a) => a['asset-id'] === GONNA_ASA);
    const gonna = holding ? holding.amount / Math.pow(10, dec) : 0;
    await loadSkinMap();
    const nfts: OwnedNft[] = [];
    for (const a of assets) {
      if (a.amount <= 0) continue;
      const hit = skinForAsset(a['asset-id']);
      if (hit) nfts.push({ id: a['asset-id'], name: hit.name, skin: hit.skin });
    }
    nfts.sort((x, y) => x.id - y.id);
    applyElig({
      checked: true,
      ok: nfts.length >= 1 || gonna >= GONNA_THRESHOLD,
      algo: acct.amount / 1e6,
      gonna,
      gonnaDecimals: dec,
      nfts,
      ts: Date.now(),
      source: 'indexer',
    });
    lsSet(KEY_ELIG, JSON.stringify({ address: state.address, ok: elig.ok, algo: elig.algo, gonna: elig.gonna, gonnaDecimals: dec, nfts: elig.nfts, ts: elig.ts }));
  } catch {
    elig.busy = false;
    // 24h grace: a fresh-enough cached verdict still opens the gate
    if (elig.checked && Date.now() - elig.ts < GRACE_MS) {
      elig.source = 'cache';
    } else {
      elig.error = true;
    }
  }
  return elig;
}

// ---------- accessors ----------
export function getWallet(): WalletState {
  return state;
}
export function getEligibility(): Eligibility {
  return elig;
}
export function isConnected(): boolean {
  return state.address !== null;
}
export function isEligible(): boolean {
  return elig.checked && elig.ok;
}
export function shortAddress(): string {
  const a = state.address;
  if (!a) return '';
  return a.slice(0, 5) + '...' + a.slice(-4);
}

// v9.1 readiness: raw transaction signing through the active wallet session
export async function signTransactions(txGroups: unknown[][]): Promise<Uint8Array[]> {
  if (mock) throw new Error('mock wallet cannot sign');
  if (!lib || !lib.signTransaction) throw new Error('wallet not connected');
  return lib.signTransaction(txGroups, state.address ?? undefined);
}
