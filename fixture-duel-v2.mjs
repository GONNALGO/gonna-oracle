// FIXTURE: re-create the test-v2.mjs PART C duel on the v2 app — PLAYER_A
// creates a SIGNED duel, PLAYER_B joins and stays UNSIGNED (seat clock QA).
// Mirrors deploy/smoke_v2_testnet.py Scenario 1 exactly, minus the rumble
// (rumble cid 3 is still OPEN on-chain and stays the board fixture).
// Updates deploy/testnet.json smoke_v2.duel_* fields. Secrets never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node', `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`, '--outfile=.tmp-kit-fixture.mjs'], { cwd: '/mnt/agents/output/app', stdio: 'pipe' });
const kit = await import('/mnt/agents/output/app/.tmp-kit-fixture.mjs');
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));
const nacl = (await import('tweetnacl')).default;

const DEPLOY = '/mnt/agents/output/app/contracts/quantum-arena/deploy';
const secrets = JSON.parse(readFileSync(DEPLOY + '/testnet.secrets.json', 'utf8'));
const state = JSON.parse(readFileSync(DEPLOY + '/testnet.json', 'utf8'));

const A = algosdk.mnemonicToSecretKey(secrets.PLAYER_A.mnemonic);
const B = algosdk.mnemonicToSecretKey(secrets.PLAYER_B.mnemonic);
const oracleSk = algosdk.mnemonicToSecretKey(secrets.ORACLE.mnemonic).sk.slice(0, 32);
const oracleKp = nacl.sign.keyPair.fromSeed(oracleSk);
const STAKE = 1_000_000;

const cid = await kit.nextChallengeId();
const score = 1000;
const sig = nacl.sign.detached(kit.scoreMsg(cid, 0, A.addr.publicKey, score), oracleKp.secretKey);

const createTxns = await kit.buildCreateGroup({
  creator: A.addr.toString(), cid, stakeBase: STAKE, seats: 1,
  durationSecs: 86400, stageMode: 0, creatorScore: score, creatorScoreSig: sig,
});
algosdk.assignGroupID(createTxns);
const algod = await kit.algodClient();
const createRes = await algod.sendRawTransaction(createTxns.map((t) => t.signTxn(A.sk))).do();
await algosdk.waitForConfirmation(algod, createRes.txid, 10);
console.log('fixture duel CREATE cid=' + cid + ' txid=' + createRes.txid);

const joinTxns = await kit.buildJoinGroup({ joiner: B.addr.toString(), cid, stakeBase: STAKE });
algosdk.assignGroupID(joinTxns);
const joinRes = await algod.sendRawTransaction(joinTxns.map((t) => t.signTxn(B.sk))).do();
await algosdk.waitForConfirmation(algod, joinRes.txid, 10);
console.log('fixture duel JOIN (B UNSIGNED) txid=' + joinRes.txid);

const players = await kit.readPlayers(cid);
const seatedAt = Number(players[1].seatedAt);
console.log('roster: A signed=' + players[0].signed + ' score=' + players[0].score + ' | B signed=' + players[1].signed + ' seated_at=' + seatedAt);
if (players[1].signed) throw new Error('B must stay UNSIGNED');

state.smoke_v2 = {
  ...state.smoke_v2,
  duel_create_cid: cid,
  duel_create_txid: createRes.txid,
  duel_join_txid: joinRes.txid,
  duel_forfeit_claimable_after: seatedAt + 3600,
};
writeFileSync(DEPLOY + '/testnet.json', JSON.stringify(state, null, 2) + '\n');
console.log('testnet.json smoke_v2.duel_create_cid = ' + cid + ' (rumble fixture cid 3 kept)');
