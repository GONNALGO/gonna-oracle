// RACE REPRO: prove that a create signed against a STALE next_challenge_id is
// rejected by algod with a 400 AT sendRawTransaction — the exact founder
// toast. The oracle score sig is cid-bound; the frontend reads the counter,
// THEN waits for the wallet signature (a long manual window on a real
// device). Any concurrent create in that window poisons the group.
// No state is created on-chain (the group is rejected). Secrets never printed.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node', `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`, '--outfile=.tmp-kit-race.mjs'], { cwd: '/mnt/agents/output/app', stdio: 'pipe' });
// crypto.subtle shim for node<19 style envs is unnecessary on node 20 (webcrypto global).
const kit = await import('/mnt/agents/output/app/.tmp-kit-race.mjs');
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));
const nacl = (await import('tweetnacl')).default;

const secrets = JSON.parse(readFileSync('/mnt/agents/output/app/contracts/quantum-arena/deploy/testnet.secrets.json', 'utf8'));
const me = algosdk.mnemonicToSecretKey(secrets.PLAYER_A.mnemonic);
const oracleSk = algosdk.mnemonicToSecretKey(secrets.ORACLE.mnemonic).sk.slice(0, 32);
const oracleKp = nacl.sign.keyPair.fromSeed(oracleSk);

const cidNow = await kit.nextChallengeId();
const staleCid = cidNow - 1; // oracle sig bound to a cid the counter has passed
console.log('next_challenge_id =', cidNow, '— signing create for STALE cid =', staleCid);

const score = 1234;
const msg = kit.scoreMsg(staleCid, 0, me.addr.publicKey ?? algosdk.decodeAddress(me.addr.toString()).publicKey, score);
const sig = nacl.sign.detached(msg, oracleKp.secretKey);

const txns = await kit.buildCreateGroup({
  creator: me.addr.toString(),
  cid: staleCid,
  stakeBase: 1_000_000,
  seats: 1,
  durationSecs: 86400,
  stageMode: 1,
  creatorScore: score,
  creatorScoreSig: sig,
});
algosdk.assignGroupID(txns);
const signed = txns.map((t) => t.signTxn(me.sk));
const algod = await kit.algodClient();
try {
  const res = await algod.sendRawTransaction(signed).do();
  console.log('UNEXPECTED SUCCESS', res);
} catch (e) {
  console.log('--- ALGOD REJECTION (founder toast source) ---');
  console.log('name:', e.name);
  console.log('status:', e.status ?? e.response?.status);
  console.log('FULL e.message:');
  console.log(e.message);
  const body = e.response?.body ?? e.body;
  if (body) {
    try { console.log('BODY:', new TextDecoder().decode(body)); } catch { console.log('BODY(raw):', String(body).slice(0, 500)); }
  }
}
