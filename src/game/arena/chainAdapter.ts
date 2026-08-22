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
}

export interface ChallengePlayer {
  address: string;
  name: string; // degen label (NFD segment or short address)
  score: number; // 0 = not submitted yet
  fighter: FighterPick;
  accountType: AccountType; // falcon accounts carry the QUANTUM SEAL
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
}

export interface ClaimResult {
  payout: number;
  txid: string;
}

export interface ArenaAdapter {
  readonly mode: 'mock' | 'testnet';
  createChallenge(cfg: ChallengeConfig, creator: ChallengePlayer): Promise<Challenge>;
  join(id: number, player: ChallengePlayer): Promise<Challenge>;
  submitScore(id: number, address: string, score: number): Promise<Challenge>;
  resolve(id: number): Promise<Challenge>;
  claim(id: number, address: string): Promise<ClaimResult>;
  earlyClose(id: number, address: string): Promise<Challenge>;
  listOpenChallenges(): Promise<Challenge[]>;
  myChallenges(address: string): Promise<Challenge[]>;
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
  challenges: Challenge[];
}

const DEGEN_NAMES = ['GEKKORIDER', 'WHALE_X', 'SER_BUYTHE_DIP', 'LIL_LIZARD', 'ANON_404', 'PUMP_SAINT', 'HODL_GOBLIN', 'MOON_MARTIAN'];

function lsLoad(): Store {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s && Array.isArray(s.challenges)) return s;
    }
  } catch { /* corrupt: rebuild */ }
  return { nextId: 1, seeded: false, challenges: [] };
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

export class MockArenaAdapter implements ArenaAdapter {
  readonly mode = 'mock' as const;

  private store(): Store {
    const s = lsLoad();
    if (!s.seeded) {
      seed(s);
      lsSave(s);
    }
    return s;
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
      players: [{ ...creator, score: 0 }],
      winner: null,
      pot: cfg.stake,
    };
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
    if (c.status === 'resolved' || c.status === 'claimed') return c;
    if (c.players.length === 0) throw new Error('no players');
    let best = c.players[0];
    for (const p of c.players) if (p.score > best.score) best = p;
    c.winner = best.address;
    c.status = 'resolved';
    lsSave(s);
    return c;
  }

  async claim(id: number, address: string): Promise<ClaimResult> {
    const s = this.store();
    const c = this.find(s, id);
    this.refresh(c);
    // expired with the caller as the only/top seat -> refund-style claim;
    // resolved -> winner claims the pot
    if (c.status === 'resolved') {
      if (c.winner !== address) throw new Error('only the winner claims the pot');
      c.status = 'claimed';
      lsSave(s);
      return { payout: c.pot, txid: 'MOCK' + String(id).padStart(6, '0') };
    }
    if (c.status === 'expired') {
      const mine = c.players.find((p) => p.address === address);
      if (!mine) throw new Error('not seated at this table');
      c.status = 'closed';
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
    c.deadline = Date.now();
    lsSave(s);
    return c;
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
// TESTNET ADAPTER — algosdk skeleton on the QuantumArena ARC-56.
// TODO(deploy): set ARENA_APP_ID + GONNA_ASA_TESTNET after the testnet
// deploy, then flip getArenaAdapter() (or ?arena=testnet) to go live.
// ======================================================================
export const ARENA_APP_ID = 0; // TODO(deploy): testnet app id — PLACEHOLDER
export const GONNA_ASA_TESTNET = 0; // TODO(deploy): testnet $GONNA ASA id
const TESTNET_ALGOD = 'https://testnet-api.algonode.cloud';

// ARC-56 method names (QuantumArena.arc56.json):
//   create_challenge(pay mbr, axfer stake, uint64 stake, uint64 seats_total,
//     uint64 duration_secs, uint64 stage_mode, byte[] seed_commitment,
//     uint64 creator_score, byte[] creator_score_sig) -> uint64
//   join_challenge(axfer stake, uint64 challenge_id) -> uint64
//   submit_score(uint64 challenge_id, uint64 score, byte[] sig) -> void
//   resolve(uint64 challenge_id, uint64 stage_idx, byte[] seed_reveal,
//     byte[] verdict_sig) -> byte[]
//   claim(uint64 challenge_id) / early_close(pay fee, uint64 challenge_id)
// Boxes: "m" prefix + uint64 id -> ChallengeMeta struct (see arc56 structs).

type SignFn = (txGroups: unknown[][]) => Promise<Uint8Array[]>;

export class TestnetArenaAdapter implements ArenaAdapter {
  readonly mode = 'testnet' as const;
  private address: string;
  private accountType: AccountType;
  private sign: SignFn;
  constructor(address: string, accountType: AccountType, sign: SignFn) {
    this.address = address;
    this.accountType = accountType;
    this.sign = sign;
  }

  private async sdk() {
    // algosdk is heavy: dynamic import so it never rides the entry chunk
    const algosdk = await import('algosdk');
    if (ARENA_APP_ID === 0) {
      // TODO(deploy): deploy QuantumArena to testnet, write the app id into
      // ARENA_APP_ID above, then this guard goes away.
      throw new Error('ARENA not deployed yet - set ARENA_APP_ID');
    }
    return { algosdk, algod: new algosdk.Algodv2('', TESTNET_ALGOD, '') };
  }

  // shared composer: one ABI call + its payment/axfer companions, signed as
  // a single group. feeOverride bumps the app-call fee for Falcon accounts
  // (resource-based PQ pricing — see estimateNetworkFee).
  private async callMethod(
    methodName: string,
    appArgs: (Uint8Array | number | bigint)[],
    extra: { pay?: number; axfer?: { assetId: number; amount: number } } = {},
  ): Promise<string> {
    const { algosdk, algod } = await this.sdk();
    const params = await algod.getTransactionParams().do();
    const feeMicro = Math.round(estimateNetworkFee(this.accountType) * 1e6);
    const txns: InstanceType<typeof algosdk.Transaction>[] = [];
    if (extra.pay !== undefined) {
      txns.push(
        algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: this.address,
          receiver: algosdk.getApplicationAddress(ARENA_APP_ID),
          amount: extra.pay,
          suggestedParams: params,
        }),
      );
    }
    if (extra.axfer) {
      txns.push(
        algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: this.address,
          receiver: algosdk.getApplicationAddress(ARENA_APP_ID),
          assetIndex: extra.axfer.assetId,
          amount: extra.axfer.amount,
          suggestedParams: params,
        }),
      );
    }
    const method = algosdk.ABIMethod.fromSignature(this.methodSig(methodName));
    const appCall = algosdk.makeApplicationCallTxnFromObject({
      sender: this.address,
      appIndex: ARENA_APP_ID,
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
      appArgs: [method.getSelector(), ...appArgs.map((a) => (a instanceof Uint8Array ? a : algosdk.encodeUint64(a)))],
      suggestedParams: { ...params, fee: feeMicro, flatFee: true },
    });
    txns.push(appCall);
    algosdk.assignGroupID(txns);
    const signed = await this.sign([txns.map((txn) => ({ txn, signers: [this.address] }))]);
    const res = (await algod.sendRawTransaction(signed).do()) as { txid?: string };
    return res.txid ?? appCall.txID();
  }

  // exact ARC-56 signatures (from QuantumArena.arc56.json)
  private methodSig(name: string): string {
    switch (name) {
      case 'create_challenge':
        return 'create_challenge(pay,axfer,uint64,uint64,uint64,uint64,byte[],uint64,byte[])uint64';
      case 'join_challenge':
        return 'join_challenge(axfer,uint64)uint64';
      case 'submit_score':
        return 'submit_score(uint64,uint64,byte[])void';
      case 'resolve':
        return 'resolve(uint64,uint64,byte[],byte[])byte[]';
      case 'claim':
        return 'claim(uint64)void';
      case 'early_close':
        return 'early_close(pay,uint64)void';
      default:
        throw new Error('unknown arena method ' + name);
    }
  }

  async createChallenge(cfg: ChallengeConfig, _creator: ChallengePlayer): Promise<Challenge> {
    // TODO(deploy): MBR payment amount comes from the box size the contract
    // reserves for ChallengeMeta (+ players map). Read it from the app spec
    // after the deploy; 0.1 ALGO is a placeholder.
    const MBR = 100_000;
    // TODO(oracle): creator_score + sig come from the score oracle — until it
    // is live the mock flow stays the default path.
    await this.callMethod(
      'create_challenge',
      [
        cfg.stake,
        cfg.format === 'duel' ? 2 : cfg.seatsTotal,
        cfg.durationSecs,
        cfg.stageMode === 'full' ? 0 : cfg.stageMode === 'single' ? 1 : 2,
        new Uint8Array(32), // seed_commitment: TODO(randomness) commit-reveal
        0, // creator_score: TODO(oracle)
        new Uint8Array(0), // creator_score_sig: TODO(oracle)
      ],
      { pay: MBR, axfer: { assetId: GONNA_ASA_TESTNET, amount: cfg.stake } },
    );
    throw new Error('testnet create not wired end-to-end yet - use the mock arena');
  }

  async join(id: number, _player: ChallengePlayer): Promise<Challenge> {
    const c = await this.readChallenge(id);
    await this.callMethod('join_challenge', [id], { axfer: { assetId: GONNA_ASA_TESTNET, amount: c.stake } });
    throw new Error('testnet join not wired end-to-end yet - use the mock arena');
  }

  async submitScore(id: number, _address: string, score: number): Promise<Challenge> {
    // TODO(oracle): the sig must come from the score oracle, not the client.
    await this.callMethod('submit_score', [id, score, new Uint8Array(0)]);
    throw new Error('testnet submit not wired end-to-end yet - use the mock arena');
  }

  async resolve(id: number): Promise<Challenge> {
    // TODO(oracle): seed_reveal + verdict_sig are oracle duties on testnet.
    await this.callMethod('resolve', [id, 0, new Uint8Array(32), new Uint8Array(0)]);
    throw new Error('testnet resolve not wired end-to-end yet - use the mock arena');
  }

  async claim(id: number, _address: string): Promise<ClaimResult> {
    const txid = await this.callMethod('claim', [id]);
    return { payout: 0, txid }; // payout is read from the box after confirm
  }

  async earlyClose(id: number, _address: string): Promise<Challenge> {
    // early_close takes a fee payment covering the refund inner txns
    const feeMicro = Math.round(estimateNetworkFee(this.accountType) * 1e6);
    await this.callMethod('early_close', [id], { pay: feeMicro * 2 });
    throw new Error('testnet early-close not wired end-to-end yet - use the mock arena');
  }

  // box read: "m" prefix + big-endian uint64 id -> ChallengeMeta struct.
  // TODO(deploy): decode with the ARC-56 struct codec (algosdk ABIType) once
  // the app id is live; until then list* return empty so the UI falls back
  // to "no live cards" instead of crashing.
  private async readChallenge(_id: number): Promise<{ stake: number }> {
    await this.sdk(); // throws while ARENA_APP_ID === 0
    return { stake: 0 };
  }
  async listOpenChallenges(): Promise<Challenge[]> {
    return [];
  }
  async myChallenges(_address: string): Promise<Challenge[]> {
    return [];
  }
}

// ---------- selector ----------
// MOCK is the default until the testnet deploy lands. ?arena=testnet (or a
// persisted flag) previews the testnet skeleton once ARENA_APP_ID is set.
let current: ArenaAdapter | null = null;
export function getArenaAdapter(): ArenaAdapter {
  if (current) return current;
  let wantTestnet = false;
  try {
    wantTestnet =
      ARENA_APP_ID > 0 &&
      (window.localStorage.getItem('gonna.arena.adapter') === 'testnet' ||
        new URLSearchParams(window.location.search).get('arena') === 'testnet');
  } catch { /* no window: mock */ }
  current = wantTestnet ? new TestnetArenaAdapter('', 'ed25519', async () => { throw new Error('wallet signing not wired'); }) : new MockArenaAdapter();
  return current;
}
// CI/QA hook: force a fresh adapter pick
export function resetArenaAdapter(): void {
  current = null;
}
