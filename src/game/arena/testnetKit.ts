// ============================================================================
// THE ARENA — TESTNET KIT. TESTNET ONLY — NEVER SHIP TO MAINNET.
// Exact atomic groups for the QuantumArena contract (deploy/smoke_testnet.py
// is the reference implementation; v5.0.0 pooled-opcode-budget via OpUp).
//   ARENA APP 769688298 · $GONNA ASA 769688287 · OPUP DONOR 769688641
// ============================================================================
export const ARENA_APP_ID = 769688298;
export const GONNA_ASA_TESTNET = 769688287;
export const OPUP_APP_ID = 769688641;
export const TREASURY_ADDR = '4OQ3LJ3JW67JEY55TMHLGZG3MWWLTVFZERGY67LBJEJLOGEUUX2PYHQGGM';
export const ORACLE_ADDR = 'COI33V32HHFEGZFVGBZHD2A67TSQ4JHHTS5CE37VNLGIQHOHCP4FI4KNFA';
export const ALGOD_TESTNET = 'https://testnet-api.algonode.cloud';

const MBR_CREATE = 350_000; // box MBR payment (create)
const EARLY_CLOSE_FEE_PAY = 1_000_000; // 1 ALGO to treasury (early close)
export const GONNA_DECIMALS = 6;

// oracle message domains (contract.py: SCORE_DOMAIN/VERDICT_DOMAIN)
const SCORE_DOMAIN = new TextEncoder().encode('QA-SCORE|');
const VERDICT_DOMAIN = new TextEncoder().encode('QA-VERDICT|');

// flat fees per txn kind (µALGO) — see smoke_testnet.py
export const TESTNET_FEES = {
  create: 1000 + 1000 + 3000 + 4 * 1000, // pay + axfer + call + 4 opup
  join: 1000 + 3000, // axfer + call
  submit: 3000 + 4 * 1000, // call + 4 opup
  resolve: 6000 + 4 * 1000, // call + 4 opup
  claim: 2000,
  close: 1000 + 4000, // pay + call
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
  return new a.Algodv2('', ALGOD_TESTNET, '');
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
  status: bigint; // 0 OPEN, 1 RESOLVED, 2 CLAIMED
  winner: Uint8Array;
  paidTotal: bigint;
}
export interface PlayerTuple {
  addr: Uint8Array;
  score: bigint;
  signed: boolean;
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

export async function readMeta(cid: number): Promise<MetaTuple | null> {
  const algod = await algodClient();
  const a = await sdk();
  try {
    const name = new Uint8Array([0x6d, ...u64be(cid)]); // 'm' + cid8
    const box = await algod.getApplicationBoxByName(ARENA_APP_ID, name).do();
    const t = a.ABIType.from('(byte[],uint64,uint64,uint64,uint64,uint64,byte[],uint64,uint64,byte[],uint64)');
    const v = t.decode(box.value) as [Uint8Array, bigint, bigint, bigint, bigint, bigint, Uint8Array, bigint, bigint, Uint8Array, bigint];
    return { creator: v[0], stake: v[1], seatsTotal: v[2], seatsTaken: v[3], deadline: v[4], stageMode: v[5], seed: v[6], creatorScore: v[7], status: v[8], winner: v[9], paidTotal: v[10] };
  } catch {
    return null; // box gone (claimed/closed) or network hiccup
  }
}

export async function readPlayers(cid: number): Promise<PlayerTuple[]> {
  const algod = await algodClient();
  const a = await sdk();
  try {
    const name = new Uint8Array([0x70, ...u64be(cid)]); // 'p' + cid8
    const box = await algod.getApplicationBoxByName(ARENA_APP_ID, name).do();
    const t = a.ABIType.from('(byte[],uint64,bool)[]');
    const v = t.decode(box.value) as [Uint8Array, bigint, boolean][];
    return v.map((p) => ({ addr: p[0], score: p[1], signed: p[2] }));
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

// 4 NoOp calls to the budget-donor app, unique notes (OpUp pattern v5.0.0)
async function opupTxns(sender: string, cid: number): Promise<Txn[]> {
  const a = await sdk();
  const out: Txn[] = [];
  for (let i = 0; i < 4; i++) {
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
    suggestedParams: await baseParams(3000),
  });
  return [pay, axfer, call, ...(await opupTxns(o.creator, o.cid))];
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
  return [axfer, call];
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
export async function buildResolveGroup(o: { caller: string; cid: number; stageIdx: number; seedReveal: Uint8Array; verdictSig: Uint8Array; winner: string }): Promise<Txn[]> {
  const a = await sdk();
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.caller, appIndex: ARENA_APP_ID,
    appArgs: [
      await methodSelector(a, 'resolve(uint64,uint64,byte[],byte[])byte[]'),
      await appArg(a, 'uint64', o.cid),
      await appArg(a, 'uint64', o.stageIdx),
      await appArg(a, 'byte[]', o.seedReveal),
      await appArg(a, 'byte[]', o.verdictSig),
    ],
    accounts: [o.winner, TREASURY_ADDR],
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 0x6d), boxRef(o.cid, 0x70)],
    suggestedParams: await baseParams(6000),
  });
  return [call, ...(await opupTxns(o.caller, o.cid))];
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
    const r = await fetch(`https://testnet-idx.algonode.cloud/v2/transactions/${txid}`);
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
    suggestedParams: await baseParams(2000),
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

// sign as one atomic group (Pera-style {txn, signers} groups) and broadcast
export type TxSignFn = (groups: { txn: Txn; signers: string[] }[][]) => Promise<Uint8Array[]>;
export async function signSend(sign: TxSignFn, txns: Txn[]): Promise<string> {
  const a = await sdk();
  const algod = await algodClient();
  a.assignGroupID(txns);
  const signed = await sign([txns.map((txn) => ({ txn, signers: [txn.sender.toString()] }))]);
  const res = (await algod.sendRawTransaction(signed).do()) as { txid: string };
  await a.waitForConfirmation(algod, res.txid, 10);
  return res.txid;
}

// per-challenge txid memory (for VIEW ON CHAIN)
const TX_KEY = 'gonna.arena.txids';
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
const RES_KEY = 'gonna.arena.resolved';
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
export function explorerTxUrl(txid: string): string {
  return 'https://testnet.explorer.perawallet.app/tx/' + txid;
}
