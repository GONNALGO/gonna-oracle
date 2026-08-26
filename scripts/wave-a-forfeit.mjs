// wave-a-forfeit.mjs — WAVE A (e): duel, joiner silent, claim_forfeit after SEAT_TTL.
// Runs in background: creates + submits creator, joins joiner, waits out the
// 1h seat clock, then claims forfeit and prints events + inner legs.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DEPLOY = path.join(ROOT, 'contracts/quantum-arena/deploy');
const ORACLE = (process.env.ORACLE_URL ?? 'https://gonna-arena-oracle-testnet.onrender.com').replace(/\/$/, '');
const KIT_OUT = path.join(ROOT, '.tmp-kit-wavef.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--define:import.meta.env={"DEV":false,"PROD":true,"VITE_QA_ORACLE":""}`,
  `--outfile=${KIT_OUT}`], { cwd: ROOT, stdio: 'pipe' });
const kit = await import(KIT_OUT);
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));
const replay = await import('../oracle-server/replay/replay.mjs');
const eng = await replay.loadBundle(process.env.SMOKE_BUILD ?? 'v53365263');

const secrets = JSON.parse(readFileSync(DEPLOY + '/testnet.secrets.json', 'utf8'));
const W = {};
for (const role of ['PLAYER_A', 'PLAYER_B']) W[role] = algosdk.mnemonicToSecretKey(secrets[role].mnemonic);
const addr = (r) => W[r].addr.toString();
const algod = await kit.algodClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STAKE = 1_000_000;
const enc = (pk) => algosdk.encodeAddress(pk instanceof Uint8Array ? pk : Uint8Array.from(pk));

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
  const sealed = game.arena?.sealedRun;
  return { score: game.score, frames: game.inputLogFrames, inputLogB64: sealed.inputLogB64 };
}
async function signScore(cid, seat, role, run, seedLabel) {
  const r = await fetch(`${ORACLE}/v1/sign-score`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      cid, seat, addr: addr(role), score: run.score, stageMode: 'stage', stageIdx: 1, build: 'v53365263',
      run: { seedLabel, frames: run.frames, durationSec: Math.ceil(run.frames / 60) + 2, inputLogB64: run.inputLogB64 },
    }),
  });
  if (r.status !== 200) throw new Error(`sign-score ${r.status}: ${await r.text()}`);
  return (await r.json()).sigB64;
}

console.log('=== WAVE A (e) CLAIM_FORFEIT — duel, silent joiner ===');
const cid = await kit.nextChallengeId();
console.log(`cid=${cid} (next_challenge_id)`);
const seedLabel = `PIT-${cid}`;
const runA = playHonest(1, seedLabel, 11);
const sigA = await signScore(cid, 0, 'PLAYER_A', runA, seedLabel);
console.log(`creator run: score=${runA.score} sig ok (oracle pubblico)`);
const cr = await send(await kit.buildCreateGroup({
  creator: addr('PLAYER_A'), cid, stakeBase: STAKE, seats: 1, durationSecs: 86400,
  stageMode: 1, creatorScore: runA.score, creatorScoreSig: Buffer.from(sigA, 'base64'), stageIdx: 1,
}), W.PLAYER_A);
console.log(`CREATE txid=${cr.txid} round=${cr.round}`);
// creator is ALREADY signed at create time (contract: entry signed=True,
// creatorScore sealed) — a second submit is rejected ('score already
// submitted'). claim_forfeit only needs the caller to hold a signed score.
console.log('creator signed at create (sealed score) — no submit needed');
const jr = await send(await kit.buildJoinGroup({ joiner: addr('PLAYER_B'), cid, stakeBase: STAKE }), W.PLAYER_B);
console.log(`JOIN joiner (seat 1, will stay SILENT) txid=${jr.txid}`);
const seatedAt = Math.floor(Date.now() / 1000);
const claimAt = seatedAt + 3600 + 90; // SEAT_TTL + safety margin
console.log(`seated_at~${seatedAt} — claim_forfeit possible after ${claimAt} (${new Date(claimAt * 1000).toISOString()})`);

// wait out the seat clock
for (;;) {
  const now = Math.floor(Date.now() / 1000);
  if (now > claimAt) break;
  await sleep(Math.min(300_000, (claimAt - now) * 1000));
  console.log(`  waiting… now=${Math.floor(Date.now() / 1000)} (claim at ${claimAt})`);
}

// pre-claim state
const rosterPre = await kit.readPlayers(cid);
console.log(`pre-claim roster: signed=[${rosterPre.map((p) => p.signed).join(',')}]`);
const trePre = await algod.accountInformation(kit.TREASURY_ADDR).do();
const aPre = await algod.accountInformation(addr('PLAYER_A')).do();
const gonnaOf = (i) => Number((i.assets ?? []).find((x) => Number(x.assetId) === kit.GONNA_ASA_TESTNET)?.amount ?? 0);

const fr = await send(await kit.buildClaimForfeitGroup({ caller: addr('PLAYER_A'), cid, seat: 1 }), W.PLAYER_A);
console.log(`CLAIM_FORFEIT txid=${fr.txid} round=${fr.round}`);
const trePost = await algod.accountInformation(kit.TREASURY_ADDR).do();
const aPost = await algod.accountInformation(addr('PLAYER_A')).do();
const inner = fr.info.innerTxns ?? fr.info['inner-txns'] ?? [];
for (const [i, t] of inner.entries()) {
  const tx = t.txn?.txn ?? {};
  const kind = tx.type;
  const amt = kind === 'axfer' ? tx.aamt : tx.amt;
  const rcv = tx.arcv ?? tx.rcv;
  console.log(`  inner[${i}] ${kind} amount=${amt} -> ${rcv ? algosdk.encodeAddress(Uint8Array.from(rcv)) : '?'}`);
}
console.log(`GONNA deltas: PLAYER_A ${gonnaOf(aPost) - gonnaOf(aPre)} (atteso +${STAKE} + ${Math.floor(STAKE * 0.95)} = stake back + 95% forfeit), TREASURY ${gonnaOf(trePost) - gonnaOf(trePre)} (atteso +${STAKE - Math.floor(STAKE * 0.95)} fee 5%)`);
const logs = (fr.info.logs ?? []).map((l) => Buffer.from(l, 'base64').toString('hex'));
console.log(`logs: ${logs.join(' ')}`);
const metaPost = await kit.readMeta(cid);
console.log(`post-claim meta: ${metaPost ? 'PRESENT (unexpected!)' : 'deleted (boxes closed)'}`);
console.log('=== (e) DONE ===');
