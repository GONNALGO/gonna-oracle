// wave-a-dfg.mjs — WAVE A: (d) early_close cid 24, (f) verdict endpoint, (g) view-tx indexer.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DEPLOY = path.join(ROOT, 'contracts/quantum-arena/deploy');
const ORACLE = (process.env.ORACLE_URL ?? 'https://gonna-arena-oracle-testnet.onrender.com').replace(/\/$/, '');
const KIT_OUT = path.join(ROOT, '.tmp-kit-wavedfg.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--define:import.meta.env={"DEV":false,"PROD":true,"VITE_QA_ORACLE":""}`,
  `--outfile=${KIT_OUT}`], { cwd: ROOT, stdio: 'pipe' });
const kit = await import(KIT_OUT);
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));
const secrets = JSON.parse(readFileSync(DEPLOY + '/testnet.secrets.json', 'utf8'));
const W = {};
for (const role of ['PLAYER_A', 'TREASURY']) W[role] = algosdk.mnemonicToSecretKey(secrets[role].mnemonic);
const addr = (r) => W[r].addr.toString();
const algod = await kit.algodClient();
const indexer = new algosdk.Indexer('', 'https://testnet-idx.algonode.cloud', '');

async function send(txns, signers) {
  algosdk.assignGroupID(txns);
  const signed = txns.map((t, i) => t.signTxn((Array.isArray(signers) ? signers[i] : signers).sk));
  const r = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, r.txid, 10);
  const info = await algod.pendingTransactionInformation(r.txid).do();
  return { txid: r.txid, round: Number(info.confirmedRound ?? 0), info };
}

// ---------- (d) EARLY_CLOSE cid 24 (0 joiners, pre-deadline, creator PLAYER_A)
console.log('=== (d) EARLY_CLOSE cid 24 (0 joiners, pre-deadline) ===');
const m24 = await kit.readMeta(24);
console.log(`meta: status=${m24?.status} seatsTaken=${m24?.seatsTaken} deadline=${m24?.deadline} (now ${Math.floor(Date.now() / 1000)})`);
const gonnaOf = async (a) => {
  const i = await algod.accountInformation(a).do();
  return Number((i.assets ?? []).find((x) => Number(x.assetId) === kit.GONNA_ASA_TESTNET)?.amount ?? 0);
};
const preA = await gonnaOf(addr('PLAYER_A'));
const preAalgo = Number((await algod.accountInformation(addr('PLAYER_A')).do()).amount);
const preTre = Number((await algod.accountInformation(kit.TREASURY_ADDR).do()).amount);
const er = await send(await kit.buildEarlyCloseGroup({ caller: addr('PLAYER_A'), cid: 24 }), W.PLAYER_A);
console.log(`EARLY_CLOSE txid=${er.txid} round=${er.round}`);
const inner = er.info.innerTxns ?? er.info['inner-txns'] ?? [];
for (const [i, t] of inner.entries()) {
  const tx = t.txn?.txn ?? {};
  const kind = tx.type;
  const amt = kind === 'axfer' ? tx.aamt : tx.amt;
  const rcv = tx.arcv ?? tx.rcv;
  console.log(`  inner[${i}] ${kind} amount=${amt} -> ${rcv ? algosdk.encodeAddress(Uint8Array.from(rcv)) : '?'}`);
}
const postA = await gonnaOf(addr('PLAYER_A'));
const postAalgo = Number((await algod.accountInformation(addr('PLAYER_A')).do()).amount);
const postTre = Number((await algod.accountInformation(kit.TREASURY_ADDR).do()).amount);
console.log(`PLAYER_A GONNA delta=${postA - preA} (atteso +1000000 stake back) | ALGO delta=${(postAalgo - preAalgo) / 1e6} (atteso ~+0.3582 MBR -1.0 fee -fees)`);
console.log(`TREASURY ALGO delta=${(postTre - preTre) / 1e6} (atteso +1.0 early-close fee)`);
const m24post = await kit.readMeta(24);
console.log(`post-close meta: ${m24post ? 'PRESENT (unexpected)' : 'deleted (boxes closed)'}`);

// ---------- (f) VERDICT endpoint
console.log('\n=== (f) VERDICT endpoint ===');
const v200 = await fetch(`${ORACLE}/v1/verdict?cid=26`);
const v200j = await v200.json().catch(() => ({}));
console.log(`verdict cid=26 (resolved): ${v200.status} ${JSON.stringify(v200j).slice(0, 200)}`);
const v409 = await fetch(`${ORACLE}/v1/verdict?cid=24`);
const v409j = await v409.json().catch(() => ({}));
console.log(`verdict cid=24 (early-closed, non risolvibile): ${v409.status} ${JSON.stringify(v409j).slice(0, 160)}`);
const vOpen = await fetch(`${ORACLE}/v1/verdict?cid=25`);
const vOpenj = await vOpen.json().catch(() => ({}));
console.log(`verdict cid=25 (open, not fully signed): ${vOpen.status} ${JSON.stringify(vOpenj).slice(0, 160)}`);

// ---------- (g) VIEW TX — close txid per card from the indexer
console.log('\n=== (g) VIEW TX (indexer, app-call close txs) ===');
for (const [cid, closeTxid] of [[26, 'ZLL7SFQ2B77C56T6Q4T3PGM6ZZGYKWGIOZ5YILS6G4SSREYD6XMQ'], [30, 'M7AKOTS6EFJV4LJCPLBX76TOBJ4VJJUAESH6RTI3D6BSA24RU4TA'], [24, er.txid]]) {
  try {
    const t = await indexer.lookupTransactionByID(closeTxid).do();
    const tx = t.transaction ?? {};
    const appArgs = (tx['application-transaction']?.['application-args'] ?? []).length;
    const innerN = (tx['inner-txns'] ?? []).length;
    console.log(`  cid ${cid}: close txid ${closeTxid.slice(0, 12)}… round=${tx['confirmed-round']} appArgs=${appArgs} inner=${innerN} — VIEW TX OK`);
  } catch (e) {
    console.log(`  cid ${cid}: indexer lookup FAILED: ${e.message}`);
  }
}
console.log('=== (d)(f)(g) DONE ===');
