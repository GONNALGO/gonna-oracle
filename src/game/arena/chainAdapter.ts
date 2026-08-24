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
  stageIdx: number | null; // 0-6 for single; null = full run / random pending
  stake: number; // $GONNA display units per seat
  fighter: FighterPick;
  sealedScore?: number; // v11: the run score sealed BEFORE signing (testnet)
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
  stageIdx: number | null; // resolved stage (random resolves at create/join)
  stake: number;
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
  // v10.4: deep-link lookup (?duel=<id>) — any visibility, live cards only
  getChallenge(id: number): Promise<Challenge | null>;
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

// settlement math (the contract takes the 5% treasury fee INSIDE resolve):
// pool = stake x seats taken, fee = 5% of the pool, winner takes the rest.
// `pot` from older records may only carry the creator stake — the pool is
// never smaller than stake x seats actually taken.
export function splitPot(stake: number, pot: number, seatsTaken: number): { pool: number; fee: number; takes: number } {
  const pool = Math.max(pot, stake * Math.max(1, seatsTaken));
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
      stake,
      createdAt: now - (12 - hrsLeft) * 3600_000,
      deadline: now + hrsLeft * 3600_000,
      status: seatsTaken >= seatsTotal ? 'full' : 'open',
      players,
      winner: null,
      pot: stake * seatsTaken,
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
    s.history!.push({
      id: s.nextId++,
      stake,
      pot: stake * Math.min(seats, 2), // duels pay 2x, tables approx for flavor
      format,
      stageMode,
      stageIdx,
      seats,
      winner,
      winnerName: name,
      players: [
        { address: winner, name, score: 9000 + (name.length * 137) % 4000 },
        { address: loser, name: DEGEN_NAMES[(name.length + 3) % DEGEN_NAMES.length], score: 7000 },
      ],
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
    const c: Challenge = {
      id: s.nextId++,
      creator: creator.address,
      creatorName: creator.name,
      creatorType: creator.accountType,
      visibility: cfg.visibility,
      format: cfg.format,
      seatsTotal: cfg.format === 'duel' ? 2 : cfg.seatsTotal,
      durationSecs: cfg.durationSecs,
      stageMode: cfg.stageMode,
      stageIdx: cfg.stageMode === 'random' ? Math.floor(Math.random() * 7) : cfg.stageIdx,
      stake: cfg.stake,
      createdAt: now,
      deadline: now + cfg.durationSecs * 1000,
      status: cfg.format === 'duel' ? 'open' : 'open',
      // v12: the creator plays BEFORE signing everywhere — a sealed score
      // (testnet or mock) rides inside the create, same as the contract
      players: [{ ...creator, score: cfg.sealedScore ?? 0 }],
      winner: null,
      pot: cfg.stake,
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
      c.pot += c.stake;
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
    c.pot += c.stake;
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
      c.pot += c.stake;
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
    return {
      id: cid,
      creator,
      creatorName: shortAddr(creator),
      creatorType: 'ed25519', // Falcon lands on mainnet — testnet accounts are classic
      visibility: 'public', // v5 contract has no private flag on-chain
      format: Number(meta.seatsTotal) <= 1 ? 'duel' : 'open',
      seatsTotal,
      durationSecs: 0, // not stored on-chain; deadline is the truth
      stageMode: Number(meta.stageMode) === 0 ? 'full' : Number(meta.stageMode) === 1 ? 'single' : 'random',
      stageIdx: null,
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
      pot: (Number(meta.stake) * seatsTaken) / 1e6,
      forfeited: statusCode === 4,
    };
  }

  private async requireOracle(): Promise<void> {
    if (!hasDevOracle()) throw new Error('ORACLE OFFLINE - testnet dev oracle key not injected');
  }

  async createChallenge(cfg: ChallengeConfig, _creator: ChallengePlayer): Promise<Challenge> {
    const me = await this.id();
    await this.requireOracle();
    const a = await kit.sdk();
    if (cfg.stageMode === 'random') throw new Error('RANDOM RUNS ON MAINNET - TESTNET IS FULL/SINGLE ONLY');
    const cid = await kit.nextChallengeId(); // oracle score sig is cid-bound
    // v11: the creator's score is the SEALED RUN score (PLAY -> SEAL -> SIGN);
    // qaScore() remains the deterministic fallback for the QA harness
    const score = cfg.sealedScore ?? qaScore();
    // v14.4: creator replays are FREE pre-commitment — a create NEVER
    // carries a continue receipt. The payment-verified devOracle continue
    // path is JOINER-ONLY now (submitScore below).
    const sig = await devOracleSignScore(kit.scoreMsg(cid, 0, a.decodeAddress(me.address).publicKey, score));
    const txns = await kit.buildCreateGroup({
      creator: me.address,
      cid,
      stakeBase: Math.round(cfg.stake * 1e6),
      seats: cfg.format === 'duel' ? 1 : cfg.seatsTotal,
      // contract rule: duels are ALWAYS 24h; tables pick 4h/12h/24h
      durationSecs: cfg.format === 'duel' ? 86400 : cfg.durationSecs,
      stageMode: cfg.stageMode === 'full' ? 0 : 1,
      creatorScore: score,
      creatorScoreSig: sig,
    });
    kit.recordTxid(cid, await kit.signSend(me.sign, txns));
    const ch = await this.getChallenge(cid);
    if (!ch) throw new Error('created on-chain but box unreadable');
    return ch;
  }

  async join(id: number, _player: ChallengePlayer): Promise<Challenge> {
    const me = await this.id();
    const meta = await kit.readMeta(id);
    if (!meta) throw new Error('card not found on chain');
    const txns = await kit.buildJoinGroup({ joiner: me.address, cid: id, stakeBase: Number(meta.stake) });
    kit.recordTxid(id, await kit.signSend(me.sign, txns));
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
    kit.recordTxid(id, await kit.signSend(me.sign, txns));
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
    let extra = new Uint8Array(32);
    if (Number(meta.stageMode) === 1) {
      extra = new Uint8Array(32);
      new DataView(extra.buffer).setBigUint64(24, BigInt(0), false); // TODO(mainnet): real chosen stage
    }
    const vsig = await devOracleSign(await kit.verdictMsg(id, Number(meta.stageMode), extra, entries));
    let best = entries[0];
    for (const e of entries) if (e.score > best.score) best = e;
    const txns = await kit.buildResolveGroup({
      caller: me.address,
      cid: id,
      stageIdx: 0, // TODO(mainnet): chosen stage for MODE_STAGE_IDX
      seedReveal: new Uint8Array(0), // MODE_FULL: empty reveal
      verdictSig: vsig,
      winner: a.encodeAddress(best.addr),
    });
    kit.recordTxid(id, await kit.signSend(me.sign, txns));
    kit.recordResolveAt(id, Date.now()); // honest "x AGO" for the HISTORY
    const ch = await this.getChallenge(id);
    // NEVER synthesize a verdict: the UI may only crown a winner the CHAIN
    // has confirmed (status RESOLVED + winner read from the box).
    if (!ch || ch.status !== 'resolved') throw new Error('RESOLVE CONFIRMED - STATE SYNC PENDING, REOPEN THE CARD');
    return ch;
  }

  async claim(id: number, _address: string): Promise<ClaimResult> {
    const me = await this.id();
    const txns = await kit.buildClaimGroup({ caller: me.address, cid: id });
    const txid = await kit.signSend(me.sign, txns);
    kit.recordTxid(id, txid);
    return { payout: 0, txid }; // exact payout lives in the inner txns
  }

  // v2: CLAIM FORFEIT — the viewer is the SIGNED duel opponent, the other
  // seat is UNSIGNED and its seat clock (seated_at + 1h) has lapsed. The
  // contract deletes both boxes: the card is gone from the board after this.
  async claimForfeit(id: number, _address: string): Promise<ClaimResult> {
    const me = await this.id();
    const a = await kit.sdk();
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
    const txid = await kit.signSend(me.sign, txns);
    kit.recordTxid(id, txid);
    kit.recordResolveAt(id, Date.now()); // terminal: honest "x AGO" everywhere
    return { payout: 0, txid }; // exact payout lives in the inner txns
  }

  async earlyClose(id: number, _address: string): Promise<Challenge> {
    const me = await this.id();
    const txns = await kit.buildEarlyCloseGroup({ caller: me.address, cid: id });
    kit.recordTxid(id, await kit.signSend(me.sign, txns));
    const ch = await this.getChallenge(id);
    if (!ch) throw new Error('closed on-chain');
    return ch;
  }

  async getChallenge(id: number): Promise<Challenge | null> {
    const [meta, players] = await Promise.all([kit.readMeta(id), kit.readPlayers(id)]);
    if (!meta) return null;
    return this.toChallenge(id, meta, players);
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
    return all.filter((c): c is Challenge => c !== null);
  }

  async listOpenChallenges(): Promise<Challenge[]> {
    return (await this.scan()).filter((c) => c.status === 'open' || c.status === 'full' || c.status === 'expired');
  }

  async myChallenges(address: string): Promise<Challenge[]> {
    return (await this.scan()).filter((c) => c.creator === address || c.players.some((p) => p.address === address));
  }

  async listHistory(): Promise<HistoryEntry[]> {
    const settled = (await this.scan()).filter((c) => c.status === 'resolved' || c.status === 'claimed');
    return settled.map((c) => ({
      id: c.id,
      stake: c.stake,
      pot: c.pot,
      format: c.format,
      stageMode: c.stageMode,
      stageIdx: c.stageIdx,
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
    }));
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
