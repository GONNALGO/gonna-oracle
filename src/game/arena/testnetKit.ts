// ============================================================================
// THE ARENA — CHAIN KIT (testnet-born, network-agnostic since M-1).
// Exact atomic groups for the QuantumArena v2 contract (deploy/smoke_v2_testnet.py
// is the reference implementation; v5.0.0 pooled-opcode-budget via OpUp).
//   TESTNET: APP v2.1 769907387 · $GONNA ASA 769688287 · OPUP DONOR 769688641
//   v1 app 769688298 is LEGACY — old cards stay resolvable on-chain there.
// M-1: all network constants now resolve from ./arenaKit (VITE_ARENA_NETWORK
// build flag) — the historical *testnet* export NAMES stay as deprecated
// aliases so every existing import keeps working untouched.
// ============================================================================
import { ARENA_NETWORK, IS_MAINNET, NET, netLsKey } from './arenaKit';
import type { ArenaNetwork } from './arenaKit';

export { ARENA_NETWORK, IS_MAINNET };
export type { ArenaNetwork };
export const ARENA_APP_ID = NET.appId;
export const LEGACY_ARENA_APP_ID = NET.legacyAppId;
export const GONNA_ASA = NET.gonnaAsa;
/** @deprecated network-resolved alias — prefer GONNA_ASA */
export const GONNA_ASA_TESTNET = NET.gonnaAsa;
export const OPUP_APP_ID = NET.opUpAppId;
export const TREASURY_ADDR = NET.treasuryAddr;
export const ORACLE_ADDR = NET.oracleAddr;
export const ALGOD_URL = NET.algodUrl;
/** @deprecated network-resolved alias — prefer ALGOD_URL */
export const ALGOD_TESTNET = NET.algodUrl;

// v2 seat clock: a duel seat that stays UNSIGNED for SEAT_TTL seconds can be
// forfeited by the signed opponent via claim_forfeit(cid, seat).
export const SEAT_TTL_SECS = 3600;
// contract.py: CATASTROPHE_WINDOW = 7 * 24 * 3600 — the permissionless full
// refund opens deadline + 7d (FUNDS CAN NEVER BE LOCKED FOREVER)
export const CATASTROPHE_WINDOW_SECS = 7 * 24 * 3600;
export const ARENA_VERSION = 2; // VERSION global on the v2 app

const MBR_CREATE = 358_200; // v2 box MBR payment (create): 65_300 + 292_900
const EARLY_CLOSE_FEE_PAY = 1_000_000; // 1 ALGO to treasury (early close)
export const GONNA_DECIMALS = 6;

// ============================================================================
// v15.2.8 — CREATOR-CHOSEN LEVEL, committed ON-CHAIN in the NOTE of the
// create/spawn app-call txn: UTF8 'gonna:v2:stage:<K>' (K 0-6). The note is
// creator-signed -> immutable and publicly readable via the indexer, so EVERY
// participant reads the same level and plays the same stage with the same
// seed ('PIT-'+cid). The v2 contract is FROZEN and has no stage field — the
// note is the commitment (contract v3 gets a native meta field).
// FULL RUN cards carry NO stage note (the level is irrelevant on a 7-stage
// run; absence of a note == no single-stage commitment).
// ============================================================================
export const STAGE_NOTE_PREFIX = 'gonna:v2:stage:';
export function stageNote(stageIdx: number): Uint8Array {
  return new TextEncoder().encode(STAGE_NOTE_PREFIX + stageIdx);
}
export function parseStageNote(note: Uint8Array): number | null {
  const m = /^gonna:v2:stage:(\d)$/.exec(new TextDecoder().decode(note));
  if (!m) return null;
  const k = Number(m[1]);
  return k >= 0 && k <= 6 ? k : null; // 7 stages, idx 0-6 ('full' -> null: no single-stage commitment)
}
// the note rides the app-call txn when a level was CHOSEN (single-mode pick)
function stageNoteOpt(stageIdx: number | null | undefined): { note: Uint8Array } | Record<string, never> {
  return stageIdx != null && stageIdx >= 0 && stageIdx <= 6 ? { note: stageNote(stageIdx) } : {};
}

// oracle message domains (contract.py: SCORE_DOMAIN/VERDICT_DOMAIN)
const SCORE_DOMAIN = new TextEncoder().encode('QA-SCORE|');
const VERDICT_DOMAIN = new TextEncoder().encode('QA-VERDICT|');

// flat fees per txn kind (µALGO) — see smoke_testnet.py
// v15.3.2 FEE RULE (audit vs contract.py): every group's fee pool must be
// >= 1000 x (outer txns + inner txns the method emits). Inner counts:
//   create/spawn/join/submit: 0 inner (state + events only)
//   resolve: 3 inner non-tie (winner axfer + 5% fee axfer + MBR payback),
//            n+1 inner on a tie (full refund per roster leg + MBR payback)
//   claim/early_close: 2 inner (stake axfer back + MBR payback; roster=1)
//   claim_forfeit: 4 inner (2 axfer caller + fee axfer treasury + MBR pay)
export const TESTNET_FEES = {
  create: 1000 + 1000 + 3000 + 4 * 1000, // pay + axfer + call + 4 opup
  join: 1000 + 3000, // axfer + call
  submit: 3000 + 4 * 1000, // call + 4 opup
  resolve: 1000 * (1 + 3) + 4 * 1000, // NON-TIE call (1 outer + 3 inner) + 4 opup; ties scale with the roster — buildResolveGroup computes it dynamically
  claim: 1000 + 2 * 1000, // call + 2 inner (stake axfer + MBR payback) — v15.3.2 BUG-1: was 2000, chain rejects it
  close: 1000 + 4000, // pay + call (2 inner covered by the call's 4000)
  forfeit: 5000, // call + 4 inner (2 axfer winner + fee axfer + MBR payback)
} as const;
export type ArenaOp = keyof typeof TESTNET_FEES;

type Sdk = typeof import('algosdk');
let sdkP: Promise<Sdk> | null = null;
export function sdk(): Promise<Sdk> {
  if (!sdkP) sdkP = import('algosdk');
  return sdkP;
}

export async function algodClient() {
  const a = await sdk();
  return new a.Algodv2('', ALGOD_URL, '');
}

function u64be(v: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(v), false);
  return b;
}

// ---------- oracle messages ----------
export function scoreMsg(cid: number, seat: number, addrBytes: Uint8Array, score: number): Uint8Array {
  const out = new Uint8Array(SCORE_DOMAIN.length + 8 + 8 + 1 + 32 + 8);
  out.set(SCORE_DOMAIN, 0);
  out.set(u64be(ARENA_APP_ID), SCORE_DOMAIN.length);
  out.set(u64be(cid), SCORE_DOMAIN.length + 8);
  out.set([seat & 0xff], SCORE_DOMAIN.length + 16);
  out.set(addrBytes, SCORE_DOMAIN.length + 17);
  out.set(u64be(score), SCORE_DOMAIN.length + 49);
  return out;
}

export async function verdictMsg(cid: number, mode: number, extra32: Uint8Array, entries: { seat: number; addr: Uint8Array; score: number }[]): Promise<Uint8Array> {
  // digest = sha256( seat‖addr‖score per signed player, in seat order )
  const raw = new Uint8Array(entries.length * 41);
  entries.forEach((e, i) => {
    raw.set([e.seat & 0xff], i * 41);
    raw.set(e.addr, i * 41 + 1);
    raw.set(u64be(e.score), i * 41 + 33);
  });
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw as BufferSource));
  const out = new Uint8Array(VERDICT_DOMAIN.length + 8 + 8 + 1 + 32 + 32);
  out.set(VERDICT_DOMAIN, 0);
  out.set(u64be(ARENA_APP_ID), VERDICT_DOMAIN.length);
  out.set(u64be(cid), VERDICT_DOMAIN.length + 8);
  out.set([mode & 0xff], VERDICT_DOMAIN.length + 16);
  out.set(extra32, VERDICT_DOMAIN.length + 17);
  out.set(digest, VERDICT_DOMAIN.length + 49);
  return out;
}

// ---------- on-chain reads ----------
export interface MetaTuple {
  creator: Uint8Array;
  stake: bigint;
  seatsTotal: bigint;
  seatsTaken: bigint;
  deadline: bigint; // unix secs
  stageMode: bigint;
  seed: Uint8Array;
  creatorScore: bigint;
  status: bigint; // 0 OPEN, 1 CLOSED(full), 2 RESOLVED, 3 REFUNDED, 4 FORFEIT
  winner: Uint8Array;
  paidTotal: bigint;
  mbrPaid: bigint; // v2: exact ALGO MBR paid at create, refunded on close
}
export interface PlayerTuple {
  addr: Uint8Array;
  score: bigint;
  signed: boolean;
  seatedAt: bigint; // v2: seat timestamp (create for seat 0, join otherwise)
}

export async function nextChallengeId(): Promise<number> {
  const algod = await algodClient();
  // algosdk v3 models: params.globalState entries {key: Uint8Array, value}
  const app = (await algod.getApplicationByID(ARENA_APP_ID).do()) as {
    params: { globalState?: { key: Uint8Array; value: { type: number; uint?: number | bigint } }[] };
  };
  for (const kv of app.params.globalState ?? []) {
    if (new TextDecoder().decode(kv.key) === 'next_challenge_id') return Number(kv.value.uint ?? 0);
  }
  return 0;
}

// v2: the VERSION global must be 2 — a stale build talking to a v1-layout
// app would mis-parse every box, so callers can hard-fail on mismatch.
export async function contractVersion(): Promise<number> {
  const algod = await algodClient();
  const app = (await algod.getApplicationByID(ARENA_APP_ID).do()) as {
    params: { globalState?: { key: Uint8Array; value: { type: number; uint?: number | bigint } }[] };
  };
  for (const kv of app.params.globalState ?? []) {
    if (new TextDecoder().decode(kv.key) === 'version') return Number(kv.value.uint ?? 0);
  }
  return 0;
}

export async function readMeta(cid: number): Promise<MetaTuple | null> {
  const algod = await algodClient();
  const a = await sdk();
  try {
    const name = new Uint8Array([0x6d, ...u64be(cid)]); // 'm' + cid8
    const box = await algod.getApplicationBoxByName(ARENA_APP_ID, name).do();
    // v2 layout (+mbr_paid): 148B for a duel pre-resolve (winner empty)
    const t = a.ABIType.from('(byte[],uint64,uint64,uint64,uint64,uint64,byte[],uint64,uint64,byte[],uint64,uint64)');
    const v = t.decode(box.value) as [Uint8Array, bigint, bigint, bigint, bigint, bigint, Uint8Array, bigint, bigint, Uint8Array, bigint, bigint];
    return { creator: v[0], stake: v[1], seatsTotal: v[2], seatsTaken: v[3], deadline: v[4], stageMode: v[5], seed: v[6], creatorScore: v[7], status: v[8], winner: v[9], paidTotal: v[10], mbrPaid: v[11] };
  } catch {
    return null; // box gone (claimed/forfeited/closed) or network hiccup
  }
}

export async function readPlayers(cid: number): Promise<PlayerTuple[]> {
  const algod = await algodClient();
  const a = await sdk();
  try {
    const name = new Uint8Array([0x70, ...u64be(cid)]); // 'p' + cid8
    const box = await algod.getApplicationBoxByName(ARENA_APP_ID, name).do();
    // v2 layout (+seated_at): (byte[],uint64,bool,uint64)[]
    const t = a.ABIType.from('(byte[],uint64,bool,uint64)[]');
    const v = t.decode(box.value) as [Uint8Array, bigint, boolean, bigint][];
    return v.map((p) => ({ addr: p[0], score: p[1], signed: p[2], seatedAt: p[3] }));
  } catch {
    return [];
  }
}

// box scan: every challenge id with a live meta box
export async function scanChallengeIds(): Promise<number[]> {
  const algod = await algodClient();
  const res = (await algod.getApplicationBoxes(ARENA_APP_ID).do()) as { boxes: { name: Uint8Array }[] };
  const ids: number[] = [];
  for (const b of res.boxes) {
    const name = b.name;
    if (name.length === 9 && name[0] === 0x6d) {
      ids.push(Number(new DataView(name.buffer, 1).getBigUint64(0, false)));
    }
  }
  return ids.sort((x, y) => x - y);
}

// ---------- group builders (exact, see smoke_testnet.py) ----------
type Txn = import('algosdk').Transaction;

async function baseParams(flatFee: number) {
  const algod = await algodClient();
  const sp = await algod.getTransactionParams().do();
  return { ...sp, fee: flatFee, flatFee: true };
}

async function methodSelector(a: Sdk, sig: string): Promise<Uint8Array> {
  const parts = sig.split(')');
  const argTypes = parts[0].slice(parts[0].indexOf('(') + 1).split(',').filter(Boolean);
  const m = new a.ABIMethod({
    name: sig.slice(0, sig.indexOf('(')),
    args: argTypes.map((t, i) => ({ type: t, name: 'a' + i })),
    returns: { type: parts[1] || 'void' },
  });
  return m.getSelector();
}

async function appArg(a: Sdk, type: string, val: Uint8Array | number | bigint): Promise<Uint8Array> {
  if (type === 'byte[]') return a.ABIType.from('byte[]').encode(val as Uint8Array);
  return a.ABIType.from('uint64').encode(BigInt(val as number | bigint));
}

function boxRef(cid: number, prefix: number) {
  return { appIndex: ARENA_APP_ID, name: new Uint8Array([prefix, ...u64be(cid)]) };
}

// NoOp calls to the budget-donor app, unique notes (OpUp pattern v5.0.0).
// v17.0.12: count param — joins of big rosters need more than the default 4.
async function opupTxns(sender: string, cid: number, count = 4): Promise<Txn[]> {
  // M-4b: mainnet donor 3686469118 live since 2026-08-26 (arenaKit MAINNET_CFG).
  // Donors are a client-side budget booster, NOT a contract dependency.
  if (!OPUP_APP_ID) return [];
  const a = await sdk();
  const out: Txn[] = [];
  for (let i = 0; i < count; i++) {
    const note = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`QA-opup-${cid}-${i}-${Date.now()}`)),
    );
    out.push(
      a.makeApplicationNoOpTxnFromObject({
        sender,
        appIndex: OPUP_APP_ID,
        note,
        suggestedParams: await baseParams(1000),
      }),
    );
  }
  return out;
}

export async function buildCreateGroup(o: {
  creator: string;
  cid: number; // next_challenge_id (oracle sig is cid-bound!)
  stakeBase: number; // microGONNA
  seats: number; // JOINER seats (duel = 1)
  durationSecs: number;
  stageMode: 0 | 1 | 2; // full / single / random
  creatorScore: number;
  creatorScoreSig: Uint8Array;
  stageIdx?: number | null; // v15.2.8: creator-CHOSEN level (0-6) -> committed in the app-call NOTE
}): Promise<Txn[]> {
  const a = await sdk();
  const appAddr = a.getApplicationAddress(ARENA_APP_ID);
  const sig = 'create_challenge(pay,axfer,uint64,uint64,uint64,uint64,byte[],uint64,byte[])uint64';
  const appArgs = [
    await methodSelector(a, sig),
    await appArg(a, 'uint64', o.stakeBase),
    await appArg(a, 'uint64', o.seats),
    await appArg(a, 'uint64', o.durationSecs),
    await appArg(a, 'uint64', o.stageMode),
    await appArg(a, 'byte[]', new Uint8Array(32)),
    await appArg(a, 'uint64', o.creatorScore),
    await appArg(a, 'byte[]', o.creatorScoreSig),
  ];
  const pay = a.makePaymentTxnWithSuggestedParamsFromObject({
    sender: o.creator, receiver: appAddr, amount: MBR_CREATE, suggestedParams: await baseParams(1000),
  });
  const axfer = a.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: o.creator, receiver: appAddr, assetIndex: GONNA_ASA_TESTNET, amount: o.stakeBase, suggestedParams: await baseParams(1000),
  });
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.creator, appIndex: ARENA_APP_ID, appArgs,
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 0x6d), boxRef(o.cid, 0x70)],
    // v15.2.8: the CHOSEN level is committed in the note (creator-signed,
    // immutable). Group semantics/fees/args unchanged — the note is inert.
    ...stageNoteOpt(o.stageIdx),
    suggestedParams: await baseParams(3000),
  });
  return [pay, axfer, call, ...(await opupTxns(o.creator, o.cid))];
}

// v15.2.8: spawn_rumble group builder (mirrors deploy/smoke + the sim's
// PHASE 2 inline group): [MBR pay, $GONNA stake axfer, 1 ALGO fee pay, call].
// Same optional stage note commitment as buildCreateGroup.
export async function buildSpawnRumbleGroup(o: {
  creator: string;
  cid: number; // next_challenge_id
  stakeBase: number; // microGONNA
  seats: number; // SEATS_SMALL/MEDIUM/LARGE (4/8/12)
  stageMode: 0 | 1 | 2; // full / single / random
  stageIdx?: number | null; // chosen level (0-6) -> app-call NOTE
}): Promise<Txn[]> {
  const a = await sdk();
  const appAddr = a.getApplicationAddress(ARENA_APP_ID);
  const sig = 'spawn_rumble(pay,axfer,pay,uint64,uint64,uint64,byte[])uint64';
  const appArgs = [
    await methodSelector(a, sig),
    await appArg(a, 'uint64', o.stakeBase),
    await appArg(a, 'uint64', o.seats),
    await appArg(a, 'uint64', o.stageMode),
    await appArg(a, 'byte[]', new Uint8Array(32)),
  ];
  const pay = a.makePaymentTxnWithSuggestedParamsFromObject({
    sender: o.creator, receiver: appAddr, amount: MBR_CREATE, suggestedParams: await baseParams(1000),
  });
  const axfer = a.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: o.creator, receiver: appAddr, assetIndex: GONNA_ASA_TESTNET, amount: o.stakeBase, suggestedParams: await baseParams(1000),
  });
  const fee = a.makePaymentTxnWithSuggestedParamsFromObject({
    sender: o.creator, receiver: TREASURY_ADDR, amount: EARLY_CLOSE_FEE_PAY, suggestedParams: await baseParams(1000),
  });
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.creator, appIndex: ARENA_APP_ID, appArgs,
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 0x6d), boxRef(o.cid, 0x70)],
    ...stageNoteOpt(o.stageIdx),
    suggestedParams: await baseParams(2000),
  });
  return [pay, axfer, fee, call];
}

export async function buildJoinGroup(o: { joiner: string; cid: number; stakeBase: number }): Promise<Txn[]> {
  const a = await sdk();
  const appAddr = a.getApplicationAddress(ARENA_APP_ID);
  const axfer = a.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: o.joiner, receiver: appAddr, assetIndex: GONNA_ASA_TESTNET, amount: o.stakeBase, suggestedParams: await baseParams(1000),
  });
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.joiner, appIndex: ARENA_APP_ID,
    appArgs: [await methodSelector(a, 'join_challenge(axfer,uint64)uint64'), await appArg(a, 'uint64', o.cid)],
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 0x6d), boxRef(o.cid, 0x70)],
    suggestedParams: await baseParams(3000),
  });
  // v17.0.12 (BULLETPROOF mainnet finding): join_challenge's opcode cost grows
  // with the roster size (roster concat loop). The bare [axfer, call] group
  // has a single 700-opcode budget and blows the dynamic cost budget around
  // seat 8 on mainnet (proven live: pc=2003 concat, cid 62/63) — the LAST
  // seats of a big table could never join. Pool budget like create/submit/
  // resolve already do: 6 OpUp donor calls (+4200 opcodes, headroom for the
  // full 13-seat roster). Fees stay flat; nothing is trapped.
  return [axfer, call, ...(await opupTxns(o.joiner, o.cid, 6))];
}

export async function buildSubmitGroup(o: { player: string; cid: number; score: number; sig: Uint8Array }): Promise<Txn[]> {
  const a = await sdk();
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.player, appIndex: ARENA_APP_ID,
    appArgs: [
      await methodSelector(a, 'submit_score(uint64,uint64,byte[])void'),
      await appArg(a, 'uint64', o.cid),
      await appArg(a, 'uint64', o.score),
      await appArg(a, 'byte[]', o.sig),
    ],
    boxes: [boxRef(o.cid, 0x6d), boxRef(o.cid, 0x70)],
    suggestedParams: await baseParams(3000),
  });
  return [call, ...(await opupTxns(o.player, o.cid))];
}

// NOTE: resolve(cid, stage_idx, seed_reveal, verdict_sig) — for MODE_FULL the
// seed_reveal arg must be EMPTY; the ZERO_32 extra is derived inside the
// contract and only lives in the ORACLE verdict message, not in the call.
//
// v15.2.4 ACCOUNT AVAILABILITY (the joiner-wins fix): resolve pays
//   - the winner        (inner axfer of the pot, via _pay_gonna)
//   - the treasury      (inner axfer of the 5% fee + redirect sink)
//   - the CREATOR       (inner ALGO pay of the 358,200 µALGO MBR back)
//   - EVERY roster leg  (tie path: _pay_gonna to each signed player)
// Every inner receiver must be AVAILABLE to the app call. The old group sent
// accounts=[winner, treasury] only — when the JOINER won, the creator's MBR
// refund had no account reference and algod 400'd the whole group
// ('unavailable Account'). Cross-checked against the working script resolve
// 7TPQ5B7JEJWZ2P53W4XYLHWAUWL2KPGJX7DWLFIGKE655ZPIZYFQ (accounts = winner,
// treasury, creator). Per AUDIT-v2 the $GONNA ASA in foreign-assets covers
// every AssetHoldingGet under AVM v9 (either side available), so the ASA
// slot below unlocks ALL holding checks; the accounts array carries the
// receivers. Txn.accounts is capped at 4: winner + creator + treasury +
// first roster player covers every duel (roster = {creator, winner-or-
// joiner}); on bigger tables the caller and dedup squeeze out extra slots.
export async function buildResolveGroup(o: {
  caller: string;
  cid: number;
  stageIdx: number;
  seedReveal: Uint8Array;
  verdictSig: Uint8Array;
  winner: string;
  // v15.3.2 BUG-2: the caller knows the outcome (chainAdapter computes it
  // from the signed scores). On a TIE the contract refunds EVERY roster leg
  // (n axfers + 1 MBR pay = n+1 inner txns), so the fee pool must scale with
  // the roster; the static 6000 broke ties of 5+ players (pool 10000 <
  // 1000 x (5 outer + n+1 inner)). When omitted we fund the WORST case
  // (full-roster refund) — safe for frozen legacy callers.
  tie?: boolean;
}): Promise<Txn[]> {
  const a = await sdk();
  const meta = await readMeta(o.cid);
  if (!meta) throw new Error('card not found on chain (already settled?)');
  const roster = await readPlayers(o.cid);
  // inner legs: tie -> roster refund (n axfers) + MBR payback = n+1;
  // non-tie -> winner axfer + 5% fee axfer + MBR payback = 3.
  const innerLegs = o.tie === false ? 3 : roster.length + 1;
  const callFee = 1000 * (1 + innerLegs); // 1 outer app call + inner legs
  const enc = (pk: Uint8Array | number[]) => a.encodeAddress(pk instanceof Uint8Array ? pk : Uint8Array.from(pk));
  const creator = enc(meta.creator);
  // v17.0.12 (BULLETPROOF mainnet finding, cid 66): on a TIE the contract
  // refunds EVERY signed roster leg and reads each player's ASA holding
  // (asset_holding_get) — those accounts must be AVAILABLE to the app call.
  // The legacy `accounts` array holds at most 4, so ties of 5+ players were
  // UNRESOLVABLE (proven live: "unavailable Account" pc=4245 on a 13-seat
  // tie). Fix: the AVM access list carries holdings refs for the WHOLE
  // roster (2 boxes + 13 holdings + treasury = 16, the protocol cap).
  // Winner path (<= 3 payouts) keeps the legacy arrays — proven, untouched.
  const needAccess = o.tie !== false && roster.length > 2;
  // v17.0.12b: the access list has NO account×asset cross product (that only
  // exists in the legacy arrays) — _gonna_dest's asset_holding_get needs an
  // EXPLICIT holding ref per payee, treasury included (redirect sink). Size
  // probed live on mainnet: 30+ entries accepted, so the 13-seat worst case
  // (13 roster holdings + treasury + 2 boxes ~ 30 refs) fits comfortably.
  const access = needAccess
    ? [
        { box: { appIndex: ARENA_APP_ID, name: new Uint8Array([0x6d, ...u64be(o.cid)]) } },
        { box: { appIndex: ARENA_APP_ID, name: new Uint8Array([0x70, ...u64be(o.cid)]) } },
        ...[...new Set(roster.map((p) => enc(p.addr)))].map((addr) => ({
          holding: { address: addr, assetIndex: GONNA_ASA_TESTNET },
        })),
        // NOTE: no treasury holding here — the tie path never READS the
        // treasury holding (a non-opted-in payee's refund redirects to the
        // treasury as a plain axfer RECEIVER, which needs no availability).
        // Boxes count toward the 16-ref cap: 2 boxes + 2 x roster + 2 escrow
        // = 14 refs at the 5-seat production cap (18 would bust at 7 seats).
        // v17.0.12c (cid 77): the ESCROW's own holding must be explicit too —
        // in access-list mode there is no account×asset cross product, so the
        // inner refund axfer's SENDER (the app address) is unavailable without
        // it. Legacy arrays get it for free via foreignAssets; access doesn't.
        { holding: { address: a.getApplicationAddress(ARENA_APP_ID).toString(), assetIndex: GONNA_ASA_TESTNET } },
      ]
    : undefined;
  const accounts = needAccess
    ? undefined
    : [...new Set([o.winner, creator, TREASURY_ADDR, ...roster.map((p) => enc(p.addr))])]
        .filter((x) => x !== o.caller) // the sender is always available — save the slot
        .slice(0, 4);
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.caller, appIndex: ARENA_APP_ID,
    appArgs: [
      await methodSelector(a, 'resolve(uint64,uint64,byte[],byte[])byte[]'),
      await appArg(a, 'uint64', o.cid),
      await appArg(a, 'uint64', o.stageIdx),
      await appArg(a, 'byte[]', o.seedReveal),
      await appArg(a, 'byte[]', o.verdictSig),
    ],
    ...(needAccess
      ? { access }
      : { accounts, foreignAssets: [GONNA_ASA_TESTNET], boxes: [boxRef(o.cid, 0x6d), boxRef(o.cid, 0x70)] }),
    suggestedParams: await baseParams(callFee),
  });
  // v17.0.12 (BULLETPROOF mainnet finding, cid 66): resolve over a FULL
  // 13-seat roster blows the pooled opcode budget at ed25519verify_bare
  // (cost 1725) with the default 4 donors — the verdict sig check plus the
  // roster scan outgrow 3500. Scale donors with the roster (13 seats ->
  // 10 donors = 7700 budget; group stays <= 12 txns, well under the 16 cap).
  return [call, ...(await opupTxns(o.caller, o.cid, 4 + Math.ceil(roster.length / 2)))];
}

// ---------- v12: CONTINUE — 5 ALGO flat to the treasury, 1/match ----------
// Prince's rule: same seed on the retry ("stesso campo, stessa palla") — a
// new seed would change the score ceiling. Best-of-2: the sealed score is
// ALWAYS the better of the two runs, you can never worsen yourself.
export const CONTINUE_FEE_MICRO = 5_000_000; // 5 ALGO flat
export function continueNote(refId: string, addr: string): string {
  return 'QA-CONTINUE|' + refId + '|' + addr;
}

// standalone payment, signed by Pera BEFORE run 2 starts
export async function buildContinuePayment(o: { sender: string; refId: string }): Promise<Txn[]> {
  const a = await sdk();
  const sp = await (await algodClient()).getTransactionParams().do();
  const pay = a.makePaymentTxnWithSuggestedParamsFromObject({
    sender: o.sender,
    receiver: TREASURY_ADDR,
    amount: CONTINUE_FEE_MICRO,
    note: new TextEncoder().encode(continueNote(o.refId, o.sender)),
    suggestedParams: { ...sp, fee: 1000, flatFee: true },
  });
  return [pay];
}

// on-chain proof check: exact amount, treasury receiver, exact note.
// algod pending-txn first (just-confirmed), indexer as fallback (it lags).
export async function verifyContinuePayment(txid: string, refId: string, addr: string): Promise<boolean> {
  const a = await sdk();
  const want = continueNote(refId, addr);
  type TxView = { type?: string; amount?: number | bigint; receiver?: string; note?: string };
  const check = (t: TxView | null): boolean => {
    if (!t || t.type !== 'pay') return false;
    if (Number(t.amount) !== CONTINUE_FEE_MICRO) return false;
    if (t.receiver !== TREASURY_ADDR) return false;
    return t.note === want;
  };
  try {
    const r = (await (await algodClient()).pendingTransactionInformation(txid).do()) as {
      txn?: { txn?: { type?: string; amt?: number | bigint; rcv?: Uint8Array; note?: Uint8Array } };
    };
    const inner = r?.txn?.txn;
    if (inner) {
      const view: TxView = {
        type: inner.type,
        amount: inner.amt,
        receiver: inner.rcv ? a.encodeAddress(Uint8Array.from(inner.rcv)) : undefined,
        note: inner.note ? new TextDecoder().decode(Uint8Array.from(inner.note)) : undefined,
      };
      if (check(view)) return true;
    }
  } catch { /* fall back to indexer */ }
  try {
    const r = await fetch(`${INDEXER_URL}/v2/transactions/${txid}`);
    if (r.ok) {
      const j = (await r.json()) as { transaction?: { 'payment-transaction'?: { amount: number; receiver: string }; note?: string; 'tx-type'?: string } };
      const t = j.transaction;
      if (t && t['tx-type'] === 'pay' && t['payment-transaction']) {
        const view: TxView = {
          type: 'pay',
          amount: t['payment-transaction'].amount,
          receiver: t['payment-transaction'].receiver,
          note: t.note ? new TextDecoder().decode(Uint8Array.from(atob(t.note), (ch) => ch.charCodeAt(0))) : undefined,
        };
        return check(view);
      }
    }
  } catch { /* indexer down/lagging */ }
  return false;
}

export async function buildClaimGroup(o: { caller: string; cid: number }): Promise<Txn[]> {
  const a = await sdk();
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.caller, appIndex: ARENA_APP_ID,
    appArgs: [await methodSelector(a, 'claim(uint64)void'), await appArg(a, 'uint64', o.cid)],
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 0x6d), boxRef(o.cid, 0x70)],
    // v15.3.2 BUG-1: claim emits 2 inner txns (_refund_all on a roster of 1:
    // stake axfer back + exact MBR payback) => 1000 x (1 outer + 2 inner).
    // The old 2000 was rejected by the chain ("group fee too small").
    suggestedParams: await baseParams(TESTNET_FEES.claim),
  });
  return [call];
}

// v17.0.8: CATASTROPHE SWEEP — permissionless TOTAL refund after
// deadline + 7d (zero fee, forfeits refunded too). The ONLY exit for an
// expired multiplayer card whose joiners never signed (live case: cid 5,
// 200 $GONNA locked behind an unsigned seat). Anyone may call it; the
// contract pays every payer back in full and deletes both boxes.
// Inner txns: one axfer per payer + the exact MBR payback.
export async function buildCatastropheGroup(o: { caller: string; cid: number; payers: number }): Promise<Txn[]> {
  const a = await sdk();
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.caller, appIndex: ARENA_APP_ID,
    appArgs: [await methodSelector(a, 'catastrophe_refund(uint64)void'), await appArg(a, 'uint64', o.cid)],
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 0x6d), boxRef(o.cid, 0x70)],
    // fee: 1000 x (1 outer + payers axfers + 1 MBR pay), 2000 margin floor
    suggestedParams: await baseParams(Math.max(2000, 1000 * (1 + o.payers + 1))),
  });
  return [call];
}

export async function buildEarlyCloseGroup(o: { caller: string; cid: number }): Promise<Txn[]> {
  const a = await sdk();
  const pay = a.makePaymentTxnWithSuggestedParamsFromObject({
    sender: o.caller, receiver: TREASURY_ADDR, amount: EARLY_CLOSE_FEE_PAY, suggestedParams: await baseParams(1000),
  });
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.caller, appIndex: ARENA_APP_ID,
    appArgs: [await methodSelector(a, 'early_close(pay,uint64)void'), await appArg(a, 'uint64', o.cid)],
    accounts: [TREASURY_ADDR],
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 0x6d), boxRef(o.cid, 0x70)],
    suggestedParams: await baseParams(4000),
  });
  return [pay, call];
}

// v2: CLAIM FORFEIT — duel seat clock expired on an UNSIGNED opponent.
// The contract pays 95% of the forfeited stake + the caller's own stake to
// the caller, 5% to the treasury, and the exact MBR back to the creator;
// both boxes are deleted. Inner txns: 2x axfer caller + axfer treasury +
// pay creator => the treasury and creator accounts must be referenced.
export async function buildClaimForfeitGroup(o: { caller: string; cid: number; seat: number }): Promise<Txn[]> {
  const a = await sdk();
  const meta = await readMeta(o.cid);
  if (!meta) throw new Error('card not found on chain (already settled?)');
  // algosdk ABI decodes box byte[] as number[] — normalize like resolve's enc()
  const creator = a.encodeAddress(meta.creator instanceof Uint8Array ? meta.creator : Uint8Array.from(meta.creator));
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.caller, appIndex: ARENA_APP_ID,
    appArgs: [
      await methodSelector(a, 'claim_forfeit(uint64,uint64)void'),
      await appArg(a, 'uint64', o.cid),
      await appArg(a, 'uint64', o.seat),
    ],
    accounts: [TREASURY_ADDR, creator],
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 0x6d), boxRef(o.cid, 0x70)],
    suggestedParams: await baseParams(TESTNET_FEES.forfeit),
  });
  return [call];
}

// sign as one atomic group (Pera-style {txn, signers} groups) and broadcast
export type TxSignFn = (groups: { txn: Txn; signers: string[] }[][]) => Promise<Uint8Array[]>;

// v14.2: a stale/dead WalletConnect session can make pera.signTransaction
// hang FOREVER — no modal, no rejection, a silently dead SIGN & STAKE (the
// Prince's v14.1 bug). Every wallet sign call gets a HARD timeout so the UI
// always comes back with a visible error instead of sitting on SIGNING...
export const SIGN_TIMEOUT_MS = 90_000;
export const SIGN_TIMEOUT_MSG = 'WALLET NOT RESPONDING - RECONNECT AND RETRY';
export function withTimeout<T>(p: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(timeoutMsg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// v15.2.1: the create oracle sig is bound to next_challenge_id READ BEFORE
// the wallet round-trip. On a real device the manual approval window is long
// enough for another create to move the counter — algod then 400s the group
// at sendRawTransaction: 'logic eval error: assert failed ... ed25519verify_bare;
// assert' (the contract's 'bad creator score proof'). That exact rejection is
// RETRIABLE with a fresh cid + fresh sig; overspend/malformed groups are not.
export function isCidRaceReject(e: unknown): boolean {
  const msg = String((e as { message?: string } | null)?.message ?? e);
  return /status 400/i.test(msg) && /logic eval error/i.test(msg);
}

// ============================================================================
// v15.2.2 — RETRY/CANCEL on every wallet signing wait.
// The founder's wedge: Pera shows "Please launch Pera Wallet..." forever, the
// WC session then answers "REQUEST PENDING: THE USER CURRENTLY HAS ANOTHER
// REQUEST THAT IS IN PROGRESS" — and the degen's sealed run is hostage. Now:
//   - after SIGN_NUDGE_MS of silence the UI shows an amber strip with
//     RETRY (re-issue the request) and CANCEL (abort cleanly — the sealed
//     score/draft is NEVER touched);
//   - RETRY first HEALS a wedged session (cancel/abandon the pending request
//     + force a fresh WC reconnect — the cure that worked for the founder),
//     then re-sends; create re-reads next_challenge_id and re-signs with the
//     oracle before the re-send (v15.2.1 cid-race composition);
//   - the 90s SIGN_TIMEOUT_MS stays the final backstop with the red toast.
// No silent hangs, ever.
// ============================================================================
export const SIGN_NUDGE_MS = 12_000; // amber RETRY/CANCEL strip after this
export const SIGN_CANCEL_MSG = 'SIGNING CANCELLED - SEALED SCORE SAFE';

export class SignCancelled extends Error {
  constructor() {
    super(SIGN_CANCEL_MSG);
    this.name = 'SignCancelled';
  }
}
// message-prefix check too: HMR/module duplication must not defeat instanceof
export function isSignCancel(e: unknown): boolean {
  return e instanceof SignCancelled || String((e as { message?: string } | null)?.message ?? e).toUpperCase().startsWith('SIGNING CANCELLED');
}

// WalletConnect wedge signatures (Pera verbatim: "REQUEST PENDING: THE USER
// CURRENTLY HAS ANOTHER REQUEST THAT IS IN PROGRESS.")
export function isWedgeError(e: unknown): boolean {
  const msg = String((e as { message?: string } | null)?.message ?? e);
  return /request pending/i.test(msg) || /another request/i.test(msg) || /session currently connected/i.test(msg);
}

// the wallet layer (arenaWallet.ts -> testnetWallet.ts) registers the wedge
// cure: drop the wedged WC session and force a FRESH reconnect BEFORE the
// re-send (disconnect+reconnect is what un-wedged the founder's Pera)
let recoverHook: (() => Promise<void>) | null = null;
export function setSignRecoverHook(fn: (() => Promise<void>) | null): void {
  recoverHook = fn;
}

export type SignPhase = 'building' | 'signing' | 'sending';

// live view of the in-flight wallet sign op — the UI polls this every frame
export interface SignOpView {
  readonly label: string;
  readonly attempt: number; // 1-based; bumps on every manual RETRY
  readonly attemptStartedAt: number; // ms epoch of the CURRENT attempt
  readonly phase: SignPhase;
  readonly recovering: boolean; // wedge cure in flight (disconnect/reconnect)
  readonly stalled: boolean; // silent for >= nudgeMs (draw the amber strip)
  readonly cancellable: boolean; // false once the tx is on the wire
  retry(): void;
  cancel(): void;
}

let activeOp: SignOpView | null = null;
export function activeSignOp(): SignOpView | null {
  return activeOp;
}

export interface SignManagedOpts {
  label?: string; // console/UI breadcrumb ('SIGN & STAKE', 'ACCEPT & STAKE', ...)
  nudgeMs?: number; // strip delay (default SIGN_NUDGE_MS) — harness-tunable
  timeoutMs?: number; // hard per-attempt timeout (default SIGN_TIMEOUT_MS)
  rebuildOnRetry?: boolean; // manual RETRY re-invokes buildTxns (create: fresh cid + oracle sig)
  autoRetries?: number; // automatic re-sends on the cid-race 400 (default 0)
  wedgeRetries?: number; // automatic recover+re-send on a wedged-session error (default 1)
  recover?: () => Promise<void>; // per-call wedge cure override (default: global hook)
  send?: (signed: Uint8Array[]) => Promise<string>; // TEST HOOK: algod send+confirm
  onEvent?: (ev: string) => void; // TEST HOOK: 'attempt' | 'retry' | 'recover' | 'cancel' | 'sent'
}

export interface SignHandle {
  done: Promise<string>; // txid; rejects on failure / SignCancelled
  retry(): void;
  cancel(): void;
}

class StaleAttempt extends Error {} // a newer attempt (or a cancel) owns the outcome

async function defaultSend(signed: Uint8Array[]): Promise<string> {
  const a = await sdk();
  const algod = await algodClient();
  const res = (await algod.sendRawTransaction(signed).do()) as { txid: string };
  console.debug('[arena] tx sent: ' + res.txid + ' — waiting for confirmation');
  await a.waitForConfirmation(algod, res.txid, 10);
  return res.txid;
}

export function signSendManaged(sign: TxSignFn, buildTxns: () => Promise<Txn[]>, opts: SignManagedOpts = {}): SignHandle {
  const nudgeMs = opts.nudgeMs ?? SIGN_NUDGE_MS;
  const timeoutMs = opts.timeoutMs ?? SIGN_TIMEOUT_MS;
  const label = opts.label ?? 'SIGN';
  let gen = 0;
  let settled = false;
  let cancelled = false;
  let recovering = false;
  let attempt = 0;
  let attemptStartedAt = 0;
  let phase: SignPhase = 'building';
  let wedged = false; // the last attempt reported/looked like a wedged WC session
  let autoLeft = opts.autoRetries ?? 0;
  let wedgeLeft = opts.wedgeRetries ?? 1;
  let resolveDone!: (txid: string) => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<string>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  const view: SignOpView = {
    label,
    get attempt() {
      return attempt;
    },
    get attemptStartedAt() {
      return attemptStartedAt;
    },
    get phase() {
      return phase;
    },
    get recovering() {
      return recovering;
    },
    get stalled() {
      // v15.2.3: NEVER stalled while the tx is on the wire — the wallet already
      // answered; only the chain can be slow now, and RETRY there would double-broadcast
      return !settled && phase !== 'sending' && attemptStartedAt > 0 && Date.now() - attemptStartedAt >= nudgeMs;
    },
    get cancellable() {
      return !settled && phase !== 'sending';
    },
    retry: () => {
      void doRetry();
    },
    cancel: () => doCancel(),
  };
  activeOp = view;

  function settleOk(txid: string): void {
    settled = true;
    if (activeOp === view) activeOp = null;
    resolveDone(txid);
  }
  function settleErr(e: Error): void {
    settled = true;
    if (activeOp === view) activeOp = null;
    rejectDone(e);
  }

  async function attemptRun(myGen: number): Promise<void> {
    const live = (): void => {
      if (cancelled) throw new SignCancelled();
      if (myGen !== gen) throw new StaleAttempt();
    };
    try {
      live();
      phase = 'building';
      attemptStartedAt = Date.now();
      const txns = await buildTxns();
      live();
      const a = await sdk();
      a.assignGroupID(txns);
      console.debug('[arena] ' + label + ' — sign start, atomic group of ' + txns.length + ' txn(s) (attempt ' + attempt + ')');
      phase = 'signing';
      attemptStartedAt = Date.now(); // the nudge clock measures WALLET silence
      const signed = await withTimeout(
        sign([txns.map((txn) => ({ txn, signers: [txn.sender.toString()] }))]),
        timeoutMs,
        SIGN_TIMEOUT_MSG,
      );
      live();
      console.debug('[arena] wallet response — ' + signed.length + ' signed txn(s)');
      phase = 'sending'; // on the wire: CANCEL goes away, the truth is algod's
      attemptStartedAt = Date.now(); // the clock tracks the CURRENT phase (chain wait now)
      const txid = await (opts.send ? opts.send(signed) : defaultSend(signed));
      live();
      opts.onEvent?.('sent');
      settleOk(txid);
    } catch (e) {
      if (e instanceof StaleAttempt) return; // discarded attempt — stay silent
      if (cancelled || e instanceof SignCancelled) {
        settleErr(new SignCancelled());
        return;
      }
      // v15.2.1 cid race: algod 400 'logic eval error' on a create whose cid
      // moved mid-approval — rebuild (fresh cid + fresh oracle sig) and re-send
      if (autoLeft > 0 && opts.rebuildOnRetry && isCidRaceReject(e)) {
        autoLeft--;
        wedged = false;
        console.debug('[arena] create 400 (stale cid race) — retrying with fresh challenge id');
        opts.onEvent?.('cid-race-retry');
        return attemptRun(myGen);
      }
      // wedged WC session reported BY the wallet layer ("REQUEST PENDING:
      // ...ANOTHER REQUEST ... IN PROGRESS") — heal (fresh session) and
      // re-send ONCE automatically; a second wedge settles VISIBLY.
      if (isWedgeError(e) && wedgeLeft > 0) {
        wedgeLeft--;
        wedged = true;
        console.debug('[arena] wedged wallet session — recovering before re-send');
        opts.onEvent?.('wedge');
        const rec = opts.recover ?? recoverHook;
        if (rec) {
          recovering = true;
          opts.onEvent?.('recover');
          try {
            await rec();
          } catch (re) {
            console.debug('[arena] session recovery failed (re-sending anyway):', re);
          }
          recovering = false;
        }
        if (cancelled) {
          settleErr(new SignCancelled());
          return;
        }
        if (myGen !== gen) return; // a manual RETRY already took over
        attempt++;
        opts.onEvent?.('attempt');
        return attemptRun(myGen);
      }
      if (isWedgeError(e)) wedged = true; // remembered for the next manual RETRY
      settleErr(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // live read of the wire state — a function boundary so TS control-flow
  // narrowing can never freeze the phase across the recovery await below
  const onWire = (): boolean => phase === 'sending';

  async function doRetry(): Promise<void> {
    if (settled || cancelled) return;
    // v15.2.3: RETRY only makes sense while waiting for the wallet's SIGNATURE.
    // Once the signed tx is broadcast ('sending'), a retry would build+sign+SEND
    // a SECOND challenge — duplicate on-chain stake. Hard guard.
    if (onWire()) return;
    opts.onEvent?.('retry');
    // RETRY while an attempt is in flight means the wallet never answered (or
    // reported a wedged session): HEAL FIRST — abandon the pending request and
    // force a fresh WC session reconnect — THEN re-send.
    const hanging = attemptStartedAt > 0; // the strip only exists pre-settle
    const rec = opts.recover ?? recoverHook;
    if ((wedged || hanging) && rec) {
      recovering = true;
      opts.onEvent?.('recover');
      try {
        await rec();
      } catch (e) {
        // recovery itself failed (user closed the pairing, wallet gone) —
        // re-send ANYWAY: the signer chain falls back or fails VISIBLY
        console.debug('[arena] session recovery failed (re-sending anyway):', e);
      }
      recovering = false;
    }
    if (settled || cancelled || onWire()) return; // a late wallet answer during recovery wins (it may already be ON THE WIRE)
    gen++; // abandon the previous attempt — its late answer is NEVER sent
    wedged = false;
    attempt++;
    opts.onEvent?.('attempt');
    void attemptRun(gen);
  }

  function doCancel(): void {
    if (settled || cancelled) return;
    opts.onEvent?.('cancel');
    cancelled = true;
    gen++; // any in-flight attempt goes stale: a late wallet answer is discarded
    settleErr(new SignCancelled());
  }

  attempt = 1;
  opts.onEvent?.('attempt');
  void attemptRun(gen);
  return { done, retry: view.retry, cancel: view.cancel };
}

// one-shot signer (fixed group): the managed op WITHOUT the cid-race rebuild
export async function signSend(sign: TxSignFn, txns: Txn[], opts: SignManagedOpts = {}): Promise<string> {
  return signSendManaged(sign, () => Promise.resolve(txns), opts).done;
}

// per-challenge txid memory (for VIEW ON CHAIN)
const TX_KEY = netLsKey('gonna.arena.txids'); // M-1: network-scoped txid memory
export function recordTxid(cid: number, txid: string): void {
  try {
    const m = JSON.parse(window.localStorage.getItem(TX_KEY) ?? '{}') as Record<string, string>;
    m[String(cid)] = txid;
    window.localStorage.setItem(TX_KEY, JSON.stringify(m));
  } catch { /* no storage */ }
}
export function getTxid(cid: number): string | null {
  try {
    const m = JSON.parse(window.localStorage.getItem(TX_KEY) ?? '{}') as Record<string, string>;
    return m[String(cid)] ?? null;
  } catch {
    return null;
  }
}

// per-challenge RESOLVE-TIME memory: the box carries no timestamp, so the
// HISTORY "x AGO" line is only honest for matches WE resolved from this
// browser (everyone else falls back to the deadline, clamped to now)
const RES_KEY = netLsKey('gonna.arena.resolved'); // M-1: network-scoped
export function recordResolveAt(cid: number, at: number): void {
  try {
    const m = JSON.parse(window.localStorage.getItem(RES_KEY) ?? '{}') as Record<string, number>;
    m[String(cid)] = at;
    window.localStorage.setItem(RES_KEY, JSON.stringify(m));
  } catch { /* no storage */ }
}
export function getResolveAt(cid: number): number | null {
  try {
    const m = JSON.parse(window.localStorage.getItem(RES_KEY) ?? '{}') as Record<string, number>;
    const v = m[String(cid)];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
// v15.3.1 — EXPLORER per network, centralized next to the indexer/app config
// (supersedes the v11..v15.3.0 hardcoded testnet perawallet link): a mainnet
// flip touches ARENA_NETWORK only, never a call site. lora.algokit.io shows
// the INNER txns of the close group — winner payout + treasury fee + MBR
// refund — exactly "i fondi che si sono mossi".
// M-1: ArenaNetwork/ARENA_NETWORK now come from ./arenaKit (build flag) —
// re-exported at the top of this file for every existing import.
export function explorerTxUrlFor(network: ArenaNetwork, txid: string): string {
  return 'https://lora.algokit.io/' + network + '/transaction/' + txid;
}
export function explorerTxUrl(txid: string): string {
  return explorerTxUrlFor(ARENA_NETWORK, txid);
}

// v15.3.1 — per-challenge CLOSE-txid memory: the tx that MOVED THE FUNDS
// (resolve / forfeit / claim / early-close). Distinct from TX_KEY above,
// which remembers the latest op of ANY kind — a create/submit txid moved no
// pot and must never back a "VIEW THE PAYOUT" link.
const CLOSE_TX_KEY = netLsKey('gonna.arena.closetx'); // M-1: network-scoped
export function recordCloseTxid(cid: number, txid: string): void {
  try {
    const m = JSON.parse(window.localStorage.getItem(CLOSE_TX_KEY) ?? '{}') as Record<string, string>;
    m[String(cid)] = txid;
    window.localStorage.setItem(CLOSE_TX_KEY, JSON.stringify(m));
  } catch { /* no storage */ }
}
export function getCloseTxid(cid: number): string | null {
  try {
    const m = JSON.parse(window.localStorage.getItem(CLOSE_TX_KEY) ?? '{}') as Record<string, string>;
    return m[String(cid)] ?? null;
  } catch {
    return null;
  }
}

// txid resolution order (v15.3.1): (a) local close memory (WE sent the close
// from this browser) -> (b) the on-chain event log (the ChallengeResolved /
// ChallengeForfeited / ChallengeRefunded event names the tx that emitted it)
// -> (c) null = unknown (indexer lag): an honest RETRY, NEVER an invented
// link. A found event txid is banked into the close memory so the lookup
// never re-scans. pickCloseTxid is the PURE event step (headless-testable).
export function pickCloseTxid(cid: number, events: ArenaCloseEvent[]): string | null {
  const ev = events.filter((e) => e.cid === cid).sort((x, y) => y.round - x.round)[0];
  return ev ? ev.txid : null;
}
export function resolveCloseTxid(cid: number, events: ArenaCloseEvent[]): string | null {
  const mem = getCloseTxid(cid);
  if (mem) return mem;
  const txid = pickCloseTxid(cid, events);
  if (txid) recordCloseTxid(cid, txid); // cache: never re-seek it
  return txid;
}

// ============================================================================
// v15.2.4 — ON-CHAIN HISTORY via ARC-28 events (BUG-3).
// The v2 contract DELETES both boxes on every terminal transition, so a
// box scan can never see a settled card. The permanent record is the event
// log: ChallengeResolved / ChallengeForfeited / ChallengeRefunded (arc56
// QuantumArena.json). The LEGACY app (769688298, v1) emits NO events —
// cross-app history is: v2 events + this browser's card memory below.
// ============================================================================
// v17.0.2: network-resolved from arenaKit (was hardcoded testnet — mainnet
// HISTORY read testnet before this fix). Alias kept for existing imports.
export const INDEXER_URL = NET.indexerUrl;
/** @deprecated network-resolved alias — prefer INDEXER_URL */
export const INDEXER_TESTNET = NET.indexerUrl;

// selectors = sha512_256('<Name>(<args>)')[0..4] — pinned from the arc56 spec
const EV_RESOLVED = 'ae488dc6'; // ChallengeResolved(uint64,address,uint64,uint64)
const EV_FORFEITED = '24d3dd8b'; // ChallengeForfeited(uint64,address,uint64,uint64)
const EV_REFUNDED = '0bfda53a'; // ChallengeRefunded(uint64,uint64)

export interface ArenaCloseEvent {
  cid: number;
  kind: 'resolved' | 'forfeited' | 'refunded';
  winner: string | null; // null on tie (zero address) and on refund-only
  payout: number; // microGONNA to the winner (0 on tie/refund)
  fee: number; // microGONNA to the treasury
  reason: number | null; // ChallengeRefunded: 1 claim, 2 early-close, 3 tie, 4 catastrophe
  txid: string;
  round: number;
  at: number; // ms epoch (indexer round-time — the real settle timestamp)
}

function hex4(b: Uint8Array): string {
  return [...b.slice(0, 4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function b64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
}
function u64At(b: Uint8Array, off: number): number {
  return Number(new DataView(b.buffer, b.byteOffset + off, 8).getBigUint64(0, false));
}

// One indexer page scan of the v2 app's appl txns; decodes the close events.
// Indexer down/lagging -> THROWS; callers catch and fall back to card memory.
export async function fetchArenaCloseEvents(maxPages = 5): Promise<ArenaCloseEvent[]> {
  const a = await sdk();
  const ZERO = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
  const out: ArenaCloseEvent[] = [];
  let next: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const url =
      INDEXER_URL + '/v2/transactions?application-id=' + ARENA_APP_ID + '&tx-type=appl&limit=100' + (next ? '&next=' + encodeURIComponent(next) : '');
    const r = await fetch(url);
    if (!r.ok) throw new Error('indexer http ' + r.status);
    const j = (await r.json()) as {
      transactions?: { id: string; 'confirmed-round': number; 'round-time'?: number; logs?: string[] }[];
      'next-token'?: string;
    };
    for (const t of j.transactions ?? []) {
      for (const log of t.logs ?? []) {
        const b = b64ToBytes(log);
        if (b.length < 12) continue;
        const sel = hex4(b);
        const at = (t['round-time'] ?? 0) * 1000;
        if (sel === EV_RESOLVED || sel === EV_FORFEITED) {
          if (b.length < 60) continue;
          const winnerRaw = a.encodeAddress(b.slice(12, 44));
          out.push({
            cid: u64At(b, 4),
            kind: sel === EV_RESOLVED ? 'resolved' : 'forfeited',
            winner: winnerRaw === ZERO ? null : winnerRaw,
            payout: u64At(b, 44),
            fee: u64At(b, 52),
            reason: null,
            txid: t.id,
            round: t['confirmed-round'],
            at,
          });
        } else if (sel === EV_REFUNDED) {
          if (b.length < 20) continue;
          out.push({ cid: u64At(b, 4), kind: 'refunded', winner: null, payout: 0, fee: 0, reason: u64At(b, 12), txid: t.id, round: t['confirmed-round'], at });
        }
      }
    }
    next = j['next-token'] ?? null;
    if (!next) break;
  }
  return out;
}

// ============================================================================
// v15.2.8 — ON-CHAIN STAGE NOTES via the indexer (cid -> chosen level).
// SEQUENTIAL MAPPING FACT (verified against contract.py): next_challenge_id
// is initialized to 0 (contract.py:290) and is read-then-incremented by
// EXACTLY 1 in ONLY two methods — create_challenge (read contract.py:379,
// write cid+1 contract.py:420) and spawn_rumble (read contract.py:486, write
// cid+1 contract.py:515). A confirmed create-ish call can never fail (a
// failed txn never confirms), so the Nth (1-based) successful create/spawn
// app call on app 769907387 created cid N-1. The scan below therefore maps
// cid -> stage WITHOUT any stage field in the frozen v2 contract.
// Cache: localStorage 'gonna.arena.stages' {fromCid, stages} — fromCid is the
// watermark (number of create-ish calls already mapped). The indexer pages
// OLDEST-FIRST (ascending confirmed-round, verified against algonode testnet
// 2026-07), so a scan skips the first fromCid create-ish hits and collects
// the (total - fromCid) NEWEST ones — watermark hits are never re-mapped, and
// when the counter hasn't moved the scan costs ZERO indexer calls. Cap 500
// stage entries (lowest cids dropped first). v15.2.8b: a scan whose create-ish
// count (watermark + new hits) does NOT match the on-chain next_challenge_id
// is banked NOWHERE — the watermark stays put (monotonic, never backward,
// never forward on a mismatch) and the cids fall back to UNVERIFIED tiers.
// ============================================================================
export interface StageScanCache {
  fromCid: number; // watermark: cids [0, fromCid) already mapped
  stages: Record<string, number>; // cid -> stage idx (only cids WITH a note)
  // v17.0.4 gap-heal: the cid prefix actually COVERED by a complete scan.
  // Legacy caches (pre-sanity-check builds) advanced the watermark WITHOUT
  // mapping every cid — holes below fromCid would otherwise stay UNVERIFIED
  // forever. scannedThrough < fromCid marks such a cache as suspect.
  scannedThrough?: number;
}
const STAGE_KEY = 'gonna.arena.stages';
const STAGE_MEM_MAX = 500;

export function readStageCache(): StageScanCache {
  try {
    const j = JSON.parse(window.localStorage.getItem(STAGE_KEY) ?? '{}') as Partial<StageScanCache>;
    return {
      fromCid: typeof j.fromCid === 'number' ? j.fromCid : 0,
      stages: j.stages && typeof j.stages === 'object' ? j.stages : {},
      scannedThrough: typeof j.scannedThrough === 'number' ? j.scannedThrough : 0,
    };
  } catch {
    return { fromCid: 0, stages: {}, scannedThrough: 0 };
  }
}
function writeStageCache(c: StageScanCache): void {
  try {
    const keys = Object.keys(c.stages);
    if (keys.length > STAGE_MEM_MAX) {
      const sorted = keys.sort((x, y) => Number(x) - Number(y));
      for (const k of sorted.slice(0, keys.length - STAGE_MEM_MAX)) delete c.stages[k];
    }
    window.localStorage.setItem(STAGE_KEY, JSON.stringify(c));
  } catch { /* no storage */ }
}

// one successful create-ish app call found by the indexer scan
export interface CreateCallHit {
  round: number; // confirmed-round
  offset: number; // intra-round-offset (tie-break inside a round)
  stage: number | null; // parsed note stage (null = no stage note)
}

// pure mapping step (exported for tests): the hits are the NEWEST create-ish
// calls after the watermark — sorted oldest-first they map SEQUENTIALLY to
// cids fromCid, fromCid+1, ... (contract fact cited above).
export function applyStageScan(cache: StageScanCache, hits: CreateCallHit[]): StageScanCache {
  const sorted = [...hits].sort((x, y) => x.round - y.round || x.offset - y.offset);
  const stages = { ...cache.stages };
  let cid = cache.fromCid;
  for (const h of sorted) {
    if (h.stage !== null) stages[String(cid)] = h.stage;
    cid++;
  }
  // the proven prefix extends exactly when the scan started from a proven base
  const scannedThrough = (cache.scannedThrough ?? 0) >= cache.fromCid ? cid : (cache.scannedThrough ?? 0);
  return { fromCid: cid, stages, scannedThrough };
}

const CREATE_SIG = 'create_challenge(pay,axfer,uint64,uint64,uint64,uint64,byte[],uint64,byte[])uint64';
const SPAWN_SIG = 'spawn_rumble(pay,axfer,pay,uint64,uint64,uint64,byte[])uint64';

// 30s memo: a board refresh maps MANY cards through the same scan
let stageMemo: { at: number; stages: Record<string, number> } | null = null;

// Indexer down/lagging -> THROWS; callers catch and fall to the memory/link
// tiers. opts.total skips the algod next_challenge_id read (tests); the
// watermark math is exact only when total == the on-chain counter.
export async function fetchArenaCreateStages(opts: { force?: boolean; maxPages?: number; total?: number } = {}): Promise<Record<string, number>> {
  if (!opts.force && stageMemo && Date.now() - stageMemo.at < 30_000) return stageMemo.stages;
  let cache = readStageCache();
  // v17.0.4 GAP-HEAL: a cid below the watermark missing from the map means an
  // old build advanced fromCid without mapping it (pre-sanity-check retaggio)
  // — those cards would render (UNVERIFIED) forever. If the prefix was never
  // PROVEN by a complete scan (scannedThrough < fromCid), distrust the
  // watermark and force ONE full rescan from cid 0. Full-mode creates carry
  // no stage note, so holes legitimately remain after the rescan — the
  // scannedThrough marker guarantees this heal fires AT MOST once per cache.
  if (!opts.force && cache.fromCid > 0 && (cache.scannedThrough ?? 0) < cache.fromCid) {
    let hole = -1;
    for (let c = 0; c < cache.fromCid; c++) {
      if (!(String(c) in cache.stages)) { hole = c; break; }
    }
    if (hole >= 0) {
      console.debug('[arena] stage cache gap below watermark (cid ' + hole + ' < ' + cache.fromCid + ') — forcing ONE full rescan');
      cache = { fromCid: 0, stages: {}, scannedThrough: 0 };
      writeStageCache(cache);
      return fetchArenaCreateStages({ ...opts, force: true });
    }
  }
  const total = opts.total ?? (await nextChallengeId());
  let out = cache;
  const need = Math.max(0, total - cache.fromCid);
  if (need > 0) {
    const a = await sdk();
    const selCreate = await methodSelector(a, CREATE_SIG);
    const selSpawn = await methodSelector(a, SPAWN_SIG);
    const eq = (b: Uint8Array, s: Uint8Array) => b.length === s.length && b.every((v, i) => v === s[i]);
    const hits: CreateCallHit[] = [];
    let skipped = cache.fromCid; // oldest-first stream: cids [0, fromCid) are already mapped
    let token: string | null = null;
    const maxPages = opts.maxPages ?? 10;
    for (let page = 0; page < maxPages && hits.length < need; page++) {
      const url =
        INDEXER_URL + '/v2/transactions?application-id=' + ARENA_APP_ID + '&tx-type=appl&limit=100' + (token ? '&next=' + encodeURIComponent(token) : '');
      const r = await fetch(url);
      if (!r.ok) throw new Error('indexer http ' + r.status);
      const j = (await r.json()) as {
        transactions?: {
          id: string;
          'confirmed-round'?: number;
          'intra-round-offset'?: number;
          note?: string;
          'application-transaction'?: { 'application-args'?: string[] };
        }[];
        'next-token'?: string;
      };
      for (const t of j.transactions ?? []) {
        if (typeof t['confirmed-round'] !== 'number') continue; // unconfirmed: never a successful create
        const args = t['application-transaction']?.['application-args'];
        if (!args || args.length === 0) continue;
        const first = b64ToBytes(args[0]);
        if (!eq(first, selCreate) && !eq(first, selSpawn)) continue; // join/submit/resolve/close don't move the counter
        if (skipped > 0) {
          skipped--; // watermark: this create-ish call maps to an already-known cid
          continue;
        }
        hits.push({
          round: t['confirmed-round'],
          offset: t['intra-round-offset'] ?? 0,
          stage: typeof t.note === 'string' ? parseStageNote(b64ToBytes(t.note)) : null,
        });
        if (hits.length >= need) break;
      }
      token = j['next-token'] ?? null;
      if (!token) break;
    }
    // v15.2.8b MAPPING SANITY CROSS-CHECK: the sequential cid mapping is exact
    // ONLY when the count of successful create-ish calls seen (watermark +
    // newly scanned) equals the app's CURRENT next_challenge_id global (read
    // above via nextChallengeId() — the same global-state read sim-multiplayer
    // recon uses). A lagging/truncated indexer page set would otherwise shift
    // every subsequent cid and dress WRONG stages as truth. On mismatch: bank
    // NOTHING (no localStorage write, no log), keep the watermark exactly
    // where it was — unmapped cids fall through to the UNVERIFIED tiers.
    if (cache.fromCid + hits.length === total) {
      out = applyStageScan(cache, hits);
      writeStageCache(out);
    }
  }
  stageMemo = { at: Date.now(), stages: out.stages };
  return out.stages;
}

// ---------- per-challenge CARD MEMORY (pairs with the event log) ----------
// The event gives cid/winner/payout/fee; the MEMORY gives stake/format/stage/
// roster for cards THIS browser witnessed (created, joined, scanned, closed).
// Indexer offline -> memory alone still renders terminal cards; a fresh
// browser -> events alone still render (stake/seats fall back to the pot).
export interface CardMemory {
  cid: number;
  creator: string;
  stake: number; // display $GONNA per seat
  seatsTotal: number; // UI convention (joiner seats + creator)
  stageMode: 'full' | 'single' | 'random';
  stageIdx: number | null;
  // v15.2.8: true = the stage was COMMITTED (create note / this browser's own
  // create / link hint); false/absent = never verified (a cid%7 fallback GUESS
  // is never written into memory — unverified cards carry stageIdx null here)
  stageVerified?: boolean;
  deadline: number; // ms epoch
  players: { address: string; score: number; signed: boolean }[];
  closedKind: 'resolved' | 'forfeited' | 'refunded' | null;
  winner: string | null;
  payout: number; // display $GONNA the winner took (0 pre-close)
  fee: number;
  closedAt: number | null; // ms epoch
}
const CARD_KEY = 'gonna.arena.cards';
const CARD_MEM_MAX = 200;

function readCardMem(): Record<string, CardMemory> {
  try {
    return JSON.parse(window.localStorage.getItem(CARD_KEY) ?? '{}') as Record<string, CardMemory>;
  } catch {
    return {};
  }
}
export function rememberCard(m: CardMemory): void {
  try {
    const all = readCardMem();
    const prev = all[String(m.cid)];
    // merge: a later close never blanks fields an earlier snapshot knew
    const merged = prev
      ? { ...prev, ...m, players: m.players.length > 0 ? m.players : prev.players, closedAt: m.closedAt ?? prev.closedAt }
      : m;
    // v15.2.8: a VERIFIED stage is never downgraded by a later unverified
    // snapshot (e.g. a scan that ran before the note indexer caught up)
    if (prev && prev.stageVerified === true && m.stageVerified !== true) {
      merged.stageVerified = true;
      merged.stageIdx = prev.stageIdx;
    }
    all[String(m.cid)] = merged;
    const keys = Object.keys(all);
    if (keys.length > CARD_MEM_MAX) {
      const sorted = keys.sort((x, y) => Number(x) - Number(y));
      for (const k of sorted.slice(0, keys.length - CARD_MEM_MAX)) delete all[k];
    }
    window.localStorage.setItem(CARD_KEY, JSON.stringify(all));
  } catch { /* no storage */ }
}
export function rememberedCard(cid: number): CardMemory | null {
  return readCardMem()[String(cid)] ?? null;
}
export function rememberedCards(): CardMemory[] {
  return Object.values(readCardMem());
}
