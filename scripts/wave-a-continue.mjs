// wave-a-continue.mjs — WAVE A (c): CONTINUE receipt flow.
// duel: creator A (sealed), joiner B plays run1 (dies, NOT submitted),
// B pays 5 ALGO continue (QA-CONTINUE note) -> receipt via oracle ->
// re-sign run2 with continueRef -> submit run2 (accepted) -> dup checks (409)
// -> verdict + resolve with leg verification.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DEPLOY = path.join(ROOT, 'contracts/quantum-arena/deploy');
const ORACLE = (process.env.ORACLE_URL ?? 'https://gonna-arena-oracle-testnet.onrender.com').replace(/\/$/, '');
const KIT_OUT = path.join(ROOT, '.tmp-kit-wavec.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--define:import.meta.env={"DEV":false,"PROD":true,"VITE_QA_ORACLE":""}`,
  `--outfile=${KIT_OUT}`], { cwd: ROOT, stdio: 'pipe' });
const kit = await import(KIT_OUT);
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));
const replay = await import('../oracle-server/replay/replay.mjs');
const eng = await replay.loadBundle('v53365263');
const secrets = JSON.parse(readFileSync(DEPLOY + '/testnet.secrets.json', 'utf8'));
const W = {};
for (const role of ['PLAYER_A', 'PLAYER_B', 'TREASURY']) W[role] = algosdk.mnemonicToSecretKey(secrets[role].mnemonic);
const addr = (r) => W[r].addr.toString();
const algod = await kit.algodClient();
const indexer = new algosdk.Indexer('', 'https://testnet-idx.algonode.cloud', '');
const STAKE = 1_000_000;

async function send(txns, signers) {
  algosdk.assignGroupID(txns);
  const signed = txns.map((t, i) => t.signTxn((Array.isArray(signers) ? signers[i] : signers).sk));
  const r = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, r.txid, 10);
  const info = await algod.pendingTransactionInformation(r.txid).do();
  return { txid: r.txid, round: Number(info.confirmedRound ?? 0), info };
}
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
async function signScore(cid, seat, role, run, seedLabel, continueRef) {
  const body = {
    cid, seat, addr: addr(role), score: run.score, stageMode: 'stage', stageIdx: 1, build: 'v53365263',
    run: { seedLabel, frames: run.frames, durationSec: Math.ceil(run.frames / 60) + 2, inputLogB64: run.inputLogB64 },
  };
  if (continueRef) body.continueRef = continueRef;
  const r = await fetch(`${ORACLE}/v1/sign-score`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

console.log('=== (c) CONTINUE receipt flow ===');
// CID_RESUME: resume an already-created+joined card (rerun after a mid-flow fix)
const RESUME = process.env.CID_RESUME ? Number(process.env.CID_RESUME) : null;
const cid = RESUME ?? (await kit.nextChallengeId());
const seedLabel = `PIT-${cid}`;
console.log(`cid=${cid} seed=${seedLabel}`);
// creator A: strong run (sealed at create)
let runA;
if (RESUME) {
  const roster = await kit.readPlayers(cid);
  runA = { score: roster[0].score };
  console.log(`RESUME cid=${cid}: creator sealed score=${runA.score}, joiner in seat 1`);
} else {
  runA = playHonest(1, seedLabel, 40);
  const sigA = (await signScore(cid, 0, 'PLAYER_A', runA, seedLabel));
  if (sigA.status !== 200) throw new Error('creator sign failed: ' + JSON.stringify(sigA.body));
  const cr = await send(await kit.buildCreateGroup({
    creator: addr('PLAYER_A'), cid, stakeBase: STAKE, seats: 1, durationSecs: 86400,
    stageMode: 1, creatorScore: runA.score, creatorScoreSig: Buffer.from(sigA.body.sigB64, 'base64'), stageIdx: 1,
  }), W.PLAYER_A);
  console.log(`CREATE txid=${cr.txid} (creator sealed score=${runA.score})`);
  const jr = await send(await kit.buildJoinGroup({ joiner: addr('PLAYER_B'), cid, stakeBase: STAKE }), W.PLAYER_B);
  console.log(`JOIN txid=${jr.txid}`);
}
// B plays run 1 — dies early (LOW score), does NOT submit
const runB1 = playHonest(1, seedLabel, 5);
console.log(`B run1 (dies): score=${runB1.score} — NOT submitted`);
// B pays 5 ALGO continue
const refId = `WAVE-C-${cid}-${Date.now().toString(36)}`;
const pay = await send(await kit.buildContinuePayment({ sender: addr('PLAYER_B'), refId }), W.PLAYER_B);
console.log(`CONTINUE PAY 5 ALGO txid=${pay.txid} refId=${refId}`);
// register receipt
const rec = await fetch(`${ORACLE}/v1/continue/receipt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refId, addr: addr('PLAYER_B'), txid: pay.txid }) });
console.log(`receipt register: ${rec.status} ${JSON.stringify(await rec.json().catch(() => ({})))}`);
// DUP receipt register -> 409
const rec2 = await fetch(`${ORACLE}/v1/continue/receipt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refId, addr: addr('PLAYER_B'), txid: pay.txid }) });
console.log(`receipt register DUP: ${rec2.status} ${JSON.stringify(await rec2.json().catch(() => ({})))} (atteso 409)`);
// B plays run 2 (continue) — better run, sign with continueRef
const runB2 = playHonest(1, seedLabel, 21);
const sigB2 = await signScore(cid, 1, 'PLAYER_B', runB2, seedLabel, refId);
console.log(`sign run2 with continueRef: ${sigB2.status} (atteso 200, receipt consumato)`);
// DUP consume -> 409
const sigDup = await signScore(cid, 1, 'PLAYER_B', runB2, seedLabel, refId);
console.log(`sign with SAME continueRef DUP: ${sigDup.status} ${JSON.stringify(sigDup.body)} (atteso 409 already consumed)`);
// submit run 2
const sr = await send(await kit.buildSubmitGroup({ player: addr('PLAYER_B'), cid, score: runB2.score, sig: Buffer.from(sigB2.body.sigB64, 'base64') }), W.PLAYER_B);
console.log(`SUBMIT run2 (continue) txid=${sr.txid} score=${runB2.score} — second score ACCEPTED on-chain`);
// verdict + resolve
const v = await fetch(`${ORACLE}/v1/verdict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cid }) });
const vj = await v.json();
console.log(`verdict: ${v.status} ${JSON.stringify(vj).slice(0, 140)}`);
const gonnaOf = async (a) => {
  const i = await algod.accountInformation(a).do();
  return Number((i.assets ?? []).find((x) => Number(x.assetId) === kit.GONNA_ASA_TESTNET)?.amount ?? 0);
};
const preTre = await gonnaOf(kit.TREASURY_ADDR);
const rosterR = await kit.readPlayers(cid);
const signedR = rosterR.filter((e) => e.signed);
const topR = signedR.reduce((a, b) => (b.score > a.score ? b : a));
const resolveTxns = await kit.buildResolveGroup({
  caller: addr('TREASURY'), cid, stageIdx: vj.stageIdx ?? 0, seedReveal: new Uint8Array(0),
  verdictSig: Buffer.from(vj.verdictSigB64, 'base64'), winner: algosdk.encodeAddress(Uint8Array.from(topR.addr)), tie: false,
});
const rr = await send(resolveTxns, W.TREASURY);
console.log(`RESOLVE txid=${rr.txid} round=${rr.round}`);
const closeTx = await indexer.lookupTransactionByID(rr.txid).do();
const legs = (closeTx.transaction.innerTxns ?? []).map((i) => {
  const p = i.paymentTransaction, a = i.assetTransferTransaction;
  if (a) return `axfer ${a.amount} -> ${a.receiver.slice(0, 8)}…`;
  if (p) return `pay ${p.amount} microA -> ${p.receiver.slice(0, 8)}…`;
  return i.txType;
});
console.log(`resolve inner legs: ${legs.join(' ; ')}`);
const winner = runB2.score > runA.score ? 'PLAYER_B (continue vince!)' : 'PLAYER_A';
console.log(`scores: A=${runA.score} B=${runB2.score} -> winner atteso: ${winner}`);
console.log('=== (c) DONE ===');
