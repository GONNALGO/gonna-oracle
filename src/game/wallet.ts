// THE GATE — Algorand wallet connection (Pera + Defly, mainnet, lazy-loaded)
// + $GONNA / GONNA NFT eligibility via public indexers (with 24h grace cache).
// A mock mode (window-injectable, persisted) drives the whole flow in CI.

import { isGonnaName, loadSkinMap, skinForAsset } from './skins';
import type { SkinId } from './skins';
import { maybeSovereign } from './sovereign';
import { b64ToBytes, bytesToB64 } from './b64';
import { arenaUsesTestnetChain } from './arena/chainAdapter';
import { adoptTestnetAddress, clearTestnetAddress } from './arena/testnetWallet';

// ---------- official on-chain data ----------
export const GONNA_ASA = 2582294183;
export const GONNA_THRESHOLD = 2_000_000_000; // >= 2B $GONNA (display units)
export const GONNA_CREATOR = 'GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU';
// v9.1: SEAL treasury — 0-ALGO record transactions are sent here
export const SEAL_TREASURY = 'SKRTO5VNF5DJVZUHKNKW44TT6VZJGLWTSVVYECNOY63TFKLK3OMCTLXJK4';
export const LINK_TINYMAN = 'https://app.tinyman.org/swap?asset_in=0&asset_out=2582294183';
export const LINK_DOWNBAD = 'https://www.downbad.farm/collection/gonna';
export const LINK_STATTO = 'https://www.statto.xyz/collections/19186?tab=listings';

const INDEXERS = ['https://mainnet-idx.algonode.cloud', 'https://mainnet-idx.4160.nodely.dev'];
const GRACE_MS = 24 * 60 * 60 * 1000; // indexer down -> cache valid 24h
const KEY_WALLET = 'gonna.wallet'; // {provider, address}
// v9.0.2: bumped from 'gonna.elig' — the pre-unwrap bug poisoned v1 caches
// (ok:false + 24h grace). The old key is never read again.
const KEY_ELIG = 'gonna.elig.v2'; // {address, ok, algo, gonna, gonnaDecimals, nfts, ts}
const KEY_ELIG_OLD = 'gonna.elig';
const KEY_MOCK = 'gonna.mockwallet'; // CI mock state
const KEY_DECIMALS = 'gonna.asa.decimals';
const KEY_NFD = 'gonna.nfd.v5'; // {address, name, active, ts} — 24h per-address (v5: on-chain primary NFD)
const NFD_CACHE_MS = 24 * 60 * 60 * 1000;

export type WalletProvider = 'pera' | 'defly';

export interface WalletState {
  provider: WalletProvider | null;
  address: string | null;
  connecting: boolean;
  mocked: boolean;
  // v18.1: the WC session dropped (mobile offline / wallet app killed it) but
  // the identity is KEPT — every page still recognizes the degen, and one tap
  // re-pairs. Only the explicit in-app DISCONNECT wipes the identity.
  sessionDead: boolean;
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
  connector?: { on?: (event: string, cb: (...args: unknown[]) => void) => void } | null;
}

const state: WalletState = { provider: null, address: null, connecting: false, mocked: false, sessionDead: false };
const elig: Eligibility = {
  checked: false, ok: false, algo: 0, gonna: 0, gonnaDecimals: 6,
  nfts: [], ts: 0, source: null, busy: false, error: false,
};

// v9.0.1: per-provider singletons (garage pattern) — a single shared instance
// returned the wrong wallet when the user switched providers mid-session.
const libs: Partial<Record<string, WalletLib>> = {}; // keyed provider:chainId
const libKey = (p: WalletProvider): string => p + ':' + (arenaUsesTestnetChain() ? 416002 : 416001);
// the cache key of the ACTIVE session's lib — disconnect/sign must use THIS
// (a mode flip between connect and disconnect must not orphan the session)
let activeLibKey: string | null = null;
let pendingProvider: WalletProvider | null = null; // connect in flight (mobile app-switch)
let visHookInstalled = false;
let sessionListener: (() => void) | null = null; // engine hook: session killed by the wallet app
let mock: MockWallet | null = null;

// ---------- v9.0.2 NFD identity (.algo segments, cosmetic — never blocks) ----------
export interface Identity {
  address: string | null;
  segment: string | null; // e.g. nat.gonna.algo (null = plain address)
  active: boolean; // segment is not expired
  root: boolean; // v9.2.6: owns the ROOT gonna.algo — the creator's throne (gold)
  domain: boolean; // v9.2.7: owns an active root .algo domain, no segment (cyan)
  source: 'nfd' | 'cache' | 'address' | null; // how the current label was produced
}
const identity: Identity = { address: null, segment: null, active: false, root: false, domain: false, source: null };
let nfdRun = 0; // race token: a stale resolution never overwrites a newer address

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
    resolveIdentity(state.address!); // cosmetic NFD lookup (CI: routes to empty)
  } else {
    lsDel(KEY_MOCK);
    state.mocked = false;
    state.provider = null;
    state.address = null;
    applyElig({ checked: false, ok: false, algo: 0, gonna: 0, nfts: [], ts: 0, source: null });
    clearIdentity();
  }
}

// ---------- NFD segment resolution (garage resolveNFD pattern) ----------
// Live-verified 2026-07-27 against https://api.nf.domains:
//  - /nfd/lookup?address=ADDR returns an OBJECT KEYED BY ADDRESS (not an array):
//    {"ADDR": {name, owner, caAlgo, state:"owned", expired:false, ...}} — and it
//    HIDES expired segments (ouichef.gonna.algo did not appear for its owner).
//  - /nfd/v2/search?owner=ADDR&view=brief&limit=N returns {total, nfds:[...]}
//    INCLUDING expired ones. Active/inactive flag = `expired` (bool), backed by
//    `state` ("owned" vs "expired"). Confirmed live: malicious.gonna.algo
//    (state owned, expired false) vs ouichef.gonna.algo (state expired, expired true).
interface NfdEntry {
  name?: string;
  owner?: string;
  caAlgo?: string[];
  expired?: boolean;
  state?: string;
  appID?: number; // v9.2.8: on-chain appID, matched against the reverse record
}

function nfdEntries(d: unknown): NfdEntry[] {
  if (Array.isArray(d)) return d as NfdEntry[];
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    if (Array.isArray(o.nfds)) return o.nfds as NfdEntry[];
    // keyed-by-address shape from /nfd/lookup
    return Object.values(o).filter((v): v is NfdEntry => !!v && typeof v === 'object' && typeof (v as NfdEntry).name === 'string');
  }
  return [];
}

// v9.2.8: on-chain PRIMARY (reverse record) from the NFD registry app
// 760937186 via the CORS-safe indexer (api.nf.domains /nfd/lookup has no CORS).
// box name = base64( SHA-256( "addr/algo/" + 32-byte address pubkey ) );
// value = base64, first 8 bytes big-endian uint64 = primary NFD appID.
// Never throws — 404/any failure -> null -> heuristic fallback.
async function primaryAppId(addr: string): Promise<number | null> {
  try {
    const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0, val = 0; const out: number[] = [];
    for (const c of addr) { const i = B32.indexOf(c); if (i < 0) return null;
      val = (val << 5) | i; bits += 5;
      if (bits >= 8) { out.push((val >> (bits - 8)) & 255); bits -= 8; } }
    const pk = Uint8Array.from(out.slice(0, 32));
    const pre = new TextEncoder().encode('addr/algo/');
    const buf = new Uint8Array(pre.length + 32); buf.set(pre); buf.set(pk, pre.length);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    // v9.3.1: no atob/btoa/fromCharCode literals — server AV false positive
    // v9.3.4: one patient retry on 429 (free-tier rate limit) before giving up
    const url = 'https://mainnet-idx.algonode.cloud/v2/applications/760937186/box?name=' +
      encodeURIComponent('b64:' + bytesToB64(hash));
    let r = await fetch(url);
    if (r.status === 429) {
      await new Promise<void>((res) => setTimeout(res, 1500));
      r = await fetch(url);
    }
    if (!r.ok) return null;
    const d = await r.json(); if (!d?.value) return null;
    const vb = b64ToBytes(d.value); if (vb.length < 8) return null;
    let id = 0; for (let i = 0; i < 8; i++) id = id * 256 + (vb[i] ?? 0);
    return id || null;
  } catch { return null; }
}

async function fetchNfdSegment(address: string): Promise<{ name: string; active: boolean; root?: boolean; domain?: boolean } | null> {
  const gather = async (url: string): Promise<NfdEntry[]> => {
    const r = await fetch(url);
    if (!r.ok) throw new Error('http ' + r.status);
    const d: unknown = await r.json();
    return nfdEntries(d).filter((n) => n.owner === address || (Array.isArray(n.caAlgo) && n.caAlgo.includes(address)));
  };
  // both garage endpoints in parallel: lookup is the primary, search is the
  // fallback AND the only one that surfaces expired .gonna.algo segments.
  // v9.2.8: the on-chain reverse record (primary NFD appID) rides along.
  const [a, b, p] = await Promise.allSettled([
    gather('https://api.nf.domains/nfd/lookup?address=' + address),
    gather('https://api.nf.domains/nfd/v2/search?owner=' + address + '&view=brief&limit=10'),
    primaryAppId(address),
  ]);
  const primary = p.status === 'fulfilled' ? p.value : null;
  const isPrimary = (n: NfdEntry): boolean => primary !== null && typeof n.appID === 'number' && n.appID === primary;
  // v9.2.5: ONLY .gonna.algo segments count as GONNAVERSE identity. Root NFDs
  // (friedbean.algo, mj.algo, gonna.algo itself, ...) do NOT — a wallet without
  // a .gonna.algo segment shows the plain address. Active segment = green,
  // expired segment = gray.
  const raw = [...(a.status === 'fulfilled' ? a.value : []), ...(b.status === 'fulfilled' ? b.value : [])];
  // v9.2.7/v9.2.8 hierarchy: creator ROOT (gold) > active segment (green
  // quantum light; primary first) > dormant segment (ember; primary first) >
  // PRIMARY root .algo domain (cyan) > first active domain > plain address.
  const cr = raw.find((n) => typeof n.name === 'string' && n.name.toLowerCase() === 'gonna.algo' && !n.expired);
  if (cr) return { name: 'gonna.algo', active: true, root: true };
  const all = raw.filter((n) => typeof n.name === 'string' && n.name.toLowerCase().endsWith('.gonna.algo'));
  if (all.length === 0) {
    // no segment: the PRIMARY non-expired domain wins the domain tier
    const doms = raw.filter((n) => typeof n.name === 'string' && !n.expired);
    const pd = doms.find(isPrimary);
    const dom = pd ?? doms[0];
    return dom && dom.name ? { name: dom.name.toLowerCase(), active: true, domain: true } : null;
  }
  // among own segments prefer an active one (primary breaks ties)
  const score = (n: NfdEntry): number => (n.expired ? 0 : 2) + (isPrimary(n) ? 1 : 0);
  const seen = new Set<string>();
  let best: NfdEntry | null = null;
  for (const n of all) {
    const key = String(n.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!best || score(n) > score(best)) best = n;
  }
  if (!best || !best.name) return null;
  return { name: best.name.toLowerCase(), active: !best.expired };
}

function applyIdentity(address: string | null, segment: string | null, active: boolean, source: Identity['source'], root = false, domain = false): void {
  identity.address = address;
  identity.segment = segment;
  identity.active = active;
  identity.root = root;
  identity.domain = domain;
  identity.source = source;
}

// resolve async + update when ready: the canvas redraws every frame, so the
// label simply appears in place — the gate/fighter screens never wait on NFD.
export function resolveIdentity(address: string): void {
  const run = ++nfdRun;
  applyIdentity(address, null, false, null); // address label until resolved
  try {
    const raw = lsGet(KEY_NFD);
    if (raw) {
      const c = JSON.parse(raw) as { address: string; name: string | null; active: boolean; root?: boolean; domain?: boolean; ts: number };
      if (c.address === address && Date.now() - c.ts < NFD_CACHE_MS) {
        applyIdentity(address, c.name, !!c.active, 'cache', !!c.root, !!c.domain);
        return;
      }
    }
  } catch { /* corrupt cache: resolve live */ }
  void (async () => {
    let seg: { name: string; active: boolean; root?: boolean; domain?: boolean } | null = null;
    try {
      seg = await fetchNfdSegment(address);
    } catch { /* cosmetic: silently fall back to the address */ }
    if (run !== nfdRun || state.address !== address) return; // wallet changed mid-flight
    applyIdentity(address, seg ? seg.name : null, seg ? seg.active : false, seg ? 'nfd' : 'address', !!(seg && seg.root), !!(seg && seg.domain));
    lsSet(KEY_NFD, JSON.stringify({ address, name: seg ? seg.name : null, active: seg ? seg.active : false, root: !!(seg && seg.root), domain: !!(seg && seg.domain), ts: Date.now() }));
  })();
}

function clearIdentity(): void {
  nfdRun++;
  applyIdentity(null, null, false, null);
}

export function getIdentity(): Identity {
  return identity;
}

// label for the pixel UI: segment name (truncated) or the short address
export function identityLabel(maxChars = 28): string {
  if (identity.segment) return truncatePixel(identity.segment, maxChars);
  return shortAddress();
}

// LO SPETTRO: gold = the ROOT (creator), green = active segment, ember =
// dormant segment, cyan = root .algo domain; null = caller default (address)
export function identityColor(): string | null {
  if (!identity.segment) return null;
  if (identity.root) return '#f5c542';
  if (identity.domain) return '#57c8d8';
  return identity.active ? '#7fd858' : '#5f7a52';
}

export function truncatePixel(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(1, maxChars - 3)) + '...';
}

function normalizeMockNfts(list: { id: number; name: string; skin: string }[]): OwnedNft[] {
  const out: OwnedNft[] = [];
  for (const n of list) {
    const s = String(n.skin).toLowerCase();
    // v9.1: the name guard applies to mock holdings too — a rogue card
    // (CompX Galaxy Card) can never sneak into the fighter list via CI mocks
    if (MOCKABLE_SKINS.includes(s) && isGonnaName(String(n.name ?? ''))) {
      out.push({ id: n.id, name: n.name || 'GONNA #' + n.id, skin: s as SkinId });
    }
  }
  return out;
}

function applyElig(p: Partial<Eligibility>): void {
  Object.assign(elig, p, { busy: false, error: false });
}

// ---------- wallet libraries (lazy, per-provider instances) ----------
async function loadLib(provider: WalletProvider): Promise<WalletLib> {
  // ONE GATE, ONE NETWORK: a testnet BUILD in live arena mode speaks TESTNET
  // (chainId 416002); everything else (main game, mainnet arena) rides mainnet
  // 416001. M-4: keyed on arenaUsesTestnetChain, not the mode name.
  const chainId = arenaUsesTestnetChain() ? 416002 : 416001;
  const cacheKey = provider + ':' + chainId;
  const cached = libs[cacheKey];
  if (cached) return cached;
  let w: WalletLib;
  if (provider === 'pera') {
    const mod = await import('@perawallet/connect');
    w = new mod.PeraWalletConnect({ chainId, shouldShowSignTxnToast: false }) as unknown as WalletLib;
  } else {
    const mod = await import('@blockshake/defly-connect');
    w = new mod.DeflyWalletConnect({ chainId, shouldShowSignTxnToast: false }) as unknown as WalletLib;
  }
  libs[cacheKey] = w;
  return w;
}

// the wallet app killed the session: v18.1 — GO SOFT, never log the degen
// out. Identity + caches survive (Prince: "il mobile non deve mai
// disconnettersi"); every page still recognizes the wallet and a silent
// re-pair is attempted in the background. Only the explicit in-app
// DISCONNECT (below) wipes the identity.
let healing = false; // our own recovery disconnects must not re-enter here
function sessionEnded(): void {
  if (healing) return; // self-initiated recovery disconnect — state managed by recoverSession
  if (!state.address) return; // nothing to preserve
  state.sessionDead = true;
  // v18.1: the engine is NOT kicked to the connect scene anymore — the
  // identity is intact (soft state), every page keeps rendering as connected,
  // and the background heal below re-pairs with no UI when the WC session is
  // still alive. sessionListener fires only on the explicit full wipe.
  const provider = state.provider;
  if (!provider || mock) return;
  void (async () => {
    try {
      const w = await loadLib(provider);
      const accounts = await w.reconnectSession();
      if (accounts && accounts.length > 0) applySession(provider, w, accounts);
    } catch { /* truly dead: the soft state waits for a tap on RE-PAIR */ }
  })();
}

// v18.1: the ONLY full wipe — the explicit in-app disconnect
function sessionWiped(): void {
  state.provider = null;
  state.address = null;
  state.sessionDead = false;
  activeLibKey = null;
  lsDel(KEY_WALLET);
  lsDel(KEY_ELIG);
  if (arenaUsesTestnetChain()) clearTestnetAddress();
  applyElig({ checked: false, ok: false, algo: 0, gonna: 0, nfts: [], ts: 0, source: null });
  clearIdentity();
  if (sessionListener) sessionListener();
}

// garage pattern: react to a disconnect coming from the wallet app itself
function watchDisconnect(w: WalletLib): void {
  try {
    w.connector?.on?.('disconnect', () => sessionEnded());
  } catch { /* connector not ready yet */ }
}

function applySession(provider: WalletProvider, w: WalletLib, accounts: string[]): void {
  state.provider = provider;
  state.address = accounts[0];
  state.sessionDead = false;
  activeLibKey = libKey(provider);
  lsSet(KEY_WALLET, JSON.stringify({ provider, address: state.address }));
  // identity bridge: a gate connect on the arena-testnet staging path is
  // ALSO the ARENA identity (same origin, same WC session storage)
  if (arenaUsesTestnetChain()) adoptTestnetAddress(accounts[0]);
  watchDisconnect(w);
  resolveIdentity(state.address!);
  void refreshEligibility(true);
  maybeSovereign(state.address); // v9.3.0: the crown recognizes its owner
}

// v9.0.1 MOBILE RESCUE (garage pattern): the wallet app opens via deep link and
// the browser tab goes to the background; when the player comes back mid-connect,
// resume the approved session instead of leaving the gate stuck on WAITING.
function installVisibilityRescue(): void {
  if (visHookInstalled || typeof document === 'undefined') return;
  visHookInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !pendingProvider || mock) return;
    const provider = pendingProvider;
    void (async () => {
      try {
        const w = await loadLib(provider);
        const accounts = await w.reconnectSession();
        if (accounts && accounts.length > 0) applySession(provider, w, accounts);
      } catch { /* not approved (yet): the pending connect() promise still runs */ }
    })();
  });
}

// which provider has a connect in flight (null = none) — drives the touch hint
export function getPending(): WalletProvider | null {
  return pendingProvider;
}

// engine subscribes: wallet-app disconnect kicks gate/fighter back to connect
export function onSessionEnded(cb: (() => void) | null): void {
  sessionListener = cb;
}

export async function connect(provider: WalletProvider): Promise<string> {
  if (mock) return state.address!; // CI: already "connected"
  // v18.1: a SOFT-DEAD session (address kept, WC dropped) never early-returns
  // — connect always re-pairs: silent reconnect first, fresh pairing after.
  if (state.address && state.provider === provider && !state.sessionDead) return state.address; // idempotent: already connected
  state.connecting = true;
  pendingProvider = provider;
  installVisibilityRescue();
  try {
    const w = await loadLib(provider);
    // v11 RECONNECT-FIRST: a live WalletConnect session must be REUSED —
    // calling connect() on top of it throws "Session currently connected"
    // (the Prince hit exactly this on staging).
    try {
      const existing = await w.reconnectSession();
      if (existing && existing.length > 0) {
        applySession(provider, w, existing);
        return state.address!;
      }
    } catch { /* no live session: connect fresh */ }
    try {
      const accounts = await w.connect();
      if (!accounts || accounts.length === 0) throw new Error('no account selected');
      applySession(provider, w, accounts);
      return state.address!;
    } catch (err) {
      const msg = String((err as { message?: string } | null)?.message ?? err);
      if (!msg.includes('Session currently connected')) throw err;
      // recovery path: reuse the live session; last resort = nuke + reconnect
      try {
        const re = await w.reconnectSession();
        if (re && re.length > 0) {
          applySession(provider, w, re);
          return state.address!;
        }
      } catch { /* fall through to the nuke */ }
      try { await w.disconnect(); } catch { /* already gone */ }
      const accounts = await w.connect();
      if (!accounts || accounts.length === 0) throw new Error('no account selected');
      applySession(provider, w, accounts);
      return state.address!;
    }
  } finally {
    state.connecting = false;
    pendingProvider = null;
  }
}

export async function disconnect(): Promise<void> {
  if (mock) {
    setMock(null);
    return;
  }
  const w = (activeLibKey ? libs[activeLibKey] : null) ?? (state.provider ? libs[libKey(state.provider)] : null);
  healing = true; // our own disconnect must not route through the soft path
  try {
    if (w) await w.disconnect();
  } catch { /* wallet already gone */ }
  healing = false;
  sessionWiped();
}

// v15.2.2 WEDGE CURE (gate side): the gate session doubles as the ARENA
// signer on the staging path. When WalletConnect wedges (Pera "REQUEST
// PENDING"), drop ONLY the session and re-pair fresh — identity, eligibility
// and the sealed draft all survive; the next sign lands on a clean session.
export async function recoverSession(): Promise<void> {
  if (mock || !state.provider) return; // CI mock / never connected: nothing to heal
  const provider = state.provider;
  const keepAddr = state.address;
  const w = (activeLibKey ? libs[activeLibKey] : null) ?? libs[libKey(provider)];
  healing = true; // the recovery disconnect is ours — sessionEnded stands down
  try {
    if (w) await w.disconnect();
  } catch { /* wedged beyond disconnect — connect() rebuilds below */ }
  healing = false;
  state.address = null; // force connect() past its idempotent early-return
  try {
    await connect(provider); // reconnect-first, then a FRESH pairing
  } catch (e) {
    // v18.1 (Prince: "si disconnette da solo"): a FAILED recovery (mobile
    // still offline) must NEVER log the degen out — restore the identity in
    // the soft state; every page keeps recognizing the wallet and the next
    // tap on RE-PAIR tries again. Only the WC session is gone, not the degen.
    state.provider = provider;
    state.address = keepAddr;
    state.sessionDead = true;
    if (keepAddr) lsSet(KEY_WALLET, JSON.stringify({ provider, address: keepAddr }));
    throw e;
  }
}

// v18.1: soft-state accessors for the UI (RE-PAIR buttons everywhere)
export function isSessionSoftDead(): boolean {
  return state.sessionDead && state.address !== null;
}

// one-tap re-pair from ANY page: reuses the persisted provider, silent
// reconnect first, fresh pairing only if the session is truly gone
export async function rePairWallet(): Promise<string> {
  if (mock) return state.address!;
  let provider = state.provider;
  if (!provider) {
    try {
      const raw = lsGet(KEY_WALLET);
      if (raw) provider = (JSON.parse(raw) as { provider: WalletProvider }).provider;
    } catch { /* corrupt */ }
  }
  if (!provider) throw new Error('NO WALLET - CONNECT FIRST');
  return connect(provider); // reconnect-first inside
}

// v18.1.6 (Prince: "mai e poi mai deve dire repair"): a SILENT session heal —
// reuses the persisted provider's still-alive WalletConnect session WITHOUT
// ever opening a pairing UI. Background probes and the pre-sign check call
// this; the fresh-pairing path stays behind an explicit degen tap.
export async function silentHeal(): Promise<boolean> {
  if (mock) return true;
  let provider = state.provider;
  if (!provider) {
    try {
      const raw = lsGet(KEY_WALLET);
      if (raw) provider = (JSON.parse(raw) as { provider: WalletProvider }).provider;
    } catch { /* corrupt */ }
  }
  if (!provider) return false;
  try {
    const w = await loadLib(provider);
    const accounts = await w.reconnectSession();
    if (!accounts || accounts.length === 0) return false;
    applySession(provider, w, accounts);
    return true;
  } catch {
    return false;
  }
}

// boot: restore a persisted session (mock in CI, wallet lib otherwise)
export function init(): void {
  lsDel(KEY_ELIG_OLD); // v9.0.2: drop the poisoned pre-unwrap cache once
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
  resolveIdentity(saved.address); // cosmetic NFD label, updates when ready
  void (async () => {
    try {
      const w = await loadLib(saved.provider);
      const accounts = await w.reconnectSession();
      if (!accounts || accounts.length === 0) throw new Error('session expired');
      state.address = accounts[0];
      state.sessionDead = false;
      watchDisconnect(w);
      maybeSovereign(accounts[0]); // v9.3.0: restored session — crown check too
    } catch {
      // v18.1: keep the persisted address in the SOFT state — every page
      // recognizes the wallet; the first sign (or a RE-PAIR tap) re-pairs
      state.sessionDead = true;
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
    const [dec, resp] = await Promise.all([
      gonnaDecimals(),
      idxFetch('/v2/accounts/' + state.address),
    ]);
    // v9.0.2 BUG FIX: the indexer WRAPS the account —
    // GET /v2/accounts/{addr} returns {account: {...}, 'current-round': N}.
    // Reading amount/assets on the wrapper produced ALGO NaN / GONNA 0 / NFT 0.
    const wrapped = resp as { account?: { amount?: number; assets?: { 'asset-id': number; amount: number }[] } };
    const acct = (wrapped.account ?? (resp as { amount?: number; assets?: { 'asset-id': number; amount: number }[] }));
    if (!Number.isFinite(Number(acct.amount))) throw new Error('bad account payload');
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
      algo: Number(acct.amount) / 1e6,
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
// v18.1 (Prince: "se mi connetto da una delle pagine tutte le altre devono
// riconoscerlo"): an ARENA-side connect runs on its own Pera instance — the
// gate must adopt that identity too (same origin, same WC session storage,
// same chainId on mainnet), so home & every page recognize the degen without
// a second pairing. The gate lib heals silently in the background.
export function adoptExternalSession(provider: WalletProvider, address: string): void {
  if (mock) return;
  if (state.address === address && !state.sessionDead) return;
  state.provider = provider;
  state.address = address;
  state.sessionDead = true; // no live session object in the gate lib yet
  lsSet(KEY_WALLET, JSON.stringify({ provider, address }));
  loadCachedElig(address);
  resolveIdentity(address);
  maybeSovereign(address);
  void (async () => {
    try {
      const w = await loadLib(provider);
      const accounts = await w.reconnectSession();
      if (accounts && accounts.length > 0) applySession(provider, w, accounts);
    } catch { /* stays soft — the first sign (or RE-PAIR) re-pairs */ }
    void refreshEligibility(false);
  })();
}

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

// QA test hook: inject/remove a fake wallet lib (reconnect-first tests)
export function __testSetLib(provider: WalletProvider, lib: WalletLib | null): void {
  const k = libKey(provider);
  if (lib) libs[k] = lib;
  else delete libs[k];
}

// v17.0.8 (Prince: "CANNOT READ PROPERTIES OF NULL (READING
// 'SENDCUSTOMREQUEST')"): a restored Pera session can LOOK live (address
// cached) while the WalletConnect client inside the lib is null — every sign
// dies with that raw TypeError. Narrow detector: user rejections never heal.
function isSessionFatal(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? e ?? '').toLowerCase();
  if (m.includes('reject') || m.includes('cancel') || m.includes('declin')) return false;
  return m.includes('sendcustomrequest') || (m.includes('null') && (m.includes('client') || m.includes('reading')));
}

// v9.1 readiness: raw transaction signing through the active wallet session.
// v17.0.8: on the null-client crash, HEAL (drop the wedged session, fresh
// re-pair via recoverSession) and retry the SAME sign ONCE — the tap's user
// gesture is still alive, so a new pairing modal may open.
export async function signTransactions(txGroups: unknown[][]): Promise<Uint8Array[]> {
  if (mock) throw new Error('mock wallet cannot sign');
  const pick = () => (activeLibKey ? libs[activeLibKey] : null) ?? (state.provider ? libs[libKey(state.provider)] : null);
  // v18.1: a soft-dead session silently re-pairs BEFORE the request — a sign
  // on a known-dead session is a guaranteed wedge (and a scary wallet prompt)
  if (state.sessionDead && state.provider) {
    try {
      const w0 = pick() ?? (await loadLib(state.provider));
      const acc = await w0.reconnectSession();
      if (acc && acc.length > 0) applySession(state.provider, w0, acc);
    } catch { /* still dead: fall through, the sign error path heals below */ }
  }
  const w = pick();
  if (!w || !w.signTransaction) throw new Error('wallet not connected');
  try {
    return await w.signTransaction(txGroups, state.address ?? undefined);
  } catch (e) {
    if (!isSessionFatal(e) || !state.provider) throw e;
    console.debug('[wallet] session fatal mid-sign — heal + one retry:', e);
    // v18.1: silent re-pair FIRST — the wedged session often resumes with no
    // UI at all; the heavy recoverSession (fresh pairing) is the last resort
    try {
      const acc = await w.reconnectSession();
      if (acc && acc.length > 0) {
        applySession(state.provider, w, acc);
        return await w.signTransaction(txGroups, state.address ?? undefined);
      }
    } catch { /* session truly wedged: full recovery below */ }
    await recoverSession(); // disconnect + fresh pairing (connect rebuilds)
    const w2 = pick();
    if (!w2 || !w2.signTransaction || !state.address) {
      throw new Error('WALLET SESSION LOST - TAP CONNECT');
    }
    return w2.signTransaction(txGroups, state.address);
  }
}

// v9.1: CI mock mode — the mock wallet cannot really sign, but the SEAL flow
// is still fully exercised (fake signed bytes -> routed algod in tests)
export function isMock(): boolean {
  return mock !== null;
}

// v9.1: per-address NFD segment resolution for the GLOBAL LEADERBOARD.
// Same garage endpoints/flags as resolveIdentity, but multi-address with a
// persisted map cache (24h) — the connected-wallet identity cache is separate.
export interface Segment {
  name: string;
  active: boolean;
  root?: boolean; // owns the ROOT gonna.algo — creator (gold)
  domain?: boolean; // owns an active root .algo domain, no segment (cyan)
}
const KEY_NFD_SEGS = 'gonna.nfd.segs.v5'; // {addr: {name, active, root, domain, ts}} (v5: + on-chain primary)
const segMem = new Map<string, Segment | null>();
let segStore: Record<string, { name: string; active: boolean; root?: boolean; domain?: boolean; ts: number }> = {};
try {
  const raw = lsGet(KEY_NFD_SEGS);
  if (raw) segStore = JSON.parse(raw) as typeof segStore;
} catch { /* corrupt: start fresh */ }

export function cachedSegment(address: string): Segment | null | undefined {
  if (segMem.has(address)) return segMem.get(address) ?? null;
  const c = segStore[address];
  if (c && Date.now() - c.ts < NFD_CACHE_MS) {
    const seg: Segment | null = c.name ? { name: c.name, active: !!c.active, root: !!c.root, domain: !!c.domain } : null;
    segMem.set(address, seg);
    return seg;
  }
  return undefined; // unknown: resolve live
}

// v9.3.4: in-flight dedup + serialization. The board UI re-kicks resolution
// EVERY FRAME until the first result lands — without dedup that is a request
// storm, and the free public indexer answers with a 429 wall. Now: one shared
// promise per address, and live resolutions start 250ms apart.
const segInflight = new Map<string, Promise<Segment | null>>();
let segChain: Promise<void> = Promise.resolve();

// resolve one address (cached); cosmetic — failures resolve to null silently
export function segmentFor(address: string): Promise<Segment | null> {
  const hit = cachedSegment(address);
  if (hit !== undefined) return Promise.resolve(hit);
  const flying = segInflight.get(address);
  if (flying) return flying;
  const p = (async (): Promise<Segment | null> => {
    await segChain;
    segChain = new Promise<void>((res) => setTimeout(res, 250));
    let seg: Segment | null = null;
    try {
      seg = await fetchNfdSegment(address);
    } catch { /* cosmetic */ }
    segMem.set(address, seg);
    segStore[address] = { name: seg ? seg.name : '', active: seg ? seg.active : false, root: !!(seg && seg.root), domain: !!(seg && seg.domain), ts: Date.now() };
    lsSet(KEY_NFD_SEGS, JSON.stringify(segStore));
    segInflight.delete(address);
    return seg;
  })();
  segInflight.set(address, p);
  return p;
}
