import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--define:import.meta.env={"DEV":false,"PROD":true,"VITE_ARENA_NETWORK":"mainnet","VITE_QA_ORACLE":""}`,
  `--outfile=./.tmp-kit-close.mjs`], { stdio: 'pipe' });
const kit = await import('./.tmp-kit-close.mjs');
const algosdk = (await import('algosdk')).default;
const S = JSON.parse(readFileSync('contracts/quantum-arena/deploy/mainnet.secrets.json', 'utf8'));
const algod = await kit.algodClient();
const ORACLE = 'https://gonna-arena-oracle-testnet.onrender.com';
const W = {};
for (const k of Object.keys(S)) { if (S[k] && S[k].mnemonic) { const a = algosdk.mnemonicToSecretKey(S[k].mnemonic); W[k] = { sk: a.sk, addr: String(a.addr) }; } }
const addr = (r) => W[r].addr;
async function send(txns, signer) {
  if (txns.length > 1) algosdk.assignGroupID(txns);
  const signed = txns.map((t) => t.signTxn(signer.sk));
  const r = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, r.txid, 4);
  return r;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryResolve(cid) {
  const meta = await kit.readMeta(cid); const roster = await kit.readPlayers(cid);
  const signedJ = roster.filter((p, i) => i > 0 && p.signed).length;
  const dl = Number(meta.deadline), now = Math.floor(Date.now() / 1000);
  const filled = roster.length >= Number(meta.seatsTotal) + 1;
  const allSigned = roster.every((p) => p.signed);
  if (!((filled && allSigned) || (now >= dl && signedJ >= 1))) { console.log(`cid ${cid}: NOT resolvable (filled=${filled} allSigned=${allSigned} signedJ=${signedJ} dl in ${Math.round((dl-now)/3600)}h)`); return false; }
  const vr = await fetch(`${ORACLE}/v1/verdict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cid }) });
  if (vr.status !== 200) { console.log(`cid ${cid}: verdict ${vr.status}`); return false; }
  const vj = await vr.json();
  const top = roster.reduce((a, b) => (Number(b.score) > Number(a.score) ? b : a));
  const nTop = roster.filter((p) => p.signed && Number(p.score) === Number(top.score)).length;
  const isTie = nTop > 1;
  const stageIdx = Number(meta.stageMode) === 1 ? Number(meta.stageIdx ?? 0) : 0;
  const rr = await send(await kit.buildResolveGroup({
    caller: addr('DEPLOYER'), cid, stageIdx, seedReveal: new Uint8Array(0),
    verdictSig: Buffer.from(vj.verdictSigB64, 'base64'),
    winner: algosdk.encodeAddress(Uint8Array.from(top.addr)), tie: isTie,
  }), W.DEPLOYER);
  await sleep(9000);
  const gone = !(await kit.readMeta(cid));
  console.log(`cid ${cid}: RESOLVED txid=${rr.txid} tie=${isTie} boxes=${gone ? 'deleted' : 'PRESENT!'}`);
  return true;
}

async function tryEarlyClose(cid, role) {
  const meta = await kit.readMeta(cid); const roster = await kit.readPlayers(cid);
  const now = Math.floor(Date.now() / 1000);
  if (roster.length > 1) { console.log(`cid ${cid}: has joiners — no early_close`); return false; }
  if (now >= Number(meta.deadline)) { console.log(`cid ${cid}: past deadline — free claim instead`); return 'claim'; }
  const r = await send(await kit.buildEarlyCloseGroup({ caller: addr(role), cid }), W[role]);
  const gone = !(await kit.readMeta(cid));
  console.log(`cid ${cid}: EARLY_CLOSED by ${role} txid=${r.txid} boxes=${gone ? 'deleted' : 'PRESENT!'}`);
  return true;
}

async function tryClaim(cid, role) {
  const r = await send(await kit.buildClaimGroup({ caller: addr(role), cid }), W[role]);
  const gone = !(await kit.readMeta(cid));
  console.log(`cid ${cid}: CLAIMED (free) by ${role} txid=${r.txid} boxes=${gone ? 'deleted' : 'PRESENT!'}`);
  return true;
}

async function tryForfeit(cid, role) {
  const roster = await kit.readPlayers(cid);
  const seat = roster.findIndex((p, i) => i > 0 && !p.signed);
  if (seat < 1) { console.log(`cid ${cid}: no unsigned joiner`); return false; }
  const r = await send(await kit.buildClaimForfeitGroup({ caller: addr(role), cid, seat }), W[role]);
  const gone = !(await kit.readMeta(cid));
  console.log(`cid ${cid}: FORFEIT claimed by ${role} txid=${r.txid} boxes=${gone ? 'deleted' : 'PRESENT!'}`);
  return true;
}

const MODE = process.env.CLOSE_MODE || 'report';
for (const cid of [76, 87]) {
  try {
    const meta = await kit.readMeta(cid);
    if (!meta) { console.log(`cid ${cid}: already gone`); continue; }
    const roster = await kit.readPlayers(cid);
    const creator = algosdk.encodeAddress(Uint8Array.from(meta.creator));
    const role = Object.keys(W).find((k) => W[k].addr === creator);
    const now = Math.floor(Date.now() / 1000), dl = Number(meta.deadline);
    console.log(`--- cid ${cid}: roster=${roster.length} signed=${roster.filter(p=>p.signed).length} creator=${role || creator.slice(0,8)} dl${now >= dl ? ' PASSED' : ' in ' + Math.round((dl-now)/3600) + 'h'}`);
    if (MODE !== 'close') continue;
    // decision tree
    if (roster.length === 1) {
      if (now >= dl) await tryClaim(cid, role);
      else await tryEarlyClose(cid, role);
    } else if (roster.length === 2 && roster.filter(p=>p.signed).length === 1 && roster[0].signed) {
      // duel, joiner unsigned -> forfeit if seat TTL lapsed; else resolve if deadline passed
      if (!(await tryForfeit(cid, role))) await tryResolve(cid);
    } else {
      await tryResolve(cid);
    }
  } catch (e) { console.log(`cid ${cid}: ERROR ${String(e.message || e).slice(0, 180)}`); }
}
