// wave-a-resolve31.mjs — standalone verdict + resolve for an already-fully-signed card.
// Usage: CID=31 node scripts/wave-a-resolve31.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname;
const DEPLOY = path.join(ROOT, 'contracts/quantum-arena/deploy');
const ORACLE = (process.env.ORACLE_URL ?? 'https://gonna-arena-oracle-testnet.onrender.com').replace(/\/$/, '');
const KIT_OUT = path.join(ROOT, '.tmp-kit-waver31.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--define:import.meta.env={"DEV":false,"PROD":true,"VITE_QA_ORACLE":""}`,
  `--outfile=${KIT_OUT}`], { cwd: ROOT, stdio: 'pipe' });
const kit = await import(KIT_OUT);
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));
const secrets = JSON.parse(readFileSync(DEPLOY + '/testnet.secrets.json', 'utf8'));
const TRE = algosdk.mnemonicToSecretKey(secrets.TREASURY.mnemonic);
const algod = await kit.algodClient();
const indexer = new algosdk.Indexer('', 'https://testnet-idx.algonode.cloud', '');
const cid = Number(process.env.CID ?? 31);
async function send(txns, signer) {
  algosdk.assignGroupID(txns);
  const signed = txns.map((t) => t.signTxn(signer.sk));
  const r = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, r.txid, 10);
  return { txid: r.txid, round: Number((await algod.pendingTransactionInformation(r.txid).do()).confirmedRound ?? 0) };
}
const roster = await kit.readPlayers(cid);
const signedR = roster.filter((e) => e.signed);
console.log(`cid=${cid} roster: signed=[${roster.map((p) => p.signed).join(',')}] scores=[${roster.map((p) => p.score).join(',')}]`);
const top = signedR.reduce((a, b) => (b.score > a.score ? b : a));
const v = await fetch(`${ORACLE}/v1/verdict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cid }) });
const vj = await v.json();
console.log(`verdict: ${v.status} stageIdx=${vj.stageIdx} playerCount=${vj.playerCount}`);
const txns = await kit.buildResolveGroup({
  caller: TRE.addr.toString(), cid, stageIdx: vj.stageIdx ?? 0, seedReveal: new Uint8Array(0),
  verdictSig: Buffer.from(vj.verdictSigB64, 'base64'), winner: algosdk.encodeAddress(Uint8Array.from(top.addr)), tie: false,
});
const rr = await send(txns, TRE);
console.log(`RESOLVE cid=${cid} txid=${rr.txid} round=${rr.round} winner=${algosdk.encodeAddress(Uint8Array.from(top.addr)).slice(0, 10)}… score=${top.score}`);
const closeTx = await indexer.lookupTransactionByID(rr.txid).do();
const legs = (closeTx.transaction.innerTxns ?? []).map((i) => {
  const p = i.paymentTransaction, a = i.assetTransferTransaction;
  if (a) return `axfer ${a.amount} GONNA-u -> ${a.receiver.slice(0, 10)}…`;
  if (p) return `pay ${p.amount} microA -> ${p.receiver.slice(0, 10)}…`;
  return i.txType;
});
console.log(`resolve inner legs: ${legs.join(' ; ')}`);
