// m4-mainnet-dogfood.mjs — M-4 step 3 + M-3 essenziale su MAINNET (app 3686311434).
// Flow: (s3) micro-duel 0.1 GONNA, (s4a) duel 1 GONNA, (s4b) 3-seat full 0.5,
// (s4c) early_close 0 joiner, (s4d) verdict 200/409, (s4e) adversarial 400/400.
// Signers: DEPLOYER (creator/resolve), PLAYER_QA2, ORACLE — da mainnet.secrets.json.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ORACLE = (process.env.ORACLE_BASE ?? 'https://gonna-arena-oracle-testnet.onrender.com').replace(/\/$/, '');
const KIT_OUT = path.join(ROOT, '.tmp-kit-m4.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--define:import.meta.env={"DEV":false,"PROD":true,"VITE_ARENA_NETWORK":"mainnet","VITE_QA_ORACLE":""}`,
  `--outfile=${KIT_OUT}`], { cwd: ROOT, stdio: 'pipe' });
const kit = await import(KIT_OUT);
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));
const replay = await import(path.join(ROOT, 'oracle-server/replay/replay.mjs'));
const eng = await replay.loadBundle('v4fc0b66e');
const secrets = JSON.parse(readFileSync(path.join(ROOT, 'contracts/quantum-arena/deploy/mainnet.secrets.json'), 'utf8'));
const W = {};
for (const role of ['DEPLOYER', 'PLAYER_QA2', 'ORACLE']) W[role] = algosdk.mnemonicToSecretKey(secrets[role].mnemonic);
const addr = (r) => W[r].addr.toString();
const algod = await kit.algodClient();
const indexer = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', '');
const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'];

function playHonest(stageIdx, seedLabel, phase) {
  const game = replay.bootGame(eng);
  replay.startStageRun(game, stageIdx, seedLabel);
  const n = 7200, stream = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    let v = 8; const q = (f + phase) % 90;
    if (q >= 30 && q < 60) v = 0;
    if (q === 34 || q === 42 || q === 68) v |= 16;
    if (q === 58) v |= 32;
    if (q === 70) v |= 64;
    stream[f] = v;
  }
  const down = game.input.down, pressed = game.input.pressed;
  for (let f = 0; f < n && game.inputLogMasks; f++) {
    const m = stream[f];
    for (let b = 0; b < 8; b++) { const v = ((m >> b) & 1) === 1; if (v && !down[BTNS[b]]) pressed[BTNS[b]] = true; down[BTNS[b]] = v; }
    game.step();
  }
  return { score: game.score, frames: game.inputLogFrames, inputLogB64: game.arena.sealedRun.inputLogB64 };
}

async function signScore(cid, seat, role, run, seedLabel) {
  const body = {
    cid, seat, addr: addr(role), score: run.score, stageMode: 'stage', stageIdx: 1, build: 'v4fc0b66e',
    run: { seedLabel, frames: run.frames, durationSec: Math.ceil(run.frames / 60) + 2, inputLogB64: run.inputLogB64 },
  };
  const r = await fetch(`${ORACLE}/v1/sign-score`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200) throw new Error(`sign ${role} cid ${cid}: ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
  return j;
}

async function send(txns, signer) {
  algosdk.assignGroupID(txns);
  const signed = txns.map((t) => t.signTxn(signer.sk));
  const r = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, r.txid, 10);
  return { txid: r.txid, round: Number((await algod.pendingTransactionInformation(r.txid).do()).confirmedRound ?? 0) };
}

async function legsOf(txid) {
  const t = await indexer.lookupTransactionByID(txid).do();
  return (t.transaction.innerTxns ?? []).map((i) => {
    const p = i.paymentTransaction, a = i.assetTransferTransaction;
    if (a) return `axfer ${a.amount} -> ${a.receiver.slice(0, 8)}…`;
    if (p) return `pay ${p.amount} microA -> ${p.receiver.slice(0, 8)}…`;
    return i.txType;
  });
}

async function verdictOf(cid) {
  const v = await fetch(`${ORACLE}/v1/verdict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cid }) });
  return { status: v.status, body: await v.json().catch(() => ({})) };
}

async function runCard({ label, stake, seatsJoin, stageMode, joiners }) {
  const cid = await kit.nextChallengeId();
  const seed = `PIT-${cid}`;
  console.log(`\n=== ${label}: cid=${cid} stake=${stake} seats=${1 + seatsJoin} mode=${stageMode} ===`);
  const runC = playHonest(1, seed, 40);
  const sigC = await signScore(cid, 0, 'DEPLOYER', runC, seed);
  const cr = await send(await kit.buildCreateGroup({
    creator: addr('DEPLOYER'), cid, stakeBase: stake, seats: seatsJoin, durationSecs: 86400,
    stageMode, creatorScore: runC.score, creatorScoreSig: Buffer.from(sigC.sigB64, 'base64'), stageIdx: 1,
  }), W.DEPLOYER);
  console.log(`CREATE txid=${cr.txid} (creator sealed score=${runC.score})`);
  const joins = [];
  for (const [i, role] of joiners.entries()) {
    const jr = await send(await kit.buildJoinGroup({ joiner: addr(role), cid, stakeBase: stake }), W[role]);
    joins.push(jr.txid);
    const run = playHonest(1, seed, 5 + i * 16);
    const sig = await signScore(cid, i + 1, role, run, seed);
    const sr = await send(await kit.buildSubmitGroup({ player: addr(role), cid, score: run.score, sig: Buffer.from(sig.sigB64, 'base64') }), W[role]);
    console.log(`JOIN+SUBMIT ${role} seat=${i + 1} score=${run.score} join=${jr.txid.slice(0, 12)}… submit=${sr.txid.slice(0, 12)}…`);
    runC.other = runC.other ?? [];
    runC.other.push(run.score);
  }
  return { cid, seed, creatorScore: runC.score, joins };
}

async function resolveCard(cid, label) {
  const roster = await kit.readPlayers(cid);
  const signedR = roster.filter((e) => e.signed);
  const top = signedR.reduce((a, b) => (b.score > a.score ? b : a));
  const v = await verdictOf(cid);
  if (v.status !== 200) throw new Error(`verdict cid ${cid}: ${v.status}`);
  const txns = await kit.buildResolveGroup({
    caller: addr('DEPLOYER'), cid, stageIdx: v.body.stageIdx ?? 0, seedReveal: new Uint8Array(0),
    verdictSig: Buffer.from(v.body.verdictSigB64, 'base64'), winner: algosdk.encodeAddress(Uint8Array.from(top.addr)), tie: false,
  });
  const rr = await send(txns, W.DEPLOYER);
  const legs = await legsOf(rr.txid);
  const meta = await kit.readMeta(cid);
  console.log(`RESOLVE ${label} cid=${cid} txid=${rr.txid}`);
  console.log(`  legs: ${legs.join(' ; ')}`);
  console.log(`  boxes: ${meta ? 'PRESENT (unexpected)' : 'deleted'}`);
  return rr.txid;
}

// ---------- (s3) micro-duel 0.1 GONNA ----------
const s3 = await runCard({ label: 'S3 micro-duel 0.1 GONNA', stake: 100_000, seatsJoin: 1, stageMode: 1, joiners: ['PLAYER_QA2'] });
const s3resolve = await resolveCard(s3.cid, 'S3');
// (s4d) verdict on the resolved card -> 409
const vDone = await verdictOf(s3.cid);
console.log(`(s4d) verdict resolved cid=${s3.cid}: ${vDone.status} ${JSON.stringify(vDone.body).slice(0, 90)} (atteso 409)`);

// ---------- (s4a) duel 1 GONNA ----------
const s4a = await runCard({ label: 'S4a duel 1 GONNA', stake: 1_000_000, seatsJoin: 1, stageMode: 1, joiners: ['PLAYER_QA2'] });
// (s4d) verdict 200 on the fully-signed open card, BEFORE resolve
const vOpen = await verdictOf(s4a.cid);
console.log(`(s4d) verdict OPEN cid=${s4a.cid}: ${vOpen.status} stageIdx=${vOpen.body.stageIdx} playerCount=${vOpen.body.playerCount} (atteso 200)`);
const s4aresolve = await resolveCard(s4a.cid, 'S4a');

// ---------- (s4b) 3-seat full-mode 0.5 GONNA ----------
const s4b = await runCard({ label: 'S4b 3-seat full 0.5 GONNA', stake: 500_000, seatsJoin: 2, stageMode: 0, joiners: ['PLAYER_QA2', 'ORACLE'] });
const s4bresolve = await resolveCard(s4b.cid, 'S4b');

// ---------- (s4c) early_close 0 joiners ----------
const cidE = await kit.nextChallengeId();
const seedE = `PIT-${cidE}`;
const runE = playHonest(1, seedE, 40);
const sigE = await signScore(cidE, 0, 'DEPLOYER', runE, seedE);
const crE = await send(await kit.buildCreateGroup({
  creator: addr('DEPLOYER'), cid: cidE, stakeBase: 100_000, seats: 1, durationSecs: 86400,
  stageMode: 1, creatorScore: runE.score, creatorScoreSig: Buffer.from(sigE.sigB64, 'base64'), stageIdx: 1,
}), W.DEPLOYER);
console.log(`\n=== S4c early_close: cid=${cidE} create txid=${crE.txid} (0 joiners) ===`);
const er = await send(await kit.buildEarlyCloseGroup({ caller: addr('DEPLOYER'), cid: cidE }), W.DEPLOYER);
const legsE = await legsOf(er.txid);
const metaE = await kit.readMeta(cidE);
console.log(`EARLY_CLOSE txid=${er.txid}\n  legs: ${legsE.join(' ; ')}\n  boxes: ${metaE ? 'PRESENT (unexpected)' : 'deleted'}`);

// ---------- (s4e) adversarial (endpoint-only, free) ----------
console.log('\n=== S4e adversarial ===');
const cidX = await kit.nextChallengeId();
const runX = playHonest(1, `PIT-${cidX}`, 7);
const mkBody = (score, logB64) => ({
  cid: cidX, seat: 0, addr: addr('PLAYER_QA2'), score, stageMode: 'stage', stageIdx: 1, build: 'v4fc0b66e',
  run: { seedLabel: `PIT-${cidX}`, frames: runX.frames, durationSec: Math.ceil(runX.frames / 60) + 2, inputLogB64: logB64 },
});
const rInf = await fetch(`${ORACLE}/v1/sign-score`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mkBody(runX.score + 500_000, runX.inputLogB64)) });
console.log(`inflated score: ${rInf.status} ${JSON.stringify(await rInf.json().catch(() => ({}))).slice(0, 90)} (atteso 400 REPLAY MISMATCH)`);
const rawV1 = Buffer.from(runX.inputLogB64, 'base64'); rawV1[3] = 1;
const rV1 = await fetch(`${ORACLE}/v1/sign-score`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mkBody(runX.score, rawV1.toString('base64'))) });
console.log(`v1 legacy: ${rV1.status} ${JSON.stringify(await rV1.json().catch(() => ({}))).slice(0, 90)} (atteso 400 LEGACY LOG REFUSED)`);

// ---------- final balances ----------
const balOf = async (a) => {
  const i = await algod.accountInformation(a).do();
  const g = (i.assets ?? []).find((x) => Number(x.assetId) === 2582294183);
  return `${Number(i.amount) / 1e6} ALGO | ${g ? Number(g.amount) / 1e6 : 0} GONNA`;
};
console.log('\n=== final balances ===');
for (const r of ['DEPLOYER', 'PLAYER_QA2', 'ORACLE']) console.log(`${r}: ${await balOf(addr(r))}`);
console.log(`TREASURY: ${await balOf(kit.TREASURY_ADDR)}`);
console.log('=== M-3/M-4 dogfood mainnet DONE ===');
