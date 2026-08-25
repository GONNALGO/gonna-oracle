// ============================================================================
// GONNAFIGHT ARENA — v16 SERVER-ORACLE E2E (Algorand TESTNET, app 769767443).
// Full lifecycle signed ONLY via the local HTTP oracle (localhost:8787) —
// NO local ed25519 oracle signing in this script. Player wallets sign their
// own txns (create/join/submit/resolve groups) exactly like the real client.
//
//   CARD A (duel)   : create PLAYER_B (stage mode, stageIdx 2, on-chain note)
//                     -> join PLAYER_A -> submit both via server -> verdict via
//                     server -> resolve -> exact legs (95/5, MBR 358200, boxes
//                     gone).
//   CARD B (5-seat) : create PLAYER_A (stageIdx 4) -> join PLAYER_B + ORACLE +
//                     TREASURY + DEPLOYER -> submit all via server (PLAYER_B's
//                     sig rides a PAID continue receipt) -> verdict -> resolve
//                     -> exact legs.
//   NEGATIVES       : wrong seat, wrong stageIdx, over-cap score, verdict on a
//                     non-resolvable card, continue receipt reuse. Every one
//                     must be refused with a reason string and NO on-chain tx.
//
// Run bodies are honest-per-M1: frames >= 600, durationSec coherent,
// seedLabel 'PIT-<cid>', build 'e2e-v16', input-log v1 attached to submits.
//
// Mnemonics are NEVER printed. Live txids/rounds ARE (audit trail).
// Usage: node scripts/sim-v16-e2e.mjs
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY = path.join(ROOT, 'contracts/quantum-arena/deploy');
const BASE = process.env.ORACLE_URL ?? 'http://localhost:8787';
const BUILD = 'e2e-v16';

// ---- bundle the chain mirror (same .tmp-kit pattern as sim-multiplayer) ----
const KIT_OUT = path.join(ROOT, '.tmp-kit-v16e2e.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--outfile=${KIT_OUT}`], { cwd: ROOT, stdio: 'pipe' });
const kit = await import(KIT_OUT);
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));

// ---- keys (never printed) ----------------------------------------------------
if (!existsSync(DEPLOY + '/testnet.secrets.json')) throw new Error('missing deploy/testnet.secrets.json (gitignored QA keys)');
const secrets = JSON.parse(readFileSync(DEPLOY + '/testnet.secrets.json', 'utf8'));
const W = {};
for (const role of ['DEPLOYER', 'TREASURY', 'ORACLE', 'PLAYER_A', 'PLAYER_B']) {
  W[role] = algosdk.mnemonicToSecretKey(secrets[role].mnemonic);
}
const addr = (role) => W[role].addr.toString();
const algod = await kit.algodClient();

const STAKE = 1_000_000; // 1 GONNA a seat
const MBR = 358_200; // v2 CHALLENGE_MBR
const STATUS = ['OPEN', 'CLOSED(full)', 'RESOLVED', 'REFUNDED', 'FORFEIT'];
const enc = (pk) => algosdk.encodeAddress(pk instanceof Uint8Array ? pk : Uint8Array.from(pk));
const short = (a) => a.slice(0, 8) + '..' + a.slice(-4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = { txids: {}, negatives: [], deviations: [], checks: { passed: 0, failed: 0 } };
function ok(cond, label) {
  report.checks[cond ? 'passed' : 'failed']++;
  if (!cond) report.deviations.push(label);
  console.log(`  ${cond ? 'PASS' : 'FAIL-DEVIATION'} ${label}`);
}

// ---- chain helpers -----------------------------------------------------------
const gonnaBal = async (a) => {
  const i = await algod.accountInformation(a).do();
  const h = (i.assets ?? []).find((x) => Number(x.assetId ?? x['asset-id']) === kit.GONNA_ASA_TESTNET);
  return h ? Number(h.amount) : null; // null = not opted
};
const algoBal = async (a) => Number((await algod.accountInformation(a).do()).amount);

async function send(txns, signers) {
  algosdk.assignGroupID(txns);
  const signed = txns.map((t, i) => t.signTxn((Array.isArray(signers) ? signers[i] : signers).sk));
  const r = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, r.txid, 10);
  const info = await algod.pendingTransactionInformation(r.txid).do();
  return { txid: r.txid, round: Number(info.confirmedRound ?? info['confirmed-round'] ?? 0), info };
}

// decode close events from a confirmed appl txn's logs (same as sim-multiplayer)
function decodeCloseEvents(info) {
  const logs = (info.logs ?? []).map((l) => Uint8Array.from(Buffer.from(l, 'base64')));
  const out = [];
  const hex4 = (b) => [...b.slice(0, 4)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const u64At = (b, off) => Number(new DataView(b.buffer, b.byteOffset + off, 8).getBigUint64(0, false));
  const ZERO = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
  for (const b of logs) {
    if (b.length < 12) continue;
    const sel = hex4(b);
    if (sel === 'ae488dc6' || sel === '24d3dd8b') {
      const winnerRaw = algosdk.encodeAddress(b.slice(12, 44));
      out.push({ kind: sel === 'ae488dc6' ? 'ChallengeResolved' : 'ChallengeForfeited', cid: u64At(b, 4), winner: winnerRaw === ZERO ? null : winnerRaw, payout: u64At(b, 44), fee: u64At(b, 52) });
    } else if (sel === '0bfda53a') {
      out.push({ kind: 'ChallengeRefunded', cid: u64At(b, 4), reason: u64At(b, 12) });
    }
  }
  return out;
}

// ---- HTTP oracle client (mirrors src/game/arena/oracleClient.ts semantics) ---
async function oraclePost(p, body, { retriesOn503 = 0 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + p, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 503 && attempt < retriesOn503) {
      console.log(`  (503 ${json.error ?? ''} — indexer lag, retry ${attempt + 1}/${retriesOn503} in 8s)`);
      await sleep(8000);
      continue;
    }
    return { status: res.status, json };
  }
}
const b64ToBytes = (s) => Uint8Array.from(Buffer.from(s, 'base64'));

// ---- honest run bodies (SPEC §3.2 rule 4 + §5 input-log v1) ------------------
function encodeInputLog({ build, seedLabel, frames }, masks) {
  const enc8 = new TextEncoder();
  const b = enc8.encode(build), s = enc8.encode(seedLabel);
  const out = new Uint8Array(3 + 1 + 1 + 2 + b.length + 2 + s.length + 4 + frames);
  const dv = new DataView(out.buffer);
  out.set([0x47, 0x49, 0x4c, 1, 0], 0); // 'GIL', v1, flags=0
  dv.setUint16(5, b.length, false); out.set(b, 7);
  const p2 = 7 + b.length;
  dv.setUint16(p2, s.length, false); out.set(s, p2 + 2);
  const p3 = p2 + 2 + s.length;
  dv.setUint32(p3, frames, false);
  out.set(masks.subarray(0, frames), p3 + 4);
  return out;
}
function honestRun(cid, seat, withLog) {
  // 1-minute sealed run at 60fps: frames 3600, duration 62s (>= frames/60*0.5)
  const frames = 3600, durationSec = 62;
  const seedLabel = `PIT-${cid}`;
  const run = { seedLabel, frames, durationSec };
  if (withLog) {
    // deterministic pseudo-input stream (structurally valid v1 log)
    const masks = new Uint8Array(frames);
    let x = (cid * 31 + seat * 7) & 0xff;
    for (let i = 0; i < frames; i++) { x = (x * 1103515245 + 12345) & 0xff; masks[i] = x & 0x3f; }
    run.inputLogB64 = Buffer.from(encodeInputLog({ build: BUILD, seedLabel, frames }, masks)).toString('base64');
  }
  return run;
}

// server-signed score -> sig bytes (expects 200; throws otherwise)
async function serverSignScore({ cid, seat, role, score, stageMode, stageIdx, withLog = true, continueRef }) {
  const body = { cid, seat, addr: addr(role), score, stageMode, build: BUILD, run: honestRun(cid, seat, withLog) };
  if (stageMode === 'stage') body.stageIdx = stageIdx;
  if (continueRef) body.continueRef = continueRef;
  const r = await oraclePost('/v1/sign-score', body, { retriesOn503: 6 });
  if (r.status !== 200) throw new Error(`sign-score cid=${cid} seat=${seat} ${role} refused: ${r.status} ${r.json.error ?? ''}`);
  return b64ToBytes(r.json.sigB64);
}

// a negative that MUST be refused (4xx/409, reason string, no on-chain tx)
async function expectRefusal(label, p, body, wantStatus, wantReason) {
  const r = await oraclePost(p, body);
  const reason = r.json.error ?? '';
  const pass = r.status === wantStatus && reason.includes(wantReason);
  report.negatives.push({ label, status: r.status, reason });
  ok(pass, `NEG ${label}: HTTP ${r.status} reason="${reason}" (want ${wantStatus} ~"${wantReason}") — no tx sent`);
}

// ============================ PRE-FLIGHT =====================================
{
  const h = await fetch(BASE + '/v1/health').then((r) => r.json()).catch(() => null);
  if (!h?.ok || h.appId !== kit.ARENA_APP_ID) throw new Error('oracle server not healthy at ' + BASE);
  console.log(`oracle server healthy: network=${h.network} appId=${h.appId} oracle=${short(h.oracleAddr)}`);
  ok(h.oracleAddr === addr('ORACLE'), 'health: server oracle addr == QA ORACLE wallet addr (boot assert)');
}
const next0 = await kit.nextChallengeId();
console.log(`app ${kit.ARENA_APP_ID} version=${await kit.contractVersion()} next_challenge_id=${next0}`);

// ---- PHASE 0.5: settle EXPIRED QA-only leftovers (recover MBR + stakes) -----
// Previous QA runs left expired cards whose MBR (358200 µALGO each) is locked.
// QA wallets are ALGO-thin and the old testnet dispenser is dead, so we settle
// them first: claim() 0-joiner expired cards (creator-only) and claim_forfeit
// expired duels with an unsigned joiner (signed QA player calls). Cards with
// ANY non-QA address (e.g. real players) are NEVER touched.
console.log('\n================ PHASE 0.5: expired QA-leftover cleanup ================');
{
  const QA = new Set(Object.keys(W).map((r) => addr(r)));
  const roleOf = (a2) => Object.keys(W).find((r) => addr(r) === a2);
  for (const cid of await kit.scanChallengeIds()) {
    const m = await kit.readMeta(cid);
    if (!m) continue;
    const roster = await kit.readPlayers(cid);
    const creator = enc(m.creator);
    const expired = Math.floor(Date.now() / 1000) >= Number(m.deadline);
    const allQA = QA.has(creator) && roster.every((p) => QA.has(enc(p.addr)));
    if (!expired || !allQA) {
      console.log(`  cid ${cid}: skip (expired=${expired} allQA=${allQA})`);
      continue;
    }
    if (Number(m.seatsTaken) === 0 && QA.has(creator)) {
      const r = await send(await kit.buildClaimGroup({ caller: creator, cid }), W[roleOf(creator)]);
      console.log(`  CLAIM cid=${cid} (0 joiners, expired) by ${roleOf(creator)} txid=${r.txid} round=${r.round}`);
      (report.txids.cleanup ??= []).push(r.txid);
    } else if (roster.length === 2) {
      const signedIdx = roster.findIndex((p) => p.signed);
      const unsignedIdx = roster.findIndex((p) => !p.signed);
      const sRole = signedIdx >= 0 ? roleOf(enc(roster[signedIdx].addr)) : undefined;
      if (sRole && unsignedIdx >= 0) {
        const r = await send(await kit.buildClaimForfeitGroup({ caller: addr(sRole), cid, seat: unsignedIdx }), W[sRole]);
        const evs = decodeCloseEvents(r.info);
        for (const e of evs) console.log(`  event ${e.kind} cid=${e.cid} winner=${e.winner ? short(e.winner) : 'ZERO'} payout=${e.payout ?? '-'} fee=${e.fee ?? '-'}`);
        console.log(`  FORFEIT cid=${cid} seat=${unsignedIdx} by ${sRole} txid=${r.txid} round=${r.round}`);
        (report.txids.cleanup ??= []).push(r.txid);
      } else {
        console.log(`  cid ${cid}: no forfeit angle (signed=${signedIdx} unsigned=${unsignedIdx}) — left`);
      }
    } else {
      console.log(`  cid ${cid}: multi-seat partial table — left for deadline flows`);
    }
  }
}

// ---- funding check (top-up small, from TREASURY, like past sims) -------------
console.log('\n================ QA funding check ================');
{
  const need = [];
  for (const role of ['PLAYER_A', 'PLAYER_B', 'ORACLE', 'TREASURY', 'DEPLOYER']) {
    const a = await algoBal(addr(role));
    const g = await gonnaBal(addr(role));
    console.log(`  ${role.padEnd(9)} ${short(addr(role))} ALGO=${(a / 1e6).toFixed(3)} GONNA=${g === null ? 'NOT-OPTED' : (g / 1e6).toFixed(1)}`);
    if (g === null) need.push({ role, kind: 'optin' });
    if ((g ?? 0) < 2 * STAKE) need.push({ role, kind: 'gonna' });
  }
  if (need.length) {
    // GONNA source: DEPLOYER (ASA creator, holds the supply; its ALGO is
    // min-balance bound). Opt-ins are signed by the wallet itself.
    const sp = await algod.getTransactionParams().do();
    const mk = (o) => ({ ...sp, fee: 1000, flatFee: true, ...o });
    const txns = [], signers = [];
    for (const n of need) {
      if (n.kind === 'optin') { txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: addr(n.role), receiver: addr(n.role), assetIndex: kit.GONNA_ASA_TESTNET, amount: 0, suggestedParams: mk({}) })); signers.push(W[n.role]); }
      if (n.kind === 'gonna') { txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: addr('DEPLOYER'), receiver: addr(n.role), assetIndex: kit.GONNA_ASA_TESTNET, amount: 3 * STAKE, suggestedParams: mk({}) })); signers.push(W.DEPLOYER); }
    }
    const r = await send(txns, signers);
    console.log(`  GONNA top-up txid=${r.txid} round=${r.round}`);
    report.txids.topup = r.txid;
  } else console.log('  all QA wallets GONNA-funded — no top-up needed');

  // ---- continue-flow pooling (QA wallets are ALGO-thin; no live dispenser):
  // PLAYER_B pays the flat 5 ALGO continue to TREASURY in CARD B. Pool micro
  // top-ups from the other wallets, each keeping a floor that covers its own
  // remaining fees + min balance (PLAYER_A: CARD B create MBR + CARD A join;
  // DEPLOYER: resolve caller fees + its app/ASA min). The 5 ALGO lands in
  // TREASURY, so the pool only loses fees overall.
  const CONTINUE_PAYER = 'PLAYER_B';
  const WANT = 5_350_000;
  const FLOORS = { PLAYER_A: 570_000, ORACLE: 265_000, TREASURY: 206_000, DEPLOYER: 1_218_500 };
  let bBal = await algoBal(addr(CONTINUE_PAYER));
  if (bBal < WANT) {
    const sp = await algod.getTransactionParams().do();
    const mk = (o) => ({ ...sp, fee: 1000, flatFee: true, ...o });
    const txns = [], signers = [];
    for (const [role, floor] of Object.entries(FLOORS)) {
      if (bBal >= WANT) break;
      const avail = Math.max(0, (await algoBal(addr(role))) - floor);
      const give = Math.min(avail, WANT - bBal);
      if (give > 0) {
        txns.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: addr(role), receiver: addr(CONTINUE_PAYER), amount: give, suggestedParams: mk({}) }));
        signers.push(W[role]);
        bBal += give;
      }
    }
    if (bBal < WANT) throw new Error(`QA ALGO pool too thin for the 5-ALGO continue (have ${bBal})`);
    const r = await send(txns, signers);
    console.log(`  continue pooling -> PLAYER_B txid=${r.txid} round=${r.round} (PLAYER_B now ${(bBal / 1e6).toFixed(3)} ALGO)`);
    report.txids.pooling = r.txid;
  } else console.log('  PLAYER_B already funded for the 5-ALGO continue');
}

// ---- shared submit / verdict / resolve flows ---------------------------------
async function submitViaServer(cid, role, score, stageIdx, opts = {}) {
  const roster = await kit.readPlayers(cid);
  const seat = roster.findIndex((p) => enc(p.addr) === addr(role));
  if (seat < 0) throw new Error(`${role} not on cid ${cid}`);
  const sig = await serverSignScore({ cid, seat, role, score, stageMode: 'stage', stageIdx, withLog: true, continueRef: opts.continueRef });
  const txns = await kit.buildSubmitGroup({ player: addr(role), cid, score, sig });
  const r = await send(txns, W[role]);
  console.log(`  submit cid=${cid} seat=${seat} ${role} score=${score}${opts.continueRef ? ' (continue ' + opts.continueRef + ')' : ''} txid=${r.txid} round=${r.round}`);
  return r;
}

async function verdictAndResolve(cid, callerRole, expectStageIdx, label) {
  const meta = await kit.readMeta(cid);
  const roster = await kit.readPlayers(cid);
  const signed = roster.map((p, i) => ({ seat: i, addr: p.addr, score: Number(p.score), signed: p.signed })).filter((e) => e.signed);
  const top = signed.reduce((a, b) => (b.score > a.score ? b : a));
  const tie = signed.filter((e) => e.score === top.score).length > 1;
  const winner = enc(top.addr);

  // verdict via the SERVER (chain-derived)
  const v = await oraclePost('/v1/verdict', { cid }, { retriesOn503: 6 });
  if (v.status !== 200) throw new Error(`verdict cid=${cid} refused: ${v.status} ${v.json.error ?? ''}`);
  console.log(`  verdict cid=${cid}: stageMode=${v.json.stageMode} stageIdx=${v.json.stageIdx} playerCount=${v.json.playerCount}`);
  ok(v.json.stageMode === 'stage' && v.json.stageIdx === expectStageIdx, `${label}: server verdict stage_idx=${v.json.stageIdx} == create-note stage ${expectStageIdx}`);
  ok(v.json.playerCount === signed.length, `${label}: verdict playerCount=${v.json.playerCount} == signed roster ${signed.length}`);

  // independent on-chain cross-check: indexer note scan == verdict stage
  const stages = await kit.fetchArenaCreateStages({ force: true }).catch(() => null);
  const noteStage = stages ? (stages[String(cid)] ?? null) : null;
  ok(noteStage === expectStageIdx, `${label}: indexer create-note stage=${noteStage} == ${expectStageIdx} (verdict bound to the note)`);

  const verdictSig = b64ToBytes(v.json.verdictSigB64);
  const pot = Number(meta.paidTotal);
  const fee = Math.floor(pot / 10000) * 500 + Math.floor(((pot % 10000) * 500) / 10000);
  const payout = pot - fee;
  const creator = enc(meta.creator);
  const pre = {
    winnerG: await gonnaBal(winner),
    treG: await gonnaBal(kit.TREASURY_ADDR),
    creatorA: await algoBal(creator),
  };
  const txns = await kit.buildResolveGroup({ caller: addr(callerRole), cid, stageIdx: v.json.stageIdx, seedReveal: new Uint8Array(0), verdictSig, winner, tie });
  const r = await send(txns, W[callerRole]);
  const events = decodeCloseEvents(r.info);
  const post = {
    winnerG: await gonnaBal(winner),
    treG: await gonnaBal(kit.TREASURY_ADDR),
    creatorA: await algoBal(creator),
  };
  const boxGone = (await kit.readMeta(cid)) === null && (await kit.readPlayers(cid)).length === 0;
  console.log(`  RESOLVED cid=${cid} txid=${r.txid} round=${r.round}`);
  for (const e of events) console.log(`  event ${e.kind} cid=${e.cid} winner=${e.winner ? short(e.winner) : 'ZERO(tie)'} payout=${e.payout ?? '-'} fee=${e.fee ?? '-'}`);
  const ev = events.find((e) => e.kind === 'ChallengeResolved' && e.cid === cid);
  ok(!!ev, `${label}: ChallengeResolved event logged for cid ${cid}`);
  if (ev) {
    ok(ev.winner === winner, `${label}: event winner = ${short(winner)}`);
    ok(ev.payout === payout && ev.fee === fee, `${label}: event payout=${payout} fee=${fee} (95/5 of pot ${pot})`);
  }
  const wDelta = (post.winnerG ?? 0) - (pre.winnerG ?? 0);
  ok(wDelta === payout, `${label}: winner GONNA delta ${wDelta} == payout ${payout} (${short(winner)})`);
  const tDelta = (post.treG ?? 0) - (pre.treG ?? 0);
  ok(tDelta === fee, `${label}: treasury GONNA delta ${tDelta} == fee ${fee}`);
  const mbrDelta = post.creatorA - pre.creatorA;
  ok(mbrDelta === MBR, `${label}: creator MBR refund delta ${mbrDelta} µALGO == ${MBR} (${short(creator)})`);
  ok(boxGone, `${label}: both boxes deleted after resolve`);
  return { txid: r.txid, round: r.round, winner, payout, fee };
}

// ============================ CARD A — DUEL ====================================
console.log('\n================ CARD A: DUEL (create PLAYER_B stage 2, join PLAYER_A) ================');
const cidA = await kit.nextChallengeId();
const scoreA = { creator: 8200, joiner: 9100 }; // PLAYER_A (joiner) wins
{
  const sig0 = await serverSignScore({ cid: cidA, seat: 0, role: 'PLAYER_B', score: scoreA.creator, stageMode: 'stage', stageIdx: 2, withLog: true });
  const txns = await kit.buildCreateGroup({
    creator: addr('PLAYER_B'), cid: cidA, stakeBase: STAKE, seats: 1, durationSecs: 86400,
    stageMode: 1, creatorScore: scoreA.creator, creatorScoreSig: sig0, stageIdx: 2,
  });
  const r = await send(txns, W.PLAYER_B);
  console.log(`  CREATE cid=${cidA} PLAYER_B stage-mode stageIdx=2 (note gonna:v2:stage:2) txid=${r.txid} round=${r.round}`);
  report.txids.cardA = { cid: cidA, create: r.txid };
  const m0 = await kit.readMeta(cidA);
  ok(m0 && Number(m0.status) === 0 && Number(m0.stageMode) === 1, `CARD A: created OPEN, stage mode (${STATUS[Number(m0?.status ?? 9)]})`);

  // NEG 4: verdict on a non-resolvable card (joiner seat empty, not signed)
  await expectRefusal('verdict non-resolvable card', '/v1/verdict', { cid: cidA }, 409, 'not resolvable yet');

  // join
  const jr = await send(await kit.buildJoinGroup({ joiner: addr('PLAYER_A'), cid: cidA, stakeBase: STAKE }), W.PLAYER_A);
  console.log(`  JOIN cid=${cidA} PLAYER_A txid=${jr.txid} round=${jr.round}`);
  report.txids.cardA.join = jr.txid;

  // NEG 1: seat not own (PLAYER_B asking for seat 1 = PLAYER_A's seat)
  await expectRefusal('sign-score wrong seat', '/v1/sign-score',
    { cid: cidA, seat: 1, addr: addr('PLAYER_B'), score: 1000, stageMode: 'stage', stageIdx: 2, build: BUILD, run: honestRun(cidA, 1, false) },
    400, 'addr does not occupy this seat');
  // NEG 2: stageIdx different from the committed note (note says 2)
  await expectRefusal('sign-score stageIdx != note', '/v1/sign-score',
    { cid: cidA, seat: 1, addr: addr('PLAYER_A'), score: 1000, stageMode: 'stage', stageIdx: 3, build: BUILD, run: honestRun(cidA, 1, false) },
    400, 'stageIdx does not match the create-note commitment');
  // NEG 3: score above the stage cap (500000)
  await expectRefusal('sign-score over cap', '/v1/sign-score',
    { cid: cidA, seat: 1, addr: addr('PLAYER_A'), score: 500_001, stageMode: 'stage', stageIdx: 2, build: BUILD, run: honestRun(cidA, 1, false) },
    400, 'score above cap');

  // joiner submits via the SERVER (stage binding checked against the note)
  const sr = await submitViaServer(cidA, 'PLAYER_A', scoreA.joiner, 2);
  report.txids.cardA.submit = sr.txid;

  // verdict via the SERVER + resolve
  const res = await verdictAndResolve(cidA, 'DEPLOYER', 2, 'CARD A');
  report.txids.cardA.resolve = res.txid;
  report.txids.cardA.round = res.round;
  report.txids.cardA.winner = res.winner;
}

// ============================ CARD B — 5-SEAT ==================================
console.log('\n================ CARD B: 5-SEAT (create PLAYER_A stage 4, join B+ORACLE+TREASURY+DEPLOYER) ================');
const cidB = await kit.nextChallengeId();
const scoresB = { PLAYER_A: 5000, PLAYER_B: 9000, ORACLE: 8000, TREASURY: 3000, DEPLOYER: 1000 }; // PLAYER_B wins
{
  const sig0 = await serverSignScore({ cid: cidB, seat: 0, role: 'PLAYER_A', score: scoresB.PLAYER_A, stageMode: 'stage', stageIdx: 4, withLog: true });
  const txns = await kit.buildCreateGroup({
    creator: addr('PLAYER_A'), cid: cidB, stakeBase: STAKE, seats: 4, durationSecs: 86400,
    stageMode: 1, creatorScore: scoresB.PLAYER_A, creatorScoreSig: sig0, stageIdx: 4,
  });
  const r = await send(txns, W.PLAYER_A);
  console.log(`  CREATE cid=${cidB} PLAYER_A stage-mode stageIdx=4 (note gonna:v2:stage:4) txid=${r.txid} round=${r.round}`);
  report.txids.cardB = { cid: cidB, create: r.txid };
  const m0 = await kit.readMeta(cidB);
  ok(m0 && Number(m0.status) === 0 && Number(m0.stageMode) === 1 && Number(m0.seatsTotal) === 4, 'CARD B: created OPEN, stage mode, 4 joiner seats');

  for (const role of ['PLAYER_B', 'ORACLE', 'TREASURY', 'DEPLOYER']) {
    const jr = await send(await kit.buildJoinGroup({ joiner: addr(role), cid: cidB, stakeBase: STAKE }), W[role]);
    console.log(`  JOIN cid=${cidB} ${role} txid=${jr.txid} round=${jr.round}`);
    (report.txids.cardB.joins ??= {})[role] = jr.txid;
  }
  const mF = await kit.readMeta(cidB);
  ok(Number(mF.seatsTaken) === 4 && Number(mF.status) === 1, 'CARD B: table CLOSED(full) at 4/4 joiner seats');

  // ---- continue flow for PLAYER_B (SPEC §3.4 + §3.2 rule 5) ----
  const refId = `E2EV16-${cidB}-B`;
  const note = new TextEncoder().encode(`QA-CONTINUE|${refId}|${addr('PLAYER_B')}`);
  const sp = await algod.getTransactionParams().do();
  const pay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: addr('PLAYER_B'), receiver: kit.TREASURY_ADDR, amount: 5_000_000, note,
    suggestedParams: { ...sp, fee: 1000, flatFee: true },
  });
  const cr = await send([pay], W.PLAYER_B);
  console.log(`  CONTINUE pay 5 ALGO ref=${refId} txid=${cr.txid} round=${cr.round}`);
  report.txids.cardB.continuePay = cr.txid;
  const reg = await oraclePost('/v1/continue/receipt', { refId, addr: addr('PLAYER_B'), txid: cr.txid });
  ok(reg.status === 200 && reg.json.ok === true, `CARD B: continue receipt registered (HTTP ${reg.status})`);
  // NEG 5b: re-registering the same receipt must 409
  await expectRefusal('continue receipt re-register', '/v1/continue/receipt', { refId, addr: addr('PLAYER_B'), txid: cr.txid }, 409, 'receipt already registered');

  // submits via the SERVER (PLAYER_B's sig consumes the receipt atomically)
  const srB = await submitViaServer(cidB, 'PLAYER_B', scoresB.PLAYER_B, 4, { continueRef: refId });
  report.txids.cardB.submits = { PLAYER_B: srB.txid };
  // NEG 5: the consumed receipt cannot sign again
  await expectRefusal('continue receipt reuse', '/v1/sign-score',
    { cid: cidB, seat: 1, addr: addr('PLAYER_B'), score: 9500, stageMode: 'stage', stageIdx: 4, build: BUILD, run: honestRun(cidB, 1, false), continueRef: refId },
    409, 'continue receipt already consumed');

  for (const role of ['ORACLE', 'TREASURY', 'DEPLOYER']) {
    const sr = await submitViaServer(cidB, role, scoresB[role], 4);
    report.txids.cardB.submits[role] = sr.txid;
  }

  const res = await verdictAndResolve(cidB, 'DEPLOYER', 4, 'CARD B');
  report.txids.cardB.resolve = res.txid;
  report.txids.cardB.round = res.round;
  report.txids.cardB.winner = res.winner;
}

// ============================ INDEXER CROSS-CHECK ==============================
console.log('\n================ EVENT-LOG cross-check (indexer, kit.fetchArenaCloseEvents) ================');
let evs = [];
for (let tries = 0; tries < 6; tries++) {
  try {
    evs = await kit.fetchArenaCloseEvents(3);
    if ([cidA, cidB].every((c) => evs.some((e) => e.cid === c && e.kind === 'resolved'))) break;
  } catch (e) { console.log('  indexer not ready: ' + e.message); }
  await sleep(8000);
}
for (const c of [cidA, cidB]) {
  const e = evs.find((x) => x.cid === c && x.kind === 'resolved');
  ok(!!e, `event-log: indexer lists ChallengeResolved for cid ${c}${e ? ` (winner=${e.winner ? short(e.winner) : 'tie'} payout=${e.payout} fee=${e.fee} round=${e.round})` : ''}`);
}

console.log('\n================ SUMMARY ================');
console.log(JSON.stringify({ txids: report.txids, negatives: report.negatives, checks: report.checks }, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
if (report.deviations.length) {
  console.log('\n*** DEVIATIONS ***\n - ' + report.deviations.join('\n - '));
} else {
  console.log('\nNO DEVIATIONS — every leg matched on-chain reality; all negatives refused server-side.');
}
process.exit(report.deviations.length ? 1 : 0);
