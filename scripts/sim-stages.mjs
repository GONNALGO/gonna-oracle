// ============================================================================
// GONNAFIGHT ARENA v15.2.8 — CREATOR-CHOSEN LEVEL E2E PROOF (Algorand TESTNET,
// v2.1 app 769907387). The owner decree: "il primo giocatore sceglie il livello
// e chi partecipa gioca lo stesso esatto livello con gli stessi nemici".
//
// The 5-card matrix (creator-chosen DESCENT duel, 1 GONNA a seat, create note
// 'gonna:v2:stage:<K>' committed by PLAYER_A's signature):
//   stage 0 -> cid 31   stage 2 -> cid 33   stage 4 -> cid 34
//   stage 6 -> cid 35   stage 1 -> cid 32
// Earlier crashed runs left two LIVE orphans fully joined + double-signed:
//   cid 26 (committed stage 0) and cid 35 (committed stage 6).
// This script, in order:
//   PHASE 0  funding check (TREASURY tops up any QA account that is short)
//   PHASE 1  recon: scanChallengeIds + fetchArenaCreateStages + an INDEPENDENT
//            indexer walk that recovers, per cid, the create/join/submit/
//            resolve txids (creates mapped sequentially — contract fact:
//            next_challenge_id increments once per create/spawn call — and
//            cross-checked against the note scan; disagreement = FAIL)
//   PHASE 2  orphan cleanup: every live card from the crashed runs is closed
//            LEGITIMATELY — seats filled (join) if open, unsigned seats
//            submitted, then resolved binding the card's COMMITTED stage
//            (oracle verdict extra = 24 zeros + uint64 idx; resolve arg #2
//            identical). 95/5 payout, exact MBR refund, both boxes deleted.
//   PHASE 3  the final 5-card txid table with on-chain note-decode proof.
//
// Keys come from the GITIGNORED contracts/quantum-arena/deploy/testnet.secrets.json
// — mnemonics are NEVER printed. Live txids + confirmed rounds ARE printed
// (they are the audit trail).
//
// Usage: node scripts/sim-stages.mjs
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY = path.join(ROOT, 'contracts/quantum-arena/deploy');

// ---- bundle the chain mirror exactly like sim-multiplayer.mjs does ----------
const KIT_OUT = path.join(ROOT, '.tmp-kit-sim-stages.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--outfile=${KIT_OUT}`], { cwd: ROOT, stdio: 'pipe' });
const kit = await import(KIT_OUT);
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));
const nacl = (await import('tweetnacl')).default;

// ---- keys (never printed) ----------------------------------------------------
if (!existsSync(DEPLOY + '/testnet.secrets.json')) throw new Error('missing deploy/testnet.secrets.json (gitignored QA keys)');
const secrets = JSON.parse(readFileSync(DEPLOY + '/testnet.secrets.json', 'utf8'));
const W = {};
for (const role of ['DEPLOYER', 'TREASURY', 'ORACLE', 'PLAYER_A', 'PLAYER_B']) {
  W[role] = algosdk.mnemonicToSecretKey(secrets[role].mnemonic);
}
const addr = (role) => W[role].addr.toString();
const oracleKp = nacl.sign.keyPair.fromSeed(W.ORACLE.sk.slice(0, 32));
const algod = await kit.algodClient();

const STAKE = 1_000_000; // 1 GONNA a seat
const MBR = 358_200; // v2 CHALLENGE_MBR
const ZERO32 = new Uint8Array(32);
const enc = (pk) => algosdk.encodeAddress(pk instanceof Uint8Array ? pk : Uint8Array.from(pk));
const short = (a) => a.slice(0, 8) + '..' + a.slice(-4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the five chosen levels (owner's exact sequence). planned scores per cid —
// used ONLY if a live card still needs a submit (both orphans are already
// double-signed with exactly these scores on-chain).
const PLAN = [
  { stage: 0, scoreA: 5000, scoreB: 9000, cid: 31 }, // B wins
  { stage: 2, scoreA: 5200, scoreB: 5100, cid: 33 }, // A wins
  { stage: 4, scoreA: 9000, scoreB: 8000, cid: 34 }, // A wins
  { stage: 6, scoreA: 5400, scoreB: 9300, cid: 35 }, // B wins (LIVE orphan -> resolve now)
  { stage: 1, scoreA: 9500, scoreB: 5000, cid: 32 }, // A wins
];
const ORPHAN_SCORES = { 26: { scoreA: 5000, scoreB: 9000 }, 35: { scoreA: 5400, scoreB: 9300 } };

const report = { cards: [], orphans: [], topups: [], checks: { passed: 0, failed: 0 }, deviations: [] };
function ok(cond, label) {
  report.checks[cond ? 'passed' : 'failed']++;
  if (!cond) report.deviations.push(label);
  console.log(`  ${cond ? 'PASS' : 'FAIL-DEVIATION'} ${label}`);
}

const gonnaBal = async (a) => {
  const i = await algod.accountInformation(a).do();
  const h = (i.assets ?? []).find((x) => Number(x.assetId ?? x['asset-id']) === kit.GONNA_ASA_TESTNET);
  return h ? Number(h.amount) : null; // null = not opted
};
const algoBal = async (a) => Number((await algod.accountInformation(a).do()).amount);
const algoSpendable = async (a) => {
  const i = await algod.accountInformation(a).do();
  return Number(i.amount) - Number(i.minBalance ?? i['min-balance'] ?? 0);
};

// v15.2.8 fix: the crashed run double-assigned the group id (groupIds() then
// send() re-assigning -> every pre-computed txid was stale). assignGroupID is
// idempotent-UNSAFE on already-grouped txns, so send() skips it when the
// group is already set and ALWAYS reads txids after assignment.
async function send(txns, signers) {
  if (!txns[0].group) algosdk.assignGroupID(txns);
  const txids = txns.map((t) => t.txID());
  const signed = txns.map((t, i) => t.signTxn((Array.isArray(signers) ? signers[i] : signers).sk));
  const r = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, r.txid, 10);
  const info = await algod.pendingTransactionInformation(r.txid).do();
  return { txid: r.txid, txids, round: Number(info.confirmedRound ?? info['confirmed-round'] ?? 0), info };
}

const signScore = (cid, seat, acct, score) => nacl.sign.detached(kit.scoreMsg(cid, seat, acct.addr.publicKey, score), oracleKp.secretKey);
const signVerdict = async (cid, mode, entries, extra = ZERO32) => nacl.sign.detached(await kit.verdictMsg(cid, mode, extra, entries), oracleKp.secretKey);

// ---------- indexer lifecycle recovery (independent audit read) -------------
// Walks EVERY app call of the arena app (oldest-first). create/spawn calls
// carry no cid arg — they map SEQUENTIALLY to cids 0,1,2,... (contract fact:
// next_challenge_id increments once per create-ish call), cross-checked
// against kit.fetchArenaCreateStages. join/submit/resolve carry the cid as
// app-arg #1; resolve also exposes the committed stage_idx as arg #2.
const SIGS = {
  create: 'create_challenge(pay,axfer,uint64,uint64,uint64,uint64,byte[],uint64,byte[])uint64',
  spawn: 'spawn_rumble(pay,axfer,pay,uint64,uint64,uint64,byte[])uint64',
  join: 'join_challenge(axfer,uint64)uint64',
  submit: 'submit_score(uint64,uint64,byte[])void',
  resolve: 'resolve(uint64,uint64,byte[],byte[])byte[]',
};
async function selectorOf(sig) {
  const a = await kit.sdk();
  const parts = sig.split(')');
  const argTypes = parts[0].slice(parts[0].indexOf('(') + 1).split(',').filter(Boolean);
  const m = new a.ABIMethod({ name: sig.slice(0, sig.indexOf('(')), args: argTypes.map((t, i) => ({ type: t, name: 'a' + i })), returns: { type: parts[1] || 'void' } });
  return Buffer.from(m.getSelector()).toString('base64');
}
const b64u64 = (b64) => Number(new DataView(Uint8Array.from(Buffer.from(b64, 'base64')).buffer).getBigUint64(0, false));

async function recoverLegs(targetCids) {
  const SEL = {};
  for (const [k, v] of Object.entries(SIGS)) SEL[await selectorOf(v)] = k;
  const creates = []; // oldest-first create-ish calls: {round, offset, txid, noteStage}
  const legs = {}; // cid -> {join, submit, resolve}
  let token = null;
  for (let page = 0; page < 60; page++) {
    const url = kit.INDEXER_TESTNET + '/v2/transactions?application-id=' + kit.ARENA_APP_ID + '&tx-type=appl&limit=100' + (token ? '&next=' + encodeURIComponent(token) : '');
    const r = await fetch(url);
    if (!r.ok) throw new Error('indexer http ' + r.status);
    const j = await r.json();
    for (const t of j.transactions ?? []) {
      if (typeof t['confirmed-round'] !== 'number') continue;
      const args = t['application-transaction']?.['application-args'];
      if (!args || !args.length) continue;
      const method = SEL[args[0]];
      if (!method) continue;
      const rec = { txid: t.id, round: t['confirmed-round'] };
      if (method === 'create' || method === 'spawn') {
        creates.push({ ...rec, offset: t['intra-round-offset'] ?? 0, noteStage: typeof t.note === 'string' ? kit.parseStageNote(Uint8Array.from(Buffer.from(t.note, 'base64'))) : null });
      } else {
        const cid = b64u64(args[1]);
        if (!targetCids.includes(cid)) continue;
        if (method === 'submit') rec.score = b64u64(args[2]);
        if (method === 'resolve') rec.stageIdx = b64u64(args[2]);
        (legs[cid] ??= {})[method] = rec; // one per method is enough for the audit table
      }
    }
    token = j['next-token'] ?? null;
    if (!token) break;
  }
  creates.sort((x, y) => x.round - y.round || x.offset - y.offset);
  const total = await kit.nextChallengeId();
  ok(creates.length >= total, `recovery: ${creates.length} create-ish calls on-chain >= next_challenge_id ${total} (sequential mapping valid)`);
  const out = {};
  for (const cid of targetCids) {
    const c = creates[cid] ?? null;
    out[cid] = { create: c ? { txid: c.txid, round: c.round, noteStage: c.noteStage } : null, ...(legs[cid] ?? {}) };
  }
  return out;
}

// ---------- legitimate lifecycle completion (join/submit/resolve) -----------
async function joinSeat(cid, role, stake) {
  const r = await send(await kit.buildJoinGroup({ joiner: addr(role), cid, stakeBase: stake }), W[role]);
  console.log(`  JOIN  cid=${cid} ${role} txid=${r.txid} round=${r.round}`);
  return r;
}
async function submitScore(cid, role, score) {
  const roster = await kit.readPlayers(cid);
  const seat = roster.findIndex((p) => enc(p.addr) === addr(role));
  if (seat < 0) throw new Error(`${role} not on cid ${cid}`);
  const sig = signScore(cid, seat, W[role], score);
  const r = await send(await kit.buildSubmitGroup({ player: addr(role), cid, score, sig }), W[role]);
  console.log(`  SUBMIT cid=${cid} ${role} seat=${seat} score=${score} txid=${r.txid} round=${r.round}`);
  return r;
}
async function resolveCard(cid, stage, label) {
  const meta = await kit.readMeta(cid);
  const roster = await kit.readPlayers(cid);
  if (!meta || !roster.length) { console.log(`  cid=${cid} already settled`); return null; }
  const signed = roster.map((p, s) => ({ seat: s, addr: p.addr, score: Number(p.score), signed: p.signed })).filter((e) => e.signed);
  const top = signed.reduce((x, y) => (y.score > x.score ? y : x));
  const winner = enc(top.addr);
  const winnerRole = winner === addr('PLAYER_A') ? 'PLAYER_A' : winner === addr('PLAYER_B') ? 'PLAYER_B' : short(winner);
  const mode = Number(meta.stageMode);
  // the oracle verdict binds the COMMITTED stage (MODE_STAGE_IDX: 24 zeros + idx)
  const extra = new Uint8Array(32);
  if (mode === 1) new DataView(extra.buffer).setBigUint64(24, BigInt(stage), false);
  const vSig = await signVerdict(cid, mode, signed, extra);
  const rtxns = await kit.buildResolveGroup({ caller: addr('DEPLOYER'), cid, stageIdx: mode === 1 ? stage : 0, seedReveal: new Uint8Array(0), verdictSig: vSig, winner });
  // proof: the resolve group carries the committed stage as arg #2
  const argBytes = rtxns[0].applicationCall.appArgs[2];
  const argStage = Number(new DataView(argBytes.buffer, argBytes.byteOffset, 8).getBigUint64(0, false));
  const pot = Number(meta.paidTotal);
  const fee = Math.floor(pot / 10000) * 500 + Math.floor(((pot % 10000) * 500) / 10000);
  const payout = pot - fee;
  const creator = enc(meta.creator);
  const pre = { winnerG: await gonnaBal(winner), treG: await gonnaBal(kit.TREASURY_ADDR), creatorA: await algoBal(creator) };
  const rr = await send(rtxns, W.DEPLOYER);
  const post = { winnerG: await gonnaBal(winner), treG: await gonnaBal(kit.TREASURY_ADDR), creatorA: await algoBal(creator) };
  const boxGone = (await kit.readMeta(cid)) === null && (await kit.readPlayers(cid)).length === 0;
  console.log(`  RESOLVE cid=${cid} txid=${rr.txid} round=${rr.round} winner=${winnerRole} payout=${payout / 1e6} GONNA fee=${fee / 1e6} GONNA`);
  ok(mode !== 1 || argStage === stage, `${label}: resolve group stage_idx arg = ${argStage} (committed ${stage})`);
  ok((post.winnerG ?? 0) - (pre.winnerG ?? 0) === payout, `${label}: winner GONNA delta == payout ${payout} (95%)`);
  ok((post.treG ?? 0) - (pre.treG ?? 0) === fee, `${label}: treasury GONNA delta == fee ${fee} (5%)`);
  ok(post.creatorA - pre.creatorA === MBR, `${label}: creator MBR refund == ${MBR} µALGO (got ${post.creatorA - pre.creatorA})`);
  ok(boxGone, `${label}: both boxes deleted after resolve`);
  return { txid: rr.txid, round: rr.round, stageIdx: argStage, winner: winnerRole, payout: payout / 1e6, fee: fee / 1e6 };
}

// close a live card LEGITIMATELY: fill seats, submit unsigned, resolve at the
// committed stage. seats_taken==0 -> early_close (1 ALGO anti-spam fee).
async function completeLiveCard(cid, committedStage, scores) {
  const meta = await kit.readMeta(cid);
  if (!meta) { console.log(`  cid=${cid}: already settled (boxes gone)`); return null; }
  const roster = await kit.readPlayers(cid);
  console.log(`  cid=${cid}: status=${meta.status} seats=${meta.seatsTaken}/${meta.seatsTotal} signed=[${roster.map((p) => p.signed).join(',')}] committed stage=${committedStage ?? 'NONE'}`);
  if (Number(meta.seatsTaken) === 0) {
    // creator-only early close: stake refunded, 1 ALGO anti-spam fee
    const r = await send(await kit.buildEarlyCloseGroup({ caller: addr('PLAYER_A'), cid }), W.PLAYER_A);
    console.log(`  EARLY_CLOSE cid=${cid} txid=${r.txid} round=${r.round}`);
    ok((await kit.readMeta(cid)) === null, `cid ${cid}: boxes deleted after early_close`);
    return { closed: 'early_close', txid: r.txid, round: r.round };
  }
  if (Number(meta.seatsTaken) < Number(meta.seatsTotal)) await joinSeat(cid, 'PLAYER_B', Number(meta.stake));
  const r2 = await kit.readPlayers(cid);
  for (let s = 0; s < r2.length; s++) {
    if (r2[s].signed) continue;
    const who = enc(r2[s].addr) === addr('PLAYER_A') ? 'PLAYER_A' : 'PLAYER_B';
    await submitScore(cid, who, s === 0 ? scores.scoreA : scores.scoreB);
  }
  return { closed: 'resolve', ...(await resolveCard(cid, committedStage, `cid ${cid}`)) };
}

// ============================ PHASE 0: funding ===============================
console.log('================ PHASE 0: funding check ================');
{
  // only resolves are planned (orphans 26/35 are joined + double-signed):
  // DEPLOYER pays ~10k µALGO per resolve group (6k call + 4x1k opup).
  const needD = 2 * 12_000 + 20_000;
  const dAlgo = await algoSpendable(addr('DEPLOYER'));
  const tAlgo = await algoSpendable(addr('TREASURY'));
  console.log(`  DEPLOYER spendable=${dAlgo / 1e6} ALGO (need ~${needD / 1e6})  TREASURY spendable=${tAlgo / 1e6} ALGO`);
  console.log(`  PLAYER_A spendable=${(await algoSpendable(addr('PLAYER_A'))) / 1e6} ALGO GONNA=${(await gonnaBal(addr('PLAYER_A'))) / 1e6}`);
  console.log(`  PLAYER_B spendable=${(await algoSpendable(addr('PLAYER_B'))) / 1e6} ALGO GONNA=${(await gonnaBal(addr('PLAYER_B'))) / 1e6}`);
  if (dAlgo < needD) {
    const sp = await algod.getTransactionParams().do();
    const amt = Math.min(Math.max(needD, 200_000), tAlgo - 2_000);
    if (amt < needD) throw new Error('TREASURY cannot cover the DEPLOYER top-up — refund TREASURY first');
    const r = await send([algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: addr('TREASURY'), receiver: addr('DEPLOYER'), amount: amt,
      suggestedParams: { ...sp, fee: 1000, flatFee: true },
    })], W.TREASURY);
    console.log(`  TREASURY->DEPLOYER top-up ${amt / 1e6} ALGO txid=${r.txid} round=${r.round}`);
    report.topups.push({ to: 'DEPLOYER', algo: amt / 1e6, txid: r.txid });
  } else {
    console.log('  DEPLOYER already funded — no top-up needed');
  }
}

// ============================ PHASE 1: recon + recovery ======================
console.log('\n================ PHASE 1: recon + indexer recovery ================');
const liveCids = await kit.scanChallengeIds();
console.log('  live cids (meta boxes):', JSON.stringify(liveCids));
const stagesScan = await kit.fetchArenaCreateStages({ force: true, maxPages: 20 });
console.log('  note scan cid->stage:', JSON.stringify(stagesScan));
const targets = [...new Set([...PLAN.map((p) => p.cid), ...Object.keys(ORPHAN_SCORES).map(Number)])];
const legs = await recoverLegs(targets);
for (const cid of targets.sort((x, y) => x - y)) console.log(`  recovered cid=${cid}:`, JSON.stringify(legs[cid]));

// cross-check the two independent mappings (sequential creates vs note scan)
for (const cid of targets) {
  const c = legs[cid]?.create;
  if (!c) { ok(false, `cid ${cid}: create call NOT found on-chain`); continue; }
  ok(c.noteStage !== null, `cid ${cid}: create txid ${c.txid} note decodes -> stage ${c.noteStage}`);
  ok(stagesScan[String(cid)] === c.noteStage, `cid ${cid}: sequential-mapping note stage ${c.noteStage} == watermark-scan stage ${stagesScan[String(cid)]}`);
}

// ====================== PHASE 2: orphan cleanup (legit) ======================
console.log('\n================ PHASE 2: orphan cleanup ================');
const orphans = Object.keys(ORPHAN_SCORES).map(Number).filter((cid) => liveCids.includes(cid));
if (!orphans.length) console.log('  no live orphans — nothing to clean up');
for (const cid of orphans) {
  const committed = stagesScan[String(cid)] ?? null;
  console.log(`\n-- orphan cid=${cid}: committed stage ${committed ?? 'NONE'} --`);
  if (committed === null) { ok(false, `cid ${cid}: no committed stage recoverable — refusing to resolve blind`); continue; }
  const res = await completeLiveCard(cid, committed, ORPHAN_SCORES[cid]);
  if (res) report.orphans.push({ cid, stage: committed, ...res });
  // fold the fresh legs into the recovery table for the final matrix
  if (res?.closed === 'resolve') legs[cid] = { ...legs[cid], resolve: { txid: res.txid, round: res.round, stageIdx: res.stageIdx } };
}

// ====================== PHASE 3: the 5-card matrix table =====================
console.log('\n================ PHASE 3: 5-card matrix proof ================');
for (const { stage, cid } of PLAN) {
  const L = legs[cid] ?? {};
  const committed = stagesScan[String(cid)] ?? null;
  console.log(`\n-- stage ${stage} (LV${stage + 1}) -> cid ${cid} --`);
  ok(committed === stage, `cid ${cid}: note scan stage = ${committed} (chosen ${stage})`);
  ok(L.create && L.create.noteStage === stage, `cid ${cid}: CREATE txid ${L.create?.txid ?? 'MISSING'} round ${L.create?.round ?? '?'} note decodes -> stage ${L.create?.noteStage ?? '?'}`);
  ok(!!L.join, `cid ${cid}: JOIN txid ${L.join?.txid ?? 'MISSING'} round ${L.join?.round ?? '?'}`);
  ok(!!L.submit, `cid ${cid}: SUBMIT txid ${L.submit?.txid ?? 'MISSING'} round ${L.submit?.round ?? '?'} score ${L.submit?.score ?? '?'}`);
  ok(!!L.resolve, `cid ${cid}: RESOLVE txid ${L.resolve?.txid ?? 'MISSING'} round ${L.resolve?.round ?? '?'}`);
  if (L.resolve) ok(L.resolve.stageIdx === stage, `cid ${cid}: resolve stage_idx arg = ${L.resolve.stageIdx} (committed ${stage})`);
  ok((await kit.readMeta(cid)) === null, `cid ${cid}: settled on-chain (meta box deleted)`);
  report.cards.push({ stage, cid, create: L.create ?? null, join: L.join ?? null, submit: L.submit ?? null, resolve: L.resolve ?? null });
}

console.log('\n================ FINAL TXID TABLE ================');
console.log('LV (chosen) | cid | create txid (note=gonna:v2:stage:K) | join txid | submit txid | resolve txid | resolve stage_idx');
for (const c of [...report.cards].sort((x, y) => x.stage - y.stage)) {
  console.log(`LV${c.stage + 1} | cid ${c.cid} | ${c.create?.txid ?? '-'} (stage ${c.create?.noteStage ?? '?'}) | ${c.join?.txid ?? '-'} | ${c.submit?.txid ?? '-'} | ${c.resolve?.txid ?? '-'} | ${c.resolve?.stageIdx ?? '?'}`);
}
if (report.orphans.length) {
  console.log('\norphan cleanup:');
  for (const o of report.orphans) console.log(`  cid ${o.cid} committed stage ${o.stage} -> ${o.closed} txid=${o.txid} round=${o.round}${o.winner ? ` winner=${o.winner} payout=${o.payout} GONNA fee=${o.fee} GONNA` : ''}`);
}
console.log(JSON.stringify({ topups: report.topups, checks: report.checks }, null, 2));
if (report.deviations.length) {
  console.log('\n*** DEVIATIONS (real bugs) ***\n - ' + report.deviations.filter(Boolean).join('\n - '));
} else {
  console.log('\nNO DEVIATIONS — all five chosen levels are committed in the create notes, were played, and resolved at the committed stage.');
}
process.exit(report.deviations.filter(Boolean).length ? 1 : 0);
