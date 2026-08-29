// GONNA FIGHT — M-1 CLIENT MAINNET: network config, mainnet-leak guard,
// fixture gating. Suite:
//   [0] source guards (arenaKit, re-exports, oracle URL, scoped LS keys, fixtures)
//   [1] behavioral TESTNET build (default env): constants, defaults, scoped LS
//   [2] behavioral MAINNET build (VITE_ARENA_NETWORK=mainnet): mainnet row,
//       placeholders, fixtures OFF, leak guard — legacy unscoped keys IGNORED
//   [3] leak scenarios: seeded testnet state must not pollute a mainnet session
// Run: node scripts/test-m1-mainnet.mjs   (ESBUILD_BINARY_PATH se serve)
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

// ================= [0] SOURCE ==============================================
console.log('\n[0] SOURCE: network config + leak guard + fixture gate');
{
  const ak = readFileSync(join(ROOT, 'src/game/arena/arenaKit.ts'), 'utf8');
  const tk = readFileSync(join(ROOT, 'src/game/arena/testnetKit.ts'), 'utf8');
  const oc = readFileSync(join(ROOT, 'src/game/arena/oracleClient.ts'), 'utf8');
  const ca = readFileSync(join(ROOT, 'src/game/arena/chainAdapter.ts'), 'utf8');
  const ui = readFileSync(join(ROOT, 'src/game/arena/arenaUI.ts'), 'utf8');
  const tw = readFileSync(join(ROOT, 'src/game/arena/testnetWallet.ts'), 'utf8');
  const aw = readFileSync(join(ROOT, 'src/game/arena/arenaWallet.ts'), 'utf8');
  ok(ak.includes("VITE_ARENA_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'"), 'arenaKit: network from VITE_ARENA_NETWORK (default testnet)');
  ok(ak.includes('gonnaAsa: 2582294183,'), 'arenaKit: GONNA ASA mainnet 2582294183');
  ok(ak.includes('gonnaAsa: 769688287,') && ak.includes('appId: 769907387,'), 'arenaKit: testnet row intact (app 769907387 / ASA 769688287)');
  ok(ak.includes('appId: 3686311434,'), 'arenaKit: mainnet appId 3686311434 (M-2 deploy, M-4 filled)');
  ok(ak.includes("treasuryAddr: 'GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU'") && ak.includes("oracleAddr: '3UVNPC3IOM42HZS5HZJPVH6LBBJOJFF2WHQ4K5SDYJKKWFAJ36SKXILG4Y'"), 'arenaKit: mainnet treasury + oracle addrs (M-4)');
  ok(ak.includes('opUpAppId: 3686469118,'), 'arenaKit: OpUp donor mainnet 3686469118 (M-4bis — budget failure proven live at opUp 0)');
  ok(ak.includes('export const ARENA_FIXTURES_ENABLED'), 'arenaKit: fixtures flag exported');
  ok(ak.includes('export function netLsKey'), 'arenaKit: netLsKey helper exported');
  ok(tk.includes("export { ARENA_NETWORK, IS_MAINNET };") && tk.includes('export const ARENA_APP_ID = NET.appId;'), 'testnetKit: re-exports network-resolved constants (compat)');
  ok(tk.includes("export const GONNA_ASA = NET.gonnaAsa;") && tk.includes('GONNA_ASA_TESTNET'), 'testnetKit: GONNA_ASA canonical + deprecated alias kept');
  ok(oc.includes('export const ORACLE_BASE_URL_MAINNET'), 'oracleClient: ORACLE_BASE_URL_MAINNET present');
  ok(oc.includes("netLsKey('gonna.arena.oracleurl')"), 'oracleClient: oracle override key network-scoped');
  // v17.0.2 advisory: EVERY network URL lives in arenaKit — indexer included
  ok(ak.includes("indexerUrl: 'https://testnet-idx.algonode.cloud'") && ak.includes("indexerUrl: 'https://mainnet-idx.algonode.cloud'"), 'arenaKit: indexerUrl per network');
  ok(tk.includes('export const INDEXER_URL = NET.indexerUrl;'), 'testnetKit: INDEXER_URL resolved from NET');
  const tkNoComments = tk.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(!tkNoComments.includes('testnet-idx.algonode.cloud') && !tkNoComments.includes('`https://testnet-api'), 'testnetKit: ZERO hardcoded network URLs (v17.0.2)');
  ok(ca.includes("netLsKey('gonna.arena.adapter')") && ca.includes("netLsKey('gonna.arena.v1')"), 'chainAdapter: adapter flag + mock store network-scoped');
  ok(tk.includes("netLsKey('gonna.arena.txids')") && tk.includes("netLsKey('gonna.arena.resolved')") && tk.includes("netLsKey('gonna.arena.closetx')"), 'testnetKit: txid memories network-scoped');
  ok(tw.includes("netLsKey('gonna.arena.live.addr')"), 'testnetWallet: saved account network-scoped (live-renamed base key, M-4)');
  ok(aw.includes("netLsKey('gonna.arena.anon')"), 'arenaWallet: anon identity network-scoped');
  ok(ui.includes("if (import.meta.env?.VITE_ARENA_NETWORK !== 'mainnet' && ARENA_FIXTURES_ENABLED && arenaMode() === 'live') {"), 'arenaUI: fixtures gated by STATIC env expr + build flag (block + strings DCEd from mainnet bundles, M-4)');
  ok(ui.includes("id: 'golive'") && ui.includes("'PRACTICE'") && ui.includes("'GO LIVE'"), 'arenaUI: mock piazza shows PRACTICE tag + GO LIVE ingress (M-4)');
  // v17.0.2 SEV follow-up: fee label must ride the CHAIN, not the mode (M-4 rename regression)
  ok(!ui.includes("feeLine('create', acct, this.adapter().mode === 'live')"), 'arenaUI: feeLine callers use arenaUsesTestnetChain, not mode');
  const ca2 = readFileSync(join(ROOT, 'src/game/arena/chainAdapter.ts'), 'utf8');
  ok(ca2.includes("if (testnet) return (kit.TESTNET_FEES[op] / 1e6).toFixed(3) + ' ALGO (TESTNET)';"), 'feeLine: (TESTNET) suffix only on the testnet chain');
  // v17.0.4 gap-heal: legacy caches that advanced the watermark past an
  // unmapped cid (the Prince's cid-8 UNVERIFIED) self-heal with ONE full rescan
  ok(tk.includes('scannedThrough') && tk.includes('GAP-HEAL'), 'testnetKit: gap-heal present (scannedThrough provenance marker)');
  ok(tk.includes("forcing ONE full rescan"), 'testnetKit: gap-heal logs a console.debug when it fires');
  // no unscoped leftovers of the network-bound keys anywhere in src
  const all = [tk, oc, ca, tw, aw];
  const leftovers = all.some((s) => /localStorage\.(getItem|setItem|removeItem)\('gonna\.arena\.(adapter|v1|oracleurl|testnet\.addr|anon|txids|resolved|closetx)'/.test(s));
  ok(!leftovers, 'no unscoped network-bound localStorage access left in src');
}

// ================= behavioral bundles ======================================
const ENTRY = join(ROOT, '.tmp-m1-entry.ts');
writeFileSync(ENTRY, `
export { ARENA_NETWORK, IS_MAINNET, NET, ARENA_FIXTURES_ENABLED, netLsKey } from './src/game/arena/arenaKit';
export { oracleBaseUrl, ORACLE_BASE_URL_MAINNET, ORACLE_BASE_URL_TESTNET } from './src/game/arena/oracleClient';
export { arenaMode, arenaUsesTestnetChain } from './src/game/arena/chainAdapter';
export { fetchArenaCreateStages, readStageCache } from './src/game/arena/testnetKit';
`);
function bundle(out, defines = []) {
  execFileSync('npx', ['esbuild', ENTRY, '--bundle', '--format=esm', '--platform=node',
    '--banner:js=import { createRequire } from "module"; const require = createRequire(import.meta.url);',
    '--define:import.meta.env.DEV=false', '--define:import.meta.env.PROD=true', ...defines,
    `--outfile=${out}`], { cwd: ROOT, stdio: 'pipe' });
}
function mkWindow(seed = {}) {
  const store = new Map(Object.entries(seed));
  const loc = { search: '', hostname: 'example.com', pathname: '/' };
  globalThis.window = { localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  }, location: loc };
  return { store, loc };
}

// ================= [1] TESTNET build (default) =============================
console.log('\n[1] BEHAVIOR: default build == testnet, byte-identical defaults');
const B1 = join(ROOT, '.tmp-m1-testnet.mjs');
bundle(B1);
const T = await import(B1);
{
  ok(T.ARENA_NETWORK === 'testnet' && T.IS_MAINNET === false, 'default build: ARENA_NETWORK=testnet');
  ok(T.NET.appId === 769907387 && T.NET.legacyAppId === 769688298 && T.NET.gonnaAsa === 769688287 && T.NET.opUpAppId === 769688641, 'testnet ids intact');
  ok(T.NET.treasuryAddr.startsWith('4OQ3') && T.NET.oracleAddr.startsWith('COI3'), 'testnet treasury/oracle addrs intact');
  ok(T.NET.algodUrl === 'https://testnet-api.algonode.cloud', 'testnet algod intact');
  ok(T.NET.indexerUrl === 'https://testnet-idx.algonode.cloud', 'testnet indexer intact');
  ok(T.ARENA_FIXTURES_ENABLED === true, 'fixtures enabled on testnet');
  ok(T.netLsKey('gonna.arena.adapter') === 'gonna.arena.adapter.testnet', 'netLsKey scopes with .testnet');
  mkWindow({});
  ok(T.oracleBaseUrl() === T.ORACLE_BASE_URL_TESTNET, 'oracleBaseUrl default = testnet Render service');
  ok(T.arenaMode() === 'live', 'arenaMode default = live (v17.0.4: on-chain piazza, zero clicks)');
  { const w = mkWindow({}); w.loc.search = '?arena=mock'; }
  ok(T.arenaMode() === 'mock', 'v17.0.4: practice piazza reachable ONLY via explicit ?arena=mock');
}

// ================= [2] MAINNET build =======================================
console.log('\n[2] BEHAVIOR: VITE_ARENA_NETWORK=mainnet build');
const B2 = join(ROOT, '.tmp-m1-mainnet.mjs');
bundle(B2, ['--define:import.meta.env.VITE_ARENA_NETWORK="mainnet"']);
const M = await import(B2);
{
  ok(M.ARENA_NETWORK === 'mainnet' && M.IS_MAINNET === true, 'mainnet build: ARENA_NETWORK=mainnet');
  ok(M.NET.appId === 3686311434 && M.NET.opUpAppId === 3686469118 && M.NET.treasuryAddr.startsWith('GONHNV') && M.NET.oracleAddr.startsWith('3UVNPC'), 'mainnet ids are the real M-2 deploy + OpUp donor (M-4bis)');
  ok(M.NET.gonnaAsa === 2582294183, 'mainnet GONNA ASA 2582294183');
  ok(M.NET.algodUrl === 'https://mainnet-api.algonode.cloud', 'mainnet algod');
  ok(M.NET.indexerUrl === 'https://mainnet-idx.algonode.cloud', 'mainnet indexer (HISTORY reads mainnet, v17.0.2 fix)');
  ok(M.ARENA_FIXTURES_ENABLED === false, 'fixtures OFF in a mainnet build (dead path)');
  ok(M.netLsKey('gonna.arena.adapter') === 'gonna.arena.adapter.mainnet', 'netLsKey scopes with .mainnet');
  ok(M.ORACLE_BASE_URL_MAINNET === 'https://gonna-arena-oracle-testnet.onrender.com', 'mainnet oracle URL = same Render service (flip at M-2)');
  mkWindow({});
  ok(M.oracleBaseUrl() === M.ORACLE_BASE_URL_MAINNET, 'oracleBaseUrl default = mainnet row');
}

// ================= [2b] MAINNET vite-dist scan (v17.0.2 advisory) ==========
// esbuild does NOT fold optional chains (vite/rollup DOES — verified), so the
// honest scan is a REAL vite mainnet build: every chunk must be testnet-free.
console.log('\n[2b] SCAN: a real VITE_ARENA_NETWORK=mainnet dist must contain ZERO testnet URLs');
{
  const distDir = '/tmp/m1-dist-mainnet-' + process.pid; // /tmp: FUSE rm -rf of the big frames/ tree is flaky inside the repo
  rmSync(distDir, { recursive: true, force: true });
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', distDir, '--emptyOutDir'],
    { cwd: ROOT, stdio: 'pipe', env: { ...process.env, VITE_ARENA_NETWORK: 'mainnet' } });
  const { readdirSync } = await import('node:fs');
  const chunks = readdirSync(join(distDir, 'assets')).filter((f) => f.endsWith('.js'));
  const all = chunks.map((f) => readFileSync(join(distDir, 'assets', f), 'utf8')).join('\n');
  ok(chunks.length > 0, 'mainnet dist built (' + chunks.length + ' js chunks)');
  ok(!all.includes('testnet-idx.algonode.cloud'), 'dist scan: no testnet-idx URL in ANY chunk');
  ok(!all.includes('testnet-api.algonode.cloud'), 'dist scan: no testnet-api URL in ANY chunk');
  ok(!all.includes('gonna.arena.testnet'), 'dist scan: no testnet-named LS key in ANY chunk');
  const entryName = readFileSync(join(distDir, 'index.html'), 'utf8').match(/assets\/(index-[^"]+\.js)/)[1];
  const entry = readFileSync(join(distDir, 'assets', entryName), 'utf8');
  ok(entry.includes('3686311434') && entry.includes('mainnet-idx.algonode.cloud'), 'dist scan: entry chunk carries mainnet app + indexer');
  ok(!entry.includes('769907387'), 'dist scan: entry chunk has no testnet app id');
  try { rmSync(distDir, { recursive: true, force: true }); } catch { /* FUSE flake — scratch dir */ }
}

// ================= [3] LEAK scenarios ======================================
console.log('\n[3] LEAK: testnet-era localStorage must not pollute mainnet (and vice versa)');
{
  // legacy UNSCOPED keys from a pre-M-1 testnet session
  mkWindow({ 'gonna.arena.adapter': 'testnet', 'gonna.arena.oracleurl': 'dev' });
  ok(M.arenaMode() === 'live', 'mainnet session: legacy unscoped adapter=testnet IGNORED (v17.0.4: falls back to the live default)');
  ok(M.oracleBaseUrl() === M.ORACLE_BASE_URL_MAINNET, "mainnet session: legacy unscoped oracleurl='dev' IGNORED (no dev-oracle leak!)");
  // testnet-scoped keys must not leak into mainnet either
  mkWindow({ 'gonna.arena.adapter.testnet': 'testnet', 'gonna.arena.oracleurl.testnet': 'http://evil-oracle.example' });
  ok(M.arenaMode() === 'live', 'mainnet session: testnet-scoped adapter flag IGNORED (live default)');
  ok(M.oracleBaseUrl() === M.ORACLE_BASE_URL_MAINNET, 'mainnet session: testnet-scoped oracle override IGNORED');
  // mainnet-scoped keys ARE honored on mainnet
  const { store } = mkWindow({ 'gonna.arena.oracleurl.mainnet': 'http://qa-oracle:9999' });
  ok(M.oracleBaseUrl() === 'http://qa-oracle:9999', 'mainnet session: mainnet-scoped override honored');
  // and writes go to the scoped key
  mkWindow({});
  M.arenaMode();
  ok(!store.has('gonna.arena.adapter'), 'no unscoped writes');
  // symmetric check on the testnet build
  mkWindow({ 'gonna.arena.adapter.mainnet': 'testnet', 'gonna.arena.oracleurl.mainnet': 'http://evil.example' });
  ok(T.arenaMode() === 'live', 'testnet session: mainnet-scoped adapter flag IGNORED (live default)');
  ok(T.oracleBaseUrl() === T.ORACLE_BASE_URL_TESTNET, 'testnet session: mainnet-scoped oracle override IGNORED');
  // M-4: legacy stored 'testnet' MIGRATES to 'live' (and is rewritten)
  const s2 = mkWindow({ 'gonna.arena.adapter.testnet': 'testnet' });
  ok(T.arenaMode() === 'live', 'M-4 migration: legacy stored testnet -> live');
  ok(s2.store.get('gonna.arena.adapter.testnet') === 'live', 'M-4 migration: stored value rewritten to live');
}

// ================= [4] M-4: mode rename + migration =======================
console.log('\n[4] M-4: mode renamed testnet->live, legacy migration, chain helper');
{
  // testnet build: query ?arena=live wins + persists
  const w1 = mkWindow({});
  w1.loc.search = '?arena=live';
  ok(T.arenaMode() === 'live', 'testnet build: ?arena=live -> live');
  ok(w1.store.get('gonna.arena.adapter.testnet') === 'live', 'persisted as live (network-scoped key)');
  // legacy ?arena=testnet is an alias of live
  const w2 = mkWindow({});
  w2.loc.search = '?arena=testnet';
  ok(T.arenaMode() === 'live', 'legacy ?arena=testnet link -> live (alias)');
  ok(w2.store.get('gonna.arena.adapter.testnet') === 'live', 'alias persisted as live (not testnet)');
  // same on the mainnet build — a legacy link never downgrades the network
  const w3 = mkWindow({});
  w3.loc.search = '?arena=testnet';
  ok(M.arenaMode() === 'live', 'mainnet build: legacy ?arena=testnet -> live');
  ok(w3.store.get('gonna.arena.adapter.mainnet') === 'live', 'persisted under the .mainnet key');
  // arenaUsesTestnetChain: only a TESTNET build in live mode
  mkWindow({ 'gonna.arena.adapter.testnet': 'live' });
  ok(T.arenaUsesTestnetChain() === true, 'testnet build + live -> testnet chain (416002)');
  mkWindow({ 'gonna.arena.adapter.testnet': 'mock' });
  ok(T.arenaUsesTestnetChain() === false, 'testnet build + mock -> mainnet chain (main game)');
  mkWindow({ 'gonna.arena.adapter.mainnet': 'live' });
  ok(M.arenaUsesTestnetChain() === false, 'mainnet build + live -> MAINNET chain (416001) — never testnet');
  mkWindow({});
  ok(M.arenaMode() === 'live', 'mainnet build default = LIVE piazza (v17.0.4 Prince decree)');
  mkWindow({ 'gonna.arena.adapter.mainnet': 'mock' });
  ok(M.arenaMode() === 'mock', 'v17.0.4: a stored explicit mock choice still wins (persisted practice)');
}

// ================= [5] v17.0.4: stage-cache GAP-HEAL ========================
console.log('\n[5] GAP-HEAL: a legacy cache with a hole below the watermark self-heals (ONE full rescan)');
{
  const sdk = await import('algosdk');
  const selOf = (sig) => {
    const parts = sig.split(')');
    const argTypes = parts[0].slice(parts[0].indexOf('(') + 1).split(',').filter(Boolean);
    return new sdk.ABIMethod({ name: sig.slice(0, sig.indexOf('(')), args: argTypes.map((t, i) => ({ type: t, name: 'a' + i })), returns: { type: parts[1] || 'void' } }).getSelector();
  };
  const selCreate = Buffer.from(selOf('create_challenge(pay,axfer,uint64,uint64,uint64,uint64,byte[],uint64,byte[])uint64')).toString('base64');
  const b64 = (x) => Buffer.from(x, 'utf8').toString('base64');
  const tx = (round, note) => ({
    id: 'T' + round,
    'confirmed-round': round,
    'intra-round-offset': 0,
    note: note === null ? undefined : b64(note),
    'application-transaction': { 'application-args': [selCreate] },
  });
  // chain, OLDEST FIRST (algonode order): cid0 stage3 | cid1 stage5 | cid2 stage6 | cid3 stage1
  const page = { transactions: [tx(100, 'gonna:v2:stage:3'), tx(101, 'gonna:v2:stage:5'), tx(102, 'gonna:v2:stage:6'), tx(103, 'gonna:v2:stage:1')] };
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return { ok: true, json: async () => page }; };
  const dbg = [];
  const origDebug = console.debug;
  console.debug = (...a) => dbg.push(a.join(' '));
  try {
    // a complete legacy cache (no hole below the watermark) must NOT heal.
    // Fresh module instance (fragment import) => the 30s memo is empty.
    const T3 = await import(B1 + '#heal-complete');
    mkWindow({ 'gonna.arena.stages': JSON.stringify({ fromCid: 2, stages: { '0': 3, '1': 5 } }) });
    const ok2 = await T3.fetchArenaCreateStages({ total: 2 }); // counter == watermark
    ok(ok2['0'] === 3 && dbg.length === 0 && fetches === 0, 'complete legacy cache: no hole -> no heal, zero fetch cost');
    dbg.length = 0;
    // LEGACY cache (the Prince's cid-8 shape): watermark 3, cid 2 NEVER mapped
    const T2 = await import(B1 + '#heal-hole'); // fresh memo
    mkWindow({ 'gonna.arena.stages': JSON.stringify({ fromCid: 3, stages: { '0': 3, '1': 5 } }) });
    const stages = await T2.fetchArenaCreateStages({ total: 4 }); // no force: the board path
    ok(dbg.some((d) => d.includes('gap below watermark') && d.includes('cid 2')), 'gap-heal fired with a console.debug naming the hole (cid 2 < watermark 3)');
    ok(stages['2'] === 6, 'healed: cid 2 mapped by the full rescan (stage 6)');
    ok(stages['0'] === 3 && stages['1'] === 5 && stages['3'] === 1, 'healed: every noted cid mapped');
    const c = T2.readStageCache();
    ok(c.fromCid === 4 && c.scannedThrough === 4, 'healed cache: watermark 4 + proven prefix 4 (sealed)');
    // at-most-once: a forced re-entry with the healed cache must NOT heal again
    const dbgCount = dbg.length, fetchCount = fetches;
    const again = await T2.fetchArenaCreateStages({ force: true, total: 4 }); // force: skips memo AND heal; counter unchanged
    ok(again['2'] === 6 && fetches === fetchCount && dbg.length === dbgCount, 'heal is AT MOST ONCE per cache (sealed: no rescan, no debug on re-entry)');
  } finally {
    console.debug = origDebug;
    globalThis.fetch = undefined;
  }
}

rmSync(ENTRY, { force: true });
rmSync(B1, { force: true });
rmSync(B2, { force: true });

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
