// GONNA FIGHT v16 — SERVER ORACLE client brick (SPEC-oracle §3/§5/§7/§8):
//   (a) INPUT LOG v1 codec: encode->decode roundtrip identical, bitmask bit
//       map exact, 0-frame log, 300k cap with the honest `truncated` flag,
//       malformed payloads rejected.
//   (b) oracleClient: base URL (?oracle= override persisted, arenaMode
//       pattern), EXACT SPEC §3 body shapes, and honest error mapping —
//       {error} -> "THE ORACLE SAYS NO - <reason>", 429 -> "THE ORACLE IS
//       BUSY - RETRY IN A BREATH", timeout -> SILENT, network -> UNREACHABLE
//       (8s + exactly 1 retry; 4xx never retried). A network failure NEVER
//       falls back to the dev-oracle in silence.
//   (c) VITE_QA_ORACLE build gate: without the flag the #oracle= master link
//       is REFUSED (key never touches localStorage, hash still scrubbed);
//       with the flag the QA build adopts it (local harness only).
//   (d) chainAdapter testnet graph: NO static import of devOracle — the
//       served bundle cannot reach the QA key (grep-assert on the bundle).
// Run: node scripts/test-v16-oracle.mjs   (from /mnt/agents/output/app)
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
console.log('\n[0] SOURCE: the 4 call sites moved to the server oracle, dev key gated');
{
  const ca = readFileSync(join(ROOT, 'src/game/arena/chainAdapter.ts'), 'utf8');
  const oc = readFileSync(join(ROOT, 'src/game/arena/oracleClient.ts'), 'utf8');
  const ol = readFileSync(join(ROOT, 'src/game/arena/oracleLink.ts'), 'utf8');
  const eng = readFileSync(join(ROOT, 'src/game/engine.ts'), 'utf8');
  const ui = readFileSync(join(ROOT, 'src/game/arena/arenaUI.ts'), 'utf8');
  ok(!ca.includes('devOracle'), 'chainAdapter: ZERO devOracle references (import AND call sites gone)');
  ok(ca.includes("import { oracleScoreSig, oracleVerdictSig, registerContinueReceipt } from './oracleClient';"), 'chainAdapter signs via oracleClient helpers');
  ok(ca.includes('const sig = await oracleScoreSig('), 'create + submit ask the SERVER oracle for the score sig');
  ok(ca.includes('const vsig = await oracleVerdictSig(id,'), 'verdict sig via the server oracle (POST /v1/verdict)');
  ok(ca.includes('if (opts?.continueRefId) await registerContinueReceipt(opts.continueRefId, address);'), 'continue gate: receipt REGISTERED before the sig ask');
  ok(!ca.includes('requireOracle'), 'the old hasDevOracle preflight gate is gone (the server answers honestly)');
  ok(oc.includes("export const ORACLE_BASE_URL_TESTNET = 'https://gonna-arena-oracle-testnet.onrender.com';"), 'oracleClient: testnet base URL constant');
  ok(oc.includes("'gonna.arena.oracleurl'"), 'oracleClient: ?oracle= override persisted (arenaMode pattern)');
  ok(oc.includes("'THE ORACLE SAYS NO - '") && oc.includes("'THE ORACLE IS BUSY - RETRY IN A BREATH'"), 'honest slang error mapping present');
  ok(oc.includes("const TIMEOUT_MS = 8000;") && oc.includes('const MAX_ATTEMPTS = 2;'), '8s timeout + exactly 1 retry');
  ok(ol.includes("import.meta.env.VITE_QA_ORACLE === '1'"), 'oracleLink: build-time VITE_QA_ORACLE gate');
  ok(ol.includes("ORACLE_LINK_REFUSED_MSG = 'ORACLE KEY LIVES ON THE SERVER NOW'"), 'oracleLink: honest refusal line');
  ok(eng.includes('maskFromDown(inp.down)') && eng.includes('INPUT_LOG_CAP'), 'engine: per-frame input bitmask hook in Game.step');
  // v16.1 (SPEC-m2 §2/§4): FULL RUN is now SEEDED ('RUN-<cid>'), UNSEEDED is the no-seed fallback
  ok(eng.includes("seedLabel = this.descent ? this.descent.seedLabel : (this.arenaRunSeedLabel ?? 'UNSEEDED')"), 'engine: FULL RUN carries its REAL seed label (UNSEEDED = fallback only)');
  ok(eng.includes('this.arena.onRunFinished(this.score, run);'), 'engine: the input log seals WITH the score');
  ok(ui.includes('onRunFinished(score: number, run?: SealedRunInfo | null): void'), 'arenaUI: seal payload carries the run telemetry');
  ok(ui.includes('if (bestRun) cfg.sealedRun = bestRun;'), 'arenaUI: sealedRun rides the create config');
  ok(!ui.includes('hasDevOracle'), 'arenaUI: no dev-key status reads (server oracle line instead)');
}

// ================= bundle the REAL codec + client ===========================
const BUNDLE_LOG = join(ROOT, '.tmp-v16-inputlog.mjs');
const BUNDLE_OC = join(ROOT, '.tmp-v16-oracleclient.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/inputLog.ts', '--bundle', '--format=esm', '--platform=node', `--outfile=${BUNDLE_LOG}`], { cwd: ROOT, stdio: 'pipe' });
execFileSync('npx', ['esbuild', 'src/game/arena/oracleClient.ts', '--bundle', '--format=esm', '--platform=node', `--outfile=${BUNDLE_OC}`], { cwd: ROOT, stdio: 'pipe' });
const il = await import(BUNDLE_LOG);
const oc = await import(BUNDLE_OC);

// ================= [1] INPUT LOG v1 codec ===================================
console.log('\n[1] INPUT LOG: bitmask map, roundtrip, cap/truncated, malformed');
{
  const F = (over) => ({ up: false, down: false, left: false, right: false, punch: false, kick: false, jump: false, special: false, ...over });
  const bits = [['up', 1], ['down', 2], ['left', 4], ['right', 8], ['punch', 16], ['kick', 32], ['jump', 64], ['special', 128]];
  ok(bits.every(([k, b]) => il.maskFromDown(F({ [k]: true })) === b), 'each button maps to its exact bit (SPEC §5 order)');
  ok(il.maskFromDown(F({ up: true, punch: true, special: true })) === 145, 'combo mask: up+punch+special = 145');
  ok(il.maskFromDown(F({})) === 0, 'idle frame = 0');

  // roundtrip: pseudo-random masks survive byte-identical
  const masks = new Uint8Array(5000);
  let x = 0x9e3779b9;
  for (let i = 0; i < masks.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; masks[i] = x & 255; }
  const log = { v: 2, build: 'v16deadbeef', seedLabel: 'PIT-42', frames: masks.length, truncated: false, masks };
  const back = il.decodeInputLog(il.encodeInputLog(log));
  ok(back.v === 2 && back.build === log.build && back.seedLabel === log.seedLabel && back.frames === log.frames && back.truncated === false, 'roundtrip: header identical (encode emits v2, SPEC-m2 §2)');
  ok(back.masks.length === masks.length && back.masks.every((v, i) => v === masks[i]), 'roundtrip: all 5000 mask bytes identical');

  // base64 roundtrip
  const back64 = il.decodeInputLogB64(il.encodeInputLogB64(log));
  ok(back64.frames === log.frames && back64.masks[1234] === masks[1234] && back64.build === log.build, 'base64 roundtrip identical');

  // zero frames
  const zero = il.decodeInputLog(il.encodeInputLog({ v: 2, build: 'DEV', seedLabel: 'UNSEEDED', frames: 0, truncated: false, masks: new Uint8Array(0) }));
  ok(zero.frames === 0 && zero.masks.length === 0 && zero.seedLabel === 'UNSEEDED', '0-frame log roundtrips (empty masks)');

  // cap + honest truncation
  const big = new Uint8Array(il.INPUT_LOG_CAP + 100).fill(0xaa);
  const enc = il.encodeInputLog({ v: 2, build: 'DEV', seedLabel: 'PIT-1', frames: big.length, truncated: true, masks: big });
  const decBig = il.decodeInputLog(enc);
  ok(decBig.frames === il.INPUT_LOG_CAP && decBig.truncated === true && decBig.masks.length === il.INPUT_LOG_CAP, 'over-cap run: cut at 300k, truncated flag HONEST');
  const forcedTrunc = il.decodeInputLog(il.encodeInputLog({ v: 2, build: 'DEV', seedLabel: 'PIT-1', frames: il.INPUT_LOG_CAP + 1, truncated: false, masks: big }));
  ok(forcedTrunc.truncated === true, 'frames > cap forces the truncated flag even if the caller lies');

  // malformed payloads are rejected, never silently fixed
  const good = il.encodeInputLog(log);
  const throws = (b, why) => { try { il.decodeInputLog(b); return false; } catch { return true; } };
  ok(throws(good.slice(1), 'short'), 'truncated bytes rejected');
  const badMagic = good.slice(); badMagic[0] = 0x58;
  ok(throws(badMagic), 'bad magic rejected');
  const badVer = good.slice(); badVer[3] = 99;
  ok(throws(badVer), 'unknown version rejected');
  ok(throws(good.slice(0, good.length - 1)), 'missing frame byte rejected (length mismatch)');
  ok(throws(Uint8Array.from([...good, 0])), 'trailing garbage rejected');
}

// ================= [2] ORACLE CLIENT ========================================
console.log('\n[2] ORACLE CLIENT: base URL, SPEC §3 bodies, honest error mapping');
const store = new Map();
function setWindow(search = '') {
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
    },
    location: { search },
  };
}
setWindow();
const REQ = {
  cid: 42, seat: 1, addr: 'ADDR58', score: 9001,
  stageMode: 'stage', stageIdx: 3, build: 'v16deadbeef',
  run: { seedLabel: 'PIT-42', frames: 12345, durationSec: 205.75, inputLogB64: 'R0lM' },
  continueRef: '42',
};
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
    return handler(url, opts, calls.length);
  };
  return calls;
}
const jsonRes = (status, obj, headers) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...(headers ?? {}) } });

// ---- base URL: default, ?oracle= override + persistence --------------------
{
  store.clear(); setWindow();
  ok(oc.oracleBaseUrl() === 'https://gonna-arena-oracle-testnet.onrender.com', 'default base = ORACLE_BASE_URL_TESTNET');
  const calls = stubFetch(() => jsonRes(200, { sigB64: Buffer.alloc(64).toString('base64'), oracleAddr: 'ORA' }));
  await oc.signScore(REQ);
  ok(calls[0].url === 'https://gonna-arena-oracle-testnet.onrender.com/v1/sign-score', 'POST hits <base>/v1/sign-score');

  store.clear(); setWindow('?oracle=' + encodeURIComponent('http://qa-oracle:9999'));
  ok(oc.oracleBaseUrl() === 'http://qa-oracle:9999', '?oracle= query wins');
  ok(store.get('gonna.arena.oracleurl') === 'http://qa-oracle:9999', 'override persisted to gonna.arena.oracleurl');
  setWindow(''); // query gone — the persisted override survives (arenaMode pattern)
  ok(oc.oracleBaseUrl() === 'http://qa-oracle:9999', 'persisted override survives without the query');
  store.clear(); setWindow('?oracle=dev');
  ok(oc.oracleIsDev() === true, '?oracle=dev is the explicit QA dev sentinel');
  store.clear(); setWindow();
}

// ---- SPEC §3.2 body shape, byte-exact --------------------------------------
{
  const calls = stubFetch(() => jsonRes(200, { sigB64: Buffer.alloc(64).toString('base64'), oracleAddr: 'ORA' }));
  const r = await oc.signScore(REQ);
  const b = calls[0].body;
  ok(b.cid === 42 && b.seat === 1 && b.addr === 'ADDR58' && b.score === 9001, 'body: cid/seat/addr/score exact');
  ok(b.stageMode === 'stage' && b.stageIdx === 3 && b.build === 'v16deadbeef', 'body: stageMode/stageIdx/build exact');
  ok(b.run && b.run.seedLabel === 'PIT-42' && b.run.frames === 12345 && b.run.durationSec === 205.75 && b.run.inputLogB64 === 'R0lM', 'body: run{seedLabel,frames,durationSec,inputLogB64} exact');
  ok(b.continueRef === '42', 'body: continueRef rides the sign ask');
  ok(r.sigB64.length > 0 && r.oracleAddr === 'ORA', 'response {sigB64, oracleAddr} parsed');

  const vcalls = stubFetch(() => jsonRes(200, { verdictSigB64: 'QQ==', digestB64: 'Rg==', extraB64: 'Rw==', stageMode: 'stage', stageIdx: 3, playerCount: 2 }));
  const v = await oc.fetchVerdict(42);
  ok(vcalls[0].url.endsWith('/v1/verdict') && vcalls[0].body.cid === 42, 'verdict: POST /v1/verdict {cid}');
  ok(v.verdictSigB64 === 'QQ==' && v.digestB64 === 'Rg==' && v.extraB64 === 'Rw==' && v.stageMode === 'stage' && v.stageIdx === 3 && v.playerCount === 2, 'verdict response fields exact (SPEC §3.3)');

  const rcalls = stubFetch(() => jsonRes(200, { ok: true }));
  await oc.postContinueReceipt('42', 'ADDR58', 'TXIDXYZ');
  ok(rcalls[0].url.endsWith('/v1/continue/receipt') && rcalls[0].body.refId === '42' && rcalls[0].body.addr === 'ADDR58' && rcalls[0].body.txid === 'TXIDXYZ', 'receipt: POST /v1/continue/receipt {refId,addr,txid}');
}

// ---- error mapping: 4xx reason, no retry ------------------------------------
{
  const calls = stubFetch(() => jsonRes(400, { error: 'SCORE OVER THE CAP DEGEN' }));
  let err = null;
  try { await oc.signScore(REQ); } catch (e) { err = e; }
  ok(err && err.message === 'THE ORACLE SAYS NO - SCORE OVER THE CAP DEGEN', '4xx {error} -> THE ORACLE SAYS NO - <reason>');
  ok(err && err.status === 400 && calls.length === 1, '4xx is deterministic: NEVER retried (1 fetch)');
}
{
  const calls = stubFetch(() => jsonRes(429, { error: 'slow down' }, { 'retry-after': '3' }));
  let err = null;
  try { await oc.signScore(REQ); } catch (e) { err = e; }
  ok(err && err.message === 'THE ORACLE IS BUSY - RETRY IN A BREATH' && err.status === 429, '429 -> THE ORACLE IS BUSY - RETRY IN A BREATH');
  ok(calls.length === 1, '429 not auto-retried (the degen breathes, not the client)');
}
{
  const calls = stubFetch(() => jsonRes(409, { error: 'CHALLENGE NOT RESOLVABLE YET' }));
  let err = null;
  try { await oc.fetchVerdict(7); } catch (e) { err = e; }
  ok(err && err.message === 'THE ORACLE SAYS NO - CHALLENGE NOT RESOLVABLE YET' && err.status === 409, 'verdict 409 -> honest reason');
}
{
  const calls = stubFetch(() => new Response('<html>bad gateway</html>', { status: 502 }));
  let err = null;
  try { await oc.signScore(REQ); } catch (e) { err = e; }
  ok(err && err.message === 'THE ORACLE SAYS NO - HTTP 502', 'non-json error body -> honest HTTP status');
  ok(calls.length === 2, '5xx retried exactly once');
}

// ---- timeout + network: retried once, NEVER a silent dev fallback -----------
{
  let n = 0;
  globalThis.fetch = (url, opts) => new Promise((_, rej) => {
    n++;
    opts.signal.addEventListener('abort', () => rej(new DOMException('The operation was aborted', 'AbortError')));
  });
  let err = null;
  const t0 = Date.now();
  try { await oc.signScore(REQ, { timeoutMs: 30 }); } catch (e) { err = e; }
  ok(err && err.message === 'THE ORACLE IS SILENT - TIMED OUT, RETRY', 'timeout -> THE ORACLE IS SILENT');
  ok(n === 2, 'timeout retried exactly once (got ' + n + ')');
  ok(Date.now() - t0 < 3000, 'the timeout actually fires (no 8s hang in the QA path)');
}
{
  let n = 0;
  globalThis.fetch = async () => { n++; throw new TypeError('fetch failed'); };
  let err = null;
  try { await oc.signScore(REQ); } catch (e) { err = e; }
  ok(err && err.message === 'THE ORACLE IS UNREACHABLE - CHECK THE LINE AND RETRY', 'network error -> THE ORACLE IS UNREACHABLE');
  ok(n === 2 && !(err && 'sigB64' in err), 'network error retried once and NEVER dev-signed in silence');
}
{
  let n = 0;
  const calls = stubFetch(() => { n++; return n === 1 ? jsonRes(500, { error: 'hiccup' }) : jsonRes(200, { sigB64: Buffer.alloc(64, 7).toString('base64'), oracleAddr: 'ORA' }); });
  const r = await oc.signScore(REQ);
  ok(calls.length === 2 && r.sigB64.length > 0, '5xx once then 200: the single retry lands');
}

// ---- malformed success + sig helper + continue gate -------------------------
{
  stubFetch(() => jsonRes(200, { nope: true }));
  let err = null;
  try { await oc.signScore(REQ); } catch (e) { err = e; }
  ok(err && err.message === 'THE ORACLE TALKS GIBBERISH - BAD SIGN RECEIPT', '200 without sigB64 -> GIBBERISH, never a fabricated sig');
}
{
  const sig = Buffer.alloc(64, 9).toString('base64');
  stubFetch(() => jsonRes(200, { sigB64: sig, oracleAddr: 'ORA' }));
  const bytes = await oc.oracleScoreSig(REQ, { msg: new Uint8Array([1, 2, 3]) });
  ok(bytes instanceof Uint8Array && bytes.length === 64 && bytes[0] === 9, 'oracleScoreSig: server sigB64 -> 64 raw bytes for the group');
  const vbytes = await (async () => {
    stubFetch(() => jsonRes(200, { verdictSigB64: sig, digestB64: 'Rg==', extraB64: 'Rw==', stageMode: 'full', stageIdx: 0, playerCount: 1 }));
    return oc.oracleVerdictSig(42, new Uint8Array([9]));
  })();
  ok(vbytes.length === 64 && vbytes[0] === 9, 'oracleVerdictSig: server verdictSigB64 -> raw bytes');
}
{
  store.clear(); setWindow();
  let err = null;
  try { await oc.registerContinueReceipt('42', 'ADDR58'); } catch (e) { err = e; }
  ok(err && err.message === 'CONTINUE NOT PAID - PAY 5 ALGO FIRST', 'continue gate: no payment txid -> honest refusal');
  store.set('gonna.continue|42|ADDR58', 'TXIDPAID');
  const calls = stubFetch(() => jsonRes(200, { ok: true }));
  await oc.registerContinueReceipt('42', 'ADDR58');
  ok(calls.length === 1 && calls[0].body.txid === 'TXIDPAID' && calls[0].body.refId === '42', 'continue gate: stored txid REGISTERED with the server (single-use DB)');
}

// ================= [3] VITE_QA_ORACLE master-link gate =======================
console.log('\n[3] ORACLE LINK: refused without the build flag, armed with it');
{
  const ENTRY = join(ROOT, '.tmp-v16-link-entry.ts');
  const OUT_A = join(ROOT, '.tmp-v16-link-off.mjs');
  const OUT_B = join(ROOT, '.tmp-v16-link-on.mjs');
  writeFileSync(ENTRY, "export { adoptOracleFromHash, ORACLE_LINK_REFUSED_MSG } from './src/game/arena/oracleLink';\n");
  const esbuild = await import('esbuild');
  // OFF: the served-bundle condition (no VITE_QA_ORACLE define at all)
  await esbuild.build({
    entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'node', external: ['algosdk', 'tweetnacl'],
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' }, outfile: OUT_A, logLevel: 'silent',
  });
  // ON: the local QA build
  await esbuild.build({
    entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'node', external: ['algosdk', 'tweetnacl'],
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_QA_ORACLE': '"1"' }, outfile: OUT_B, logLevel: 'silent',
  });
  const mn = Array(25).fill('abandon').join(' ');
  const token = Buffer.from(mn, 'utf8').toString('base64url');
  const mkWindow = () => {
    const s = new Map([['gonna.arena.adapter', 'testnet']]);
    const scrubbed = { n: 0 };
    globalThis.window = {
      localStorage: {
        getItem: (k) => (s.has(k) ? s.get(k) : null),
        setItem: (k, v) => void s.set(k, String(v)),
        removeItem: (k) => void s.delete(k),
      },
      location: { hash: '#oracle=' + token, search: '', hostname: 'localhost', pathname: '/' },
      history: { replaceState: () => { scrubbed.n++; } },
    };
    return { s, scrubbed };
  };
  const off = await import(OUT_A);
  {
    const { s, scrubbed } = mkWindow();
    const adopted = off.adoptOracleFromHash();
    ok(adopted === false, 'flag OFF: the master link is REFUSED');
    ok(!s.has('gonna.qa.oracle.mn'), 'flag OFF: the key NEVER touches localStorage');
    ok(scrubbed.n === 1, 'flag OFF: the hash is still scrubbed (not a route, never lingers)');
    ok(off.ORACLE_LINK_REFUSED_MSG === 'ORACLE KEY LIVES ON THE SERVER NOW', 'honest refusal message exported');
  }
  const on = await import(OUT_B);
  {
    const { s, scrubbed } = mkWindow();
    const adopted = on.adoptOracleFromHash();
    ok(adopted === true && s.get('gonna.qa.oracle.mn') === mn, 'flag ON (QA build): the link arms the dev key');
    ok(scrubbed.n === 1, 'flag ON: hash scrubbed as always');
  }
  rmSync(ENTRY, { force: true }); rmSync(OUT_A, { force: true }); rmSync(OUT_B, { force: true });
}

// ================= [4] BUNDLE: no static devOracle in the testnet graph =====
console.log('\n[4] BUNDLE: chainAdapter testnet graph cannot reach the QA key statically');
{
  const ENTRY = join(ROOT, '.tmp-v16-ca-entry.ts');
  const OUT = join(ROOT, '.tmp-v16-ca-bundle.mjs');
  writeFileSync(ENTRY, "export { TestnetArenaAdapter } from './src/game/arena/chainAdapter';\n");
  const esbuild = await import('esbuild');
  let staticDevImport = null;
  await esbuild.build({
    entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'node', external: ['algosdk', 'tweetnacl'],
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' }, outfile: OUT, logLevel: 'silent',
    plugins: [{
      name: 'no-static-devoracle',
      setup(build) {
        build.onResolve({ filter: /(^|\/)devOracle$/ }, (args) => {
          if (args.kind !== 'dynamic-import') {
            staticDevImport = args.importer + ' -> ' + args.path + ' (' + args.kind + ')';
            return { errors: [{ text: 'static devOracle import in the testnet graph: ' + staticDevImport }] };
          }
          return null; // the explicit ?oracle=dev QA path loads it lazily
        });
      },
    }],
  });
  ok(staticDevImport === null, 'ZERO static devOracle imports in the chainAdapter graph' + (staticDevImport ? ' (FOUND: ' + staticDevImport + ')' : ''));
  const bundle = readFileSync(OUT, 'utf8');
  ok(!bundle.includes('ORACLE OFFLINE - testnet dev oracle key not injected'), 'bundle: the old dev-key gate message is GONE');
  ok(bundle.includes('/v1/sign-score') && bundle.includes('/v1/verdict') && bundle.includes('/v1/continue/receipt'), 'bundle: the 3 SPEC §3 endpoints are wired');
  ok(!/devOracleSignScore\(kit\.scoreMsg/.test(bundle), 'bundle: no devOracleSignScore(kit.scoreMsg(...)) call site left');
  rmSync(ENTRY, { force: true }); rmSync(OUT, { force: true });
}

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
for (const f of [BUNDLE_LOG, BUNDLE_OC]) rmSync(f, { force: true });
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
