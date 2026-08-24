// src/game/arena/testnetKit.ts
var ARENA_APP_ID = 769767443;
var LEGACY_ARENA_APP_ID = 769688298;
var GONNA_ASA_TESTNET = 769688287;
var OPUP_APP_ID = 769688641;
var TREASURY_ADDR = "4OQ3LJ3JW67JEY55TMHLGZG3MWWLTVFZERGY67LBJEJLOGEUUX2PYHQGGM";
var ORACLE_ADDR = "COI33V32HHFEGZFVGBZHD2A67TSQ4JHHTS5CE37VNLGIQHOHCP4FI4KNFA";
var ALGOD_TESTNET = "https://testnet-api.algonode.cloud";
var SEAT_TTL_SECS = 3600;
var ARENA_VERSION = 2;
var MBR_CREATE = 358200;
var EARLY_CLOSE_FEE_PAY = 1e6;
var GONNA_DECIMALS = 6;
var SCORE_DOMAIN = new TextEncoder().encode("QA-SCORE|");
var VERDICT_DOMAIN = new TextEncoder().encode("QA-VERDICT|");
var TESTNET_FEES = {
  create: 1e3 + 1e3 + 3e3 + 4 * 1e3,
  // pay + axfer + call + 4 opup
  join: 1e3 + 3e3,
  // axfer + call
  submit: 3e3 + 4 * 1e3,
  // call + 4 opup
  resolve: 6e3 + 4 * 1e3,
  // call + 4 opup
  claim: 2e3,
  close: 1e3 + 4e3,
  // pay + call
  forfeit: 5e3
  // call + 4 inner (2 axfer winner + fee axfer + MBR payback)
};
var sdkP = null;
function sdk() {
  if (!sdkP) sdkP = import("algosdk");
  return sdkP;
}
async function algodClient() {
  const a = await sdk();
  return new a.Algodv2("", ALGOD_TESTNET, "");
}
function u64be(v) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(v), false);
  return b;
}
function scoreMsg(cid, seat, addrBytes, score) {
  const out = new Uint8Array(SCORE_DOMAIN.length + 8 + 8 + 1 + 32 + 8);
  out.set(SCORE_DOMAIN, 0);
  out.set(u64be(ARENA_APP_ID), SCORE_DOMAIN.length);
  out.set(u64be(cid), SCORE_DOMAIN.length + 8);
  out.set([seat & 255], SCORE_DOMAIN.length + 16);
  out.set(addrBytes, SCORE_DOMAIN.length + 17);
  out.set(u64be(score), SCORE_DOMAIN.length + 49);
  return out;
}
async function verdictMsg(cid, mode, extra32, entries) {
  const raw = new Uint8Array(entries.length * 41);
  entries.forEach((e, i) => {
    raw.set([e.seat & 255], i * 41);
    raw.set(e.addr, i * 41 + 1);
    raw.set(u64be(e.score), i * 41 + 33);
  });
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  const out = new Uint8Array(VERDICT_DOMAIN.length + 8 + 8 + 1 + 32 + 32);
  out.set(VERDICT_DOMAIN, 0);
  out.set(u64be(ARENA_APP_ID), VERDICT_DOMAIN.length);
  out.set(u64be(cid), VERDICT_DOMAIN.length + 8);
  out.set([mode & 255], VERDICT_DOMAIN.length + 16);
  out.set(extra32, VERDICT_DOMAIN.length + 17);
  out.set(digest, VERDICT_DOMAIN.length + 49);
  return out;
}
async function nextChallengeId() {
  const algod = await algodClient();
  const app = await algod.getApplicationByID(ARENA_APP_ID).do();
  for (const kv of app.params.globalState ?? []) {
    if (new TextDecoder().decode(kv.key) === "next_challenge_id") return Number(kv.value.uint ?? 0);
  }
  return 0;
}
async function contractVersion() {
  const algod = await algodClient();
  const app = await algod.getApplicationByID(ARENA_APP_ID).do();
  for (const kv of app.params.globalState ?? []) {
    if (new TextDecoder().decode(kv.key) === "version") return Number(kv.value.uint ?? 0);
  }
  return 0;
}
async function readMeta(cid) {
  const algod = await algodClient();
  const a = await sdk();
  try {
    const name = new Uint8Array([109, ...u64be(cid)]);
    const box = await algod.getApplicationBoxByName(ARENA_APP_ID, name).do();
    const t = a.ABIType.from("(byte[],uint64,uint64,uint64,uint64,uint64,byte[],uint64,uint64,byte[],uint64,uint64)");
    const v = t.decode(box.value);
    return { creator: v[0], stake: v[1], seatsTotal: v[2], seatsTaken: v[3], deadline: v[4], stageMode: v[5], seed: v[6], creatorScore: v[7], status: v[8], winner: v[9], paidTotal: v[10], mbrPaid: v[11] };
  } catch {
    return null;
  }
}
async function readPlayers(cid) {
  const algod = await algodClient();
  const a = await sdk();
  try {
    const name = new Uint8Array([112, ...u64be(cid)]);
    const box = await algod.getApplicationBoxByName(ARENA_APP_ID, name).do();
    const t = a.ABIType.from("(byte[],uint64,bool,uint64)[]");
    const v = t.decode(box.value);
    return v.map((p) => ({ addr: p[0], score: p[1], signed: p[2], seatedAt: p[3] }));
  } catch {
    return [];
  }
}
async function scanChallengeIds() {
  const algod = await algodClient();
  const res = await algod.getApplicationBoxes(ARENA_APP_ID).do();
  const ids = [];
  for (const b of res.boxes) {
    const name = b.name;
    if (name.length === 9 && name[0] === 109) {
      ids.push(Number(new DataView(name.buffer, 1).getBigUint64(0, false)));
    }
  }
  return ids.sort((x, y) => x - y);
}
async function baseParams(flatFee) {
  const algod = await algodClient();
  const sp = await algod.getTransactionParams().do();
  return { ...sp, fee: flatFee, flatFee: true };
}
async function methodSelector(a, sig) {
  const parts = sig.split(")");
  const argTypes = parts[0].slice(parts[0].indexOf("(") + 1).split(",").filter(Boolean);
  const m = new a.ABIMethod({
    name: sig.slice(0, sig.indexOf("(")),
    args: argTypes.map((t, i) => ({ type: t, name: "a" + i })),
    returns: { type: parts[1] || "void" }
  });
  return m.getSelector();
}
async function appArg(a, type, val) {
  if (type === "byte[]") return a.ABIType.from("byte[]").encode(val);
  return a.ABIType.from("uint64").encode(BigInt(val));
}
function boxRef(cid, prefix) {
  return { appIndex: ARENA_APP_ID, name: new Uint8Array([prefix, ...u64be(cid)]) };
}
async function opupTxns(sender, cid) {
  const a = await sdk();
  const out = [];
  for (let i = 0; i < 4; i++) {
    const note = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`QA-opup-${cid}-${i}-${Date.now()}`))
    );
    out.push(
      a.makeApplicationNoOpTxnFromObject({
        sender,
        appIndex: OPUP_APP_ID,
        note,
        suggestedParams: await baseParams(1e3)
      })
    );
  }
  return out;
}
async function buildCreateGroup(o) {
  const a = await sdk();
  const appAddr = a.getApplicationAddress(ARENA_APP_ID);
  const sig = "create_challenge(pay,axfer,uint64,uint64,uint64,uint64,byte[],uint64,byte[])uint64";
  const appArgs = [
    await methodSelector(a, sig),
    await appArg(a, "uint64", o.stakeBase),
    await appArg(a, "uint64", o.seats),
    await appArg(a, "uint64", o.durationSecs),
    await appArg(a, "uint64", o.stageMode),
    await appArg(a, "byte[]", new Uint8Array(32)),
    await appArg(a, "uint64", o.creatorScore),
    await appArg(a, "byte[]", o.creatorScoreSig)
  ];
  const pay = a.makePaymentTxnWithSuggestedParamsFromObject({
    sender: o.creator,
    receiver: appAddr,
    amount: MBR_CREATE,
    suggestedParams: await baseParams(1e3)
  });
  const axfer = a.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: o.creator,
    receiver: appAddr,
    assetIndex: GONNA_ASA_TESTNET,
    amount: o.stakeBase,
    suggestedParams: await baseParams(1e3)
  });
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.creator,
    appIndex: ARENA_APP_ID,
    appArgs,
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 109), boxRef(o.cid, 112)],
    suggestedParams: await baseParams(3e3)
  });
  return [pay, axfer, call, ...await opupTxns(o.creator, o.cid)];
}
async function buildJoinGroup(o) {
  const a = await sdk();
  const appAddr = a.getApplicationAddress(ARENA_APP_ID);
  const axfer = a.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: o.joiner,
    receiver: appAddr,
    assetIndex: GONNA_ASA_TESTNET,
    amount: o.stakeBase,
    suggestedParams: await baseParams(1e3)
  });
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.joiner,
    appIndex: ARENA_APP_ID,
    appArgs: [await methodSelector(a, "join_challenge(axfer,uint64)uint64"), await appArg(a, "uint64", o.cid)],
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 109), boxRef(o.cid, 112)],
    suggestedParams: await baseParams(3e3)
  });
  return [axfer, call];
}
async function buildSubmitGroup(o) {
  const a = await sdk();
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.player,
    appIndex: ARENA_APP_ID,
    appArgs: [
      await methodSelector(a, "submit_score(uint64,uint64,byte[])void"),
      await appArg(a, "uint64", o.cid),
      await appArg(a, "uint64", o.score),
      await appArg(a, "byte[]", o.sig)
    ],
    boxes: [boxRef(o.cid, 109), boxRef(o.cid, 112)],
    suggestedParams: await baseParams(3e3)
  });
  return [call, ...await opupTxns(o.player, o.cid)];
}
async function buildResolveGroup(o) {
  const a = await sdk();
  const meta = await readMeta(o.cid);
  if (!meta) throw new Error("card not found on chain (already settled?)");
  const roster = await readPlayers(o.cid);
  const enc = (pk) => a.encodeAddress(pk instanceof Uint8Array ? pk : Uint8Array.from(pk));
  const creator = enc(meta.creator);
  const accounts = [.../* @__PURE__ */ new Set([o.winner, creator, TREASURY_ADDR, ...roster.map((p) => enc(p.addr))])].filter((x) => x !== o.caller).slice(0, 4);
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.caller,
    appIndex: ARENA_APP_ID,
    appArgs: [
      await methodSelector(a, "resolve(uint64,uint64,byte[],byte[])byte[]"),
      await appArg(a, "uint64", o.cid),
      await appArg(a, "uint64", o.stageIdx),
      await appArg(a, "byte[]", o.seedReveal),
      await appArg(a, "byte[]", o.verdictSig)
    ],
    accounts,
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 109), boxRef(o.cid, 112)],
    suggestedParams: await baseParams(6e3)
  });
  return [call, ...await opupTxns(o.caller, o.cid)];
}
var CONTINUE_FEE_MICRO = 5e6;
function continueNote(refId, addr) {
  return "QA-CONTINUE|" + refId + "|" + addr;
}
async function buildContinuePayment(o) {
  const a = await sdk();
  const sp = await (await algodClient()).getTransactionParams().do();
  const pay = a.makePaymentTxnWithSuggestedParamsFromObject({
    sender: o.sender,
    receiver: TREASURY_ADDR,
    amount: CONTINUE_FEE_MICRO,
    note: new TextEncoder().encode(continueNote(o.refId, o.sender)),
    suggestedParams: { ...sp, fee: 1e3, flatFee: true }
  });
  return [pay];
}
async function verifyContinuePayment(txid, refId, addr) {
  const a = await sdk();
  const want = continueNote(refId, addr);
  const check = (t) => {
    if (!t || t.type !== "pay") return false;
    if (Number(t.amount) !== CONTINUE_FEE_MICRO) return false;
    if (t.receiver !== TREASURY_ADDR) return false;
    return t.note === want;
  };
  try {
    const r = await (await algodClient()).pendingTransactionInformation(txid).do();
    const inner = r?.txn?.txn;
    if (inner) {
      const view = {
        type: inner.type,
        amount: inner.amt,
        receiver: inner.rcv ? a.encodeAddress(Uint8Array.from(inner.rcv)) : void 0,
        note: inner.note ? new TextDecoder().decode(Uint8Array.from(inner.note)) : void 0
      };
      if (check(view)) return true;
    }
  } catch {
  }
  try {
    const r = await fetch(`https://testnet-idx.algonode.cloud/v2/transactions/${txid}`);
    if (r.ok) {
      const j = await r.json();
      const t = j.transaction;
      if (t && t["tx-type"] === "pay" && t["payment-transaction"]) {
        const view = {
          type: "pay",
          amount: t["payment-transaction"].amount,
          receiver: t["payment-transaction"].receiver,
          note: t.note ? new TextDecoder().decode(Uint8Array.from(atob(t.note), (ch) => ch.charCodeAt(0))) : void 0
        };
        return check(view);
      }
    }
  } catch {
  }
  return false;
}
async function buildClaimGroup(o) {
  const a = await sdk();
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.caller,
    appIndex: ARENA_APP_ID,
    appArgs: [await methodSelector(a, "claim(uint64)void"), await appArg(a, "uint64", o.cid)],
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 109), boxRef(o.cid, 112)],
    suggestedParams: await baseParams(2e3)
  });
  return [call];
}
async function buildEarlyCloseGroup(o) {
  const a = await sdk();
  const pay = a.makePaymentTxnWithSuggestedParamsFromObject({
    sender: o.caller,
    receiver: TREASURY_ADDR,
    amount: EARLY_CLOSE_FEE_PAY,
    suggestedParams: await baseParams(1e3)
  });
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.caller,
    appIndex: ARENA_APP_ID,
    appArgs: [await methodSelector(a, "early_close(pay,uint64)void"), await appArg(a, "uint64", o.cid)],
    accounts: [TREASURY_ADDR],
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 109), boxRef(o.cid, 112)],
    suggestedParams: await baseParams(4e3)
  });
  return [pay, call];
}
async function buildClaimForfeitGroup(o) {
  const a = await sdk();
  const meta = await readMeta(o.cid);
  if (!meta) throw new Error("card not found on chain (already settled?)");
  const creator = a.encodeAddress(meta.creator);
  const call = a.makeApplicationNoOpTxnFromObject({
    sender: o.caller,
    appIndex: ARENA_APP_ID,
    appArgs: [
      await methodSelector(a, "claim_forfeit(uint64,uint64)void"),
      await appArg(a, "uint64", o.cid),
      await appArg(a, "uint64", o.seat)
    ],
    accounts: [TREASURY_ADDR, creator],
    foreignAssets: [GONNA_ASA_TESTNET],
    boxes: [boxRef(o.cid, 109), boxRef(o.cid, 112)],
    suggestedParams: await baseParams(TESTNET_FEES.forfeit)
  });
  return [call];
}
var SIGN_TIMEOUT_MS = 9e4;
var SIGN_TIMEOUT_MSG = "WALLET NOT RESPONDING - RECONNECT AND RETRY";
function withTimeout(p, ms, timeoutMsg) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(timeoutMsg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}
function isCidRaceReject(e) {
  const msg = String(e?.message ?? e);
  return /status 400/i.test(msg) && /logic eval error/i.test(msg);
}
var SIGN_NUDGE_MS = 12e3;
var SIGN_CANCEL_MSG = "SIGNING CANCELLED - SEALED SCORE SAFE";
var SignCancelled = class extends Error {
  constructor() {
    super(SIGN_CANCEL_MSG);
    this.name = "SignCancelled";
  }
};
function isSignCancel(e) {
  return e instanceof SignCancelled || String(e?.message ?? e).toUpperCase().startsWith("SIGNING CANCELLED");
}
function isWedgeError(e) {
  const msg = String(e?.message ?? e);
  return /request pending/i.test(msg) || /another request/i.test(msg) || /session currently connected/i.test(msg);
}
var recoverHook = null;
function setSignRecoverHook(fn) {
  recoverHook = fn;
}
var activeOp = null;
function activeSignOp() {
  return activeOp;
}
var StaleAttempt = class extends Error {
};
async function defaultSend(signed) {
  const a = await sdk();
  const algod = await algodClient();
  const res = await algod.sendRawTransaction(signed).do();
  console.debug("[arena] tx sent: " + res.txid + " \u2014 waiting for confirmation");
  await a.waitForConfirmation(algod, res.txid, 10);
  return res.txid;
}
function signSendManaged(sign, buildTxns, opts = {}) {
  const nudgeMs = opts.nudgeMs ?? SIGN_NUDGE_MS;
  const timeoutMs = opts.timeoutMs ?? SIGN_TIMEOUT_MS;
  const label = opts.label ?? "SIGN";
  let gen = 0;
  let settled = false;
  let cancelled = false;
  let recovering = false;
  let attempt = 0;
  let attemptStartedAt = 0;
  let phase = "building";
  let wedged = false;
  let autoLeft = opts.autoRetries ?? 0;
  let wedgeLeft = opts.wedgeRetries ?? 1;
  let resolveDone;
  let rejectDone;
  const done = new Promise((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  const view = {
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
      return !settled && phase !== "sending" && attemptStartedAt > 0 && Date.now() - attemptStartedAt >= nudgeMs;
    },
    get cancellable() {
      return !settled && phase !== "sending";
    },
    retry: () => {
      void doRetry();
    },
    cancel: () => doCancel()
  };
  activeOp = view;
  function settleOk(txid) {
    settled = true;
    if (activeOp === view) activeOp = null;
    resolveDone(txid);
  }
  function settleErr(e) {
    settled = true;
    if (activeOp === view) activeOp = null;
    rejectDone(e);
  }
  async function attemptRun(myGen) {
    const live = () => {
      if (cancelled) throw new SignCancelled();
      if (myGen !== gen) throw new StaleAttempt();
    };
    try {
      live();
      phase = "building";
      attemptStartedAt = Date.now();
      const txns = await buildTxns();
      live();
      const a = await sdk();
      a.assignGroupID(txns);
      console.debug("[arena] " + label + " \u2014 sign start, atomic group of " + txns.length + " txn(s) (attempt " + attempt + ")");
      phase = "signing";
      attemptStartedAt = Date.now();
      const signed = await withTimeout(
        sign([txns.map((txn) => ({ txn, signers: [txn.sender.toString()] }))]),
        timeoutMs,
        SIGN_TIMEOUT_MSG
      );
      live();
      console.debug("[arena] wallet response \u2014 " + signed.length + " signed txn(s)");
      phase = "sending";
      attemptStartedAt = Date.now();
      const txid = await (opts.send ? opts.send(signed) : defaultSend(signed));
      live();
      opts.onEvent?.("sent");
      settleOk(txid);
    } catch (e) {
      if (e instanceof StaleAttempt) return;
      if (cancelled || e instanceof SignCancelled) {
        settleErr(new SignCancelled());
        return;
      }
      if (autoLeft > 0 && opts.rebuildOnRetry && isCidRaceReject(e)) {
        autoLeft--;
        wedged = false;
        console.debug("[arena] create 400 (stale cid race) \u2014 retrying with fresh challenge id");
        opts.onEvent?.("cid-race-retry");
        return attemptRun(myGen);
      }
      if (isWedgeError(e) && wedgeLeft > 0) {
        wedgeLeft--;
        wedged = true;
        console.debug("[arena] wedged wallet session \u2014 recovering before re-send");
        opts.onEvent?.("wedge");
        const rec = opts.recover ?? recoverHook;
        if (rec) {
          recovering = true;
          opts.onEvent?.("recover");
          try {
            await rec();
          } catch (re) {
            console.debug("[arena] session recovery failed (re-sending anyway):", re);
          }
          recovering = false;
        }
        if (cancelled) {
          settleErr(new SignCancelled());
          return;
        }
        if (myGen !== gen) return;
        attempt++;
        opts.onEvent?.("attempt");
        return attemptRun(myGen);
      }
      if (isWedgeError(e)) wedged = true;
      settleErr(e instanceof Error ? e : new Error(String(e)));
    }
  }
  const onWire = () => phase === "sending";
  async function doRetry() {
    if (settled || cancelled) return;
    if (onWire()) return;
    opts.onEvent?.("retry");
    const hanging = attemptStartedAt > 0;
    const rec = opts.recover ?? recoverHook;
    if ((wedged || hanging) && rec) {
      recovering = true;
      opts.onEvent?.("recover");
      try {
        await rec();
      } catch (e) {
        console.debug("[arena] session recovery failed (re-sending anyway):", e);
      }
      recovering = false;
    }
    if (settled || cancelled || onWire()) return;
    gen++;
    wedged = false;
    attempt++;
    opts.onEvent?.("attempt");
    void attemptRun(gen);
  }
  function doCancel() {
    if (settled || cancelled) return;
    opts.onEvent?.("cancel");
    cancelled = true;
    gen++;
    settleErr(new SignCancelled());
  }
  attempt = 1;
  opts.onEvent?.("attempt");
  void attemptRun(gen);
  return { done, retry: view.retry, cancel: view.cancel };
}
async function signSend(sign, txns, opts = {}) {
  return signSendManaged(sign, () => Promise.resolve(txns), opts).done;
}
var TX_KEY = "gonna.arena.txids";
function recordTxid(cid, txid) {
  try {
    const m = JSON.parse(window.localStorage.getItem(TX_KEY) ?? "{}");
    m[String(cid)] = txid;
    window.localStorage.setItem(TX_KEY, JSON.stringify(m));
  } catch {
  }
}
function getTxid(cid) {
  try {
    const m = JSON.parse(window.localStorage.getItem(TX_KEY) ?? "{}");
    return m[String(cid)] ?? null;
  } catch {
    return null;
  }
}
var RES_KEY = "gonna.arena.resolved";
function recordResolveAt(cid, at) {
  try {
    const m = JSON.parse(window.localStorage.getItem(RES_KEY) ?? "{}");
    m[String(cid)] = at;
    window.localStorage.setItem(RES_KEY, JSON.stringify(m));
  } catch {
  }
}
function getResolveAt(cid) {
  try {
    const m = JSON.parse(window.localStorage.getItem(RES_KEY) ?? "{}");
    const v = m[String(cid)];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
function explorerTxUrl(txid) {
  return "https://testnet.explorer.perawallet.app/tx/" + txid;
}
var INDEXER_TESTNET = "https://testnet-idx.algonode.cloud";
var EV_RESOLVED = "ae488dc6";
var EV_FORFEITED = "24d3dd8b";
var EV_REFUNDED = "0bfda53a";
function hex4(b) {
  return [...b.slice(0, 4)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function b64ToBytes(s) {
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
}
function u64At(b, off) {
  return Number(new DataView(b.buffer, b.byteOffset + off, 8).getBigUint64(0, false));
}
async function fetchArenaCloseEvents(maxPages = 5) {
  const a = await sdk();
  const ZERO = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
  const out = [];
  let next = null;
  for (let page = 0; page < maxPages; page++) {
    const url = INDEXER_TESTNET + "/v2/transactions?application-id=" + ARENA_APP_ID + "&tx-type=appl&limit=100" + (next ? "&next=" + encodeURIComponent(next) : "");
    const r = await fetch(url);
    if (!r.ok) throw new Error("indexer http " + r.status);
    const j = await r.json();
    for (const t of j.transactions ?? []) {
      for (const log of t.logs ?? []) {
        const b = b64ToBytes(log);
        if (b.length < 12) continue;
        const sel = hex4(b);
        const at = (t["round-time"] ?? 0) * 1e3;
        if (sel === EV_RESOLVED || sel === EV_FORFEITED) {
          if (b.length < 60) continue;
          const winnerRaw = a.encodeAddress(b.slice(12, 44));
          out.push({
            cid: u64At(b, 4),
            kind: sel === EV_RESOLVED ? "resolved" : "forfeited",
            winner: winnerRaw === ZERO ? null : winnerRaw,
            payout: u64At(b, 44),
            fee: u64At(b, 52),
            reason: null,
            txid: t.id,
            round: t["confirmed-round"],
            at
          });
        } else if (sel === EV_REFUNDED) {
          if (b.length < 20) continue;
          out.push({ cid: u64At(b, 4), kind: "refunded", winner: null, payout: 0, fee: 0, reason: u64At(b, 12), txid: t.id, round: t["confirmed-round"], at });
        }
      }
    }
    next = j["next-token"] ?? null;
    if (!next) break;
  }
  return out;
}
var CARD_KEY = "gonna.arena.cards";
var CARD_MEM_MAX = 200;
function readCardMem() {
  try {
    return JSON.parse(window.localStorage.getItem(CARD_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function rememberCard(m) {
  try {
    const all = readCardMem();
    const prev = all[String(m.cid)];
    all[String(m.cid)] = prev ? { ...prev, ...m, players: m.players.length > 0 ? m.players : prev.players, closedAt: m.closedAt ?? prev.closedAt } : m;
    const keys = Object.keys(all);
    if (keys.length > CARD_MEM_MAX) {
      const sorted = keys.sort((x, y) => Number(x) - Number(y));
      for (const k of sorted.slice(0, keys.length - CARD_MEM_MAX)) delete all[k];
    }
    window.localStorage.setItem(CARD_KEY, JSON.stringify(all));
  } catch {
  }
}
function rememberedCard(cid) {
  return readCardMem()[String(cid)] ?? null;
}
function rememberedCards() {
  return Object.values(readCardMem());
}
export {
  ALGOD_TESTNET,
  ARENA_APP_ID,
  ARENA_VERSION,
  CONTINUE_FEE_MICRO,
  GONNA_ASA_TESTNET,
  GONNA_DECIMALS,
  INDEXER_TESTNET,
  LEGACY_ARENA_APP_ID,
  OPUP_APP_ID,
  ORACLE_ADDR,
  SEAT_TTL_SECS,
  SIGN_CANCEL_MSG,
  SIGN_NUDGE_MS,
  SIGN_TIMEOUT_MS,
  SIGN_TIMEOUT_MSG,
  SignCancelled,
  TESTNET_FEES,
  TREASURY_ADDR,
  activeSignOp,
  algodClient,
  buildClaimForfeitGroup,
  buildClaimGroup,
  buildContinuePayment,
  buildCreateGroup,
  buildEarlyCloseGroup,
  buildJoinGroup,
  buildResolveGroup,
  buildSubmitGroup,
  continueNote,
  contractVersion,
  explorerTxUrl,
  fetchArenaCloseEvents,
  getResolveAt,
  getTxid,
  isCidRaceReject,
  isSignCancel,
  isWedgeError,
  nextChallengeId,
  readMeta,
  readPlayers,
  recordResolveAt,
  recordTxid,
  rememberCard,
  rememberedCard,
  rememberedCards,
  scanChallengeIds,
  scoreMsg,
  sdk,
  setSignRecoverHook,
  signSend,
  signSendManaged,
  verdictMsg,
  verifyContinuePayment,
  withTimeout
};
