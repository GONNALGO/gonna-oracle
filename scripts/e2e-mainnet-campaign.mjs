// E2E MAINNET CAMPAIGN (v17.0.11, Prince's full-coverage order):
//   - 3 duels PER descent stage (stages 1-7) — stage mode, PIT-<cid> seeds
//   - 1 open table with 12 invited joiners (13 players total)
//   - 1 forfeit duel (joiner never signs -> creator sweeps after SEAT_TTL)
// Every match: REAL stage runs on the shipped engine bundle, REAL oracle
// sign-score, REAL on-chain create/join/submit/resolve, payout legs verified
// via indexer (95% winner / 5% treasury / MBR back / boxes deleted).
//
// Envs:
//   E2E_BUILD   engine VER (REQUIRED — the live bundle)
//   E2E_STAKE   microGONNA per seat (default 1_000_000 = 1 GONNA)
//   E2E_FRAMES  run length cap per player (default 1800)
//   E2E_ONLY    'stages' | 'table12' | 'forfeit-create' | 'forfeit-claim' (default: stages+table12)
//
// Run from repo root: node scripts/e2e-mainnet-campaign.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const BUILD = process.env.E2E_BUILD ?? (() => { throw new Error('set E2E_BUILD=<VER>'); })();
const STAKE = Number(process.env.E2E_STAKE ?? 1_000_000);
const FRAMES = Number(process.env.E2E_FRAMES ?? 1800);
const ONLY = process.env.E2E_ONLY ?? 'all';
const ORACLE = 'https://gonna-arena-oracle-testnet.onrender.com';
const STATE_FILE = ROOT + '/.tmp-campaign-state.json';

execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--define:import.meta.env={"DEV":false,"PROD":true,"VITE_ARENA_NETWORK":"mainnet","VITE_QA_ORACLE":""}`,
  `--outfile=./.tmp-kit-campaign.mjs`], { cwd: ROOT, stdio: 'pipe' });
const kit = await import(`${ROOT}/.tmp-kit-campaign.mjs`);
const replay = await import(`${ROOT}/oracle-server/replay/replay.mjs`);
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));

const secrets = JSON.parse(readFileSync(`${ROOT}/contracts/quantum-arena/deploy/mainnet.secrets.json`, 'utf8'));
const W = {};
for (const role of Object.keys(secrets)) {
  if (secrets[role]?.mnemonic) W[role] = algosdk.mnemonicToSecretKey(secrets[role].mnemonic);
}
const addr = (r) => W[r].addr.toString();
const JOINERS12 = Array.from({ length: 12 }, (_, i) => 'QA_G' + String(i + 1).padStart(2, '0'));
for (const r of JOINERS12) if (!W[r]) throw new Error('missing wallet ' + r + ' — run scripts/gen-qa-wallets.mjs first');

const eng = await replay.loadBundle(BUILD);
const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'];

// hunting bot — actually scores (mirrors the repro suites; multi-frame holds
// + occasional sub-frame taps so the v3 edge stream gets exercised too)
function playStageRun(stageIdx, seedLabel, salt, frameCap = FRAMES, weak = false) {
  const w = typeof weak === 'number' ? weak : weak ? 1 : 0; // per-seat weakness profile
  const game = replay.bootGame(eng);
  replay.startStageRun(game, stageIdx, seedLabel);
  let f = 0;
  while (f < frameCap && game.inputLogMasks) {
    if (game.scene === 'play') {
      const es = (game.enemies ?? []).filter((e) => e.alive);
      let dir = 'right'; let near = false;
      if (es.length) {
        let best = es[0]; let bd = Math.abs(best.x - game.player.x);
        for (const e of es) { const d = Math.abs(e.x - game.player.x); if (d < bd) { bd = d; best = e; } }
        dir = best.x < game.player.x ? 'left' : 'right';
        near = bd < 40;
      }
      for (const b of BTNS) { game.input.pressed[b] = false; game.input.down[b] = false; }
      if (dir) game.input.down[dir] = true;
      const cad = 2 + (w % 3); // per-seat punch cadence — scores MUST differ
      if (near && (f + salt) % cad === 0) {
        if ((f + salt) % 6 === 0) game.input.pressed.punch = true; // sub-frame tap
        else { game.input.pressed.punch = true; game.input.down.punch = true; }
      }
      if (w % 2 === 0 && (f + salt) % (211 + w * 17) < 2) game.input.pressed.jump = true;
      game.step();
      f++;
    } else {
      for (const b of BTNS) { game.input.down[b] = false; game.input.pressed[b] = false; }
      if (game.scene === 'clear' || game.scene === 'victory') game.input.pressed.start = true;
      game.step();
    }
  }
  const sealed = game.arena?.sealedRun;
  if (sealed?.inputLogB64) return { score: Math.max(0, Math.floor(game.score)), frames: sealed.frames, inputLogB64: sealed.inputLogB64 };
  const frames = game.inputLogFrames ?? 0;
  const masks = Uint8Array.from(game.inputLogMasks.subarray(0, frames));
  const edges = game.inputLogEdges ? Uint8Array.from(game.inputLogEdges.subarray(0, frames)) : null;
  const inputLogB64 = eng.encodeInputLogB64({ v: 3, build: BUILD, seedLabel, frames, truncated: false, masks, edges });
  return { score: Math.max(0, Math.floor(game.score)), frames, inputLogB64 };
}

async function sign(cid, seat, role, run, seedLabel, stageIdx) {
  const body = {
    cid, seat, addr: addr(role), score: run.score, stageMode: 'stage', stageIdx, build: BUILD,
    run: { seedLabel, frames: run.frames, durationSec: Math.ceil(run.frames / 60) + 2, inputLogB64: run.inputLogB64 },
  };
  const r = await fetch(`${ORACLE}/v1/sign-score`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200) throw new Error(`sign ${role} cid ${cid} seat ${seat}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
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
  const r = await indexer.searchForTransactions().applicationID(kit.ARENA_APP_ID).minRound(round).maxRound(round).do();
  const legs = [];
  for (const tx of r.transactions ?? []) {
    for (const i of tx.innerTxns ?? []) {
      const a = i.assetTransferTransaction, p = i.paymentTransaction;
      if (a && Number(a.assetId) === 2582294183) legs.push({ gonna: Number(a.amount), to: a.receiver });
      if (p) legs.push({ algo: Number(p.amount), to: p.receiver });
    }
  }
  return legs;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assertLegs(legs, { pot, winnerAddr, creatorAddr, label }) {
  const treasury = 'GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU';
  const fee = Math.floor((pot * 5) / 100);
  const win = pot - fee;
  const g = legs.filter((l) => l.gonna !== undefined);
  const p = legs.filter((l) => l.algo !== undefined);
  const toWinner = g.find((l) => l.to === winnerAddr)?.gonna ?? 0;
  const toTreasury = g.find((l) => l.to === treasury)?.gonna ?? 0;
  const mbr = p.find((l) => l.to === creatorAddr)?.algo ?? 0;
  const okW = toWinner === win, okT = toTreasury === fee, okM = mbr === 358_200;
  console.log(`  legs ${label}: winner=${toWinner} (want ${win}) ${okW ? 'OK' : 'FAIL'} | treasury=${toTreasury} (want ${fee}) ${okT ? 'OK' : 'FAIL'} | MBR=${mbr} ${okM ? 'OK' : 'FAIL'}`);
  if (!okW || !okT || !okM) throw new Error(`${label}: payout legs WRONG`);
}

async function playDuel(stageIdx, creatorRole, joinerRole) {
  const cid = await kit.nextChallengeId();
  const seed = `PIT-${cid}`;
  const runC = playStageRun(stageIdx, seed, 40);
  const sigC = await sign(cid, 0, creatorRole, runC, seed, stageIdx);
  const cr = await send(await kit.buildCreateGroup({
    creator: addr(creatorRole), cid, stakeBase: STAKE, seats: 1, durationSecs: 86400,
    stageMode: 1, creatorScore: runC.score, creatorScoreSig: Buffer.from(sigC.sigB64, 'base64'), stageIdx,
  }), W[creatorRole]);
  const jr = await send(await kit.buildJoinGroup({ joiner: addr(joinerRole), cid, stakeBase: STAKE }), W[joinerRole]);
  // joiner plays a SHORTER run (frames differ -> scores differ): a duel must
  // crown a winner so the 95/5 legs get asserted (identical twin bots tie).
  const runJ = playStageRun(stageIdx, seed, 5, Math.max(600, FRAMES - 250 - stageIdx * 40), true);
  const sgJ = await sign(cid, 1, joinerRole, runJ, seed, stageIdx);
  const sr = await send(await kit.buildSubmitGroup({ player: addr(joinerRole), cid, score: runJ.score, sig: Buffer.from(sgJ.sigB64, 'base64') }), W[joinerRole]);
  // filled + all signed -> resolve immediately
  const vr = await fetch(`${ORACLE}/v1/verdict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cid }) });
  const vj = await vr.json().catch(() => ({}));
  if (vr.status !== 200) throw new Error(`duel cid ${cid}: verdict ${vr.status} ${JSON.stringify(vj).slice(0, 120)}`);
  const roster = await kit.readPlayers(cid);
  const top = roster.reduce((a, b) => (Number(b.score) > Number(a.score) ? b : a));
  const tie = Number(roster[0].score) === Number(roster[1].score);
  const rr = await send(await kit.buildResolveGroup({
    caller: addr(creatorRole), cid, stageIdx, seedReveal: new Uint8Array(0),
    verdictSig: Buffer.from(vj.verdictSigB64, 'base64'),
    winner: algosdk.encodeAddress(Uint8Array.from(top.addr)), tie,
  }), W[creatorRole]);
  await sleep(9000); // indexer lag on inner txns
  const legs = await legsOf(rr.txid);
  const meta = await kit.readMeta(cid);
  console.log(`DUEL stage ${stageIdx + 1} cid=${cid}: creator=${runC.score} joiner=${runJ.score} -> ${tie ? 'TIE/refund' : 'winner ' + addr(top === roster[0] ? creatorRole : joinerRole).slice(0, 8)} create=${cr.txid.slice(0, 10)}… resolve=${rr.txid.slice(0, 10)}… boxes=${meta ? 'PRESENT!' : 'deleted'}`);
  if (meta) throw new Error(`duel cid ${cid}: boxes not deleted after resolve`);
  if (!tie) assertLegs(legs, { pot: STAKE * 2, winnerAddr: algosdk.encodeAddress(Uint8Array.from(top.addr)), creatorAddr: addr(creatorRole), label: `cid ${cid}` });
  return { cid, creatorScore: runC.score, joinerScore: runJ.score, txid: rr.txid };
}

async function table12() {
  const stageIdx = 0; // stage 1 open table
  const SEATS = Number(process.env.E2E_SEATS || 12); // joiners (v17.0.12: production cap = 4)
  const joiners = JOINERS12.slice(0, SEATS);
  const cid = await kit.nextChallengeId();
  const seed = `PIT-${cid}`;
  const creatorRole = 'DEPLOYER';
  console.log(`=== TABLE${SEATS}: cid=${cid} stake=${STAKE} players=${SEATS + 1} build=${BUILD} ===`);
  const runC = playStageRun(stageIdx, seed, 40);
  const sigC = await sign(cid, 0, creatorRole, runC, seed, stageIdx);
  await send(await kit.buildCreateGroup({
    creator: addr(creatorRole), cid, stakeBase: STAKE, seats: SEATS, durationSecs: 86400,
    stageMode: 1, creatorScore: runC.score, creatorScoreSig: Buffer.from(sigC.sigB64, 'base64'), stageIdx,
  }), W[creatorRole]);
  console.log(`  create OK (creator score=${runC.score})`);
  const scores = [runC.score];
  for (const [i, role] of joiners.entries()) {
    await send(await kit.buildJoinGroup({ joiner: addr(role), cid, stakeBase: STAKE }), W[role]);
    const run = playStageRun(stageIdx, seed, 5 + i * 16, Math.max(700, FRAMES - i * 110), i); // distinct cadence+caps -> a real winner
    const sg = await sign(cid, i + 1, role, run, seed, stageIdx);
    await send(await kit.buildSubmitGroup({ player: addr(role), cid, score: run.score, sig: Buffer.from(sg.sigB64, 'base64') }), W[role]);
    scores.push(run.score);
    console.log(`  seat ${i + 1} ${role}: score=${run.score} joined+signed+submitted`);
  }
  const vr = await fetch(`${ORACLE}/v1/verdict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cid }) });
  const vj = await vr.json().catch(() => ({}));
  if (vr.status !== 200) throw new Error(`table12 cid ${cid}: verdict ${vr.status}`);
  const roster = await kit.readPlayers(cid);
  const top = roster.reduce((a, b) => (Number(b.score) > Number(a.score) ? b : a));
  const rr = await send(await kit.buildResolveGroup({
    caller: addr(creatorRole), cid, stageIdx, seedReveal: new Uint8Array(0),
    verdictSig: Buffer.from(vj.verdictSigB64, 'base64'),
    winner: algosdk.encodeAddress(Uint8Array.from(top.addr)), tie: false,
  }), W[creatorRole]);
  await sleep(9000);
  const legs = await legsOf(rr.txid);
  const meta = await kit.readMeta(cid);
  console.log(`  RESOLVE txid=${rr.txid} winner score=${Number(top.score)} boxes=${meta ? 'PRESENT!' : 'deleted'}`);
  if (meta) throw new Error('table12: boxes not deleted');
  assertLegs(legs, { pot: STAKE * (SEATS + 1), winnerAddr: algosdk.encodeAddress(Uint8Array.from(top.addr)), creatorAddr: addr(creatorRole), label: 'table12' });
  console.log(`=== TABLE${SEATS} DONE ===`);
}

async function forfeitCreate() {
  // duel: creator signs, joiner JOINS but never signs -> after SEAT_TTL the
  // creator sweeps 95% (the anti-grief drain plug)
  const cid = await kit.nextChallengeId();
  const seed = `PIT-${cid}`;
  const stageIdx = 1;
  const runC = playStageRun(stageIdx, seed, 40);
  const sigC = await sign(cid, 0, 'DEPLOYER', runC, seed, stageIdx);
  await send(await kit.buildCreateGroup({
    creator: addr('DEPLOYER'), cid, stakeBase: STAKE, seats: 1, durationSecs: 86400,
    stageMode: 1, creatorScore: runC.score, creatorScoreSig: Buffer.from(sigC.sigB64, 'base64'), stageIdx,
  }), W.DEPLOYER);
  await send(await kit.buildJoinGroup({ joiner: addr('QA_G12'), cid, stakeBase: STAKE }), W.QA_G12);
  const state = { forfeitCid: cid, seatedAt: Date.now() };
  writeFileSync(STATE_FILE, JSON.stringify(state));
  console.log(`FORFEIT duel armed: cid=${cid} (QA_G12 seated, never signs — claim after SEAT_TTL 3600s)`);
}

async function forfeitClaim() {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  const cid = state.forfeitCid;
  const players = await kit.readPlayers(cid);
  const seat = players.findIndex((p, i) => i > 0 && !p.signed);
  if (seat < 1) throw new Error('forfeit: no unsigned joiner seat');
  const seatedAt = Number(players[seat].seatedAt);
  const now = Math.floor(Date.now() / 1000);
  if (now < seatedAt + 3600) throw new Error(`forfeit: SEAT_TTL not lapsed (${seatedAt + 3600 - now}s left)`);
  const r = await send(await kit.buildClaimForfeitGroup({ caller: addr('DEPLOYER'), cid, seat }), W.DEPLOYER);
  await sleep(9000);
  const legs = await legsOf(r.txid);
  const meta = await kit.readMeta(cid);
  console.log(`FORFEIT claimed: cid=${cid} txid=${r.txid} boxes=${meta ? 'PRESENT!' : 'deleted'}`);
  if (meta) throw new Error('forfeit: boxes not deleted');
  // forfeit legs differ from resolve: the signed caller gets his OWN stake
  // back in full + 95% of the FORFEITED seat; treasury takes 5% of the
  // forfeited seat only; MBR back to the creator. (cid 29 verified on-chain:
  // 1000000 + 950000 / 50000 / 358200.)
  const dep = addr('DEPLOYER'), tre = 'GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU';
  const toW = legs.filter((l) => l.gonna && l.to === dep).reduce((x, l) => x + l.gonna, 0);
  const toT = legs.filter((l) => l.gonna && l.to === tre).reduce((x, l) => x + l.gonna, 0);
  const mbr = legs.filter((l) => l.algo && l.to === dep).reduce((x, l) => x + l.algo, 0);
  const okF = toW === STAKE + Math.floor((STAKE * 95) / 100) && toT === Math.floor((STAKE * 5) / 100) && mbr === 358_200;
  console.log(`  legs forfeit: winner=${toW} treasury=${toT} MBR=${mbr} ${okF ? 'OK' : 'FAIL'}`);
  if (!okF) throw new Error('forfeit: payout legs WRONG');
}

// ---------- run ----------
const results = [];
if (ONLY === 'all' || ONLY === 'stages') {
  const joinerPool = ['PLAYER_QA2', 'PLAYER_QA3', 'PLAYER_QA4', 'ORACLE', ...JOINERS12.slice(0, 8)];
  for (let stage = 0; stage < 7; stage++) {
    for (let m = 0; m < 3; m++) {
      const creator = m % 2 === 0 ? 'DEPLOYER' : 'PLAYER_QA2';
      const joiner = joinerPool[(stage * 3 + m) % joinerPool.length];
      const r = await playDuel(stage, creator, joiner);
      results.push(r);
    }
    console.log(`--- stage ${stage + 1}: 3/3 duels green ---`);
  }
}
if (ONLY === 'all' || ONLY === 'table12') await table12();
// v17.0.12: finish a FILLED table whose last seat joined but never signed
// (oracle rejects runs < 600 frames — the old harness clamp dipped below).
// Signs every seated-but-unsigned roster seat with a fresh valid run, then
// resolves and asserts the legs. Usage: E2E_ONLY=finish E2E_CID=66
if (ONLY === 'finish') {
  const cid = Number(process.env.E2E_CID || 0);
  if (!cid) throw new Error('E2E_CID required');
  const stageIdx = 0; const seed = `PIT-${cid}`;
  const roster = await kit.readPlayers(cid);
  console.log(`=== FINISH cid=${cid}: ${roster.length} seated ===`);
  for (const [i, p] of roster.entries()) {
    if (Number(p.score) !== 0 || p.signed) { console.log(`  seat ${i}: already signed (${Number(p.score)})`); continue; }
    const role = JOINERS12.find((r) => addr(r) === algosdk.encodeAddress(Uint8Array.from(p.addr)));
    if (!role) throw new Error('seat ' + i + ' wallet not in QA roster');
    const run = playStageRun(stageIdx, seed, 5 + i * 16, 800, i);
    const sg = await sign(cid, i, role, run, seed, stageIdx);
    await send(await kit.buildSubmitGroup({ player: addr(role), cid, score: run.score, sig: Buffer.from(sg.sigB64, 'base64') }), W[role]);
    console.log(`  seat ${i} ${role}: score=${run.score} signed+submitted`);
  }
  const vr = await fetch(`${ORACLE}/v1/verdict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cid }) });
  const vj = await vr.json().catch(() => ({}));
  if (vr.status !== 200) throw new Error(`finish cid ${cid}: verdict ${vr.status} ${JSON.stringify(vj).slice(0, 160)}`);
  const roster2 = await kit.readPlayers(cid);
  const top = roster2.reduce((a, b) => (Number(b.score) > Number(a.score) ? b : a));
  // v17.0.12: duplicate top score = the CONTRACT resolves as a perfect tie
  // (full refunds, n+1 inner legs). Detect it and fund the tie path —
  // passing tie:false here underfunds the group by exactly the refund legs.
  const nTop = roster2.filter((p) => Number(p.score) === Number(top.score)).length;
  const isTie = nTop > 1;
  console.log(`  top score=${Number(top.score)} x${nTop} -> ${isTie ? 'TIE/refund path' : 'winner path'}`);
  // v17.0.12: on a big TIE the caller must NOT be seated — the access list
  // (16 refs) carries 13 roster addrs + the ASA + 2 boxes; a seated caller's
  // holding would need a 17th ref. QA4 is never at the table here.
  const resolver = isTie && roster2.length > 2 ? 'PLAYER_QA4' : 'DEPLOYER';
  console.log('  resolver: ' + resolver);
  const rr = await send(await kit.buildResolveGroup({
    caller: addr(resolver), cid, stageIdx, seedReveal: new Uint8Array(0),
    verdictSig: Buffer.from(vj.verdictSigB64, 'base64'),
    winner: algosdk.encodeAddress(Uint8Array.from(top.addr)), tie: isTie,
  }), W[resolver]);
  await sleep(9000);
  const legs = await legsOf(rr.txid);
  const meta = await kit.readMeta(cid);
  console.log(`  RESOLVE txid=${rr.txid} boxes=${meta ? 'PRESENT!' : 'deleted'}`);
  if (meta) throw new Error('finish: boxes not deleted');
  if (isTie) {
    // every signed seat refunded its full stake; MBR back to creator; NO treasury leg
    const refunds = legs.filter((l) => l.gonna === STAKE);
    const treasuryLeg = legs.find((l) => l.gonna && l.to === 'GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU');
    const mbr = legs.find((l) => l.algo && l.to === addr('DEPLOYER'));
    console.log(`  tie legs: refunds=${refunds.length}/${roster2.length} treasury=${treasuryLeg ? 'PRESENT!' : 'none OK'} MBR=${mbr ? mbr.algo : 0}`);
    if (refunds.length !== roster2.length || treasuryLeg || !mbr || mbr.algo !== 358_200) throw new Error('finish: tie legs wrong');
  } else {
    assertLegs(legs, { pot: STAKE * roster2.length, winnerAddr: algosdk.encodeAddress(Uint8Array.from(top.addr)), creatorAddr: addr('DEPLOYER'), label: 'finish' + cid });
  }
  console.log(`=== FINISH cid=${cid} DONE ===`);
}
if (ONLY === 'forfeit-create') await forfeitCreate();
if (ONLY === 'forfeit-claim') await forfeitClaim();
console.log('=== CAMPAIGN DONE: ' + results.length + ' duels + table12 all green ===');
