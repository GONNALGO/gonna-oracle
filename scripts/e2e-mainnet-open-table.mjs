// E2E MAINNET OPEN TABLE (post-fix dogfood) — PREPARED, not yet executed.
//
// Flow: DEPLOYER creates a FULL-mode open table (stake GONNA/seat), QA joiner
// seats, plays a real seeded full run, signs, submits; verdict → resolve →
// legs verified via indexer (95/5, MBR back, boxes closed).
//
// ORDER MATTERS (proven live 2026-08-27): the joiner must JOIN before SIGN —
// /v1/sign-score rejects seats not yet in the on-chain roster
// ("seat out of roster range"). Creator sign is PRE-create
// (cid == next_challenge_id), joiner sign is POST-join.
//
// Envs:
//   E2E_BUILD   engine VER to play/sign with (default: latest live bundle
//               discovered from the oracle /v1/health boot bundles — set
//               explicitly post-fix, e.g. E2E_BUILD=vXXXXXXXX)
//   E2E_STAKE   stake base units per seat (default 2_000_000 = 2 GONNA)
//   E2E_SEATS   joiner seats: 1|4|8|12 (default 1 = duel open table;
//               4 uses QA2+ORACLE+QA3+QA4)
//   E2E_FRAMES  run length cap (default 7200)
//
// Run from the repo root:  node scripts/e2e-mainnet-open-table.mjs
// Requires contracts/quantum-arena/deploy/mainnet.secrets.json (0600, gitignored).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const BUILD_ENV = process.env.E2E_BUILD ?? null;
const STAKE = Number(process.env.E2E_STAKE ?? 2_000_000);
const SEATS = Number(process.env.E2E_SEATS ?? 1);
const FRAMES = Number(process.env.E2E_FRAMES ?? 7200);
const ORACLE = 'https://gonna-arena-oracle-testnet.onrender.com';

execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--define:import.meta.env={"DEV":false,"PROD":true,"VITE_ARENA_NETWORK":"mainnet","VITE_QA_ORACLE":""}`,
  `--outfile=./.tmp-kit-e2e.mjs`], { cwd: ROOT, stdio: 'pipe' });
const kit = await import(`${ROOT}/.tmp-kit-e2e.mjs`);
const replay = await import(`${ROOT}/oracle-server/replay/replay.mjs`);
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));

const secrets = JSON.parse(readFileSync(`${ROOT}/contracts/quantum-arena/deploy/mainnet.secrets.json`, 'utf8'));
const W = {};
for (const role of ['DEPLOYER', 'PLAYER_QA2', 'PLAYER_QA3', 'PLAYER_QA4', 'ORACLE']) {
  if (secrets[role]) W[role] = algosdk.mnemonicToSecretKey(secrets[role].mnemonic);
}
const addr = (r) => W[r].addr.toString();
const JOINER_BY_SEAT = { 1: ['PLAYER_QA2'], 4: ['PLAYER_QA2', 'ORACLE', 'PLAYER_QA3', 'PLAYER_QA4'] }[SEATS];
if (!JOINER_BY_SEAT) throw new Error('E2E_SEATS must be 1 or 4 (QA wallets available)');

// build VER: explicit env wins; else refuse loudly (post-fix bundle MUST be pinned)
const BUILD = BUILD_ENV ?? (() => { throw new Error('set E2E_BUILD=<VER> (post-fix bundle)'); })();
const eng = await replay.loadBundle(BUILD);

const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'];
function playFullRun(seedLabel, salt) {
  let lastMasks = null, lastFrames = 0;
  const game = replay.bootGame(eng);
  replay.startFullRunSeeded(eng, game, seedLabel);
  for (let f = 0; f < FRAMES; f++) {
    let v = 8; const q = (f + salt) % 90;
    if (q >= 30 && q < 60) v = 0;
    if (q === 34 || q === 42 || q === 68) v |= 16;
    if (q === 58) v |= 32;
    if (q === 70) v |= 64;
    const down = game.input.down, pressed = game.input.pressed;
    for (let b = 0; b < 8; b++) { const on = ((v >> b) & 1) === 1; if (on && !down[BTNS[b]]) pressed[BTNS[b]] = true; down[BTNS[b]] = on; }
    game.step();
    if (game.inputLogMasks) { lastMasks = game.inputLogMasks.slice(0, game.inputLogFrames); lastFrames = game.inputLogFrames; }
  }
  const sealed = game.arena?.sealedRun;
  const frames = sealed?.frames ?? lastFrames;
  const inputLogB64 = sealed?.inputLogB64
    ?? eng.encodeInputLogB64({ v: 2, build: BUILD, seedLabel, frames, truncated: false, masks: Uint8Array.from(lastMasks) });
  return { score: game.score, frames, inputLogB64 };
}

async function sign(cid, seat, role, run, seedLabel) {
  const body = {
    cid, seat, addr: addr(role), score: run.score, stageMode: 'full', build: BUILD,
    run: { seedLabel, frames: run.frames, durationSec: Math.ceil(run.frames / 60) + 2, inputLogB64: run.inputLogB64 },
  };
  const r = await fetch(`${ORACLE}/v1/sign-score`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200) throw new Error(`sign ${role} cid ${cid}: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

const algod = await kit.algodClient();
async function send(txns, signer) {
  algosdk.assignGroupID(txns);
  const signed = txns.map((t) => t.signTxn(signer.sk));
  const r = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, r.txid, 10);
  return { txid: r.txid };
}
const indexer = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', '');
async function legsOf(txid) {
  const t = await indexer.lookupTransactionByID(txid).do();
  const round = Number(t.transaction.confirmedRound);
  const r = await indexer.searchForTransactions().applicationID(kit.NET.appId).minRound(round).maxRound(round).do();
  const legs = [];
  for (const tx of r.transactions ?? []) {
    for (const i of tx.innerTxns ?? []) {
      const a = i.assetTransferTransaction, p = i.paymentTransaction;
      if (a && Number(a.assetId) === 2582294183) legs.push(`${a.amount} GONNA-u -> ${a.receiver.slice(0, 8)}…`);
      if (p) legs.push(`${p.amount} µA -> ${p.receiver.slice(0, 8)}…`);
    }
  }
  return legs;
}

// ---------- flow ----------
const cid = await kit.nextChallengeId();
const seed = `RUN-${cid}`;
console.log(`=== E2E open table: cid=${cid} stake=${STAKE} seats=${1 + SEATS} build=${BUILD} ===`);

const runC = playFullRun(seed, 40);
const sigC = await sign(cid, 0, 'DEPLOYER', runC, seed);
const cr = await send(await kit.buildCreateGroup({
  creator: addr('DEPLOYER'), cid, stakeBase: STAKE, seats: SEATS, durationSecs: 86400,
  stageMode: 0, creatorScore: runC.score, creatorScoreSig: Buffer.from(sigC.sigB64, 'base64'), stageIdx: 1,
}), W.DEPLOYER);
console.log(`CREATE txid=${cr.txid} (creator sealed score=${runC.score})`);

for (const [i, role] of JOINER_BY_SEAT.entries()) {
  const jr = await send(await kit.buildJoinGroup({ joiner: addr(role), cid, stakeBase: STAKE }), W[role]);
  const run = playFullRun(seed, 5 + i * 16);
  const sg = await sign(cid, i + 1, role, run, seed);
  const sr = await send(await kit.buildSubmitGroup({ player: addr(role), cid, score: run.score, sig: Buffer.from(sg.sigB64, 'base64') }), W[role]);
  console.log(`JOIN+SUBMIT ${role} seat=${i + 1} score=${run.score} join=${jr.txid.slice(0, 12)}… submit=${sr.txid.slice(0, 12)}…`);
}

// verdict (200 expected on fully-signed open card)
const vr = await fetch(`${ORACLE}/v1/verdict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cid }) });
const vj = await vr.json().catch(() => ({}));
console.log(`verdict: ${vr.status} ${JSON.stringify(vj).slice(0, 120)}`);
if (vr.status !== 200) throw new Error('verdict not ready');

// winner = top scorer from the on-chain roster (tie -> zero addr impossible here)
const roster = await kit.readPlayers(cid);
const top = roster.reduce((a, b) => (Number(b.score) > Number(a.score) ? b : a));
const rr = await send(await kit.buildResolveGroup({
  caller: addr('DEPLOYER'), cid, stageIdx: vj.stageIdx ?? 0, seedReveal: new Uint8Array(0),
  verdictSig: Buffer.from(vj.verdictSigB64, 'base64'),
  winner: algosdk.encodeAddress(Uint8Array.from(top.addr)), tie: false,
}), W.DEPLOYER);
const legs = await legsOf(rr.txid);
const meta = await kit.readMeta(cid);
console.log(`RESOLVE txid=${rr.txid}\n  legs: ${legs.join(' ; ')}\n  boxes: ${meta ? 'PRESENT (unexpected)' : 'deleted'}`);
console.log('=== E2E open table DONE ===');
