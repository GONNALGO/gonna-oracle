// ============================================================================
// GONNAFIGHT ARENA — v16.1 M2 SERVER-ORACLE E2E (Algorand TESTNET, app
// 769767443). Full lifecycle signed ONLY via the local HTTP oracle
// (localhost:8787) WITH M2 REPLAY VERIFICATION ON: every score is the output
// of an HONEST headless run recorded through the REAL client path
// (startArenaRun / debugFullRun + the v16.1 play-scene recorder), sealed as a
// GIL v2 log and replay-verified by the server before any signature.
//
//   CARD A (duel, STAGE mode): create PLAYER_B (stage 2, on-chain note) ->
//     join PLAYER_A -> both runs recorded+replayed (PIT-<cid>) -> verdict ->
//     resolve -> exact legs (95/5, MBR 358200, boxes gone).
//   CARD B (5-seat, FULL mode): create PLAYER_A -> join PLAYER_B + ORACLE +
//     TREASURY + DEPLOYER -> five seeded campaign runs (RUN-<cid>) recorded+
//     replayed -> verdict -> resolve -> exact legs. PLAYER_B's sig rides a
//     PAID continue receipt.
//   NEGATIVES: wrong seat, wrong stageIdx, over-cap score, verdict on a
//     non-resolvable card, INFLATED SCORE -> REPLAY MISMATCH (M2), continue
//     receipt reuse. All refused server-side, no on-chain tx.
//
// Mnemonics are NEVER printed. Live txids/rounds ARE (audit trail).
// Usage: node scripts/sim-v16-e2e.mjs   (oracle server on :8787 with
//        REPLAY_ENFORCE=1 and the vb1d23c1a bundle — default config)
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as replay from '../oracle-server/replay/replay.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// QA keys are gitignored: in a worktree point QA_DEPLOY_DIR at the shared
// repo's deploy dir (secrets never enter this tree).
const DEPLOY = process.env.QA_DEPLOY_DIR ?? path.join(ROOT, 'contracts/quantum-arena/deploy');
const BASE = process.env.ORACLE_URL ?? 'http://localhost:8787';
// the pinned engine bundle the server verifies against (replay-bundles/)
const BUILD = 'vb1d23c1a';

// ---- bundle the chain mirror (same .tmp-kit pattern as sim-multiplayer) ----
const KIT_OUT = path.join(ROOT, '.tmp-kit-v16e2e.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--define:import.meta.env={"DEV":false,"PROD":true,"VITE_QA_ORACLE":""}`,
  `--outfile=${KIT_OUT}`], { cwd: ROOT, stdio: 'pipe' });
const kit = await import(KIT_OUT);
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));
const eng = await replay.loadBundle(BUILD); // pinned v16.1 engine bundle

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

// ---- HTTP oracle client --------------------------------------------------------
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

// ---- HONEST RUNS: real client path + recorder -> GIL v2 + replayed score -----
const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'];

// scripted brawl stream (levels), same rhythm as test-v1610 brawlMasks
function brawlStream(n, phase = 0) {
  const m = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    let v = 8;
    const q = (f + phase) % 90;
    if (q >= 30 && q < 60) v = 0;
    if (q === 34 || q === 42 || q === 68) v |= 16;
    if (q === 58) v |= 32;
    if (q === 70) v |= 64;
    m[f] = v;
  }
  return m;
}

// Play a run EXACTLY like the live client: boot via the arena entries, feed
// the input stream every step; the v16.1 recorder captures PLAY frames only.
// Returns the sealed/recorded GIL v2 log + the score the client would submit.
function playHonestRun({ stageMode, stageIdx, seedLabel, frames = 7200, phase = 0 }) {
  const game = replay.bootGame(eng);
  if (stageMode === 'stage') replay.startStageRun(game, stageIdx, seedLabel);
  else replay.startFullRunSeeded(eng, game, seedLabel);
  const stream = brawlStream(frames, phase);
  const down = game.input.down;
  const pressed = game.input.pressed;
  for (let f = 0; f < stream.length && game.inputLogMasks; f++) {
    const m = stream[f];
    for (let b = 0; b < 8; b++) {
      const v = ((m >> b) & 1) === 1;
      if (v && !down[BTNS[b]]) pressed[BTNS[b]] = true;
      down[BTNS[b]] = v;
    }
    game.step();
  }
  const sealed = game.arena?.sealedRun;
  if (sealed?.inputLogB64) {
    return { inputLogB64: sealed.inputLogB64, score: game.score, frames: sealed.frames, seedLabel, sealed: true };
  }
  const n = game.inputLogFrames;
  const masks = Uint8Array.from(game.inputLogMasks.subarray(0, n));
  return {
    inputLogB64: eng.encodeInputLogB64({ v: 2, build: BUILD, seedLabel, frames: n, truncated: false, masks }),
    score: game.score, frames: n, seedLabel, sealed: false,
  };
}

// FROZEN-CONTRACT BUG GUARD: a perfect tie at the top score BRICKS resolve
// (resolve deletes both boxes, then the tie branch lazily box_extracts the
// deleted players box — QuantumArena.approval.teal:3036-3090). cid 56 proved
// it on-chain. Runs are deterministic, so we PRE-COMPUTE and re-roll the
// input stream (phase) until the top score is unique. All runs stay honest.
function tieSafePhase({ stageMode, stageIdx, seedLabel, phase, bannedTop }) {
  let p = phase;
  for (let tries = 0; tries < 40; tries++) {
    const run = playHonestRun({ stageMode, stageIdx, seedLabel, phase: p });
    if (run.score !== bannedTop) return { run, phase: p };
    p += 13;
  }
  throw new Error('tie-guard: could not find a non-tying run');
}

// server-signed score for an honestly played run (expects 200)
async function serverSignScore({ cid, seat, role, stageMode, stageIdx, continueRef, phase = 0, bannedTop = -1 }) {
  const seedLabel = stageMode === 'stage' ? `PIT-${cid}` : `RUN-${cid}`;
  const { run } = tieSafePhase({ stageMode, stageIdx, seedLabel, phase, bannedTop });
  const body = {
    cid, seat, addr: addr(role), score: run.score, stageMode, build: BUILD,
    run: { seedLabel, frames: run.frames, durationSec: Math.ceil(run.frames / 60) + 2, inputLogB64: run.inputLogB64 },
  };
  if (stageMode === 'stage') body.stageIdx = stageIdx;
  if (continueRef) body.continueRef = continueRef;
  const r = await oraclePost('/v1/sign-score', body, { retriesOn503: 6 });
  if (r.status !== 200) throw new Error(`sign-score cid=${cid} seat=${seat} ${role} refused: ${r.status} ${r.json.error ?? ''}`);
  console.log(`    run ${seedLabel} ${role}: ${run.frames} play frames${run.sealed ? ' (sealed by death)' : ''}, replay-verified score ${run.score}`);
  return { sig: b64ToBytes(r.json.sigB64), score: run.score };
}

// a negative that MUST be refused (4xx/409/500, reason string, no on-chain tx)
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
console.log(`app ${kit.ARENA_APP_ID} version=${await kit.contractVersion()} next_challenge_id=${next0} build=${BUILD} (replay bundle pinned)`);

// ---- PHASE 0.5: settle EXPIRED QA-only leftovers (recover MBR + stakes) -----
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

// ---- funding check -----------------------------------------------------------
console.log('\n================ QA funding check ================');
{
  const need = [];
  for (const role of ['PLAYER_A', 'PLAYER_B', 'ORACLE', 'TREASURY', 'DEPLOYER']) {
    const a = await algoBal(addr(role));
    const g = await gonnaBal(addr(role));
    console.log(`  ${role.padEnd(9)} ${short(addr(role))} ALGO=${(a / 1e6).toFixed(3)} GONNA=${g === null ? 'NOT-OPTED' : (g / 1e6).toFixed(1)}`);
    if (a < 900_000) need.push({ role, kind: 'algo' }); // join+submit fees + create MBR 358200 + min balance
    if (g === null) need.push({ role, kind: 'optin' });
    if ((g ?? 0) < 2 * STAKE) need.push({ role, kind: 'gonna' });
  }
  if (need.length) {
    const sp = await algod.getTransactionParams().do();
    const mk = (o) => ({ ...sp, fee: 1000, flatFee: true, ...o });
    const txns = [], signers = [];
    for (const n of need) {
      // ALGO top-ups from TREASURY (banks the QA continue fees); GONNA from DEPLOYER (ASA creator)
      if (n.kind === 'algo') { txns.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: addr('TREASURY'), receiver: addr(n.role), amount: 700_000, suggestedParams: mk({}) })); signers.push(W.TREASURY); }
      if (n.kind === 'optin') { txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: addr(n.role), receiver: addr(n.role), assetIndex: kit.GONNA_ASA_TESTNET, amount: 0, suggestedParams: mk({}) })); signers.push(W[n.role]); }
      if (n.kind === 'gonna') { txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: addr('DEPLOYER'), receiver: addr(n.role), assetIndex: kit.GONNA_ASA_TESTNET, amount: 3 * STAKE, suggestedParams: mk({}) })); signers.push(W.DEPLOYER); }
    }
    const r = await send(txns, signers);
    console.log(`  GONNA top-up txid=${r.txid} round=${r.round}`);
    report.txids.topup = r.txid;
  } else console.log('  all QA wallets GONNA-funded — no top-up needed');

  // continue-flow pooling: PLAYER_B pays the flat 5 ALGO continue to TREASURY
  const CONTINUE_PAYER = 'PLAYER_B';
  const WANT = 5_350_000;
  const FLOORS = { PLAYER_A: 980_000, ORACLE: 265_000, TREASURY: 206_000, DEPLOYER: 1_218_500 };
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
async function submitViaServer(cid, role, stageMode, stageIdx, opts = {}) {
  const roster = await kit.readPlayers(cid);
  const seat = roster.findIndex((p) => enc(p.addr) === addr(role));
  if (seat < 0) throw new Error(`${role} not on cid ${cid}`);
  const { sig, score } = await serverSignScore({ cid, seat, role, stageMode, stageIdx, continueRef: opts.continueRef, phase: opts.phase ?? 0, bannedTop: opts.bannedTop ?? -1 });
  const txns = await kit.buildSubmitGroup({ player: addr(role), cid, score, sig });
  const r = await send(txns, W[role]);
  console.log(`  submit cid=${cid} seat=${seat} ${role} score=${score}${opts.continueRef ? ' (continue ' + opts.continueRef + ')' : ''} txid=${r.txid} round=${r.round}`);
  return { ...r, score };
}

async function verdictAndResolve(cid, callerRole, expectStageMode, expectStageIdx, label) {
  const meta = await kit.readMeta(cid);
  const roster = await kit.readPlayers(cid);
  const signed = roster.map((p, i) => ({ seat: i, addr: p.addr, score: Number(p.score), signed: p.signed })).filter((e) => e.signed);
  const top = signed.reduce((a, b) => (b.score > a.score ? b : a));
  const tie = signed.filter((e) => e.score === top.score).length > 1;
  const winner = enc(top.addr);

  const v = await oraclePost('/v1/verdict', { cid }, { retriesOn503: 6 });
  if (v.status !== 200) throw new Error(`verdict cid=${cid} refused: ${v.status} ${v.json.error ?? ''}`);
  console.log(`  verdict cid=${cid}: stageMode=${v.json.stageMode} stageIdx=${v.json.stageIdx} playerCount=${v.json.playerCount}`);
  ok(v.json.stageMode === expectStageMode, `${label}: verdict stageMode=${v.json.stageMode} == ${expectStageMode}`);
  if (expectStageMode === 'stage') {
    ok(v.json.stageIdx === expectStageIdx, `${label}: server verdict stage_idx=${v.json.stageIdx} == create-note stage ${expectStageIdx}`);
    const stages = await kit.fetchArenaCreateStages({ force: true }).catch(() => null);
    const noteStage = stages ? (stages[String(cid)] ?? null) : null;
    ok(noteStage === expectStageIdx, `${label}: indexer create-note stage=${noteStage} == ${expectStageIdx} (verdict bound to the note)`);
  }
  ok(v.json.playerCount === signed.length, `${label}: verdict playerCount=${v.json.playerCount} == signed roster ${signed.length}`);

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
  const txns = await kit.buildResolveGroup({ caller: addr(callerRole), cid, stageIdx: v.json.stageIdx ?? 0, seedReveal: new Uint8Array(0), verdictSig, winner, tie });
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

// ============================ CARD A — DUEL (STAGE) ===========================
console.log('\n================ CARD A: DUEL stage-mode (create PLAYER_B stage 2, join PLAYER_A) ================');
const cidA = await kit.nextChallengeId();
{
  const s0 = await serverSignScore({ cid: cidA, seat: 0, role: 'PLAYER_B', stageMode: 'stage', stageIdx: 2, phase: 11 });
  const txns = await kit.buildCreateGroup({
    creator: addr('PLAYER_B'), cid: cidA, stakeBase: STAKE, seats: 1, durationSecs: 86400,
    stageMode: 1, creatorScore: s0.score, creatorScoreSig: s0.sig, stageIdx: 2,
  });
  const r = await send(txns, W.PLAYER_B);
  console.log(`  CREATE cid=${cidA} PLAYER_B stage-mode stageIdx=2 score=${s0.score} (note gonna:v2:stage:2) txid=${r.txid} round=${r.round}`);
  report.txids.cardA = { cid: cidA, create: r.txid };
  const m0 = await kit.readMeta(cidA);
  ok(m0 && Number(m0.status) === 0 && Number(m0.stageMode) === 1, `CARD A: created OPEN, stage mode (${STATUS[Number(m0?.status ?? 9)]})`);

  // NEG: verdict on a non-resolvable card
  await expectRefusal('verdict non-resolvable card', '/v1/verdict', { cid: cidA }, 409, 'not resolvable yet');

  const jr = await send(await kit.buildJoinGroup({ joiner: addr('PLAYER_A'), cid: cidA, stakeBase: STAKE }), W.PLAYER_A);
  console.log(`  JOIN cid=${cidA} PLAYER_A txid=${jr.txid} round=${jr.round}`);
  report.txids.cardA.join = jr.txid;

  // NEG: seat not own
  await expectRefusal('sign-score wrong seat', '/v1/sign-score',
    { cid: cidA, seat: 1, addr: addr('PLAYER_B'), score: 1000, stageMode: 'stage', stageIdx: 2, build: BUILD, run: { seedLabel: `PIT-${cidA}`, frames: 600, durationSec: 12 } },
    400, 'addr does not occupy this seat');
  // NEG: stageIdx different from the committed note
  await expectRefusal('sign-score stageIdx != note', '/v1/sign-score',
    { cid: cidA, seat: 1, addr: addr('PLAYER_A'), score: 1000, stageMode: 'stage', stageIdx: 3, build: BUILD, run: { seedLabel: `PIT-${cidA}`, frames: 600, durationSec: 12 } },
    400, 'stageIdx does not match the create-note commitment');
  // NEG: score above the stage cap
  await expectRefusal('sign-score over cap', '/v1/sign-score',
    { cid: cidA, seat: 1, addr: addr('PLAYER_A'), score: 500_001, stageMode: 'stage', stageIdx: 2, build: BUILD, run: { seedLabel: `PIT-${cidA}`, frames: 600, durationSec: 12 } },
    400, 'score above cap');

  // NEG (M2): honest log but INFLATED score -> the server replays and refuses
  {
    const run = playHonestRun({ stageMode: 'stage', stageIdx: 2, seedLabel: `PIT-${cidA}`, phase: 23 });
    await expectRefusal('inflated score -> REPLAY MISMATCH', '/v1/sign-score',
      { cid: cidA, seat: 1, addr: addr('PLAYER_A'), score: run.score + 1000, stageMode: 'stage', stageIdx: 2, build: BUILD, run: { seedLabel: run.seedLabel, frames: run.frames, durationSec: Math.ceil(run.frames / 60) + 2, inputLogB64: run.inputLogB64 } },
      400, 'REPLAY MISMATCH');
  }

  // joiner submits the honest replayed run via the SERVER
  const sr = await submitViaServer(cidA, 'PLAYER_A', 'stage', 2, { phase: 23, bannedTop: s0.score });
  report.txids.cardA.submit = sr.txid;

  const res = await verdictAndResolve(cidA, 'DEPLOYER', 'stage', 2, 'CARD A');
  report.txids.cardA.resolve = res.txid;
  report.txids.cardA.round = res.round;
  report.txids.cardA.winner = res.winner;
}

// ============================ CARD B — 5-SEAT (FULL) ==========================
console.log('\n================ CARD B: 5-SEAT full-mode (create PLAYER_A, join B+ORACLE+TREASURY+DEPLOYER) ================');
const cidB = await kit.nextChallengeId();
{
  const s0 = await serverSignScore({ cid: cidB, seat: 0, role: 'PLAYER_A', stageMode: 'full', phase: 3 });
  const txns = await kit.buildCreateGroup({
    creator: addr('PLAYER_A'), cid: cidB, stakeBase: STAKE, seats: 4, durationSecs: 86400,
    stageMode: 0, creatorScore: s0.score, creatorScoreSig: s0.sig,
  });
  const r = await send(txns, W.PLAYER_A);
  console.log(`  CREATE cid=${cidB} PLAYER_A full-mode score=${s0.score} (no stage note) txid=${r.txid} round=${r.round}`);
  report.txids.cardB = { cid: cidB, create: r.txid };
  const m0 = await kit.readMeta(cidB);
  ok(m0 && Number(m0.status) === 0 && Number(m0.stageMode) === 0 && Number(m0.seatsTotal) === 4, 'CARD B: created OPEN, full mode, 4 joiner seats');

  for (const role of ['PLAYER_B', 'ORACLE', 'TREASURY', 'DEPLOYER']) {
    const jr = await send(await kit.buildJoinGroup({ joiner: addr(role), cid: cidB, stakeBase: STAKE }), W[role]);
    console.log(`  JOIN cid=${cidB} ${role} txid=${jr.txid} round=${jr.round}`);
    (report.txids.cardB.joins ??= {})[role] = jr.txid;
  }
  const mF = await kit.readMeta(cidB);
  ok(Number(mF.seatsTaken) === 4 && Number(mF.status) === 1, 'CARD B: table CLOSED(full) at 4/4 joiner seats');

  // ---- continue flow for PLAYER_B ----
  const refId = `E2EV161-${cidB}-B`;
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
  await expectRefusal('continue receipt re-register', '/v1/continue/receipt', { refId, addr: addr('PLAYER_B'), txid: cr.txid }, 409, 'receipt already registered');

  // submits via the SERVER (PLAYER_B's sig consumes the receipt atomically)
  const { run: bRun } = tieSafePhase({ stageMode: 'full', seedLabel: `RUN-${cidB}`, phase: 17, bannedTop: s0.score });
  let topB = Math.max(s0.score, bRun.score);
  {
    const body = {
      cid: cidB, seat: 1, addr: addr('PLAYER_B'), score: bRun.score, stageMode: 'full', build: BUILD,
      run: { seedLabel: bRun.seedLabel, frames: bRun.frames, durationSec: Math.ceil(bRun.frames / 60) + 2, inputLogB64: bRun.inputLogB64 },
      continueRef: refId,
    };
    const rr = await oraclePost('/v1/sign-score', body, { retriesOn503: 6 });
    if (rr.status !== 200) throw new Error(`continue sign-score refused: ${rr.status} ${rr.json.error ?? ''}`);
    console.log(`    run RUN-${cidB} PLAYER_B: ${bRun.frames} play frames, replay-verified score ${bRun.score} (continue consumed)`);
    const txns2 = await kit.buildSubmitGroup({ player: addr('PLAYER_B'), cid: cidB, score: bRun.score, sig: b64ToBytes(rr.json.sigB64) });
    const srB = await send(txns2, W.PLAYER_B);
    console.log(`  submit cid=${cidB} seat=1 PLAYER_B score=${bRun.score} (continue ${refId}) txid=${srB.txid} round=${srB.round}`);
    report.txids.cardB.submits = { PLAYER_B: srB.txid };
    // NEG: the consumed receipt cannot sign again — a VALID replayable log is
    // re-verified first, then the consume check refuses (rule order: replay
    // gate runs before any DB write, so the receipt is still intact hereafter)
    await expectRefusal('continue receipt reuse', '/v1/sign-score', body, 409, 'continue receipt already consumed');
  }

  for (const [i, role] of ['ORACLE', 'TREASURY', 'DEPLOYER'].entries()) {
    const sr = await submitViaServer(cidB, role, 'full', null, { phase: 29 + i * 7, bannedTop: topB });
    topB = Math.max(topB, sr.score ?? topB);
    report.txids.cardB.submits[role] = sr.txid;
  }

  const res = await verdictAndResolve(cidB, 'DEPLOYER', 'full', null, 'CARD B');
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
