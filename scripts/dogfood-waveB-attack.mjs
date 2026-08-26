// attack.mjs — DOGFOOD WAVE B (avversariale) vs public testnet oracle.
// Output: /tmp/waveb/results.json  [{id,name,expected,status,body,ms,...}]
// Uso: node attack.mjs [--skip-slow] [--only A1,A2,...]
import { writeFileSync } from 'node:fs';
import { REPO, initStubs, loadBundle, playHonest, gilEncode, b64e, b64d, replayTolerant, bootStageRun } from './gil.mjs';

const ORACLE = 'https://gonna-arena-oracle-testnet.onrender.com';
const APP_ID = 769907387;
const BUILD = 'v53365263';
const OLD_BUILD = 'v002d77d0';
const SKIP_SLOW = process.argv.includes('--skip-slow');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx > 0 ? process.argv[onlyIdx + 1].split(',') : null;
const want = (id) => !ONLY || ONLY.includes(id);

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function rec(id, name, expected, r) {
  const b = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  results.push({ id, name, expected, status: r.status, body: b.slice(0, 500), ms: r.ms, extra: r.extra });
  console.log(`[${id}] ${name}\n     expected: ${expected}\n     got: HTTP ${r.status} ${b.slice(0, 180)} (${r.ms}ms)`);
}

async function post(path, payload, { raw = null, headers = {}, retries = 2, keep429 = false } = {}) {
  const t0 = Date.now();
  for (let a = 0; a <= retries; a++) {
    try {
      const res = await fetch(ORACLE + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: raw ?? JSON.stringify(payload),
      });
      const ms = Date.now() - t0;
      const text = await res.text();
      if (res.status >= 500 && a < retries) { await sleep(7000); continue; } // redeploy window
      if (res.status === 429 && !keep429 && a < retries) { await sleep(65000); continue; } // shared IP budget: wait a window
      let json; try { json = JSON.parse(text); } catch { json = text; }
      const extra = {};
      const ra = res.headers.get('retry-after'); if (ra) extra.retryAfter = ra;
      const acao = res.headers.get('access-control-allow-origin'); if (acao) extra.acao = acao;
      return { status: res.status, body: json, ms, extra };
    } catch (e) {
      if (a < retries) { await sleep(7000); continue; }
      return { status: -1, body: 'FETCH FAIL: ' + e.message, ms: Date.now() - t0, extra: {} };
    }
  }
}

async function nextCid() {
  const r = await fetch(`https://testnet-api.algonode.cloud/v2/applications/${APP_ID}`);
  const j = await r.json();
  const gs = Object.fromEntries(j.params['global-state'].map((e) => [Buffer.from(e.key, 'base64').toString(), e.value.uint]));
  return Number(gs['next_challenge_id']);
}

// ---------------------------------------------------------------------------
const st = await initStubs();
const { default: algosdk } = await import(REPO + '/node_modules/algosdk/dist/esm/index.js');
const secrets = JSON.parse(process.env.WAVEB_SECRETS ?? '{}');

console.log('== Wave B battery vs ' + ORACLE + ' ==');
const h = await fetch(ORACLE + '/v1/health');
console.log('health:', h.status, JSON.stringify(await h.json()));

const eng = await loadBundle(BUILD);
const rndAddr = () => algosdk.generateAccount().addr.toString();

// --- generate the honest tape set for the CURRENT next_challenge_id ----------
const cid = await nextCid();
console.log('next_challenge_id =', cid, '— generating honest tapes…');
const seed = `PIT-${cid}`;
const honest = playHonest(eng, 1, seed, 7200, 5);
console.log(`honest run: score=${honest.score} frames=${honest.frames}`);
const mkLog = (over = {}, masks = honest.masks) =>
  b64e(gilEncode({ v: 2, build: BUILD, seedLabel: seed, frames: honest.frames, ...over }, masks));
const honestLog = mkLog();
const mkBody = (score, over = {}, runOver = {}) => ({
  cid, seat: 0, addr: rndAddr(), score, stageMode: 'stage', stageIdx: 1, build: BUILD,
  run: { seedLabel: seed, frames: honest.frames, durationSec: Math.ceil(honest.frames / 60) + 2, inputLogB64: honestLog, ...runOver },
  ...over,
});

// --- A0 baseline: honest -> 200 ---------------------------------------------
if (want('A0')) {
  const r = await post('/v1/sign-score', mkBody(honest.score));
  rec('A0', 'baseline honest v2 log', '200 + sigB64', r);
  await sleep(2200);
}

// --- A1 score gonfiato -------------------------------------------------------
if (want('A1')) {
  const r = await post('/v1/sign-score', mkBody(honest.score + 5000));
  rec('A1', 'inflated score (+5000), honest log', '400 REPLAY MISMATCH', r);
  await sleep(2200);
}

// --- A2 bitflip in un frame intermedio --------------------------------------
if (want('A2')) {
  const flipMasks = honest.masks.slice();
  flipMasks[100] ^= 0x08; // clear RIGHT at frame 100 -> downstream cascade
  const g = bootStageRun(eng, 1, seed);
  const fsim = replayTolerant(g, flipMasks); // what the oracle replay computes
  console.log(`  flipped-tape local replay: score=${fsim.score} consumed=${fsim.consumed}/${flipMasks.length} stuck=${fsim.stuck} (honest: ${honest.score})`);
  const r = await post('/v1/sign-score', mkBody(honest.score, {}, { inputLogB64: mkLog({}, flipMasks) }));
  rec('A2', 'bitflip RIGHT @frame100, claim honest score', '400 REPLAY MISMATCH', r);
  await sleep(2200);
}

// --- A3 v1 legacy -------------------------------------------------------------
if (want('A3')) {
  const v1 = (masks, over = {}) => {
    const raw = gilEncode({ v: 2, build: BUILD, seedLabel: seed, frames: honest.frames, ...over }, masks);
    raw[3] = 1; // downgrade to legacy v1 (same layout)
    return b64e(raw);
  };
  const r1 = await post('/v1/sign-score', mkBody(honest.score, {}, { inputLogB64: v1(honest.masks) }));
  rec('A3a', 'LEGACY v1 log, honest score', '400 LEGACY LOG REFUSED (REPLAY_ENFORCE=1 batte ALLOW_LEGACY_GIL)', r1);
  await sleep(2200);
  const r2 = await post('/v1/sign-score', mkBody(honest.score + 99999, {}, { inputLogB64: v1(honest.masks) }));
  rec('A3b', 'LEGACY v1 log, INFLATED score (+99999)', '400 LEGACY LOG REFUSED — se 200 e\' SEV-1 (v1 salta il replay)', r2);
  await sleep(2200);
}

// --- A4 seed sbagliato --------------------------------------------------------
if (want('A4')) {
  const wrongSeed = 'PIT-999999';
  const log = b64e(gilEncode({ v: 2, build: BUILD, seedLabel: wrongSeed, frames: honest.frames }, honest.masks));
  const r = await post('/v1/sign-score', mkBody(honest.score, {}, { seedLabel: wrongSeed, inputLogB64: log }));
  rec('A4', `honest tape of ${seed}, presented as ${wrongSeed}`, '400 SEED MISMATCH', r);
  await sleep(2200);
}

// --- A5 build falsa -------------------------------------------------------------
if (want('A5')) {
  const log = b64e(gilEncode({ v: 2, build: 'vdeadbeef', seedLabel: seed, frames: honest.frames }, honest.masks));
  const r = await post('/v1/sign-score', mkBody(honest.score, { build: 'vdeadbeef' }, { inputLogB64: log }));
  rec('A5', "build='vdeadbeef' (header+body)", '400 BUILD UNKNOWN TO THE ORACLE', r);
  await sleep(2200);
}

// --- A6 build vecchia v002d77d0 -------------------------------------------------
if (want('A6')) {
  const engOld = await loadBundle(OLD_BUILD);
  const oldRun = playHonest(engOld, 1, seed, 7200, 5);
  console.log(`old-engine replay of same tape: score=${oldRun.score} (new engine: ${honest.score})`);
  const logOld = b64e(gilEncode({ v: 2, build: OLD_BUILD, seedLabel: seed, frames: oldRun.frames }, oldRun.masks));
  const r1 = await post('/v1/sign-score', mkBody(oldRun.score, { build: OLD_BUILD }, { inputLogB64: logOld, frames: oldRun.frames }));
  rec('A6a', `build=${OLD_BUILD} + tape scored on THAT engine (${oldRun.score})`, '200 se il bundle legacy e\' ancora pinnato / 400 BUILD UNKNOWN se pruned', r1);
  await sleep(2200);
  const r2 = await post('/v1/sign-score', mkBody(honest.score, { build: OLD_BUILD }, { inputLogB64: logOld, frames: oldRun.frames }));
  rec('A6b', `build=${OLD_BUILD} ma score del motore NUOVO (${honest.score})`, '400 REPLAY MISMATCH (engine drift) o frames mismatch', r2);
  await sleep(2200);
}

// --- A7 troncamenti ---------------------------------------------------------------
if (want('A7')) {
  const r1 = await post('/v1/sign-score', mkBody(honest.score, {}, { inputLogB64: mkLog({ truncated: true }) }));
  rec('A7a', 'truncated FLAG bit0=1 (len integre)', '400 RUN LOG TRUNCATED', r1);
  await sleep(2200);
  const half = Math.floor(honest.frames / 2);
  const halfLog = b64e(gilEncode({ v: 2, build: BUILD, seedLabel: seed, frames: half }, honest.masks));
  const r2 = await post('/v1/sign-score', mkBody(honest.score, {}, { frames: half, durationSec: Math.ceil(half / 60) + 2, inputLogB64: halfLog }));
  rec('A7b', `frames array tagliato a meta' (${half}), header coerente`, '400 REPLAY MISMATCH (replay copre meta\' tape)', r2);
  await sleep(2200);
  const rawCut = b64d(honestLog).slice(0, Math.floor(b64d(honestLog).length / 2));
  const r3 = await post('/v1/sign-score', mkBody(honest.score, {}, { inputLogB64: b64e(rawCut) }));
  rec('A7c', 'bytes del log tagliati a meta\' (header dice 7200)', '400 input log: invalid structure', r3);
  await sleep(2200);
}

// --- A8 receipt reuse ---------------------------------------------------------------
if (want('A8')) {
  const PB = 'D3XW34DMJTCJQKZZKRWUQDYPGWE5RHM4TZPAKZD27333K57MNYEFQY2I7A';
  const receipt = { refId: 'E2EV161-1-B', addr: PB, txid: 'FO6B7NJJP22FS3QUZHGTGRFGDMT73DGQPAU3FHDSK23BHVBT2QSQ' };
  const r1 = await post('/v1/continue/receipt', receipt);
  rec('A8a', 'register OLD on-chain receipt (E2EV161-1-B)', '200 prima volta / 409 se gia\' registrata', r1);
  await sleep(2200);
  const r2 = await post('/v1/continue/receipt', receipt);
  rec('A8b', 'REUSE stesso receipt txid', '409 receipt already registered', r2);
  await sleep(2200);
  const r3 = await post('/v1/continue/receipt', { refId: 'WAVEB-FAKE', addr: PB, txid: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
  rec('A8c', 'receipt con txid inesistente', '400 continue payment not verified on-chain', r3);
  await sleep(2200);
  // consume + reconsume (needs an honest log; addr must match the receipt addr)
  const r4 = await post('/v1/sign-score', mkBody(honest.score, { addr: PB, continueRef: 'E2EV161-1-B' }));
  rec('A8d', 'sign-score con continueRef (consume)', '200 consuma / 409 se gia\' consumata', r4);
  await sleep(2200);
  const r5 = await post('/v1/sign-score', mkBody(honest.score, { addr: PB, continueRef: 'E2EV161-1-B' }));
  rec('A8e', 'REUSE receipt gia\' consumata', '409 continue receipt already consumed', r5);
  await sleep(2200);
}

// --- A11 verdict misuse ---------------------------------------------------------
if (want('A11')) {
  const r1 = await post('/v1/verdict', { cid: 999999999 });
  rec('A11a', 'verdict su cid MAI esistito', '409 challenge not active', r1);
  await sleep(2200);
  const r2 = await post('/v1/verdict', { cid: 0 });
  rec('A11b', 'verdict su cid 0 (prima card, boxes cancellate = finalized/expired)', '409 challenge not active', r2);
  await sleep(2200);
  const r3 = await post('/v1/verdict', { cid: '5' });
  rec('A11c', "verdict con cid stringa (tipo sbagliato)", '400 malformed request body', r3);
  await sleep(2200);
}

// --- A12 body malformati ----------------------------------------------------------
if (want('A12')) {
  const cases = [
    ['A12a', { raw: '{broken json' }, 'JSON rotto'],
    ['A12b', { payload: {} }, 'body vuoto'],
    ['A12c', { payload: mkBody('5000') }, 'score come stringa'],
    ['A12d', { payload: mkBody(honest.score, { cid: -3 }) }, 'cid negativo'],
    ['A12e', { payload: mkBody(honest.score, { addr: 'not-an-addr' }) }, 'addr spazzatura'],
    ['A12f', { payload: mkBody(honest.score, { stageMode: 'turbo' }) }, 'stageMode sconosciuto'],
    ['A12g', { payload: mkBody(honest.score, {}, { frames: -5 }) }, 'frames negativi'],
    ['A12h', { payload: mkBody(honest.score, { stageMode: 'full', stageIdx: 1 }) }, 'full con stageIdx'],
  ];
  for (const [id, opt, name] of cases) {
    const r = await post('/v1/sign-score', opt.payload ?? null, { raw: opt.raw ?? null });
    rec(id, name, '400 pulito, niente 500, niente stack trace', r);
    await sleep(1800);
  }
}

// --- A13 giganti / DoS --------------------------------------------------------------
if (want('A13') && !SKIP_SLOW) {
  // (a) frames dichiarati > cap con log piccolo
  const r1 = await post('/v1/sign-score', mkBody(honest.score, {}, { frames: 300001, durationSec: 5000 }));
  rec('A13a', 'run.frames=300001 (log piccolo)', "400 run sanity: frames above 300000 (veloce)", r1);
  await sleep(2200);
  // (b) header frames=300001 con bitmask coerente-corta -> decode reject
  const over = gilEncode({ v: 2, build: BUILD, seedLabel: seed, frames: 100 }, new Uint8Array(100));
  new DataView(over.buffer).setUint32(over.length - 4 - 100, 300001, false);
  const r2 = await post('/v1/sign-score', mkBody(honest.score, {}, { frames: 300001, durationSec: 5000, inputLogB64: b64e(over) }));
  rec('A13b', 'header GIL frames=300001', '400 input log: invalid structure (veloce)', r2);
  await sleep(2200);
  // (c) 1MB di zeri -> b64 > 600k char -> shape reject, misura tempo
  const oneMB = b64e(new Uint8Array(1024 * 1024));
  const r3 = await post('/v1/sign-score', mkBody(honest.score, {}, { inputLogB64: oneMB }));
  rec('A13c', 'inputLogB64 da 1MB di zeri (~1.4MB b64)', '400 malformed request body (limite 600k char), veloce', r3);
  await sleep(2200);
  // (d) log valido 299999 frames di zeri: replay pesante — misura latenza + health durante
  const zeros = new Uint8Array(299999);
  const zlog = b64e(gilEncode({ v: 2, build: BUILD, seedLabel: seed, frames: 299999 }, zeros));
  const p = post('/v1/sign-score', mkBody(0, {}, { frames: 299999, durationSec: 2500, inputLogB64: zlog }), { retries: 0 });
  await sleep(1000);
  const ht0 = Date.now();
  const hh = await fetch(ORACLE + '/v1/health');
  const healthMs = Date.now() - ht0;
  await hh.text();
  const r4 = await p;
  r4.extra = { ...(r4.extra ?? {}), healthDuringMs: healthMs };
  rec('A13d', 'log valido 299999 frames zeri (replay DoS probe)', 'rifiuto o 200, ma /v1/health durante il replay deve rispondere <2s', r4);
  console.log('  health latency during replay:', healthMs + 'ms');
}

// --- A9 rate limit (LAST, fresh window) ----------------------------------------------
if (want('A9')) {
  console.log('waiting for a fresh rate window…');
  const now = Date.now() / 1000;
  await sleep((60 - (now % 60) + 2) * 1000);
  const seq = [];
  for (let i = 1; i <= 40; i++) {
    const r = await post('/v1/verdict', { cid: 1 }, { retries: 0, keep429: true });
    seq.push({ i, status: r.status, retryAfter: r.extra?.retryAfter, body: typeof r.body === 'string' ? r.body : r.body?.error });
    if (i % 5 === 0) console.log('  burst', i, '->', r.status);
  }
  const first429 = seq.find((s) => s.status === 429);
  rec('A9', 'raffica 40x /v1/verdict stesso IP', '429 dal limite+1 (missione dice 21a; default config 30/min) con Retry-After', {
    status: first429 ? 429 : 200, body: JSON.stringify({ first429At: first429?.i ?? null, retryAfter: first429?.retryAfter, sample: seq.filter((s) => s.status === 429).slice(0, 2) }), ms: 0,
  });
}

writeFileSync('/tmp/waveb/results.json', JSON.stringify(results, null, 2));
console.log('\nresults -> /tmp/waveb/results.json (' + results.length + ' entries)');
process.exit(0);
