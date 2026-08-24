// ============================================================================
// GONNAFIGHT ARENA — QA MULTIPLAYER SIMULATION (Algorand TESTNET, v2 app
// 769767443). Reproducible full-lifecycle harness:
//   PHASE 0  RECON (read-only): dump every live challenge box, QA balances.
//   PHASE 1  SETUP: fund the ORACLE QA wallet if it cannot play (ALGO + opt-in).
//   PHASE 2  SIM-RUMBLE: spawn a 4-seat rumble (permissionless spawn_rumble,
//            1 ALGO fee), fill all 4 joiner seats with QA wallets, submit 5
//            DISTINCT oracle-signed scores, RESOLVE via early-resolve rule
//            (full table + everyone signed). Verify 95/5 payout legs, MBR
//            refund, box deletion, ChallengeResolved event.
//   PHASE 3  PRINCE'S TABLE (cid given by --prince-cid, default 20): fill the
//            remaining seats with QA wallets signing HONESTLY LOW scores (the
//            on-chain top scorer must win — we never out-sign a real player),
//            then early-resolve (full + all signed). Verify the same legs.
//   PHASE 4  FINAL RECON + event-log cross-check (kit.fetchArenaCloseEvents).
//
// Keys come from the GITIGNORED contracts/quantum-arena/deploy/testnet.secrets.json
// — mnemonics are NEVER printed. Live txids + confirmed rounds ARE printed
// (they are the audit trail).
//
// Usage: node scripts/sim-multiplayer.mjs [--recon-only] [--prince-cid N]
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY = path.join(ROOT, 'contracts/quantum-arena/deploy');
const RECON_ONLY = process.argv.includes('--recon-only');
const PRINCE_CID = (() => {
  const i = process.argv.indexOf('--prince-cid');
  return i > 0 ? Number(process.argv[i + 1]) : 20;
})();

// ---- bundle the chain mirror exactly like test-v2.mjs does ------------------
const KIT_OUT = path.join(ROOT, '.tmp-kit-sim.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--outfile=${KIT_OUT}`], { cwd: ROOT, stdio: 'pipe' });
const kit = await import(KIT_OUT);
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));
const nacl = (await import('tweetnacl')).default;

// ---- keys (never printed) ----------------------------------------------------
if (!existsSync(DEPLOY + '/testnet.secrets.json')) throw new Error('missing deploy/testnet.secrets.json (gitignored QA keys)');
const secrets = JSON.parse(readFileSync(DEPLOY + '/testnet.secrets.json', 'utf8'));
const state = JSON.parse(readFileSync(DEPLOY + '/testnet.json', 'utf8'));
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
const STATUS = ['OPEN', 'CLOSED(full)', 'RESOLVED', 'REFUNDED', 'FORFEIT'];
const enc = (pk) => algosdk.encodeAddress(pk instanceof Uint8Array ? pk : Uint8Array.from(pk));
const short = (a) => a.slice(0, 8) + '..' + a.slice(-4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = { txids: {}, deviations: [], checks: { passed: 0, failed: 0 } };
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
  // signers: array parallel to txns, each an account (or single account)
  algosdk.assignGroupID(txns);
  const signed = txns.map((t, i) => t.signTxn((Array.isArray(signers) ? signers[i] : signers).sk));
  const r = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, r.txid, 10);
  const info = await algod.pendingTransactionInformation(r.txid).do();
  return { txid: r.txid, round: Number(info.confirmedRound ?? info['confirmed-round'] ?? 0), info };
}

// oracle-signed score for (cid, seat, player account)
const signScore = (cid, seat, acct, score) =>
  nacl.sign.detached(kit.scoreMsg(cid, seat, acct.addr.publicKey, score), oracleKp.secretKey);

async function signVerdict(cid, mode, entries /* [{seat, addr(bytes), score}] */, extra = ZERO32) {
  const msg = await kit.verdictMsg(cid, mode, extra, entries);
  return nacl.sign.detached(msg, oracleKp.secretKey);
}

// v15.2.7b: the v2 contract has NO stage field — the DESCENT level is dealt
// by the counter (same one-liner as chainAdapter.stageIdxFromCid). Resolve
// must pass it AND bind it into the verdict payload (the contract asserts
// verdict stage_idx == the resolve arg) or single-mode cards 400 in sims.
const stageIdxFromCid = (cid) => cid % 7; // 7 stages, idx 0-6

// decode ChallengeResolved / ChallengeForfeited / ChallengeRefunded from a
// confirmed appl txn's logs (no indexer lag). Returns [] when none.
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

// ============================ PHASE 0: RECON =================================
async function recon(title) {
  const now = Math.floor(Date.now() / 1000);
  console.log(`\n================ RECON (${title}) — ${new Date(now * 1000).toISOString()} ================`);
  const nextId = await kit.nextChallengeId();
  const ver = await kit.contractVersion();
  console.log(`app ${kit.ARENA_APP_ID} version=${ver} next_challenge_id=${nextId}`);
  const ids = await kit.scanChallengeIds();
  console.log('live meta boxes: ' + (ids.length ? ids.join(', ') : '(none)'));
  const cards = [];
  for (const cid of ids) {
    const m = await kit.readMeta(cid);
    const roster = await kit.readPlayers(cid);
    if (!m) { console.log(`cid ${cid}: meta box vanished mid-scan`); continue; }
    const dl = Number(m.deadline);
    const creator = enc(m.creator);
    const expired = now >= dl;
    const joinCut = now < dl - 600;
    const filled = Number(m.seatsTaken) === Number(m.seatsTotal);
    const signedJoiners = roster.slice(1).filter((p) => p.signed).length;
    const allSigned = roster.every((p) => p.signed);
    const resolvable = (filled && allSigned) || (expired && signedJoiners >= 1);
    console.log(`\ncid ${cid} | creator=${short(creator)} | stake=${Number(m.stake) / 1e6} GONNA | seats ${Number(m.seatsTaken)}/${Number(m.seatsTotal)} joiner | status=${STATUS[Number(m.status)]}`);
    console.log(`  deadline=${new Date(dl * 1000).toISOString()} (${expired ? 'EXPIRED' : 'in ' + Math.round((dl - now) / 60) + 'min'}) joinable=${joinCut && Number(m.status) === 0 && !filled} pot=${Number(m.paidTotal) / 1e6} GONNA mbr_paid=${Number(m.mbrPaid)}`);
    roster.forEach((p, i) =>
      console.log(`  seat${i} ${short(enc(p.addr))} signed=${p.signed} score=${Number(p.score)} seated_at=${new Date(Number(p.seatedAt) * 1000).toISOString()}`));
    console.log(`  => resolvable_now=${resolvable} (filled=${filled} all_signed=${allSigned} expired_signed_joiners=${expired && signedJoiners >= 1})`);
    console.log(`     claim(): creator-only, needs seats_taken=0 + expired -> ${Number(m.seatsTaken) === 0 && expired}`);
    cards.push({ cid, meta: m, roster, creator, resolvable });
  }
  console.log('\nQA wallets:');
  for (const role of ['DEPLOYER', 'TREASURY', 'ORACLE', 'PLAYER_A', 'PLAYER_B']) {
    const g = await gonnaBal(addr(role));
    console.log(`  ${role.padEnd(9)} ${short(addr(role))} ALGO=${(await algoBal(addr(role))) / 1e6} GONNA=${g === null ? 'NOT-OPTED' : g / 1e6}`);
  }
  return cards;
}

const cards0 = await recon('BEFORE');
const prince = cards0.find((c) => c.cid === PRINCE_CID) ?? null;

// ============================ SIM ============================================
async function submitScore(cid, role, score) {
  const seat = (await kit.readPlayers(cid)).findIndex((p) => enc(p.addr) === addr(role));
  if (seat < 0) throw new Error(`${role} not on cid ${cid}`);
  const sig = signScore(cid, seat, W[role], score);
  const txns = await kit.buildSubmitGroup({ player: addr(role), cid, score, sig });
  const r = await send(txns, W[role]);
  console.log(`  submit cid=${cid} seat=${seat} ${role} score=${score} txid=${r.txid} round=${r.round}`);
  return r;
}

async function joinSeat(cid, role, stake) {
  const txns = await kit.buildJoinGroup({ joiner: addr(role), cid, stakeBase: stake });
  const r = await send(txns, W[role]);
  console.log(`  join cid=${cid} ${role} txid=${r.txid} round=${r.round}`);
  return r;
}

async function resolveChallenge(cid, callerRole, expectWinnerRole /* string addr */, label) {
  const meta = await kit.readMeta(cid);
  const roster = await kit.readPlayers(cid);
  const signed = roster.map((p, i) => ({ seat: i, addr: p.addr, score: Number(p.score), signed: p.signed })).filter((e) => e.signed);
  // winner = unique top score (our sims are built tie-free)
  const top = signed.reduce((a, b) => (b.score > a.score ? b : a));
  const tie = signed.filter((e) => e.score === top.score).length > 1;
  const winner = enc(top.addr);
  console.log(`  resolve cid=${cid}: pot=${Number(meta.paidTotal)} winner=${short(winner)} score=${top.score} tie=${tie} caller=${callerRole}`);
  // v15.2.7b: MODE_STAGE_IDX resolves at cid % 7 (was hardcoded 0) — the
  // verdict extra carries the SAME idx (24 zeros + uint64) the resolve arg
  // passes, because the contract asserts the two agree. MODE_FULL pins 0.
  const chosenStage = Number(meta.stageMode) === 1 ? stageIdxFromCid(cid) : 0;
  const extra = new Uint8Array(32);
  if (Number(meta.stageMode) === 1) new DataView(extra.buffer).setBigUint64(24, BigInt(chosenStage), false);
  const vSig = await signVerdict(cid, Number(meta.stageMode), signed, extra);
  const txns = await kit.buildResolveGroup({ caller: addr(callerRole), cid, stageIdx: chosenStage, seedReveal: new Uint8Array(0), verdictSig: vSig, winner });
  const pot = Number(meta.paidTotal);
  const fee = Math.floor(pot / 10000) * 500 + Math.floor(((pot % 10000) * 500) / 10000);
  const payout = pot - fee;
  const creator = enc(meta.creator);
  const pre = {
    winnerG: await gonnaBal(winner),
    treG: await gonnaBal(kit.TREASURY_ADDR),
    creatorA: await algoBal(creator),
    callerA: await algoBal(addr(callerRole)),
  };
  const r = await send(txns, W[callerRole]);
  const events = decodeCloseEvents(r.info);
  const post = {
    winnerG: await gonnaBal(winner),
    treG: await gonnaBal(kit.TREASURY_ADDR),
    creatorA: await algoBal(creator),
    callerA: await algoBal(addr(callerRole)),
  };
  const boxGone = (await kit.readMeta(cid)) === null && (await kit.readPlayers(cid)).length === 0;
  console.log(`  RESOLVED cid=${cid} txid=${r.txid} round=${r.round}`);
  for (const e of events) console.log(`  event ${e.kind} cid=${e.cid} winner=${e.winner ? short(e.winner) : 'ZERO(tie)'} payout=${e.payout ?? '-'} fee=${e.fee ?? '-'}`);
  ok(events.some((e) => e.kind === 'ChallengeResolved' && e.cid === cid), `${label}: ChallengeResolved event logged for cid ${cid}`);
  const ev = events.find((e) => e.kind === 'ChallengeResolved' && e.cid === cid);
  if (ev) {
    ok(ev.winner === winner, `${label}: event winner = ${short(winner)}`);
    ok(ev.payout === payout && ev.fee === fee, `${label}: event payout=${payout} fee=${fee} (95/5 of pot ${pot})`);
  }
  // balance legs
  const sameAsCaller = winner === addr(callerRole);
  const wDelta = (post.winnerG ?? 0) - (pre.winnerG ?? 0);
  ok(wDelta === payout, `${label}: winner GONNA delta ${wDelta} == payout ${payout}`);
  ok((post.treG ?? 0) - (pre.treG ?? 0) === fee, `${label}: treasury GONNA delta ${(post.treG ?? 0) - (pre.treG ?? 0)} == fee ${fee}`);
  const creatorIsCaller = creator === addr(callerRole);
  const mbrDelta = post.creatorA - pre.creatorA;
  ok(mbrDelta === MBR || (creatorIsCaller && mbrDelta > MBR - 20000), `${label}: creator MBR refund delta ${mbrDelta} µALGO (expect ${MBR}${creatorIsCaller ? ' minus caller fees' : ''})`);
  ok(boxGone, `${label}: both boxes deleted after resolve`);
  return { txid: r.txid, round: r.round, winner, payout, fee, events };
}

if (RECON_ONLY) {
  console.log('\n--recon-only: done.');
  process.exit(0);
}

// ---------------- PHASE 1: ORACLE wallet setup (needs ALGO + GONNA opt-in) ---
console.log('\n================ PHASE 1: QA setup ================');
{
  const oAlgo = await algoBal(addr('ORACLE'));
  const oGonna = await gonnaBal(addr('ORACLE'));
  // DEPLOYER is min-balance bound (it created the ASA/apps) — TREASURY banks
  // the QA top-ups instead.
  const dSpendable = (await algoBal(addr('DEPLOYER'))) - 1_200_000;
  if (oAlgo < 250_000 || oGonna === null || oGonna < 2 * STAKE || dSpendable < 100_000) {
    const sp = await algod.getTransactionParams().do();
    const mk = (o) => ({ ...sp, fee: 1000, flatFee: true, ...o });
    const txns = [];
    const signers = [];
    if (oAlgo < 250_000) {
      txns.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: addr('TREASURY'), receiver: addr('ORACLE'), amount: 300_000, suggestedParams: mk({}) }));
      signers.push(W.TREASURY);
    }
    if (oGonna === null) {
      txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: addr('ORACLE'), receiver: addr('ORACLE'), assetIndex: kit.GONNA_ASA_TESTNET, amount: 0, suggestedParams: mk({}) }));
      signers.push(W.ORACLE);
    }
    if (oGonna === null || oGonna < 2 * STAKE) {
      txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: addr('TREASURY'), receiver: addr('ORACLE'), assetIndex: kit.GONNA_ASA_TESTNET, amount: 3 * STAKE, suggestedParams: mk({}) }));
      signers.push(W.TREASURY);
    }
    if (dSpendable < 100_000) {
      txns.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: addr('TREASURY'), receiver: addr('DEPLOYER'), amount: 500_000, suggestedParams: mk({}) }));
      signers.push(W.TREASURY);
    }
    const r = await send(txns, signers);
    console.log(`  setup (ORACLE ALGO top-up + GONNA opt-in + 3 GONNA, DEPLOYER 0.5 ALGO) txid=${r.txid} round=${r.round}`);
    report.txids.setup = r.txid;
  } else {
    console.log('  ORACLE/DEPLOYER already playable — no setup needed');
  }
}

// ---------------- PHASE 2: fresh 4-seat rumble, full cycle --------------------
console.log('\n================ PHASE 2: SIM-RUMBLE (spawn -> fill -> sign -> early resolve) ================');
{
  const cid = await kit.nextChallengeId();
  console.log(`  spawning rumble cid=${cid} creator=PLAYER_A (enters UNSIGNED), stake=1 GONNA, seats=4`);
  const a = algosdk;
  const appAddr = a.getApplicationAddress(kit.ARENA_APP_ID);
  const sp = await algod.getTransactionParams().do();
  const mk = (fee) => ({ ...sp, fee, flatFee: true });
  const sel = async (sig) => {
    const parts = sig.split(')');
    const argTypes = parts[0].slice(parts[0].indexOf('(') + 1).split(',').filter(Boolean);
    return new a.ABIMethod({ name: sig.slice(0, sig.indexOf('(')), args: argTypes.map((t, i) => ({ type: t, name: 'a' + i })), returns: { type: parts[1] || 'void' } }).getSelector();
  };
  const u64 = (v) => a.ABIType.from('uint64').encode(BigInt(v));
  const bytes = (v) => a.ABIType.from('byte[]').encode(v);
  const boxRef = (p) => ({ appIndex: kit.ARENA_APP_ID, name: new Uint8Array([p, ...(() => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(cid), false); return b; })()]) });
  const txns = [
    a.makePaymentTxnWithSuggestedParamsFromObject({ sender: addr('PLAYER_A'), receiver: appAddr, amount: MBR, suggestedParams: mk(1000) }),
    a.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: addr('PLAYER_A'), receiver: appAddr, assetIndex: kit.GONNA_ASA_TESTNET, amount: STAKE, suggestedParams: mk(1000) }),
    a.makePaymentTxnWithSuggestedParamsFromObject({ sender: addr('PLAYER_A'), receiver: kit.TREASURY_ADDR, amount: 1_000_000, suggestedParams: mk(1000) }),
    a.makeApplicationNoOpTxnFromObject({
      sender: addr('PLAYER_A'), appIndex: kit.ARENA_APP_ID,
      appArgs: [await sel('spawn_rumble(pay,axfer,pay,uint64,uint64,uint64,byte[])uint64'), u64(STAKE), u64(4), u64(0), bytes(ZERO32)],
      foreignAssets: [kit.GONNA_ASA_TESTNET], boxes: [boxRef(0x6d), boxRef(0x70)],
      suggestedParams: mk(2000),
    }),
  ];
  const rSpawn = await send(txns, W.PLAYER_A);
  console.log(`  SPAWN txid=${rSpawn.txid} round=${rSpawn.round}`);
  report.txids.rumble = { cid, spawn: rSpawn.txid };
  const m0 = await kit.readMeta(cid);
  const dl = Number(m0.deadline);
  console.log(`  on-chain deadline=${new Date(dl * 1000).toISOString()} (next 21:00 UTC, +1d if <4h away) status=${STATUS[Number(m0.status)]} creator_signed=false (no oracle gate)`);
  ok(Number(m0.seatsTotal) === 4 && Number(m0.status) === 0 && Number(m0.creatorScore) === 0, 'SIM-RUMBLE: spawned OPEN, 4 joiner seats, creator unsigned');

  // fill seats: B, TREASURY, ORACLE, DEPLOYER
  for (const role of ['PLAYER_B', 'TREASURY', 'ORACLE', 'DEPLOYER']) await joinSeat(cid, role, STAKE);
  const mF = await kit.readMeta(cid);
  ok(Number(mF.seatsTaken) === 4 && Number(mF.status) === 1, 'SIM-RUMBLE: table CLOSED(full) at 4/4 joiner seats');

  // DISTINCT scores (tie-free by design); B wins
  const scores = { PLAYER_A: 7000, PLAYER_B: 9000, TREASURY: 3000, ORACLE: 5000, DEPLOYER: 1000 };
  for (const role of ['PLAYER_A', 'PLAYER_B', 'TREASURY', 'ORACLE', 'DEPLOYER']) await submitScore(cid, role, scores[role]);

  // early resolve: full + all signed -> allowed BEFORE the deadline
  const res = await resolveChallenge(cid, 'DEPLOYER', addr('PLAYER_B'), 'SIM-RUMBLE');
  report.txids.rumble.resolve = res.txid;
  report.txids.rumble.round = res.round;
  report.txids.rumble.winner = res.winner;
}

// ---------------- PHASE 3: the Prince's table ---------------------------------
console.log(`\n================ PHASE 3: PRINCE'S TABLE (cid ${PRINCE_CID}) ================`);
{
  const m = await kit.readMeta(PRINCE_CID);
  if (!m) {
    console.log('  table already settled — nothing to do');
  } else {
    const now = Math.floor(Date.now() / 1000);
    let roster = await kit.readPlayers(PRINCE_CID);
    const openSeats = Number(m.seatsTotal) - Number(m.seatsTaken);
    const topSigned = roster.filter((p) => p.signed).reduce((mx, p) => Math.max(mx, Number(p.score)), 0);
    console.log(`  seats ${Number(m.seatsTaken)}/${Number(m.seatsTotal)}, deadline=${new Date(Number(m.deadline) * 1000).toISOString()}, top signed score=${topSigned}`);
    if (now >= Number(m.deadline) - 600 && Number(m.seatsTaken) < Number(m.seatsTotal)) {
      console.log('  inside join cutoff — cannot fill; leaving for post-deadline resolve');
    } else if (openSeats > 0) {
      // fill remaining seats with QA wallets signing HONESTLY LOW scores so the
      // real on-chain top scorer wins the pot
      const fillers = ['TREASURY', 'ORACLE', 'DEPLOYER', 'PLAYER_B', 'PLAYER_A'].filter((r) => !roster.some((p) => enc(p.addr) === addr(r)));
      for (let s = 0; s < openSeats; s++) {
        const role = fillers[s];
        if (!role) throw new Error('not enough QA wallets to fill the table');
        await joinSeat(PRINCE_CID, role, Number(m.stake));
      }
      roster = await kit.readPlayers(PRINCE_CID);
      for (const p of roster.map((p, i) => ({ p, i }))) {
        const a2 = enc(p.p.addr);
        const role = ['TREASURY', 'ORACLE', 'DEPLOYER', 'PLAYER_A', 'PLAYER_B'].find((r) => addr(r) === a2);
        if (role && !p.p.signed) {
          const honest = 100 + 50 * p.i; // strictly below any real signed score
          if (honest >= topSigned) throw new Error('refusing to out-sign the real leader');
          await submitScore(PRINCE_CID, role, honest);
        }
      }
    }
    // resolve (permissionless): full + all signed, or expired + >=1 signed joiner
    const mNow = await kit.readMeta(PRINCE_CID);
    const rNow = await kit.readPlayers(PRINCE_CID);
    const filled = Number(mNow.seatsTaken) === Number(mNow.seatsTotal);
    const allSigned = rNow.every((p) => p.signed);
    const expired = Math.floor(Date.now() / 1000) >= Number(mNow.deadline);
    const signedJoiners = rNow.slice(1).filter((p) => p.signed).length;
    if ((filled && allSigned) || (expired && signedJoiners >= 1)) {
      const winnerPk = rNow.filter((p) => p.signed).reduce((a2, b) => (Number(b.score) > Number(a2.score) ? b : a2)).addr;
      const res = await resolveChallenge(PRINCE_CID, 'DEPLOYER', enc(winnerPk), 'PRINCE-TABLE');
      report.txids.prince = { cid: PRINCE_CID, resolve: res.txid, round: res.round, winner: res.winner };
    } else {
      console.log(`  NOT resolvable yet (filled=${filled} all_signed=${allSigned} expired=${expired} signed_joiners=${signedJoiners}) — left untouched`);
      report.txids.prince = { cid: PRINCE_CID, resolve: null };
    }
  }
}

// ---------------- PHASE 4: final recon + event cross-check --------------------
await recon('AFTER');
console.log('\n================ EVENT-LOG cross-check (indexer, kit.fetchArenaCloseEvents) ================');
let evs = [];
for (let tries = 0; tries < 6; tries++) {
  try {
    evs = await kit.fetchArenaCloseEvents(3);
    const want = [report.txids.rumble?.cid, report.txids.prince?.resolve ? PRINCE_CID : null].filter((x) => x != null);
    if (want.every((cid) => evs.some((e) => e.cid === cid && e.kind === 'resolved'))) break;
  } catch (e) { console.log('  indexer not ready: ' + e.message); }
  await sleep(8000);
}
for (const cid of [report.txids.rumble?.cid, report.txids.prince?.resolve ? PRINCE_CID : null].filter((x) => x != null)) {
  const e = evs.find((x) => x.cid === cid && x.kind === 'resolved');
  ok(!!e, `event-log: indexer lists ChallengeResolved for cid ${cid}${e ? ` (winner=${e.winner ? short(e.winner) : 'tie'} payout=${e.payout} fee=${e.fee} round=${e.round})` : ''}`);
}

console.log('\n================ SUMMARY ================');
console.log(JSON.stringify({ txids: report.txids, checks: report.checks }, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
if (report.deviations.length) {
  console.log('\n*** DEVIATIONS (real bugs) ***\n - ' + report.deviations.join('\n - '));
} else {
  console.log('\nNO DEVIATIONS — every expected payout leg matched on-chain reality.');
}
process.exit(report.deviations.length ? 1 : 0);
