// GONNA FIGHT v15.2.8b — FINAL HONESTY NITS (verifier follow-ups on v15.2.8):
//   [0] SOURCE: shareText routed through stageLine; link tier verified:false;
//       count-mismatch guard skips caching + keeps the watermark
//   [1] shareText carries (UNVERIFIED) for unverified single-mode cards,
//       the plain STAGE label for verified ones (and FULL RUN untouched)
//   [2] link tier (?st=) fills stageIdx but stageVerified stays FALSE
//       (?duel=26&st=5 can no longer spoof a legacy card as VERIFIED);
//       note/memory tiers stay verified; behavioral via toChallenge
//   [3] count-MISMATCH scan banks NOTHING (no localStorage write, no log)
//       and the watermark is untouched (never backward, never forward)
//   [4] count-MATCH scan banks normally (entries + watermark advance)
// Run: node scripts/test-v1528b.mjs   (from /mnt/agents/output/app)
import { readFileSync } from 'node:fs';
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
console.log('\n[0] SOURCE: the three honesty nits are in the tree');
{
  const sc = readFileSync(join(ROOT, 'src/game/arena/shareCard.ts'), 'utf8');
  ok(/export function shareText[\s\S]*?stageLine\(ch\) \+ '\.'/.test(sc), 'shareCard: shareText routes the stage through stageLine (marker rides along)');
  ok(!/export function shareText[\s\S]*?'STAGE ' \(\(\(ch\.stageIdx/.test(sc), 'shareCard: the raw STAGE N print (no marker) is gone from shareText');

  const ca = readFileSync(join(ROOT, 'src/game/arena/chainAdapter.ts'), 'utf8');
  ok(ca.includes("if (inStageRange(opts.link)) return { stageIdx: opts.link, verified: false, source: 'link' };"), 'chainAdapter: link tier fills stageIdx, verified FALSE');
  ok(!ca.includes("source: 'link', verified: true") && !ca.includes("verified: true, source: 'link'"), 'chainAdapter: no verified:true link tier anywhere');

  const kit = readFileSync(join(ROOT, 'src/game/arena/testnetKit.ts'), 'utf8');
  ok(kit.includes('if (cache.fromCid + hits.length === total) {'), 'kit: count cross-check gates the cache write');
  ok(/if \(cache\.fromCid \+ hits\.length === total\) \{\s*out = applyStageScan\(cache, hits\);\s*writeStageCache\(out\);\s*\}/.test(kit), 'kit: applyStageScan + writeStageCache run ONLY inside the match branch (mismatch banks nothing)');
  ok(kit.includes('nextChallengeId()'), 'kit: the guard compares against the next_challenge_id global');
}

// ================= browser-global stubs (BEFORE any bundle loads) ===========
const store = new Map();
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
};
globalThis.window = {
  localStorage: localStorageStub,
  location: { search: '', hostname: 'localhost', pathname: '/', origin: 'http://localhost' },
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  visualViewport: undefined,
};
globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {} }), body: { appendChild() {} }, activeElement: null };
globalThis.localStorage = localStorageStub;
globalThis.Image = class {};
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };

const { writeFileSync } = await import('node:fs');
const esbuild = await import('esbuild');

// ================= bundle S: shareCard + chainAdapter (kit stubbed) =========
const KITSTUB = join(ROOT, '.tmp-v1528b-kitstub.ts');
const ORACLESTUB = join(ROOT, '.tmp-v1528b-oraclestub.ts');
const QASTUB = join(ROOT, '.tmp-v1528b-qastub.ts');
const ENTRY_S = join(ROOT, '.tmp-v1528b-entry-s.ts');
const BUNDLE_S = join(ROOT, '.tmp-v1528b-bundle-s.mjs');
writeFileSync(
  KITSTUB,
  "const H = () => globalThis.__KIT;\n" +
    'export const ARENA_APP_ID = 769767443;\n' +
    'export const GONNA_ASA_TESTNET = 769688287;\n' +
    'export const OPUP_APP_ID = 769688641;\n' +
    "export const TREASURY_ADDR = 'TREASURYSTUB';\n" +
    "export const ORACLE_ADDR = 'ORACLESTUB';\n" +
    "export const ALGOD_TESTNET = 'https://example.invalid';\n" +
    "export const INDEXER_TESTNET = 'https://example.invalid';\n" +
    'export const SEAT_TTL_SECS = 3600;\n' +
    'export const ARENA_VERSION = 2;\n' +
    'export const GONNA_DECIMALS = 6;\n' +
    'export const TESTNET_FEES = new Proxy({}, { get: () => 1000 });\n' +
    'export const CONTINUE_FEE_MICRO = 5000000;\n' +
    'export const SIGN_TIMEOUT_MS = 90000;\n' +
    "export const SIGN_TIMEOUT_MSG = 'TIMEOUT';\n" +
    'export const SIGN_NUDGE_MS = 12000;\n' +
    "export const SIGN_CANCEL_MSG = 'CANCELLED';\n" +
    'export class SignCancelled extends Error {}\n' +
    'export const sdk = () => H().sdk();\n' +
    'export const algodClient = () => H().algodClient();\n' +
    'export const scoreMsg = (...a) => H().scoreMsg(...a);\n' +
    'export const verdictMsg = (...a) => H().verdictMsg(...a);\n' +
    'export const nextChallengeId = () => H().nextChallengeId();\n' +
    'export const contractVersion = () => H().contractVersion();\n' +
    'export const readMeta = (cid) => H().readMeta(cid);\n' +
    'export const readPlayers = (cid) => H().readPlayers(cid);\n' +
    'export const scanChallengeIds = () => H().scanChallengeIds();\n' +
    'export const buildCreateGroup = (o) => H().buildCreateGroup(o);\n' +
    'export const buildJoinGroup = (o) => H().buildJoinGroup(o);\n' +
    'export const buildSubmitGroup = (o) => H().buildSubmitGroup(o);\n' +
    'export const buildResolveGroup = (o) => H().buildResolveGroup(o);\n' +
    'export const buildClaimGroup = (o) => H().buildClaimGroup(o);\n' +
    'export const buildEarlyCloseGroup = (o) => H().buildEarlyCloseGroup(o);\n' +
    'export const buildClaimForfeitGroup = (o) => H().buildClaimForfeitGroup(o);\n' +
    'export const buildContinuePayment = (o) => H().buildContinuePayment(o);\n' +
    "export const continueNote = () => 'note';\n" +
    'export const verifyContinuePayment = () => Promise.resolve(true);\n' +
    'export const withTimeout = (p) => p;\n' +
    'export const isCidRaceReject = () => false;\n' +
    'export const isSignCancel = () => false;\n' +
    'export const isWedgeError = () => false;\n' +
    'export const setSignRecoverHook = () => undefined;\n' +
    'export const activeSignOp = () => null;\n' +
    'export const signSendManaged = (...a) => H().signSendManaged(...a);\n' +
    'export const signSend = (...a) => H().signSend(...a);\n' +
    'export const recordTxid = (...a) => H().recordTxid && H().recordTxid(...a);\n' +
    'export const getTxid = () => null;\n' +
    'export const recordCloseTxid = (...a) => H().recordCloseTxid && H().recordCloseTxid(...a);\n' +
    'export const getCloseTxid = () => null;\n' +
    'export const pickCloseTxid = () => null;\n' +
    'export const resolveCloseTxid = () => null;\n' +
    "export const explorerTxUrlFor = (n, t) => 'https://example.invalid/' + n + '/' + t;\n" +
    'export const recordResolveAt = (...a) => H().recordResolveAt && H().recordResolveAt(...a);\n' +
    'export const getResolveAt = () => null;\n' +
    "export const explorerTxUrl = (t) => 'https://example.invalid/' + t;\n" +
    'export const fetchArenaCloseEvents = (...a) => H().fetchArenaCloseEvents(...a);\n' +
    'export const fetchArenaCreateStages = (...a) => (H().fetchArenaCreateStages ? H().fetchArenaCreateStages(...a) : Promise.resolve({}));\n' +
    'export const rememberCard = (m) => H().rememberCard && H().rememberCard(m);\n' +
    'export const rememberedCard = (cid) => H().rememberedCard(cid);\n' +
    'export const rememberedCards = () => (H().rememberedCards ? H().rememberedCards() : []);\n',
);
writeFileSync(
  ORACLESTUB,
  'export const armDevOracle = () => undefined;\n' +
    'export const hasDevOracle = () => true;\n' +
    'export const devOracleSign = async () => new Uint8Array(64);\n' +
    'export const devOracleSignScore = async () => new Uint8Array(64);\n',
);
writeFileSync(QASTUB, 'export const qaMode = () => false;\nexport const qaActive = () => false;\nexport const qaScore = () => 4200;\n');
writeFileSync(
  ENTRY_S,
  "export { pickCardStage, setLinkStageHint, getLinkStageHint, TestnetArenaAdapter } from './src/game/arena/chainAdapter';\n" +
    "export { shareText, stageLine } from './src/game/arena/shareCard';\n",
);
await esbuild.build({
  entryPoints: [ENTRY_S], bundle: true, format: 'esm', platform: 'node', external: ['algosdk'],
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  outfile: BUNDLE_S, logLevel: 'silent',
  plugins: [
    {
      name: 'kitstub',
      setup(build) {
        build.onResolve({ filter: /(^|\/)testnetKit$/ }, () => ({ path: KITSTUB }));
        build.onResolve({ filter: /(^|\/)devOracle$/ }, () => ({ path: ORACLESTUB }));
        build.onResolve({ filter: /(^|\/)qaSigner$/ }, () => ({ path: QASTUB }));
      },
    },
  ],
});
const modS = await import(BUNDLE_S);
const { pickCardStage, setLinkStageHint, TestnetArenaAdapter, shareText, stageLine } = modS;

// ================= [1] shareText honesty ====================================
console.log('\n[1] shareText: UNVERIFIED marker on guesses, plain label on truth');
{
  const base = {
    id: 42, creator: 'CREATOR', creatorName: 'DEGEN', creatorType: 'ed25519',
    visibility: 'public', format: 'duel', seatsTotal: 2, durationSecs: 86400,
    stake: 10_000_000, createdAt: Date.now(), deadline: Date.now() + 3600_000,
    status: 'open', players: [], winner: null, pot: 10_000_000,
  };
  const verified = shareText({ ...base, stageMode: 'single', stageIdx: 5, stageVerified: true });
  ok(verified.includes('STAGE 6 - LAUNCHPAD.') && !verified.includes('UNVERIFIED'), 'verified single card: plain STAGE 6 - LAUNCHPAD, no marker');
  const guessed = shareText({ ...base, stageMode: 'single', stageIdx: 5, stageVerified: false });
  ok(guessed.includes('STAGE 6 - LAUNCHPAD (UNVERIFIED).'), 'fallback-guessed stage: share copy carries (UNVERIFIED)');
  const legacy = shareText({ ...base, stageMode: 'single', stageIdx: 5, stageVerified: undefined });
  ok(legacy.includes('STAGE 6 - LAUNCHPAD.') && !legacy.includes('UNVERIFIED'), 'stageVerified undefined (pre-v15.2.8 record) treated as true — no marker');
  const full = shareText({ ...base, stageMode: 'full', stageIdx: null });
  ok(full.includes('FULL RUN. ALL 7 STAGES.') && !full.includes('UNVERIFIED'), 'FULL RUN copy unchanged, no marker');
  ok(stageLine({ stageMode: 'single', stageIdx: 5, stageVerified: false }) === 'STAGE 6 - LAUNCHPAD (UNVERIFIED)', 'stageLine still the single source of the marker');
}

// ================= [2] LINK TIER never self-verifies ========================
console.log('\n[2] link tier (?st=): fills the stage, NEVER verified');
{
  let r = pickCardStage(26, 'single', { link: 5 });
  ok(r.stageIdx === 5 && r.verified === false && r.source === 'link', 'crafted ?duel=26&st=5: stage filled (5) but verified FALSE');
  r = pickCardStage(26, 'single', { note: 2, link: 5 });
  ok(r.stageIdx === 2 && r.verified === true && r.source === 'note', 'note tier still verified and still overrides the link');
  r = pickCardStage(26, 'single', { memory: { stageIdx: 3, stageVerified: true }, link: 5 });
  ok(r.stageIdx === 3 && r.verified === true && r.source === 'memory', 'memory tier still verified and still beats the link');
  r = pickCardStage(26, 'single', { link: 9 });
  ok(r.stageIdx === 5 && r.verified === false && r.source === 'fallback', 'out-of-range ?st=9 ignored: cid%7 fallback (26 % 7 = 5), unverified');

  // behavioral: a deep-linked card through the real adapter mapping
  globalThis.__KIT = {
    sdk: async () => ({ encodeAddress: (b) => ('PK' + (b instanceof Uint8Array ? b[31] : 0) + 'Q'.repeat(58)).slice(0, 58), decodeAddress: () => ({ publicKey: new Uint8Array(32) }) }),
    algodClient: async () => ({}),
    fetchArenaCreateStages: async () => ({}), // no notes on-chain
    rememberedCard: () => null, // no card memory
    rememberedCards: () => [],
    fetchArenaCloseEvents: async () => [],
  };
  const meta = {
    creator: new Uint8Array(32), stake: 1_000_000n, seatsTotal: 1n, seatsTaken: 1n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), stageMode: 1n,
    seed: new Uint8Array(32), creatorScore: 5000n, status: 0n,
    winner: new Uint8Array(0), paidTotal: 2_000_000n, mbrPaid: 0n,
  };
  const players = [
    { addr: (() => { const b = new Uint8Array(32); b[31] = 9; return b; })(), score: 5000n, signed: true, seatedAt: 0n },
  ];
  const ta = new TestnetArenaAdapter();
  setLinkStageHint(26, 5); // the crafted link
  const card = await ta.toChallenge(26, meta, players);
  ok(card.stageIdx === 5 && card.stageVerified === false, 'deep-link spoof: card shows the hinted stage 5 but renders UNVERIFIED');
  setLinkStageHint(-1, 0); // reset: no cid matches -1
  const card2 = await ta.toChallenge(26, meta, players);
  ok(card2.stageIdx === 26 % 7 && card2.stageVerified === false, 'no hint: cid%7 fallback, still UNVERIFIED');
}

// ================= bundle K: the REAL testnetKit (algosdk external) =========
const ENTRY_K = join(ROOT, '.tmp-v1528b-entry-k.ts');
const BUNDLE_K = join(ROOT, '.tmp-v1528b-bundle-k.mjs');
writeFileSync(
  ENTRY_K,
  "export { fetchArenaCreateStages, readStageCache } from './src/game/arena/testnetKit';\n",
);
await esbuild.build({
  entryPoints: [ENTRY_K], bundle: true, format: 'esm', platform: 'node', external: ['algosdk'],
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  outfile: BUNDLE_K, logLevel: 'silent',
});
const modK = await import(BUNDLE_K);
const { fetchArenaCreateStages, readStageCache } = modK;

const sdk = await import('algosdk');
const selOf = (sig) => {
  const parts = sig.split(')');
  const argTypes = parts[0].slice(parts[0].indexOf('(') + 1).split(',').filter(Boolean);
  return new sdk.ABIMethod({ name: sig.slice(0, sig.indexOf('(')), args: argTypes.map((t, i) => ({ type: t, name: 'a' + i })), returns: { type: parts[1] || 'void' } }).getSelector();
};
const selCreate = Buffer.from(selOf('create_challenge(pay,axfer,uint64,uint64,uint64,uint64,byte[],uint64,byte[])uint64')).toString('base64');
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const tx = (round, off, firstArg, note) => ({
  id: 'T' + round + '_' + off,
  'confirmed-round': round,
  'intra-round-offset': off,
  note: note === null ? undefined : b64(note),
  'application-transaction': { 'application-args': [firstArg] },
});

// ================= [3] COUNT MISMATCH: bank nothing =========================
console.log('\n[3] count-mismatch scan: nothing banked, watermark untouched');
{
  let pages = [];
  globalThis.fetch = async () => ({ ok: true, json: async () => (pages.shift() ?? { transactions: [] }) });

  // the indexer page is TRUNCATED (lag): 2 create-ish hits visible, but the
  // chain counter says 4 — the sequential mapping would be a lie
  store.clear();
  pages = [{ transactions: [tx(100, 0, selCreate, 'gonna:v2:stage:3'), tx(101, 0, selCreate, 'gonna:v2:stage:5')] }];
  const s1 = await fetchArenaCreateStages({ force: true, total: 4 });
  ok(s1['0'] === undefined && s1['1'] === undefined, 'mismatch: NO partial entries returned (cids fall back to UNVERIFIED tiers)');
  const c1 = readStageCache();
  ok(c1.fromCid === 0 && Object.keys(c1.stages).length === 0, 'mismatch: localStorage untouched — no entries banked, watermark 0');

  // pre-existing banked mapping: a mismatched incremental scan must neither
  // append NOR move the watermark (monotonic: never backward, never forward)
  store.clear();
  store.set('gonna.arena.stages', JSON.stringify({ fromCid: 2, stages: { '0': 3, '1': 5 } }));
  pages = [{
    transactions: [
      tx(100, 0, selCreate, 'gonna:v2:stage:3'),
      tx(101, 0, selCreate, 'gonna:v2:stage:5'),
      tx(102, 0, selCreate, 'gonna:v2:stage:1'), // only ONE new hit visible...
    ],
  }];
  const s2 = await fetchArenaCreateStages({ force: true, total: 4 }); // ...but the chain says 4 creates total
  const c2 = readStageCache();
  ok(s2['0'] === 3 && s2['1'] === 5 && s2['2'] === undefined, 'mismatch: old verified entries still served, the shifted new one withheld');
  ok(c2.fromCid === 2 && c2.stages['2'] === undefined && c2.stages['0'] === 3, 'mismatch: watermark pinned at 2 (never backward, never forward), nothing banked');
}

// ================= [4] COUNT MATCH: banks normally ==========================
console.log('\n[4] count-match scan: banks normally');
{
  let pages = [];
  globalThis.fetch = async () => ({ ok: true, json: async () => (pages.shift() ?? { transactions: [] }) });
  store.clear();
  store.set('gonna.arena.stages', JSON.stringify({ fromCid: 2, stages: { '0': 3, '1': 5 } }));
  pages = [{
    transactions: [
      tx(100, 0, selCreate, 'gonna:v2:stage:3'),
      tx(101, 0, selCreate, 'gonna:v2:stage:5'),
      tx(102, 0, selCreate, 'gonna:v2:stage:1'),
      tx(103, 0, selCreate, 'gonna:v2:stage:6'),
    ],
  }];
  const s = await fetchArenaCreateStages({ force: true, total: 4 }); // 2 + 2 hits == 4 == counter
  const c = readStageCache();
  ok(s['2'] === 1 && s['3'] === 6, 'match: new entries mapped sequentially from the watermark (cid2->1, cid3->6)');
  ok(c.fromCid === 4 && c.stages['2'] === 1 && c.stages['3'] === 6 && c.stages['0'] === 3, 'match: banked to localStorage, watermark advanced to 4');
  globalThis.fetch = undefined;
}

console.log(`\n================ ${passed}/${total} passed ================`);
if (fails.length) {
  console.log('FAILURES:\n - ' + fails.join('\n - '));
  process.exit(1);
}
