// ============================================================================
// GONNAFIGHT ARENA — QA ops script for the Prince's two live tables:
//   cid 22 (5-seat, 1 GONNA/seat) and cid 47 (1v1, 2 GONNA/seat, stage duel).
// Reuses the same bundled kit helpers as scripts/sim-multiplayer.mjs.
//   --recon-only : read-only dump (meta + roster + stage note decode)
//   default      : fill open seats with QA wallets (honest scores, never
//                  out-signing a real player), then resolve when legal.
// Mnemonics are NEVER printed; addresses + txids are the audit trail.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY = path.join(ROOT, 'contracts/quantum-arena/deploy');
const RECON_ONLY = process.argv.includes('--recon-only');
const CIDS = [22, 47];

const KIT_OUT = path.join(ROOT, '.tmp-kit-v1530.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--outfile=${KIT_OUT}`], { cwd: ROOT, stdio: 'pipe' });
const kit = await import(KIT_OUT);
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));
const nacl = (await import('tweetnacl')).default;

if (!existsSync(DEPLOY + '/testnet.secrets.json')) throw new Error('missing deploy/testnet.secrets.json');
const secrets = JSON.parse(readFileSync(DEPLOY + '/testnet.secrets.json', 'utf8'));
const W = {};
for (const role of ['DEPLOYER', 'TREASURY', 'ORACLE', 'PLAYER_A', 'PLAYER_B']) {
  W[role] = algosdk.mnemonicToSecretKey(secrets[role].mnemonic);
}
const addr = (role) => W[role].addr.toString();
const oracleKp = nacl.sign.keyPair.fromSeed(W.ORACLE.sk.slice(0, 32));
const algod = await kit.algodClient();

const MBR = 358_200;
const STATUS = ['OPEN', 'CLOSED(full)', 'RESOLVED', 'REFUNDED', 'FORFEIT'];
const enc = (pk) => algosdk.encodeAddress(pk instanceof Uint8Array ? pk : Uint8Array.from(pk));
const short = (a) => a.slice(0, 8) + '..' + a.slice(-4);
const report = { txids: {}, deviations: [] };

const gonnaBal = async (a) => {
  const i = await algod.accountInformation(a).do();
  const h = (i.assets ?? []).find((x) => Number(x.assetId ?? x['asset-id']) === kit.GONNA_ASA_TESTNET);
  return h ? Number(h.amount) : null;
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

const signScore = (cid, seat, acct, score) =>
  nacl.sign.detached(kit.scoreMsg(cid, seat, acct.addr.publicKey, score), oracleKp.secretKey);

async function signVerdict(cid, mode, entries, extra = new Uint8Array(32)) {
  const msg = await kit.verdictMsg(cid, mode, extra, entries);
  return nacl.sign.detached(msg, oracleKp.secretKey);
}

const stageIdxFromCid = (cid) => cid % 7; // legacy fallback ONLY (pre-note cards)

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

// ---- RECON -------------------------------------------------------------------
console.log(`app ${kit.ARENA_APP_ID} (testnet) treasury=${kit.TREASURY_ADDR}`);
let createStages = null;
try {
  createStages = await kit.fetchArenaCreateStages({ force: true });
} catch (e) {
  console.log('fetchArenaCreateStages failed: ' + e.message);
}
console.log('create-note stages (gonna:v2:stage:<K>): ' + JSON.stringify(createStages));

const tables = {};
for (const cid of CIDS) {
  const now = Math.floor(Date.now() / 1000);
  const m = await kit.readMeta(cid);
  if (!m) { console.log(`\ncid ${cid}: NO meta box — already settled/refunded`); tables[cid] = null; continue; }
  const roster = await kit.readPlayers(cid);
  const dl = Number(m.deadline);
  const note = createStages ? (createStages[String(cid)] ?? null) : null;
  console.log(`\ncid ${cid} | creator=${enc(m.creator)} | stake=${Number(m.stake) / 1e6} GONNA | seats ${Number(m.seatsTaken)}/${Number(m.seatsTotal)} joiner | status=${STATUS[Number(m.status)]} stageMode=${Number(m.stageMode)}`);
  console.log(`  deadline=${new Date(dl * 1000).toISOString()} (${now >= dl ? 'EXPIRED' : 'in ' + Math.round((dl - now) / 60) + 'min'}) pot=${Number(m.paidTotal) / 1e6} GONNA mbr_paid=${Number(m.mbrPaid)}`);
  console.log(`  stage: note_committed=${note ?? 'none'}${Number(m.stageMode) === 1 && note === null ? ` -> UNVERIFIED fallback cid%7=${cid % 7}` : ''}`);
  roster.forEach((p, i) =>
    console.log(`  seat${i} ${enc(p.addr)} signed=${p.signed} score=${Number(p.score)}`));
  tables[cid] = { meta: m, roster, note };
}

if (RECON_ONLY) { console.log('\n--recon-only: done.'); process.exit(0); }

// ---- OPS ----------------------------------------------------------------------
async function joinSeat(cid, role, stake) {
  const txns = await kit.buildJoinGroup({ joiner: addr(role), cid, stakeBase: stake });
  const r = await send(txns, W[role]);
  console.log(`  JOIN cid=${cid} ${role} txid=${r.txid} round=${r.round}`);
  return r;
}
async function submitScore(cid, role, score) {
  const seat = (await kit.readPlayers(cid)).findIndex((p) => enc(p.addr) === addr(role));
  if (seat < 0) throw new Error(`${role} not on cid ${cid}`);
  const sig = signScore(cid, seat, W[role], score);
  const txns = await kit.buildSubmitGroup({ player: addr(role), cid, score, sig });
  const r = await send(txns, W[role]);
  console.log(`  SUBMIT cid=${cid} seat=${seat} ${role} score=${score} txid=${r.txid} round=${r.round}`);
  return r;
}
async function resolveChallenge(cid, callerRole) {
  const meta = await kit.readMeta(cid);
  const roster = await kit.readPlayers(cid);
  const signed = roster.map((p, i) => ({ seat: i, addr: p.addr, score: Number(p.score), signed: p.signed })).filter((e) => e.signed);
  const top = signed.reduce((a, b) => (b.score > a.score ? b : a));
  if (signed.filter((e) => e.score === top.score).length > 1) throw new Error(`tie at top score on cid ${cid} — refusing`);
  const winner = enc(top.addr);
  const stageMode = Number(meta.stageMode);
  const committed = stageMode === 1 ? (createStages?.[String(cid)] ?? null) : null;
  const chosenStage = stageMode === 1 ? (committed ?? stageIdxFromCid(cid)) : 0;
  if (stageMode === 1) console.log(`  stage: committed=${committed ?? 'none'} resolved=${chosenStage}${committed === null ? ' (UNVERIFIED cid%7 fallback)' : ' (on-chain create note)'}`);
  const extra = new Uint8Array(32);
  if (stageMode === 1) new DataView(extra.buffer).setBigUint64(24, BigInt(chosenStage), false);
  const vSig = await signVerdict(cid, stageMode, signed, extra);
  const txns = await kit.buildResolveGroup({ caller: addr(callerRole), cid, stageIdx: chosenStage, seedReveal: new Uint8Array(0), verdictSig: vSig, winner });
  const pot = Number(meta.paidTotal);
  const fee = Math.floor(pot / 10000) * 500 + Math.floor(((pot % 10000) * 500) / 10000);
  const payout = pot - fee;
  const creator = enc(meta.creator);
  const pre = { winnerG: await gonnaBal(winner), treG: await gonnaBal(kit.TREASURY_ADDR), creatorA: await algoBal(creator) };
  const r = await send(txns, W[callerRole]);
  const events = decodeCloseEvents(r.info);
  const post = { winnerG: await gonnaBal(winner), treG: await gonnaBal(kit.TREASURY_ADDR), creatorA: await algoBal(creator) };
  const boxGone = (await kit.readMeta(cid)) === null && (await kit.readPlayers(cid)).length === 0;
  console.log(`  RESOLVE cid=${cid} txid=${r.txid} round=${r.round}`);
  for (const e of events) console.log(`  event ${e.kind} cid=${e.cid} winner=${e.winner ?? 'ZERO'} payout=${e.payout ?? '-'} fee=${e.fee ?? '-'}`);
  const ev = events.find((e) => e.kind === 'ChallengeResolved' && e.cid === cid);
  console.log(`  VERIFY winner_delta=${(post.winnerG ?? 0) - (pre.winnerG ?? 0)} (expect ${payout}) treasury_delta=${(post.treG ?? 0) - (pre.treG ?? 0)} (expect ${fee}) creator_algo_delta=${post.creatorA - pre.creatorA} (expect ~${MBR}) boxes_gone=${boxGone} event_ok=${!!ev && ev.winner === winner && ev.payout === payout && ev.fee === fee}`);
  if (!ev || ev.winner !== winner || ev.payout !== payout || ev.fee !== fee) report.deviations.push(`cid ${cid}: event mismatch`);
  if ((post.winnerG ?? 0) - (pre.winnerG ?? 0) !== payout) report.deviations.push(`cid ${cid}: winner delta mismatch`);
  if ((post.treG ?? 0) - (pre.treG ?? 0) !== fee) report.deviations.push(`cid ${cid}: treasury delta mismatch`);
  if (post.creatorA - pre.creatorA !== MBR) report.deviations.push(`cid ${cid}: creator MBR delta ${post.creatorA - pre.creatorA} != ${MBR}`);
  if (!boxGone) report.deviations.push(`cid ${cid}: boxes not deleted`);
  return { txid: r.txid, round: r.round, winner, payout, fee, pot };
}

// Per-table plan: which QA roles fill the open seats, and their honest scores.
// Honest = <=2400 for bots, and NEVER above a real player's signed score.
const PLAN = {
  22: { fillers: ['PLAYER_A', 'PLAYER_B', 'ORACLE'], scores: { PLAYER_A: 1900, PLAYER_B: 1400, ORACLE: 800 } },
  47: { fillers: ['PLAYER_A'], scores: { PLAYER_A: 1500 } },
};

for (const cid of CIDS) {
  console.log(`\n================ OPS cid ${cid} ================`);
  let m = await kit.readMeta(cid);
  if (!m) { console.log('  already settled — skip'); continue; }
  const now = Math.floor(Date.now() / 1000);
  let roster = await kit.readPlayers(cid);
  const topSigned = roster.filter((p) => p.signed).reduce((mx, p) => Math.max(mx, Number(p.score)), 0);
  const openSeats = Number(m.seatsTotal) - Number(m.seatsTaken);
  const stake = Number(m.stake);
  const plan = PLAN[cid];
  if (openSeats > 0) {
    if (now >= Number(m.deadline) - 600) { console.log('  inside join cutoff — cannot join'); continue; }
    if (openSeats > plan.fillers.length) throw new Error(`cid ${cid}: need ${openSeats} fillers, have ${plan.fillers.length}`);
    // wallet sanity: enough GONNA + ALGO
    for (let s = 0; s < openSeats; s++) {
      const role = plan.fillers[s];
      const g = await gonnaBal(addr(role));
      if (g === null || g < stake) throw new Error(`${role} cannot stake ${stake} µGONNA (has ${g})`);
      if ((await algoBal(addr(role))) < 50_000) throw new Error(`${role} low on ALGO`);
    }
    for (let s = 0; s < openSeats; s++) await joinSeat(cid, plan.fillers[s], stake);
    roster = await kit.readPlayers(cid);
    for (const p of roster) {
      const a2 = enc(p.addr);
      const role = plan.fillers.find((r) => addr(r) === a2);
      if (role && !p.signed) {
        const score = plan.scores[role];
        if (score > 2400) throw new Error('bot score cap 2400 violated');
        if (score >= topSigned) throw new Error(`refusing to out-sign real leader (${score} >= ${topSigned})`);
        await submitScore(cid, role, score);
      }
    }
  }
  // resolve check
  m = await kit.readMeta(cid);
  const rNow = await kit.readPlayers(cid);
  const filled = Number(m.seatsTaken) === Number(m.seatsTotal);
  const allSigned = rNow.every((p) => p.signed);
  const expired = Math.floor(Date.now() / 1000) >= Number(m.deadline);
  const signedJoiners = rNow.slice(1).filter((p) => p.signed).length;
  console.log(`  resolvable check: filled=${filled} all_signed=${allSigned} expired=${expired} signed_joiners=${signedJoiners}`);
  if ((filled && allSigned) || (expired && signedJoiners >= 1)) {
    const res = await resolveChallenge(cid, 'DEPLOYER');
    report.txids[`cid${cid}`] = res;
  } else {
    console.log(`  NOT resolvable now (deadline ${new Date(Number(m.deadline) * 1000).toISOString()})`);
    report.txids[`cid${cid}`] = { resolve: null };
  }
}

console.log('\n================ SUMMARY ================');
console.log(JSON.stringify(report, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
if (report.deviations.length) { console.log('DEVIATIONS: ' + report.deviations.join(' | ')); process.exit(1); }
console.log('NO DEVIATIONS.');
