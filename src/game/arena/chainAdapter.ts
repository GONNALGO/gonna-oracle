// THE ARENA — chain adapter. One clean interface, TWO implementations:
//   MOCK    (default) — full end-to-end flow in localStorage with REAL timers,
//            so QA can run create/join/resolve/claim without any chain.
//   TESTNET — algosdk skeleton against the QuantumArena ARC-56
//            (contracts/quantum-arena/.../QuantumArena.arc56.json). The app id
//            is a placeholder until the testnet deploy lands.
// The UI never talks to algosdk / localStorage directly — only to ArenaAdapter.

// ---------- shared types ----------
export type AccountType = 'ed25519' | 'falcon';
export type Visibility = 'public' | 'private';
export type Format = 'duel' | 'open';
export type StageMode = 'full' | 'single' | 'random';
export type ChallengeStatus = 'open' | 'full' | 'resolved' | 'expired' | 'claimed' | 'closed';

export interface FighterPick {
  skin: string;
  assetId: number | null; // null = the free default GONNA
  name: string;
}

export interface ChallengeConfig {
  visibility: Visibility;
  format: Format;
  seatsTotal: number; // duel => always 2
  durationSecs: number; // 4h / 12h / 24h
  stageMode: StageMode;
  // v15.2.8: 0-6 for single — the CREATOR's CHOSEN level (wizard picker or
  // the RANDOM shuffle), committed ON-CHAIN in the create app-call note;
  // null = full run (no single stage)
  stageIdx: number | null;
  stake: number; // $GONNA display units per seat
  fighter: FighterPick;
  sealedScore?: number; // v11: the run score sealed BEFORE signing (testnet)
  // v15.2.7b (cid-race guard): the challenge id the sealed run was PLAYED for
  // ('PIT-' + runCid; the LEVEL is the creator's pick in stageIdx, only the
  // seed rides the cid). When set, createChallenge REFUSES to build/sign
  // under any other id (CidMovedError) — a card created at cid != runCid
  // would hand joiners a different seed than the creator played.
  runCid?: number;
  // v14.4: no continueRefId here — creator replays are FREE pre-commitment;
  // the 5 ALGO continue receipt exists ONLY on the joiner submitScore path
}

export interface ChallengePlayer {
  address: string;
  name: string; // degen label (NFD segment or short address)
  score: number; // 0 = not submitted yet
  fighter: FighterPick;
  accountType: AccountType; // falcon accounts carry the QUANTUM SEAL
  // v2 seat clock (testnet only — mock cards leave both undefined)
  signed?: boolean; // oracle-signed score accepted on-chain
  seatedAt?: number; // ms epoch: create for seat 0, join otherwise
}

export interface Challenge {
  id: number;
  creator: string;
  creatorName: string;
  creatorType: AccountType;
  visibility: Visibility;
  format: Format;
  seatsTotal: number;
  durationSecs: number;
  stageMode: StageMode;
  stageIdx: number | null; // resolved stage (v15.2.8: single = the creator's committed pick)
  // v15.2.8: true = stageIdx is COMMITTED (on-chain note / card memory of a
  // card this browser created); false = UNVERIFIED (cid%7 FALLBACK guess for
  // legacy cards without notes, or a caller-controlled deep-link ?st= hint —
  // v15.2.8b: the link tier fills the stage but never self-verifies) — the UI
  // renders it '(UNVERIFIED)' in DIM, never presenting a guess as truth.
  // Undefined = treat as true (mock cards and every pre-v15.2.8 record).
  stageVerified?: boolean;
  stake: number; // $GONNA per seat — NaN on a terminal card with no card memory (UNKNOWN, renders '-'; never an invented number)
  createdAt: number; // ms epoch
  deadline: number; // ms epoch — REAL timer
  status: ChallengeStatus;
  players: ChallengePlayer[];
  winner: string | null;
  pot: number; // stake * seats taken (paid out on claim)
  forfeited?: boolean; // v2: terminal STATUS_FORFEIT (4) — seat clock expired
}

export interface ClaimResult {
  payout: number;
  txid: string;
}

// ---------- HISTORY / LEGACY (v10.3) ----------
// A match leaves the BOARD the moment it resolves — it lives here forever.
export interface HistoryEntry {
  id: number;
  stake: number;
  pot: number; // total paid to the winner
  format: Format;
  stageMode: StageMode;
  stageIdx: number | null;
  stageVerified?: boolean; // v15.2.8: false = cid%7 fallback guess (renders UNVERIFIED)
  seats: number;
  winner: string; // address
  winnerName: string;
  players: { address: string; name: string; score: number }[];
  resolvedAt: number; // ms epoch
  claimed: boolean; // pot claimed (winner) or not yet
}

// MY LEGACY — per-identity stats accumulated from the history (on-chain later)
export interface LegacyStats {
  played: number;
  wins: number;
  losses: number;
  open: number; // seated/created but not yet settled (live cards)
  winRate: number; // 0-100
  won: number; // $GONNA taken home
  lost: number; // $GONNA staked into losing matches
  net: number; // won - lost
  bestWin: number; // biggest pot taken
}

export interface ArenaAdapter {
  readonly mode: 'mock' | 'testnet';
  createChallenge(cfg: ChallengeConfig, creator: ChallengePlayer): Promise<Challenge>;
  join(id: number, player: ChallengePlayer): Promise<Challenge>;
  submitScore(id: number, address: string, score: number, opts?: { continueRefId?: string }): Promise<Challenge>;
  resolve(id: number): Promise<Challenge>;
  claim(id: number, address: string): Promise<ClaimResult>;
  // v2: duel seat clock — claim the stake of an UNSIGNED opponent whose
  // seated_at + SEAT_TTL has expired (testnet contract only; mock optional)
  claimForfeit?(id: number, address: string): Promise<ClaimResult>;
  earlyClose(id: number, address: string): Promise<Challenge>;
  listOpenChallenges(): Promise<Challenge[]>;
  myChallenges(address: string): Promise<Challenge[]>;
  listHistory(): Promise<HistoryEntry[]>;
  legacyStats(address: string): Promise<LegacyStats>;
  // v10.4: deep-link lookup (?duel=<id>) — any visibility. v15.2.4: on
  // testnet a CLOSED cid resolves to its terminal card (v2 event log + card
  // memory) — settled battles are never a 404. v15.2.7: deepLink retries the
  // event fetch (indexer lag) before rendering the terminal unknown card.
  getChallenge(id: number, opts?: { deepLink?: boolean }): Promise<Challenge | null>;
  // v15: the id the NEXT create will get — a creator's DESCENT run is seeded
  // by it, so the joiner later fights the exact same waves. Read-only.
  peekNextId?(): Promise<number | null>;
}

// ---------- FEE ENGINE ----------
// ed25519 accounts pay the flat min fee. Falcon (post-quantum) signatures are
// ~6-7x bigger, so the network charges a resource-based fee (~6-7x min fee).
export const MIN_FEE_ALGO = 0.001;
export function estimateNetworkFee(accountType: AccountType): number {
  // TODO(testnet): derive the multiplier from the actual Falcon sig size once
  // the PQ account standard finalizes; 7x min fee is the current estimate.
  return accountType === 'falcon' ? MIN_FEE_ALGO * 7 : MIN_FEE_ALGO;
}
export function fmtFee(accountType: AccountType): string {
  return estimateNetworkFee(accountType).toFixed(3) + ' ALGO' + (accountType === 'falcon' ? ' (PQ)' : '');
}

// ---------- $GONNA formatting (10M / 100M / 1B degen style) ----------
export function fmtStake(n: number): string {
  // v15.2.7: a terminal card whose stake the chain never told us carries NaN —
  // render '-' (honest unknown), NEVER an invented number
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000_000) return trim1(n / 1_000_000_000) + 'B';
  if (n >= 1_000_000) return trim1(n / 1_000_000) + 'M';
  if (n >= 1_000) return trim1(n / 1_000) + 'K';
  return String(n);
}
function trim1(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}
// thousands-separated integer — the CUSTOM stake field / typed amounts
export function fmtGonna(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.floor(Math.max(0, n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// clean $GONNA amount: degen tiers (10M/1B) for big stacks, trimmed
// decimals (max 4, trailing zeros off) for dust — never "0.0526315789"
export function fmtAmount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1000) return fmtStake(n);
  const s = n.toFixed(4);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

// v15.2.7 (BUG-2) kept as the UNVERIFIED FALLBACK only: the v2 contract has
// NO stage field, and legacy cards (created before v15.2.8) carry no stage
// note. For those, cid % 7 is the deterministic guess — ALWAYS rendered
// '(UNVERIFIED)', never presented as truth. v15.2.8: the creator CHOOSES the
// level and commits it in the create note; pickCardStage below is the truth.
export function stageIdxFromCid(cid: number): number {
  return cid % 7; // 7 stages, idx 0-6
}

// ---------- v15.2.8: single-mode stage resolution ----------
// Order: (a) on-chain create NOTE via kit.fetchArenaCreateStages; (b) card
// memory (gonna.arena.cards — createChallenge persists the pick there);
// (c) deep-link URL hint ?st= (share links carry it for single-mode cards) —
// fills the stage but stageVerified stays FALSE (v15.2.8b: a URL param is
// caller-controlled, never a proof); (d) stageIdxFromCid fallback — FALSE.
export type StageSource = 'full' | 'note' | 'memory' | 'link' | 'fallback';
export interface StageResolution {
  stageIdx: number | null;
  verified: boolean;
  source: StageSource;
}
const inStageRange = (v: number | null | undefined): v is number => typeof v === 'number' && v >= 0 && v <= 6;
export function pickCardStage(
  cid: number,
  stageMode: StageMode,
  opts: { note?: number | null; memory?: { stageIdx: number | null; stageVerified?: boolean } | null; link?: number | null } = {},
): StageResolution {
  if (stageMode === 'full') return { stageIdx: null, verified: true, source: 'full' };
  if (inStageRange(opts.note)) return { stageIdx: opts.note, verified: true, source: 'note' };
  if (opts.memory && inStageRange(opts.memory.stageIdx) && opts.memory.stageVerified !== false) {
    return { stageIdx: opts.memory.stageIdx, verified: true, source: 'memory' };
  }
  // v15.2.8b: the ?st= URL hint fills the stage but NEVER self-verifies — a
  // crafted link (?duel=26&st=5) must not spoof a legacy card's stage as
  // VERIFIED. Only the note and memory tiers are verified sources.
  if (inStageRange(opts.link)) return { stageIdx: opts.link, verified: false, source: 'link' };
  return { stageIdx: stageIdxFromCid(cid), verified: false, source: 'fallback' };
}

// deep-link stage hint (?duel=N&st=K) — tier (c). engine.bootArenaDeepLink
// parses it once at page boot and hands it here before stripping the params.
let linkStageHint: { cid: number; stage: number } | null = null;
export function setLinkStageHint(cid: number, stage: number): void {
  linkStageHint = inStageRange(stage) ? { cid, stage } : null;
}
export function getLinkStageHint(cid: number): number | null {
  return linkStageHint && linkStageHint.cid === cid ? linkStageHint.stage : null;
}

// v15.2.7b (cid-race guard): a creator's DESCENT run is seeded 'PIT-' + the
// hinted id (v15.2.8: the LEVEL is the creator's pick — a moved cid changes
// only the seed, never the chosen stage). If next_challenge_id has moved by
// SIGN time, creating under the NEW id would silently mismatch every joiner
// (different seed). The oracle sig is cid-bound so the chain would 400 it
// anyway — this guard fires BEFORE the wallet prompt instead.
export const CID_MOVED_MSG = 'THE PIT MOVED WHILE YOU PLAYED - RE-SEAL YOUR RUN';
export class CidMovedError extends Error {
  readonly code = 'CID_MOVED';
  readonly runCid: number; // the id the sealed run was played for
  readonly actualCid: number; // the id the chain would create under now
  constructor(runCid: number, actualCid: number) {
    super(CID_MOVED_MSG);
    this.name = 'CidMovedError';
    this.runCid = runCid;
    this.actualCid = actualCid;
  }
}
export function isCidMovedError(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'CID_MOVED';
}

// settlement math (the contract takes the 5% treasury fee INSIDE resolve):
// pool = stake x seats taken, fee = 5% of the pool, winner takes the rest.
// Contract truth (contract.py:128): seats_taken counts JOINER seats only —
// the real pot is stake x players.length (creator is seat 0 of the roster).
// Callers pass players.length as `seatsTaken`; `pot` from older records may
// only carry the creator stake, so the pool is never smaller than stake x
// the seated roster. No Math.max(1, ...) flavor: the roster count IS the
// truth (an empty roster adds nothing, never a phantom seat).
export function splitPot(stake: number, pot: number, seatsTaken: number): { pool: number; fee: number; takes: number } {
  const pool = Math.max(pot, stake * Math.max(0, seatsTaken));
  const fee = pool * 0.05;
  return { pool, fee, takes: pool - fee };
}

// degen relative time: "57M AGO" / "1H 02M AGO" / "3D AGO"
// (font has no em dash, use '-')
export function fmtAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  const mins = Math.floor(s / 60);
  if (mins < 60) return Math.max(1, mins) + 'M AGO';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'H ' + String(mins - hrs * 60).padStart(2, '0') + 'M AGO';
  return Math.floor(hrs / 24) + 'D AGO';
}

// countdown "11:42:33" from a ms deadline (clamped at 0)
export function fmtCountdown(deadline: number, now = Date.now()): string {
  let s = Math.max(0, Math.floor((deadline - now) / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const p = (v: number) => String(v).padStart(2, '0');
  return p(h) + ':' + p(m) + ':' + p(s);
}

// countdown "42:33" (mm:ss) from a ms remaining span (clamped at 0) —
// the duel seat clock never exceeds 1h so hours are noise
export function fmtMMSS(remainingMs: number): string {
  let s = Math.max(0, Math.floor(remainingMs / 1000));
  const m = Math.floor(s / 60);
  s -= m * 60;
  const p = (v: number) => String(v).padStart(2, '0');
  return p(m) + ':' + p(s);
}

// ---------- v2 duel seat clock ----------
// The contract keeps a 1h clock (seated_at + SEAT_TTL) on every UNSIGNED
// duel seat: once it lapses, the SIGNED opponent may claim_forfeit() and
// take 95% of the silent seat's stake. Duels only (seats_total == 1 on
// chain — the UI counts the creator seat on top, so format === 'duel').
export const SEAT_TTL_MS = 3600 * 1000;

export type ForfeitInfo =
  | { kind: 'claimable'; seat: number; expiredAt: number } // viewer can CLAIM FORFEIT on `seat`
  | { kind: 'own-clock'; remainingMs: number; expiresAt: number } // viewer's own seat is UNSIGNED
  | null;

// Pure + headless-testable: given a card and the viewer address, what does
// the seat clock demand RIGHT NOW? Mock cards carry no seatedAt/signed —
// they return null (the seat clock is a testnet-contract feature).
export function duelForfeitInfo(card: Challenge, me: string | null, nowMs = Date.now()): ForfeitInfo {
  if (card.format !== 'duel') return null;
  if (card.status !== 'open' && card.status !== 'full') return null;
  if (me === null) return null;
  const myIdx = card.players.findIndex((p) => p.address === me);
  if (myIdx < 0) return null;
  const mine = card.players[myIdx];
  if (mine.seatedAt === undefined || mine.signed === undefined) return null;
  if (!mine.signed) {
    const expiresAt = mine.seatedAt + SEAT_TTL_MS;
    return { kind: 'own-clock', remainingMs: Math.max(0, expiresAt - nowMs), expiresAt };
  }
  // I'm signed: the OTHER seat (duel => exactly one) may be forfeitable
  const otherIdx = card.players.findIndex((_, i) => i !== myIdx);
  if (otherIdx < 0) return null;
  const other = card.players[otherIdx];
  if (other.signed !== false || other.seatedAt === undefined) return null;
  const expiredAt = other.seatedAt + SEAT_TTL_MS;
  if (nowMs > expiredAt) return { kind: 'claimable', seat: otherIdx, expiredAt };
  return null;
}

// ======================================================================
// MOCK ADAPTER — localStorage state, real timers, full flow for QA
// ======================================================================
const LS_KEY = 'gonna.arena.v1';
// CI / QA hook: the local account runs as Falcon (PQ fees + QUANTUM SEAL)
const LS_FALCON = 'gonna.arena.falcon';

export function mockAccountType(): AccountType {
  try {
    return window.localStorage.getItem(LS_FALCON) === '1' ? 'falcon' : 'ed25519';
  } catch {
    return 'ed25519';
  }
}

interface Store {
  nextId: number;
  seeded: boolean;
  histSeeded?: boolean;
  challenges: Challenge[]; // LIVE cards only — resolved/claimed auto-archive
  history?: HistoryEntry[]; // every settled match, forever
}

const DEGEN_NAMES = ['GEKKORIDER', 'WHALE_X', 'SER_BUYTHE_DIP', 'LIL_LIZARD', 'ANON_404', 'PUMP_SAINT', 'HODL_GOBLIN', 'MOON_MARTIAN'];

function lsLoad(): Store {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s && Array.isArray(s.challenges)) {
        if (!Array.isArray(s.history)) {
          s.history = []; // v10.3 migration for pre-history stores
          s.histSeeded = false;
        }
        return s;
      }
    }
  } catch { /* corrupt: rebuild */ }
  return { nextId: 1, seeded: false, challenges: [], history: [] };
}
function lsSave(s: Store): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch { /* storage unavailable: session-only */ }
}

const FIGHTER_POOL: FighterPick[] = [
  { skin: 'gonna', assetId: null, name: 'GONNA' },
  { skin: 'fire', assetId: 7001, name: 'GONNA 7' },
  { skin: 'alien', assetId: 7012, name: 'GONNA 12' },
  { skin: 'rainbow', assetId: 7042, name: 'GONNA 42' },
];

function mockAddr(name: string): string {
  // deterministic fake 58-char-ish address label base
  return (name.replace(/[^A-Z0-9]/g, '') + 'X'.repeat(58)).slice(0, 58);
}

// the piazza opens pre-populated: live cards with real ticking deadlines
function seed(s: Store): void {
  const now = Date.now();
  const mk = (
    i: number,
    name: string,
    type: AccountType,
    format: Format,
    seatsTotal: number,
    seatsTaken: number,
    hrsLeft: number,
    stake: number,
    stageMode: StageMode,
    stageIdx: number | null,
  ): Challenge => {
    const players: ChallengePlayer[] = [];
    for (let p = 0; p < seatsTaken; p++) {
      const pn = p === 0 ? name : DEGEN_NAMES[(i + p) % DEGEN_NAMES.length];
      players.push({ address: mockAddr(pn), name: pn, score: 0, fighter: FIGHTER_POOL[(i + p) % FIGHTER_POOL.length], accountType: p === 0 ? type : 'ed25519' });
    }
    return {
      id: s.nextId++,
      creator: players[0].address,
      creatorName: name,
      creatorType: type,
      visibility: i % 3 === 2 ? 'private' : 'public',
      format,
      seatsTotal,
      durationSecs: 12 * 3600,
      stageMode,
      stageIdx,
      stageVerified: true, // seeded piazza cards: mock-local truth
      stake,
      createdAt: now - (12 - hrsLeft) * 3600_000,
      deadline: now + hrsLeft * 3600_000,
      status: seatsTaken >= seatsTotal ? 'full' : 'open',
      players,
      winner: null,
      // v15.2.7: pot = stake x roster length (creator included), same as the chain
      pot: stake * players.length,
    };
  };
  s.challenges.push(
    mk(0, 'GEKKORIDER', 'falcon', 'open', 8, 6, 3.2, 100_000_000, 'full', null), // FILLING FAST + QUANTUM
    mk(1, 'WHALE_X', 'ed25519', 'duel', 2, 1, 0.5, 1_000_000_000, 'single', 4), // CLOSING SOON
    mk(2, 'SER_BUYTHE_DIP', 'ed25519', 'open', 12, 3, 11.7, 10_000_000, 'random', 2),
    mk(3, 'LIL_LIZARD', 'falcon', 'open', 4, 3, 22.9, 100_000_000, 'single', 6), // FILLING FAST + PQ
    mk(4, 'ANON_404', 'ed25519', 'open', 8, 2, 47.5, 10_000_000, 'full', null),
  );
  s.seeded = true;
}

// HISTORY comes pre-loaded: the piazza has a past, legends included
function seedHistory(s: Store): void {
  const now = Date.now();
  const mkH = (
    name: string,
    _type: AccountType, // reserved: history UI may badge Falcon winners later
    format: Format,
    seats: number,
    stake: number,
    stageMode: StageMode,
    stageIdx: number | null,
    hrsAgo: number,
    claimed: boolean,
  ): void => {
    const winner = mockAddr(name);
    const loser = mockAddr(DEGEN_NAMES[(name.length + 3) % DEGEN_NAMES.length]);
    const players = [
      { address: winner, name, score: 9000 + (name.length * 137) % 4000 },
      { address: loser, name: DEGEN_NAMES[(name.length + 3) % DEGEN_NAMES.length], score: 7000 },
    ];
    s.history!.push({
      id: s.nextId++,
      stake,
      // v15.2.7: pot = stake x roster length — the chain pays from the players
      // box, so the mock history carries the same semantics (no duel-only /2s)
      pot: stake * players.length,
      format,
      stageMode,
      stageIdx,
      stageVerified: true, // seeded history: mock-local truth
      seats,
      winner,
      winnerName: name,
      players,
      resolvedAt: now - hrsAgo * 3600_000,
      claimed,
    });
  };
  mkH('WHALE_X', 'ed25519', 'duel', 2, 350_000_000, 'single', 6, 2, true); // WHALE_X TOOK 700M - STAGE 7 THRONE ROOM - 2H AGO
  mkH('GEKKORIDER', 'falcon', 'open', 8, 50_000_000, 'full', null, 26, true);
  mkH('SER_BUYTHE_DIP', 'ed25519', 'duel', 2, 60_000_000, 'single', 2, 74, true);
  mkH('ANON_404', 'ed25519', 'open', 4, 10_000_000, 'random', 1, 124, false); // unclaimed pot still warm
  s.histSeeded = true;
}

export class MockArenaAdapter implements ArenaAdapter {
  readonly mode = 'mock' as const;

  private store(): Store {
    const s = lsLoad();
    let dirty = false;
    if (!s.seeded) {
      seed(s);
      dirty = true;
    }
    if (!s.histSeeded) {
      seedHistory(s);
      dirty = true;
    }
    if (dirty) lsSave(s);
    return s;
  }

  // v10.3: resolve auto-archives — the match leaves the BOARD for the HISTORY
  private archive(s: Store, c: Challenge): void {
    const w = c.players.find((p) => p.address === c.winner);
    s.history!.unshift({
      id: c.id,
      stake: c.stake,
      pot: c.pot,
      format: c.format,
      stageMode: c.stageMode,
      stageIdx: c.stageIdx,
      stageVerified: c.stageVerified !== false,
      seats: c.seatsTotal,
      winner: c.winner ?? '',
      winnerName: w ? w.name : '???',
      players: c.players.map((p) => ({ address: p.address, name: p.name, score: p.score })),
      resolvedAt: Date.now(),
      claimed: false,
    });
    s.challenges = s.challenges.filter((x) => x.id !== c.id);
  }

  private find(s: Store, id: number): Challenge {
    const c = s.challenges.find((x) => x.id === id);
    if (!c) throw new Error('card not found');
    return c;
  }

  // expiry is derived from the REAL clock, not from a stored flag
  private refresh(c: Challenge): void {
    if ((c.status === 'open' || c.status === 'full') && Date.now() >= c.deadline) {
      c.status = 'expired';
    }
  }

  async createChallenge(cfg: ChallengeConfig, creator: ChallengePlayer): Promise<Challenge> {
    const s = this.store();
    const now = Date.now();
    // v15.2.7b (cid-race guard): the mock mirrors the testnet create guard —
    // a sealed run played for runCid is NEVER committed under a different id
    // (same CidMovedError the chain adapter throws before the wallet prompt).
    if (cfg.runCid !== undefined && cfg.runCid !== s.nextId) throw new CidMovedError(cfg.runCid, s.nextId);
    const id = s.nextId++;
    const c: Challenge = {
      id,
      creator: creator.address,
      creatorName: creator.name,
      creatorType: creator.accountType,
      visibility: cfg.visibility,
      format: cfg.format,
      seatsTotal: cfg.format === 'duel' ? 2 : cfg.seatsTotal,
      durationSecs: cfg.durationSecs,
      stageMode: cfg.stageMode,
      // v15.2.8 (owner decree): the CREATOR chooses the level (wizard picker
      // or the RANDOM shuffle) — the mock commits cfg.stageIdx exactly like
      // the chain commits the create note; cid % 7 survives ONLY as the
      // unverified fallback when no pick was made (QA/legacy paths)
      stageIdx: cfg.stageMode === 'full' ? null : (cfg.stageIdx ?? stageIdxFromCid(id)),
      stageVerified: cfg.stageMode === 'full' ? true : cfg.stageIdx != null,
      stake: cfg.stake,
      createdAt: now,
      deadline: now + cfg.durationSecs * 1000,
      status: cfg.format === 'duel' ? 'open' : 'open',
      // v12: the creator plays BEFORE signing everywhere — a sealed score
      // (testnet or mock) rides inside the create, same as the contract
      players: [{ ...creator, score: cfg.sealedScore ?? 0 }],
      winner: null,
      pot: cfg.stake, // stake x roster length (1 seat so far — the creator)
    };
    // a mock card with a pre-sealed creator gets its rival instantly (same
    // honest rule as submitScore: the rival CAN beat you)
    if ((cfg.sealedScore ?? 0) > 0 && c.players.length < 2) {
      c.players.push({
        address: 'RIVAL_' + Math.random().toString(36).slice(2, 8).toUpperCase(),
        name: 'RIVAL_' + Math.random().toString(36).slice(2, 6).toUpperCase(),
        score: Math.max(0, Math.floor((cfg.sealedScore ?? 0) + (Math.random() < 0.45 ? 1 : -1) * (300 + Math.random() * 700))),
        fighter: { skin: 'snek', assetId: null, name: 'SNEK' },
        accountType: 'ed25519',
      });
      c.pot = c.stake * c.players.length; // pot = stake x roster length (v15.2.7)
      if (c.players.length >= c.seatsTotal) c.status = 'full';
    }
    s.challenges.unshift(c);
    lsSave(s);
    return c;
  }

  async join(id: number, player: ChallengePlayer): Promise<Challenge> {
    const s = this.store();
    const c = this.find(s, id);
    this.refresh(c);
    if (c.status !== 'open') throw new Error('card is not open');
    if (c.players.some((p) => p.address === player.address)) throw new Error('already seated');
    if (c.players.length >= c.seatsTotal) throw new Error('table is full');
    c.players.push({ ...player, score: 0 });
    c.pot = c.stake * c.players.length; // pot = stake x roster length (v15.2.7)
    if (c.players.length >= c.seatsTotal) c.status = 'full';
    lsSave(s);
    return c;
  }

  async submitScore(id: number, address: string, score: number): Promise<Challenge> {
    const s = this.store();
    const c = this.find(s, id);
    const p = c.players.find((x) => x.address === address);
    if (!p) throw new Error('not seated at this table');
    p.score = Math.max(0, Math.floor(score));
    // honest mock: a SOLO card never resolves — seat a mock rival who plays
    // back instantly (same pattern as the seeded piazza cards), and that
    // rival CAN beat you. No more YOU WON with an OPEN SEAT.
    if (c.players.length < 2) {
      const rivalScore = Math.max(0, Math.floor(score + (Math.random() < 0.45 ? 1 : -1) * (300 + Math.random() * 700)));
      c.players.push({
        address: 'RIVAL_' + Math.random().toString(36).slice(2, 8).toUpperCase(),
        name: 'RIVAL_' + Math.random().toString(36).slice(2, 6).toUpperCase(),
        score: rivalScore,
        fighter: { skin: 'snek', assetId: null, name: 'SNEK' },
        accountType: 'ed25519',
      });
      c.pot = c.stake * c.players.length; // pot = stake x roster length (v15.2.7)
      if (c.players.length >= c.seatsTotal) c.status = 'full';
    }
    // mock opponents play back instantly so the flow resolves end-to-end
    for (const o of c.players) {
      if (o.address !== address && o.score === 0) {
        o.score = Math.max(0, Math.floor(score + (Math.random() * 2 - 1) * 800));
      }
    }
    lsSave(s);
    return c;
  }

  async resolve(id: number): Promise<Challenge> {
    const s = this.store();
    const c = this.find(s, id);
    if (c.players.length === 0) throw new Error('no players');
    // honest mock: mirror the contract — never resolve without an opponent
    if (c.players.length < 2 || c.players.some((p) => p.score <= 0)) {
      throw new Error('WAITING FOR A CHALLENGER');
    }
    let best = c.players[0];
    for (const p of c.players) if (p.score > best.score) best = p;
    c.winner = best.address;
    c.status = 'resolved';
    this.archive(s, c); // off the BOARD, into the HISTORY
    lsSave(s);
    return c; // the caller keeps its copy for the verdict/versus screen
  }

  async claim(id: number, address: string): Promise<ClaimResult> {
    const s = this.store();
    // resolved match -> the winner claims the pot from the HISTORY archive
    const h = s.history!.find((x) => x.id === id);
    if (h) {
      if (h.winner !== address) throw new Error('only the winner claims the pot');
      if (h.claimed) throw new Error('pot already claimed');
      h.claimed = true;
      lsSave(s);
      return { payout: h.pot, txid: 'MOCK' + String(id).padStart(6, '0') };
    }
    // expired live card -> seated degen takes the stake back
    const c = s.challenges.find((x) => x.id === id);
    if (!c) throw new Error('card not found');
    this.refresh(c);
    if (c.status === 'expired') {
      const mine = c.players.find((p) => p.address === address);
      if (!mine) throw new Error('not seated at this table');
      s.challenges = s.challenges.filter((x) => x.id !== id);
      lsSave(s);
      return { payout: c.stake, txid: 'MOCK' + String(id).padStart(6, '0') };
    }
    throw new Error('nothing to claim yet');
  }

  async earlyClose(id: number, address: string): Promise<Challenge> {
    const s = this.store();
    const c = this.find(s, id);
    if (c.creator !== address) throw new Error('only the creator can early-close');
    this.refresh(c);
    if (c.status !== 'open') throw new Error('card is not open');
    c.status = 'closed';
    s.challenges = s.challenges.filter((x) => x.id !== id); // sealed cards leave the square
    lsSave(s);
    return c;
  }

  // v15: the id the NEXT create will get — mock counter, so the wizard's
  // chain-dealt level (id % 7) matches the card the mock actually creates
  async peekNextId(): Promise<number | null> {
    return this.store().nextId;
  }

  // v10.4: deep-link (?duel=<id>) — live cards of ANY visibility
  async getChallenge(id: number): Promise<Challenge | null> {
    const s = this.store();
    const c = s.challenges.find((x) => x.id === id);
    if (!c) return null;
    this.refresh(c);
    lsSave(s);
    return c;
  }

  // ---------- HISTORY / LEGACY (mock) ----------
  async listHistory(): Promise<HistoryEntry[]> {
    const s = this.store();
    return [...s.history!].sort((a, b) => b.resolvedAt - a.resolvedAt);
  }

  async legacyStats(address: string): Promise<LegacyStats> {
    const s = this.store();
    let wins = 0;
    let losses = 0;
    let won = 0;
    let lost = 0;
    let bestWin = 0;
    let open = 0;
    for (const h of s.history!) {
      if (!h.players.some((p) => p.address === address)) continue;
      if (h.winner === address) {
        wins++;
        const takes = splitPot(h.stake, h.pot, h.players.length).takes;
        won += takes;
        if (takes > bestWin) bestWin = takes;
      } else {
        losses++;
        lost += h.stake;
      }
    }
    // OPEN: live cards where I'm seated (or the creator) — not settled yet
    for (const c of s.challenges) {
      this.refresh(c);
      if (c.status === 'closed') continue; // sealed before the fight = no battle
      if (c.creator === address || c.players.some((p) => p.address === address)) open++;
    }
    lsSave(s);
    const played = wins + losses;
    return {
      played,
      wins,
      losses,
      open,
      winRate: played > 0 ? Math.round((wins / played) * 100) : 0,
      won,
      lost,
      net: won - lost,
      bestWin,
    };
  }

  async listOpenChallenges(): Promise<Challenge[]> {
    const s = this.store();
    for (const c of s.challenges) this.refresh(c);
    lsSave(s);
    return s.challenges.filter((c) => c.visibility === 'public');
  }

  async myChallenges(address: string): Promise<Challenge[]> {
    const s = this.store();
    for (const c of s.challenges) this.refresh(c);
    lsSave(s);
    return s.challenges.filter((c) => c.players.some((p) => p.address === address));
  }
}

// ======================================================================
// TESTNET ADAPTER — QuantumArena v2 is LIVE on testnet (app 769767443;
// v1 app 769688298 kept as legacy in deploy/testnet.json).
// Exact atomic groups + OpUp donor calls live in ./testnetKit.ts.
// Identity (Pera testnet via ./testnetWallet.ts, or the QA signer) is
// INJECTED through setTestnetIdentityProvider by arenaWallet.ts (no
// circular imports). Oracle sigs come from ./devOracle.ts (TESTNET ONLY).
// ======================================================================
import * as kit from './testnetKit';
import { devOracleSign, devOracleSignScore, hasDevOracle } from './devOracle';
import { qaScore } from './qaSigner';
export { ARENA_APP_ID, GONNA_ASA_TESTNET } from './testnetKit';

export interface TestnetIdentity {
  address: string;
  sign: kit.TxSignFn;
}
// stored on window: vite may instantiate this module twice during HMR/debug
// evaluates — the registry must survive module duplication.
type Win = { __arenaIdProvider?: () => Promise<TestnetIdentity | null> };
function providerRef(): (() => Promise<TestnetIdentity | null>) | null {
  return (window as unknown as Win).__arenaIdProvider ?? null;
}
export function setTestnetIdentityProvider(p: () => Promise<TestnetIdentity | null>): void {
  (window as unknown as Win).__arenaIdProvider = p;
}

function sameAddr(a: Uint8Array, addr: Uint8Array): boolean {
  return a.length === addr.length && a.every((v, i) => v === addr[i]);
}
// ABI decode may hand back plain number[] — normalize before encodeAddress
function asBytes(v: Uint8Array | number[]): Uint8Array {
  return v instanceof Uint8Array ? v : Uint8Array.from(v);
}
function shortAddr(addr: string): string {
  return addr.slice(0, 6) + '..' + addr.slice(-4);
}

export class TestnetArenaAdapter implements ArenaAdapter {
  readonly mode = 'testnet' as const;

  private async id(): Promise<TestnetIdentity> {
    const me = providerRef() ? await providerRef()!() : null;
    if (!me) throw new Error('CONNECT WALLET FIRST (TESTNET)');
    return me;
  }

  private async toChallenge(cid: number, meta: kit.MetaTuple, players: kit.PlayerTuple[]): Promise<Challenge> {
    const a = await kit.sdk();
    // tie/refund and claimed cards can carry EMPTY byte[] fields — never
    // feed those to encodeAddress (it throws on non-32-byte keys)
    const enc = (pk: Uint8Array | number[]) => a.encodeAddress(asBytes(pk));
    const encOpt = (pk: Uint8Array | number[]) => (pk.length === 32 ? enc(pk) : 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ');
    const nowSec = Math.floor(Date.now() / 1000);
    const seatsTaken = Number(meta.seatsTaken);
    const seatsTotal = Number(meta.seatsTotal) + 1; // + creator seat (UI convention)
    // contract: 0 OPEN · 1 CLOSED (table full) · 2 RESOLVED · 3 REFUNDED
    // · 4 FORFEIT (v2, terminal — seat clock expired on an unsigned duel seat)
    // v14.4: REFUNDED (early-close / claim / sweep / catastrophe) maps to
    // 'closed' — stakes went BACK, no pot was ever paid. 'claimed' stays a
    // mock-only "winner took the pot" state; testnet pays inside resolve.
    const statusCode = Number(meta.status);
    const expired = (statusCode === 0 || statusCode === 1) && Number(meta.deadline) <= nowSec;
    const status: ChallengeStatus =
      statusCode === 3 || statusCode === 4 ? 'closed' : statusCode === 2 ? 'resolved' : expired ? 'expired' : statusCode === 1 || seatsTaken >= seatsTotal ? 'full' : 'open';
    const creator = encOpt(meta.creator);
    const stageMode: StageMode = Number(meta.stageMode) === 0 ? 'full' : Number(meta.stageMode) === 1 ? 'single' : 'random';
    const stageRes = await this.cardStage(cid, stageMode);
    return {
      id: cid,
      creator,
      creatorName: shortAddr(creator),
      creatorType: 'ed25519', // Falcon lands on mainnet — testnet accounts are classic
      visibility: 'public', // v5 contract has no private flag on-chain
      format: Number(meta.seatsTotal) <= 1 ? 'duel' : 'open',
      seatsTotal,
      durationSecs: 0, // not stored on-chain; deadline is the truth
      stageMode,
      // v15.2.8 (owner decree): v2 ChallengeMeta has NO stage field — the
      // DESCENT level is the CREATOR's pick, committed in the create note.
      // Resolution order: note > card memory > link hint > cid%7 (UNVERIFIED).
      stageIdx: stageRes.stageIdx,
      stageVerified: stageRes.verified,
      stake: Number(meta.stake) / 1e6, // base units -> $GONNA display units
      createdAt: Number(meta.deadline) * 1000 - 12 * 3600_000,
      deadline: Number(meta.deadline) * 1000,
      status,
      players: players.map((p) => ({
        address: encOpt(p.addr),
        name: shortAddr(encOpt(p.addr)),
        score: Number(p.score),
        fighter: { skin: 'gonna', assetId: null, name: 'GONNA' },
        accountType: 'ed25519' as AccountType,
        signed: p.signed, // v2 seat clock
        seatedAt: Number(p.seatedAt) * 1000,
      })),
      winner: statusCode === 2 && meta.winner.length === 32 ? enc(meta.winner) : null,
      // v15.2.7 (BUG-1): seats_taken counts JOINER seats only — the contract
      // pays stake x roster length (creator is seat 0), so the players box
      // length IS the pot truth (proven on-chain: cid 21, 5 x 1 GONNA -> pot 5)
      pot: (Number(meta.stake) * players.length) / 1e6,
      forfeited: statusCode === 4,
    };
  }

  private async requireOracle(): Promise<void> {
    if (!hasDevOracle()) throw new Error('ORACLE OFFLINE - testnet dev oracle key not injected');
  }

  // v15.2.8: the committed level for a single-mode card — (a) on-chain note
  // via the indexer scan, (b) this browser's card memory, (c) the deep-link
  // ?st= hint (v15.2.8b: fills the stage, verified FALSE — caller-controlled),
  // (d) cid%7 fallback (verified: false). Indexer hiccups never blank a card:
  // the memory/link tiers still resolve.
  private async cardStage(cid: number, stageMode: StageMode): Promise<StageResolution> {
    let notes: Record<string, number> | null = null;
    try {
      notes = await kit.fetchArenaCreateStages();
    } catch {
      console.debug('[arena] stage-note scan unreachable — falling back to card memory / link hint');
    }
    const mem = kit.rememberedCard(cid);
    return pickCardStage(cid, stageMode, {
      note: notes ? (notes[String(cid)] ?? null) : null,
      memory: mem ? { stageIdx: mem.stageIdx, stageVerified: mem.stageVerified } : null,
      link: getLinkStageHint(cid),
    });
  }

  async createChallenge(cfg: ChallengeConfig, _creator: ChallengePlayer): Promise<Challenge> {
    const me = await this.id();
    await this.requireOracle();
    const a = await kit.sdk();
    if (cfg.stageMode === 'random') throw new Error('RANDOM RUNS ON MAINNET - TESTNET IS FULL/SINGLE ONLY');
    const stakeBase = Math.round(cfg.stake * 1e6);
    // v15.2.1 PREFLIGHT: algod's 400 'overspend' must never be the first word
    // a degen hears about a missing ASA opt-in or a light balance — fail with
    // a VISIBLE, actionable line BEFORE any wallet prompt.
    {
      const algod = await kit.algodClient();
      const acct = (await algod.accountInformation(me.address).do()) as {
        amount: number | bigint;
        minBalance?: number | bigint;
        assets?: { assetId: number | bigint; amount: number | bigint }[];
      };
      const gonna = (acct.assets ?? []).find((x) => Number(x.assetId) === kit.GONNA_ASA_TESTNET);
      if (!gonna) throw new Error('OPT INTO $GONNA FIRST - ASA ' + kit.GONNA_ASA_TESTNET + ' (TESTNET)');
      if (Number(gonna.amount) < stakeBase) {
        throw new Error('NOT ENOUGH GONNA - NEED ' + fmtGonna(stakeBase / 1e6) + ', WALLET HAS ' + fmtGonna(Number(gonna.amount) / 1e6));
      }
      const spendable = Number(acct.amount) - Number(acct.minBalance ?? 0);
      if (spendable < 358_200 + 10_000) throw new Error('NEED ~0.37 ALGO FOR THE CARD MBR + FEES');
    }
    // v11: the creator's score is the SEALED RUN score (PLAY -> SEAL -> SIGN);
    // qaScore() remains the deterministic fallback for the QA harness
    const score = cfg.sealedScore ?? qaScore();
    // v14.4: creator replays are FREE pre-commitment — a create NEVER
    // carries a continue receipt. The payment-verified devOracle continue
    // path is JOINER-ONLY now (submitScore below).
    const myPk = a.decodeAddress(me.address).publicKey;
    // v15.2.1: the oracle score sig is cid-bound and the cid is read BEFORE
    // the wallet signs. A concurrent create inside the manual-approval window
    // moves next_challenge_id and algod 400s the group ('logic eval error:
    // assert failed ... ed25519verify_bare'). Re-read, re-sign, retry — a
    // fresh attempt is exact, a stale one can never confirm.
    // v15.2.2: the group is built LAZILY per attempt — a manual RETRY (or the
    // automatic cid-race re-send) always re-reads next_challenge_id and
    // re-signs with the oracle before going back to the wallet.
    let builtCid = -1;
    const build = async () => {
      const cid = await kit.nextChallengeId(); // oracle score sig is cid-bound
      // v15.2.7b (cid-race guard): the sealed run was played for cfg.runCid —
      // NEVER build/sign a create under a different id (joiners would get a
      // different seed/stage than the creator played). Throws BEFORE the
      // oracle sign + wallet prompt; the 400 auto-retry below stays as
      // belt&braces for a genuine POST-sign race, and it is safe: the rebuild
      // re-reads the counter, so it either re-signs for the SAME runCid or
      // dies right here with CID_MOVED — a mismatched card can never exist.
      if (cfg.runCid !== undefined && cid !== cfg.runCid) throw new CidMovedError(cfg.runCid, cid);
      const sig = await devOracleSignScore(kit.scoreMsg(cid, 0, myPk, score));
      builtCid = cid;
      return kit.buildCreateGroup({
        creator: me.address,
        cid,
        stakeBase,
        seats: cfg.format === 'duel' ? 1 : cfg.seatsTotal,
        // contract rule: duels are ALWAYS 24h; tables pick 4h/12h/24h
        durationSecs: cfg.format === 'duel' ? 86400 : cfg.durationSecs,
        stageMode: cfg.stageMode === 'full' ? 0 : 1,
        creatorScore: score,
        creatorScoreSig: sig,
        // v15.2.8: the creator's CHOSEN level rides the app-call NOTE —
        // creator-signed, immutable, readable by every participant
        stageIdx: cfg.stageMode === 'single' ? cfg.stageIdx : null,
      });
    };
    const txid = await kit.signSendManaged(me.sign, build, {
      label: 'SIGN & STAKE',
      rebuildOnRetry: true,
      autoRetries: 2, // up to 3 sends total on the cid-race 400 (was attempt<3)
    }).done;
    kit.recordTxid(builtCid, txid);
    const ch0 = await this.getChallenge(builtCid);
    if (!ch0) throw new Error('created on-chain but box unreadable');
    // v15.2.8: WE committed the level (note signed by this wallet) — the card
    // is verified with our pick even before the indexer catches up, and the
    // pick is persisted to card memory (resolution tier b)
    const committed = cfg.stageMode === 'single' && cfg.stageIdx !== null ? cfg.stageIdx : null;
    kit.rememberCard({
      cid: builtCid,
      creator: me.address,
      stake: cfg.stake,
      seatsTotal: ch0.seatsTotal,
      stageMode: cfg.stageMode,
      stageIdx: committed,
      stageVerified: cfg.stageMode === 'full' ? true : committed !== null,
      deadline: ch0.deadline,
      players: ch0.players.map((p) => ({ address: p.address, score: p.score, signed: !!p.signed })),
      closedKind: null,
      winner: null,
      payout: 0,
      fee: 0,
      closedAt: null,
    });
    return committed !== null ? { ...ch0, stageIdx: committed, stageVerified: true } : ch0;
  }

  async join(id: number, _player: ChallengePlayer): Promise<Challenge> {
    const me = await this.id();
    const meta = await kit.readMeta(id);
    if (!meta) throw new Error('card not found on chain');
    const txns = await kit.buildJoinGroup({ joiner: me.address, cid: id, stakeBase: Number(meta.stake) });
    kit.recordTxid(id, await kit.signSend(me.sign, txns, { label: 'ACCEPT & STAKE' }));
    const ch = await this.getChallenge(id);
    if (!ch) throw new Error('joined but box unreadable');
    return ch;
  }

  async submitScore(id: number, address: string, score: number, opts?: { continueRefId?: string }): Promise<Challenge> {
    const me = await this.id();
    await this.requireOracle();
    const a = await kit.sdk();
    const players = await kit.readPlayers(id);
    const myPk = a.decodeAddress(address).publicKey;
    const seat = players.findIndex((p) => sameAddr(p.addr, myPk));
    if (seat < 0) throw new Error('not seated at this table');
    // v12: a post-CONTINUE score needs the on-chain 5-ALGO receipt
    const sig = await devOracleSignScore(
      kit.scoreMsg(id, seat, myPk, score),
      opts?.continueRefId ? { refId: opts.continueRefId, addr: address } : undefined,
    );
    const txns = await kit.buildSubmitGroup({ player: me.address, cid: id, score, sig });
    kit.recordTxid(id, await kit.signSend(me.sign, txns, { label: 'SIGN SCORE' }));
    const ch = await this.getChallenge(id);
    if (!ch) throw new Error('submitted but box unreadable');
    return ch;
  }

  async resolve(id: number): Promise<Challenge> {
    const me = await this.id();
    await this.requireOracle();
    const a = await kit.sdk();
    const meta = await kit.readMeta(id);
    if (!meta) throw new Error('card not found on chain');
    const players = await kit.readPlayers(id);
    const entries = players
      .map((p, i) => ({ seat: i, addr: asBytes(p.addr), score: Number(p.score), signed: p.signed }))
      .filter((p) => p.signed);
    if (entries.length === 0) throw new Error('no signed scores yet');
    // verdict payload: FULL -> 32 zero bytes; STAGE_IDX -> 24 zeros + stage idx
    // v15.2.8 (owner decree): the chosen stage is the CREATOR's committed pick
    // (note > memory > link > cid%7 fallback) — the contract asserts the
    // verdict's stage_idx equals the resolve arg (contract.py:689-691), so
    // BOTH legs carry the SAME committed value.
    const chosenStage = Number(meta.stageMode) === 1 ? (await this.cardStage(id, 'single')).stageIdx! : 0;
    let extra = new Uint8Array(32);
    if (Number(meta.stageMode) === 1) {
      extra = new Uint8Array(32);
      new DataView(extra.buffer).setBigUint64(24, BigInt(chosenStage), false);
    }
    const vsig = await devOracleSign(await kit.verdictMsg(id, Number(meta.stageMode), extra, entries));
    let best = entries[0];
    for (const e of entries) if (e.score > best.score) best = e;
    const tie = entries.filter((e) => e.score === best.score).length > 1; // contract: perfect tie -> refund all, zero fee
    const winnerAddr = tie ? null : a.encodeAddress(best.addr);
    // v15.2.4 (BUG-2): the v2 contract DELETES both boxes inside resolve, so
    // a post-confirm re-read legitimately finds NOTHING — that is the SUCCESS
    // case, not a sync error. Snapshot the card BEFORE the send (the earlyClose
    // pattern, v15.2.1) and hand back the terminal state on confirm.
    const before = await this.toChallenge(id, meta, players);
    const txns = await kit.buildResolveGroup({
      caller: me.address,
      cid: id,
      stageIdx: chosenStage, // v15.2.8: the committed pick for MODE_STAGE_IDX (0 for FULL)
      seedReveal: new Uint8Array(0), // MODE_FULL: empty reveal
      verdictSig: vsig,
      winner: a.encodeAddress(best.addr), // tie: contract ignores it, refunds all
    });
    kit.recordTxid(id, await kit.signSend(me.sign, txns, { label: 'RESOLVE' }));
    kit.recordResolveAt(id, Date.now()); // honest "x AGO" for the HISTORY
    // card memory for the event-paired history (BUG-3): exact settlement math
    // (protocol_fee = floor(pot * 500 / 10_000))
    // v15.2.7 (BUG-1): pot = stake x roster length (creator included) — the
    // same legs the contract pays: fee 5% floor, winner takes the rest.
    const potMicro = Number(meta.stake) * players.length;
    const feeMicro = tie ? 0 : Math.floor(potMicro * 0.05);
    kit.rememberCard({
      cid: id,
      creator: before.creator,
      stake: before.stake,
      seatsTotal: before.seatsTotal,
      stageMode: before.stageMode,
      // v15.2.8: never persist an UNVERIFIED fallback guess as memory truth
      stageIdx: before.stageVerified === false ? null : before.stageIdx,
      stageVerified: before.stageVerified !== false,
      deadline: before.deadline,
      players: before.players.map((p) => ({ address: p.address, score: p.score, signed: !!p.signed })),
      closedKind: tie ? 'refunded' : 'resolved',
      winner: winnerAddr,
      payout: (potMicro - feeMicro) / 1e6,
      fee: feeMicro / 1e6,
      closedAt: Date.now(),
    });
    const ch = await this.getChallenge(id);
    // box still readable would mean the tx landed but state didn't move —
    // contradictory after a confirmed v2 resolve; trust the CONFIRMED tx
    // (waitForConfirmation inside signSend) and return the terminal copy.
    if (ch && ch.status === 'resolved') return ch;
    return { ...before, status: tie ? 'closed' : 'resolved', winner: winnerAddr };
  }

  // v15.2.4 audit: claim() is a TERMINAL close path on v2 (deletes both
  // boxes, ChallengeRefunded reason 1). It never re-read the box after the
  // send, so there is no false-error bug here — it only needs the card
  // memory write so the deep-link/history survive the box deletion.
  async claim(id: number, _address: string): Promise<ClaimResult> {
    const me = await this.id();
    const before = await this.getChallenge(id);
    const txns = await kit.buildClaimGroup({ caller: me.address, cid: id });
    const txid = await kit.signSend(me.sign, txns, { label: 'CLAIM' });
    kit.recordTxid(id, txid);
    if (before) this.rememberClosed(before, 'refunded', null, 0, 0);
    return { payout: 0, txid }; // exact payout lives in the inner txns
  }

  // v2: CLAIM FORFEIT — the viewer is the SIGNED duel opponent, the other
  // seat is UNSIGNED and its seat clock (seated_at + 1h) has lapsed. The
  // contract deletes both boxes: the card is gone from the board after this.
  async claimForfeit(id: number, _address: string): Promise<ClaimResult> {
    const me = await this.id();
    const a = await kit.sdk();
    const before = await this.getChallenge(id); // snapshot for the card memory (v15.2.4)
    const players = await kit.readPlayers(id);
    const myPk = a.decodeAddress(me.address).publicKey;
    const mySeat = players.findIndex((p) => sameAddr(asBytes(p.addr), myPk));
    if (mySeat < 0) throw new Error('not seated at this table');
    if (!players[mySeat].signed) throw new Error('SIGN YOUR OWN SCORE FIRST');
    const target = 1 - mySeat; // a duel has exactly seats 0 and 1
    if (!players[target]) throw new Error('opponent seat is empty');
    if (players[target].signed) throw new Error('opponent already signed - no forfeit');
    const expiresAt = Number(players[target].seatedAt) + kit.SEAT_TTL_SECS;
    if (Math.floor(Date.now() / 1000) <= expiresAt) {
      throw new Error('SEAT CLOCK STILL RUNNING - FORFEIT AT ' + new Date(expiresAt * 1000).toISOString().slice(11, 16) + ' UTC');
    }
    const txns = await kit.buildClaimForfeitGroup({ caller: me.address, cid: id, seat: target });
    const txid = await kit.signSend(me.sign, txns, { label: 'CLAIM FORFEIT' });
    kit.recordTxid(id, txid);
    kit.recordResolveAt(id, Date.now()); // terminal: honest "x AGO" everywhere
    if (before) {
      // contract: caller keeps own stake + 95% of the forfeited stake, 5% fee
      const feeMicro = Math.floor(Number(before.stake * 1e6) * 0.05);
      this.rememberClosed(before, 'forfeited', me.address, (before.stake * 1e6 - feeMicro) / 1e6, feeMicro / 1e6);
    }
    return { payout: 0, txid }; // exact payout lives in the inner txns
  }

  async earlyClose(id: number, _address: string): Promise<Challenge> {
    const me = await this.id();
    // v15.2.1: the contract DELETES both boxes on early_close, so a post-tx
    // read finds nothing — that is the SUCCESS case, not an error. Snapshot
    // the card first and hand back the terminal 'closed' copy (same as the
    // mock adapter), otherwise the UI screams a red toast over a good close.
    const before = await this.getChallenge(id);
    const txns = await kit.buildEarlyCloseGroup({ caller: me.address, cid: id });
    kit.recordTxid(id, await kit.signSend(me.sign, txns, { label: 'EARLY CLOSE' }));
    const ch = await this.getChallenge(id);
    if (ch && ch.status !== 'closed') return ch; // box still readable (unexpected) — return the truth
    if (before) {
      this.rememberClosed(before, 'refunded', null, 0, 0);
      return { ...before, status: 'closed' };
    }
    throw new Error('closed on-chain');
  }

  async getChallenge(id: number, opts?: { deepLink?: boolean }): Promise<Challenge | null> {
    const [meta, players] = await Promise.all([kit.readMeta(id), kit.readPlayers(id)]);
    if (meta) return this.toChallenge(id, meta, players);
    // v15.2.4 (BUG-3): v2 deletes BOTH boxes on every terminal transition, so
    // a missing box means SETTLED — never a 404. Rebuild the terminal card
    // from the v2 event log (winner/payout/fee + real round-time), paired with
    // this browser's card memory for stake/format/roster. Indexer down ->
    // memory alone; fresh browser -> event alone.
    const mem = kit.rememberedCard(id);
    let ev: kit.ArenaCloseEvent | null = null;
    // v15.2.7 (BUG-3c): a deep-link can outrun the indexer — retry the event
    // fetch up to 3 times over ~6s (bounded backoff) before rendering.
    const waits = opts?.deepLink ? [0, 2000, 4000] : [0];
    for (let i = 0; i < waits.length && !ev; i++) {
      if (waits[i] > 0) await new Promise((r) => setTimeout(r, waits[i]));
      try {
        const events = await this.closeEvents(true);
        ev = events.filter((e) => e.cid === id).sort((x, y) => y.round - x.round)[0] ?? null;
      } catch { /* indexer unreachable — memory below still renders */ }
    }
    if (ev) return this.terminalChallenge(id, ev.kind, ev, mem);
    if (mem && mem.closedKind) return this.terminalChallenge(id, mem.closedKind, null, mem);
    // v15.2.7: boxes gone = the card IS terminal even when neither the event
    // log nor this browser remembers it — render the honest unknown terminal
    // card ('SETTLED - DATA ON CHAIN'), never a 404 and never invented numbers.
    // Post-op callers (create/join/close) keep the null contract so their
    // 'box unreadable' guards still fire — only deep-links opt in.
    if (opts?.deepLink) return this.terminalChallenge(id, 'resolved', null, null);
    return null; // truly unknown card
  }

  // terminal card reconstructed from a close event and/or card memory.
  // kind 'resolved' with NO winner = perfect tie -> everyone refunded
  // (v14.4 convention: refunded cards render 'closed').
  private terminalChallenge(id: number, kind: 'resolved' | 'forfeited' | 'refunded', ev: kit.ArenaCloseEvent | null, mem: kit.CardMemory | null): Challenge {
    const winner = (kind !== 'refunded' ? (ev?.winner ?? null) : null) ?? mem?.winner ?? null;
    // v15.2.7: ev+mem BOTH missing = terminal-unknown — the boxes are gone so
    // the card IS settled on-chain, but no numbers survive locally. It renders
    // the resolved terminal block ('SETTLED - DATA ON CHAIN'), never a refund.
    const unknown = !ev && !mem;
    const settled = kind === 'resolved' && (winner !== null || unknown);
    const potMicro = ev ? ev.payout + ev.fee : mem ? Math.round((mem.payout + mem.fee) * 1e6) : 0;
    const at = ev?.at ?? mem?.closedAt ?? Date.now();
    const players =
      mem && mem.players.length > 0
        ? mem.players.map((p) => ({
            address: p.address,
            name: shortAddr(p.address),
            score: p.score,
            fighter: { skin: 'gonna', assetId: null, name: 'GONNA' },
            accountType: 'ed25519' as AccountType,
            signed: p.signed,
          }))
        : winner
          ? [{ address: winner, name: shortAddr(winner), score: 0, fighter: { skin: 'gonna', assetId: null, name: 'GONNA' }, accountType: 'ed25519' as AccountType }]
          : [];
    const creator = mem?.creator ?? winner ?? '';
    // v15.2.8: terminal cards keep the committed level from card memory / the
    // link hint; without either, the cid%7 fallback renders '(UNVERIFIED)'
    // (the on-chain note tier is async — the live path resolves it first and
    // banks the verified stage into memory before the card settles)
    const tStage = pickCardStage(id, mem?.stageMode ?? 'full', {
      memory: mem ? { stageIdx: mem.stageIdx, stageVerified: mem.stageVerified } : null,
      link: getLinkStageHint(id),
    });
    return {
      id,
      creator,
      creatorName: creator ? shortAddr(creator) : '???',
      creatorType: 'ed25519',
      visibility: 'public',
      format: mem && mem.seatsTotal > 2 ? 'open' : 'duel', // event-only: duels are the live format
      seatsTotal: mem?.seatsTotal ?? 2,
      durationSecs: 0,
      stageMode: mem?.stageMode ?? 'full',
      stageIdx: tStage.stageIdx,
      stageVerified: tStage.verified,
      // v15.2.7 (BUG-3a): the stake comes from card memory ONLY — the chain
      // event names pot/winner/fee, never the per-seat stake. No memory =
      // stake UNKNOWN (NaN -> fmtStake renders '-'), never pot/2 (that was a
      // duel-only guess, wrong for tables — inventing numbers is banned).
      stake: mem?.stake ?? NaN,
      createdAt: at - 3600_000, // unknown — the settle time is the real record
      deadline: mem?.deadline ?? at,
      status: settled ? 'resolved' : 'closed',
      players,
      winner,
      pot: potMicro / 1e6 || (mem ? mem.stake * Math.max(1, mem.players.length) : 0),
      forfeited: kind === 'forfeited',
    };
  }

  // event-log cache: the indexer answers once per 30s per session at most
  // (board refreshes and deep-links share it); failures fall back to the
  // last good answer so an indexer hiccup never blanks the HISTORY.
  private eventsCache: { at: number; events: kit.ArenaCloseEvent[] } | null = null;
  private async closeEvents(force = false): Promise<kit.ArenaCloseEvent[]> {
    if (!force && this.eventsCache && Date.now() - this.eventsCache.at < 30_000) return this.eventsCache.events;
    try {
      const events = await kit.fetchArenaCloseEvents();
      this.eventsCache = { at: Date.now(), events };
      return events;
    } catch {
      console.debug('[arena] indexer unreachable — HISTORY falls back to live boxes + card memory');
      return this.eventsCache?.events ?? [];
    }
  }

  // card memory write for a close path this browser just confirmed
  private rememberClosed(c: Challenge, kind: 'resolved' | 'forfeited' | 'refunded', winner: string | null, payout: number, fee: number): void {
    kit.rememberCard({
      cid: c.id,
      creator: c.creator,
      stake: c.stake,
      seatsTotal: c.seatsTotal,
      stageMode: c.stageMode,
      stageIdx: c.stageVerified === false ? null : c.stageIdx, // v15.2.8: guesses never become memory truth
      stageVerified: c.stageVerified !== false,
      deadline: c.deadline,
      players: c.players.map((p) => ({ address: p.address, score: p.score, signed: !!p.signed })),
      closedKind: kind,
      winner,
      payout,
      fee,
      closedAt: Date.now(),
    });
  }

  // v15: the on-chain counter = the id the next create will get (DESCENT seed)
  async peekNextId(): Promise<number | null> {
    try {
      return await kit.nextChallengeId();
    } catch {
      return null; // offline/algorand hiccup — the run falls back to the draft ref
    }
  }

  private versionChecked = false;
  // v2: the VERSION global pins the box layout — warn loudly (visible in
  // console) if the app we point at is not the v2 contract this build parses
  private async ensureVersion(): Promise<void> {
    if (this.versionChecked) return;
    this.versionChecked = true;
    try {
      const v = await kit.contractVersion();
      if (v !== kit.ARENA_VERSION) console.debug('[arena] WARNING: contract VERSION=' + v + ', this build parses v' + kit.ARENA_VERSION + ' boxes');
    } catch {
      console.debug('[arena] VERSION read failed (network hiccup) — continuing');
    }
  }

  private async scan(): Promise<Challenge[]> {
    await this.ensureVersion();
    const ids = await kit.scanChallengeIds();
    // parallel box reads — sequential is 2 round-trips PER card, way too slow
    const all = await Promise.all(ids.map((cid) => this.getChallenge(cid).catch(() => null)));
    const live = all.filter((c): c is Challenge => c !== null);
    // v15.2.4 (BUG-3): remember every LIVE card this browser sees — when it
    // later closes, the v2 event pairs with this memory for stake/format/
    // roster (the event alone only names cid/winner/payout/fee)
    for (const c of live) {
      kit.rememberCard({
        cid: c.id,
        creator: c.creator,
        stake: c.stake,
        seatsTotal: c.seatsTotal,
        stageMode: c.stageMode,
        stageIdx: c.stageVerified === false ? null : c.stageIdx, // v15.2.8: never bank a fallback guess
        stageVerified: c.stageVerified !== false,
        deadline: c.deadline,
        players: c.players.map((p) => ({ address: p.address, score: p.score, signed: !!p.signed })),
        closedKind: null,
        winner: c.winner,
        payout: 0,
        fee: 0,
        closedAt: null,
      });
    }
    return live;
  }

  async listOpenChallenges(): Promise<Challenge[]> {
    return (await this.scan()).filter((c) => c.status === 'open' || c.status === 'full' || c.status === 'expired');
  }

  async myChallenges(address: string): Promise<Challenge[]> {
    return (await this.scan()).filter((c) => c.creator === address || c.players.some((p) => p.address === address));
  }

  // v15.2.4 (BUG-3): v2 terminal transitions DELETE both boxes, so HISTORY
  // = live settled boxes (none on v2, kept for safety) UNION the v2 event log
  // (ChallengeResolved / ChallengeForfeited — the permanent on-chain record)
  // UNION this browser's card memory (covers indexer lag and offline).
  // Pure REFUNDED events (claim / early-close / catastrophe / tie leg) are
  // NOT battles — no entry (a tie still shows via its ChallengeResolved).
  // The LEGACY app (769688298) emits NO events: its history stays whatever
  // this browser remembers — documented in the header of testnetKit.ts.
  async listHistory(): Promise<HistoryEntry[]> {
    const byId = new Map<number, HistoryEntry>();
    // algod hiccup must never blank the HISTORY — events + memory still render
    const settled = await this.scan()
      .then((all) => all.filter((c) => c.status === 'resolved' || c.status === 'claimed'))
      .catch(() => [] as Challenge[]);
    for (const c of settled) {
      byId.set(c.id, {
        id: c.id,
        stake: c.stake,
        pot: c.pot,
        format: c.format,
        stageMode: c.stageMode,
        stageIdx: c.stageIdx,
        stageVerified: c.stageVerified !== false,
        seats: c.seatsTotal,
        winner: c.winner ?? '',
        winnerName: c.winner ? shortAddr(c.winner) : '???',
        players: c.players.map((p) => ({ address: p.address, name: p.name, score: p.score })),
        // no on-chain timestamp: if WE resolved it the real time is remembered
        // locally (recordResolveAt); else the deadline is the closest truth,
        // clamped to now so a card resolved early never shows "1M AGO" from a
        // FUTURE deadline
        resolvedAt: kit.getResolveAt(c.id) ?? Math.min(c.deadline, Date.now()),
        claimed: c.status === 'claimed',
      });
    }
    for (const ev of await this.closeEvents()) {
      if (ev.kind === 'refunded') continue; // not a battle (see header)
      const mem = kit.rememberedCard(ev.cid);
      byId.set(ev.cid, {
        id: ev.cid,
        // event knows pot = payout + fee exactly; stake/seats come from the
        // card memory when this browser witnessed the card, else duel estimate
        stake: mem?.stake ?? (ev.payout + ev.fee) / 1e6 / 2,
        pot: (ev.payout + ev.fee) / 1e6,
        format: mem && mem.seatsTotal > 2 ? 'open' : 'duel',
        stageMode: mem?.stageMode ?? 'full',
        stageIdx: pickCardStage(ev.cid, mem?.stageMode ?? 'full', { memory: mem ? { stageIdx: mem.stageIdx, stageVerified: mem.stageVerified } : null, link: getLinkStageHint(ev.cid) }).stageIdx,
        stageVerified: pickCardStage(ev.cid, mem?.stageMode ?? 'full', { memory: mem ? { stageIdx: mem.stageIdx, stageVerified: mem.stageVerified } : null, link: getLinkStageHint(ev.cid) }).verified,
        seats: mem?.seatsTotal ?? 2,
        winner: ev.winner ?? '',
        winnerName: ev.winner ? shortAddr(ev.winner) : 'TIE - ALL REFUNDED',
        players:
          mem && mem.players.length > 0
            ? mem.players.map((p) => ({ address: p.address, name: shortAddr(p.address), score: p.score }))
            : ev.winner
              ? [{ address: ev.winner, name: shortAddr(ev.winner), score: 0 }]
              : [],
        // the indexer round-time IS the real settle timestamp — better than
        // the local record and available on every browser, not just ours
        resolvedAt: ev.at || (kit.getResolveAt(ev.cid) ?? Date.now()),
        claimed: true, // testnet pays INSIDE resolve/forfeit — a settled match is a PAID match
      });
    }
    // terminal cards the indexer has not caught yet (or never will, offline):
    // this browser's own closes are never lost
    for (const mem of kit.rememberedCards()) {
      if (!mem.closedKind || mem.closedKind === 'refunded' || byId.has(mem.cid)) continue;
      byId.set(mem.cid, {
        id: mem.cid,
        stake: mem.stake,
        pot: mem.payout + mem.fee || mem.stake * Math.max(1, mem.players.length),
        format: mem.seatsTotal > 2 ? 'open' : 'duel',
        stageMode: mem.stageMode,
        stageIdx: pickCardStage(mem.cid, mem.stageMode, { memory: { stageIdx: mem.stageIdx, stageVerified: mem.stageVerified }, link: getLinkStageHint(mem.cid) }).stageIdx,
        stageVerified: pickCardStage(mem.cid, mem.stageMode, { memory: { stageIdx: mem.stageIdx, stageVerified: mem.stageVerified }, link: getLinkStageHint(mem.cid) }).verified,
        seats: mem.seatsTotal,
        winner: mem.winner ?? '',
        winnerName: mem.winner ? shortAddr(mem.winner) : '???',
        players: mem.players.map((p) => ({ address: p.address, name: shortAddr(p.address), score: p.score })),
        resolvedAt: mem.closedAt ?? kit.getResolveAt(mem.cid) ?? mem.deadline,
        claimed: true,
      });
    }
    return [...byId.values()].sort((x, y) => y.resolvedAt - x.resolvedAt);
  }

  async legacyStats(address: string): Promise<LegacyStats> {
    const hist = await this.listHistory();
    let wins = 0;
    let losses = 0;
    let won = 0;
    let lost = 0;
    let bestWin = 0;
    for (const h of hist) {
      if (!h.players.some((p) => p.address === address)) continue;
      if (!h.winner) continue; // tie: everyone refunded — no scar, no W, no L
      if (h.winner === address) {
        wins++;
        const takes = splitPot(h.stake, h.pot, h.players.length).takes;
        won += takes;
        if (takes > bestWin) bestWin = takes;
      } else {
        losses++;
        lost += h.stake;
      }
    }
    // OPEN: live cards where I'm seated (or the creator) — not settled yet
    const mine = await this.myChallenges(address);
    const open = mine.filter((c) => c.status === 'open' || c.status === 'full' || c.status === 'expired').length;
    const played = wins + losses;
    return { played, wins, losses, open, winRate: played > 0 ? Math.round((wins / played) * 100) : 0, won, lost, net: won - lost, bestWin };
  }
}

// real network fee per op (testnet flat-fee sums; Falcon keeps the 7x
// multiplier for the mainnet PQ future)
export function feeLine(op: kit.ArenaOp, accountType: AccountType, testnet: boolean): string {
  if (testnet) return (kit.TESTNET_FEES[op] / 1e6).toFixed(3) + ' ALGO (TESTNET)';
  return fmtFee(accountType);
}

// ---------- selector ----------
// MOCK is the PUBLIC default (the Prince flips the preview explicitly).
// ?arena=testnet enables the live testnet adapter and PERSISTS the choice.
const LS_ADAPTER = 'gonna.arena.adapter';
let current: ArenaAdapter | null = null;
export function arenaMode(): 'mock' | 'testnet' {
  try {
    // explicit query ALWAYS wins (and persists)
    const q = new URLSearchParams(window.location.search).get('arena');
    if (q === 'testnet') {
      window.localStorage.setItem(LS_ADAPTER, 'testnet');
      return 'testnet';
    }
    if (q === 'mock') {
      window.localStorage.setItem(LS_ADAPTER, 'mock');
      return 'mock';
    }
    // STAGING FLAG (beats any stored flag — a leftover 'mock' from old tests
    // must NOT win on the staging path): gonna.bond/arena-testnet/ lands
    // straight on-chain; public previews (any other origin/path) stay MOCK.
    if (window.location.hostname.includes('gonna.bond') && window.location.pathname.includes('arena-testnet')) {
      return 'testnet';
    }
    const stored = window.localStorage.getItem(LS_ADAPTER);
    if (stored === 'testnet' || stored === 'mock') return stored;
    return 'mock';
  } catch {
    return 'mock';
  }
}
export function getArenaAdapter(): ArenaAdapter {
  if (current) return current;
  current = arenaMode() === 'testnet' ? new TestnetArenaAdapter() : new MockArenaAdapter();
  return current;
}
// CI/QA hook: force a fresh adapter pick
export function resetArenaAdapter(): void {
  current = null;
}
