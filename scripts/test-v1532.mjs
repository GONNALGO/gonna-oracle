// GONNA FIGHT v15.3.2 — FEE AUDIT: the UI must never offer a group the chain
// rejects for fee shortage (node-only, algod STUBBED at the fetch layer).
//   The security verifier caught two LIVE failures via testnet simulate:
//   BUG-1  claim: flat fee 2000, but claim() emits 2 inner txns
//          (_refund_all on a roster of 1: stake axfer back + exact MBR
//          payback) => 1000 x (1 outer + 2 inner) = 3000. Simulate: 2000
//          FAILS "group fee too small", 3000 PASSES.
//   BUG-2  resolve/tie with 5+ players: the tie path refunds EVERY roster
//          leg (n axfers + 1 MBR pay = n+1 inner). The static 6000 (+ 4
//          opup x 1000 = 10000 pool) breaks at n>=5 (needs (n+6) x 1000).
//          Fix: dynamic call fee = 1000 x (1 + innerLegs), tie known at the
//          call site; legacy callers (no `tie` arg) fund the worst case.
//   SWEEP-3 audit invariant, every builder: fee pool >= 1000 x (outer +
//          inner emitted) — inner counts cross-read from contract.py:
//            create/spawn/join/submit: 0 inner (state + events only)
//            resolve non-tie: 3 (winner axfer + 5% fee axfer + MBR payback)
//            resolve tie n:  n+1 (refund per leg + MBR payback)
//            claim/early_close: 2 (roster=1 refund + MBR payback)
//            claim_forfeit: 4 (2 axfer caller + fee axfer + MBR payback)
//   Side fix: buildClaimForfeitGroup crashed on encodeAddress(number[])
//   (algosdk ABI decodes box byte[] as number[]) — normalized like the
//   resolve builder's enc(). Latent, never exercised end-to-end before.
//   [0] source guards · [1] TESTNET_FEES table · [2] builder fees vs stubbed
//       algod (rosters 2/5/13, tie & non-tie & legacy) · [3] audit invariant
// Run: node scripts/test-v1532.mjs   (from /mnt/agents/output/app)
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, total = 0;
const fails = [];
function ok(cond, label) {
  total++;
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { fails.push(label); console.log('  FAIL ' + label); }
}

// ================= [0] SOURCE-LEVEL =========================================
console.log('\n[0] SOURCE: fee rule documented, dynamic resolve, claim via table');
{
  const tk = readFileSync(join(ROOT, 'src/game/arena/testnetKit.ts'), 'utf8');
  const ca = readFileSync(join(ROOT, 'src/game/arena/chainAdapter.ts'), 'utf8');
  ok(tk.includes('claim: 1000 + 2 * 1000'), 'TESTNET_FEES.claim = 1000 + 2 inner x 1000 (BUG-1)');
  ok(!tk.includes('claim: 2000'), 'old broken claim: 2000 is gone');
  ok(tk.includes('suggestedParams: await baseParams(TESTNET_FEES.claim)'), 'buildClaimGroup fees from the table (no literal)');
  ok(tk.includes('tie?: boolean'), 'buildResolveGroup accepts the caller-known tie flag');
  ok(tk.includes('const innerLegs = o.tie === false ? 3 : roster.length + 1;'), 'innerLegs: 3 non-tie / n+1 tie / n+1 legacy worst-case');
  ok(tk.includes('const callFee = 1000 * (1 + innerLegs);'), 'call fee = 1000 x (1 outer + inner legs)');
  ok(tk.includes('suggestedParams: await baseParams(callFee)'), 'resolve call carries the dynamic fee');
  ok(!tk.includes('suggestedParams: await baseParams(6000)'), 'old static resolve 6000 is gone');
  ok(ca.includes('      tie, // v15.3.2 BUG-2'), 'chainAdapter passes the tie flag it already computes');
  ok(tk.includes('meta.creator instanceof Uint8Array ? meta.creator : Uint8Array.from(meta.creator)'), 'claim_forfeit: ABI number[] creator normalized (latent crash fix)');
}

// ================= bundle the REAL kit (algosdk external) ===================
const BUNDLE = join(ROOT, '.tmp-kit-v1532.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  '--external:algosdk',
  `--outfile=${BUNDLE}`], { cwd: ROOT, stdio: 'pipe' });
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));

// ---- fetch stub: algod params + meta/players boxes --------------------------
const pk = (n) => { const b = new Uint8Array(32); b[31] = n; return b; };
const A = (n) => algosdk.encodeAddress(pk(n));
const META_T = algosdk.ABIType.from('(byte[],uint64,uint64,uint64,uint64,uint64,byte[],uint64,uint64,byte[],uint64,uint64)');
const PLAYERS_T = algosdk.ABIType.from('(byte[],uint64,bool,uint64)[]');
let ROSTER_N = 2;
const metaBox = () => META_T.encode([pk(9), 1_000_000n, 12n, 12n, 9_999_999_999n, 0n, new Uint8Array(32), 1000n, 1n, new Uint8Array(32), 13_000_000n, 358_200n]);
const playersBox = () => PLAYERS_T.encode(Array.from({ length: ROSTER_N }, (_, i) => [pk(10 + i), 500n, true, 123n]));
const PARAMS = {
  'consensus-version': 'future', fee: 0,
  'genesis-hash': Buffer.from(pk(1)).toString('base64'),
  'genesis-id': 'testnet-v1.0', 'last-round': 50000, 'min-fee': 1000,
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.pathname.endsWith('/transactions/params')) {
    return new Response(JSON.stringify(PARAMS), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.pathname.includes('/box')) {
    const name = Buffer.from(u.searchParams.get('name').replace(/^b64:/, ''), 'base64');
    const val = name[0] === 0x6d ? metaBox() : playersBox();
    return new Response(JSON.stringify({ name: u.searchParams.get('name'), value: Buffer.from(val).toString('base64') }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error('unstubbed fetch: ' + u.pathname);
};

const kit = await import(BUNDLE);

// ================= [1] TESTNET_FEES table ===================================
console.log('\n[1] TESTNET_FEES: the documented minimums');
{
  const F = kit.TESTNET_FEES;
  ok(F.claim === 3000, 'claim = 3000 (1 outer + 2 inner) [BUG-1] (got ' + F.claim + ')');
  ok(F.resolve === 8000, 'resolve (non-tie reference) = 8000 = 1000 x (5 outer + 3 inner) (got ' + F.resolve + ')');
  ok(F.forfeit === 5000, 'claim_forfeit = 5000 (1 outer + 4 inner, exact) (got ' + F.forfeit + ')');
  ok(F.close === 5000, 'early_close = 5000 >= 1000 x (2 outer + 2 inner) (got ' + F.close + ')');
  ok(F.join === 4000, 'join = 4000 >= 1000 x 2 outer (0 inner) (got ' + F.join + ')');
  ok(F.create === 9000, 'create = 9000 >= 1000 x 7 outer (0 inner) (got ' + F.create + ')');
  ok(F.submit === 7000, 'submit = 7000 >= 1000 x 5 outer (0 inner) (got ' + F.submit + ')');
}

// ================= [2] builder fees vs stubbed algod ========================
console.log('\n[2] BUILDERS: exact fees per group (algod stubbed, zero network)');
const fees = (txns) => txns.map((t) => Number(t.fee));
const pool = (txns) => fees(txns).reduce((a, b) => a + b, 0);
{
  const claim = await kit.buildClaimGroup({ caller: A(7), cid: 42 });
  ok(claim.length === 1 && fees(claim)[0] === 3000, 'claim: 1 txn, flat fee 3000 [BUG-1 fixed] (got ' + fees(claim) + ')');

  const cf = await kit.buildClaimForfeitGroup({ caller: A(7), cid: 42, seat: 1 });
  ok(cf.length === 1 && fees(cf)[0] === 5000, 'claim_forfeit: 1 txn, flat fee 5000 = 1000 x (1 + 4 inner), exact (got ' + fees(cf) + ')');

  const ec = await kit.buildEarlyCloseGroup({ caller: A(7), cid: 42 });
  ok(ec.length === 2 && pool(ec) === 5000, 'early_close: 2 txns, pool 5000 >= 4000 min (got ' + fees(ec) + ')');

  const join = await kit.buildJoinGroup({ joiner: A(7), cid: 42, stakeBase: 1_000_000 });
  ok(join.length === 2 && pool(join) === 4000, 'join: 2 txns, pool 4000 >= 2000 min (got ' + fees(join) + ')');

  const submit = await kit.buildSubmitGroup({ player: A(7), cid: 42, score: 100, sig: new Uint8Array(64) });
  ok(submit.length === 5 && pool(submit) === 7000, 'submit: 5 txns (call + 4 opup), pool 7000 >= 5000 min (got ' + fees(submit) + ')');

  const create = await kit.buildCreateGroup({
    creator: A(7), cid: 42, stakeBase: 1_000_000, seats: 1, durationSecs: 86_400,
    stageMode: 0, creatorScore: 100, creatorScoreSig: new Uint8Array(64),
  });
  ok(create.length === 7 && pool(create) === 9000, 'create: 7 txns, pool 9000 >= 7000 min (got ' + fees(create) + ')');

  const rumble = await kit.buildSpawnRumbleGroup({ creator: A(7), cid: 42, stakeBase: 1_000_000, seats: 12, stageMode: 0 });
  ok(rumble.length === 4 && pool(rumble) === 5000, 'spawn_rumble: 4 txns, pool 5000 >= 4000 min (got ' + fees(rumble) + ')');

  for (const n of [2, 5, 13]) {
    ROSTER_N = n;
    const tieTx = await kit.buildResolveGroup({ caller: A(7), cid: 42, stageIdx: 0, seedReveal: new Uint8Array(0), verdictSig: new Uint8Array(64), winner: A(10), tie: true });
    const wantCall = 1000 * (1 + n + 1); // tie: n refund axfers + 1 MBR pay
    ok(fees(tieTx)[0] === wantCall && pool(tieTx) === wantCall + 4000,
      `resolve TIE roster ${n}: call fee ${wantCall}, pool ${wantCall + 4000} = 1000 x (5 + ${n + 1}) [BUG-2] (got ${fees(tieTx)})`);
    const winTx = await kit.buildResolveGroup({ caller: A(7), cid: 42, stageIdx: 0, seedReveal: new Uint8Array(0), verdictSig: new Uint8Array(64), winner: A(10), tie: false });
    ok(fees(winTx)[0] === 4000 && pool(winTx) === 8000,
      `resolve WIN roster ${n}: call fee 4000, pool 8000 = 1000 x (5 + 3), roster-independent (got ${fees(winTx)})`);
    const legTx = await kit.buildResolveGroup({ caller: A(7), cid: 42, stageIdx: 0, seedReveal: new Uint8Array(0), verdictSig: new Uint8Array(64), winner: A(10) });
    ok(fees(legTx)[0] === wantCall,
      `resolve LEGACY (no tie arg) roster ${n}: worst-case call fee ${wantCall} (got ${fees(legTx)})`);
  }
}

// ================= [3] audit invariant vs contract.py =======================
console.log('\n[3] SWEEP: pool >= 1000 x (outer + inner) for EVERY builder');
{
  const src = readFileSync(join(ROOT, 'contracts/quantum-arena/contracts/quantum_arena/contract.py'), 'utf8');
  // inner-txn ground truth, cross-read from the FROZEN contract
  ok(src.includes('for i in urange(roster.length):\n            entry = roster[i].copy()\n            self._pay_gonna(entry.addr, meta.stake)'), 'contract: _refund_all pays EVERY roster leg + MBR (claim/early_close/tie)');
  ok((src.match(/self\._pay_gonna\(winner_addr, own_stake\)/) || []).length === 1 && (src.match(/self\._pay_gonna\(winner_addr, winner_share\)/) || []).length === 1, 'contract: claim_forfeit 2 axfers to caller + fee axfer + MBR pay = 4 inner');
  const INNER = { create: 0, spawn: 0, join: 0, submit: 0, claim: 2, early_close: 2, claim_forfeit: 4 };
  const groups = {
    create: await kit.buildCreateGroup({ creator: A(7), cid: 42, stakeBase: 1_000_000, seats: 1, durationSecs: 86_400, stageMode: 0, creatorScore: 100, creatorScoreSig: new Uint8Array(64) }),
    spawn: await kit.buildSpawnRumbleGroup({ creator: A(7), cid: 42, stakeBase: 1_000_000, seats: 12, stageMode: 0 }),
    join: await kit.buildJoinGroup({ joiner: A(7), cid: 42, stakeBase: 1_000_000 }),
    submit: await kit.buildSubmitGroup({ player: A(7), cid: 42, score: 100, sig: new Uint8Array(64) }),
    claim: await kit.buildClaimGroup({ caller: A(7), cid: 42 }),
    early_close: await kit.buildEarlyCloseGroup({ caller: A(7), cid: 42 }),
    claim_forfeit: await kit.buildClaimForfeitGroup({ caller: A(7), cid: 42, seat: 1 }),
  };
  for (const [m, txns] of Object.entries(groups)) {
    const need = 1000 * (txns.length + INNER[m]);
    ok(pool(txns) >= need, `${m}: pool ${pool(txns)} >= 1000 x (${txns.length} outer + ${INNER[m]} inner) = ${need}`);
  }
  for (const n of [2, 5, 13]) {
    ROSTER_N = n;
    const tieTx = await kit.buildResolveGroup({ caller: A(7), cid: 42, stageIdx: 0, seedReveal: new Uint8Array(0), verdictSig: new Uint8Array(64), winner: A(10), tie: true });
    const needT = 1000 * (tieTx.length + n + 1);
    ok(pool(tieTx) === needT, `resolve TIE n=${n}: pool ${pool(tieTx)} EXACTLY 1000 x (${tieTx.length} outer + ${n + 1} inner) = ${needT} (no padding)`);
    const winTx = await kit.buildResolveGroup({ caller: A(7), cid: 42, stageIdx: 0, seedReveal: new Uint8Array(0), verdictSig: new Uint8Array(64), winner: A(10), tie: false });
    const needW = 1000 * (winTx.length + 3);
    ok(pool(winTx) === needW, `resolve WIN n=${n}: pool ${pool(winTx)} EXACTLY 1000 x (${winTx.length} outer + 3 inner) = ${needW} (no padding)`);
  }
}

globalThis.fetch = realFetch;
rmSync(BUNDLE, { force: true });

console.log(`\n========== v15.3.2 FEE AUDIT: ${passed}/${total} ==========`);
if (fails.length) { console.log('FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
