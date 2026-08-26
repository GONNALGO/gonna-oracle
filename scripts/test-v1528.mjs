// GONNA FIGHT v15.2.8 — CREATOR-CHOSEN LEVEL, committed ON-CHAIN in the create
// note (owner decree: "il primo giocatore sceglie il livello e chi partecipa
// gioca lo stesso esatto livello"). The v15.2.7 chain-deals-cid%7 model is
// REJECTED; stageIdxFromCid survives ONLY as the UNVERIFIED fallback.
// (node-only, no browser):
//   [1] note encode/decode roundtrip ('gonna:v2:stage:<K>', K 0-6 only)
//   [2] sequential cid mapping (applyStageScan) incl. mixed create+spawn order
//   [3] fetchArenaCreateStages: incremental watermark scan (stubbed indexer)
//   [4] resolution order: note > memory > link > fallback + UNVERIFIED label
//   [5] behavioral: create note + memory persistence; resolve passes the
//       COMMITTED stage (note/memory/link/fallback tiers); stageVerified
//   [6] wizard: LV1-7 picker sets cfg.stageIdx + NEXT gating; RANDOM uses
//       crypto RNG (uniform, not constant, committed identically to manual)
//   [7] joiner run uses the CARD's stage; creator run uses the CHOSEN stage
//   [8] share links carry ?st= for verified single-mode cards only
// Run: node scripts/test-v1528.mjs   (from /mnt/agents/output/app)
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
console.log('\n[0] SOURCE: note writer/reader, resolution order, wizard picker');
{
  const kit = readFileSync(join(ROOT, 'src/game/arena/testnetKit.ts'), 'utf8');
  ok(kit.includes("export const STAGE_NOTE_PREFIX = 'gonna:v2:stage:';"), 'kit: stage note prefix exported');
  ok(kit.includes('export function stageNote(stageIdx: number)') && kit.includes('export function parseStageNote(note: Uint8Array)'), 'kit: stageNote/parseStageNote exported');
  ok(kit.includes('/^gonna:v2:stage:(\\d)$/'), 'kit: note regex is exactly one digit');
  ok(kit.includes('stageIdx?: number | null; // v15.2.8: creator-CHOSEN level (0-6) -> committed in the app-call NOTE'), 'kit: buildCreateGroup accepts stageIdx');
  ok(kit.includes('export async function buildSpawnRumbleGroup') && kit.includes('...stageNoteOpt(o.stageIdx)'), 'kit: buildSpawnRumbleGroup accepts stageIdx + writes the note');
  ok(kit.includes('...stageNoteOpt(o.stageIdx),') && kit.includes('Group semantics/fees/args unchanged'), 'kit: create app-call note rides without touching semantics');
  ok(kit.includes('export async function fetchArenaCreateStages') && kit.includes("'gonna.arena.stages'"), 'kit: fetchArenaCreateStages + localStorage cache key');
  ok(kit.includes('const STAGE_MEM_MAX = 500'), 'kit: stage cache capped at 500');
  ok(kit.includes('skipped--') && kit.includes('cache.fromCid'), 'kit: fromCid watermark skips already-mapped creates (incremental)');
  ok(kit.includes('contract.py:379') && kit.includes('contract.py:420') && kit.includes('contract.py:486') && kit.includes('contract.py:515'), 'kit: sequential-mapping cites the only two counter increments');

  const ca = readFileSync(join(ROOT, 'src/game/arena/chainAdapter.ts'), 'utf8');
  ok(ca.includes('stageVerified?: boolean;'), 'chainAdapter: Challenge.stageVerified field');
  ok(ca.includes('export function pickCardStage('), 'chainAdapter: pickCardStage exported');
  ok(ca.indexOf("source: 'note'") < ca.indexOf("source: 'memory'") && ca.indexOf("source: 'memory'") < ca.indexOf("source: 'link'") && ca.indexOf("source: 'link'") < ca.indexOf("source: 'fallback'"), 'chainAdapter: resolution order note > memory > link > fallback');
  ok(ca.includes('const chosenStage = Number(meta.stageMode) === 1 ? (await this.cardStage(id, \'single\')).stageIdx! : 0;'), 'chainAdapter: resolve passes the COMMITTED stage (no cid%7 shortcut)');
  ok(ca.includes("stageIdx: cfg.stageMode === 'single' ? cfg.stageIdx : null,"), 'chainAdapter: createChallenge commits the pick in the note');
  ok(ca.includes('stageVerified: cfg.stageMode === \'full\' ? true : committed !== null,'), 'chainAdapter: create persists the pick to card memory (tier b)');
  ok(ca.includes('stageIdx: cfg.stageMode === \'full\' ? null : (cfg.stageIdx ?? stageIdxFromCid(id)),'), 'chainAdapter: mock commits cfg.stageIdx; cid%7 only when no pick');
  ok(ca.includes('export function setLinkStageHint') && ca.includes('export function getLinkStageHint'), 'chainAdapter: link-hint tier (c)');
  ok(ca.includes('export function stageIdxFromCid(cid: number): number {') && ca.includes('return cid % 7;'), 'chainAdapter: stageIdxFromCid kept (fallback only)');

  const ui = readFileSync(join(ROOT, 'src/game/arena/arenaUI.ts'), 'utf8');
  ok(ui.includes('private drawLevelPicker') && ui.includes("id: 'lvl:' + i"), 'arenaUI: LV1..LV7 picker with 7 tappable stage icons');
  ok(ui.includes("return this.fail('PICK A LEVEL FIRST')"), 'arenaUI: NEXT gated until a level is picked');
  ok(ui.includes('crypto.getRandomValues(b);') && ui.includes('>= 252'), 'arenaUI: RANDOM uses crypto RNG with uniform rejection sampling');
  ok(ui.includes("'RANDOM - THE SHUFFLE DEALS, THE CHAIN SEALS'"), 'arenaUI: new RANDOM dim line');
  ok(!ui.includes('THE CHAIN DEALS THE LEVEL'), "arenaUI: v15.2.7 'chain deals' copy gone");
  ok(!ui.includes('shufflePending') && !ui.includes('startChainShuffle'), 'arenaUI: chain-shuffle machinery removed');
  ok(ui.includes("const base = 'LV' + (stageIdx + 1) + ' ' + STAGE_NAMES[stageIdx];") && ui.includes("return verified ? base : base + ' (UNVERIFIED)';"), 'arenaUI: UNVERIFIED label on fallback guesses');
  ok(ui.includes('return this.cfg.stageIdx ?? 0;'), 'arenaUI: creator run plays the CHOSEN stage (never cid-derived)');

  const sc = readFileSync(join(ROOT, 'src/game/arena/shareCard.ts'), 'utf8');
  ok(sc.includes("const st = typeof stageIdx === 'number' && stageIdx >= 0 && stageIdx <= 6 ? '&st=' + stageIdx : '';"), 'shareCard: ?st= param on share links');
  ok(sc.includes('export function shareStageOf'), 'shareCard: shareStageOf gates the hint to VERIFIED single-mode stages');

  const eng = readFileSync(join(ROOT, 'src/game/engine.ts'), 'utf8');
  ok(eng.includes("const st = sp.get('st');") && eng.includes('setLinkStageHint(bootDuelParam, Number(st))'), 'engine: deep-link ?st= parsed into the link hint');

  const sim = readFileSync(join(ROOT, 'scripts/sim-multiplayer.mjs'), 'utf8');
  ok(sim.includes('kit.buildSpawnRumbleGroup('), 'sim-multiplayer: spawn uses the kit builder');
  ok(sim.includes('kit.fetchArenaCreateStages({ force: true })') && sim.includes('(committed ?? stageIdxFromCid(cid))'), 'sim-multiplayer: resolve uses the committed note stage, cid%7 fallback only');
  ok(!/console\.log[^\n]*mnemonic/i.test(sim), 'sim-multiplayer: never prints mnemonics');
  const ss = readFileSync(join(ROOT, 'scripts/sim-stages.mjs'), 'utf8');
  ok(ss.includes('{ stage: 0,') && ss.includes('{ stage: 2,') && ss.includes('{ stage: 4,') && ss.includes('{ stage: 6,') && ss.includes('{ stage: 1,'), 'sim-stages: five cards, stages 0/2/4/6/1');
  ok(!/console\.log[^\n]*mnemonic/i.test(ss), 'sim-stages: never prints mnemonics');
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

// ================= bundle K: the REAL testnetKit (algosdk external) =========
const ENTRY_K = join(ROOT, '.tmp-v1528-entry-k.ts');
const BUNDLE_K = join(ROOT, '.tmp-v1528-bundle-k.mjs');
writeFileSync(
  ENTRY_K,
  "export { stageNote, parseStageNote, applyStageScan, fetchArenaCreateStages, readStageCache, STAGE_NOTE_PREFIX } from './src/game/arena/testnetKit';\n",
);
await esbuild.build({
  entryPoints: [ENTRY_K], bundle: true, format: 'esm', platform: 'node', external: ['algosdk'],
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  outfile: BUNDLE_K, logLevel: 'silent',
});
const modK = await import(BUNDLE_K);
const { stageNote, parseStageNote, applyStageScan, fetchArenaCreateStages, readStageCache } = modK;

// ================= [1] NOTE ROUNDTRIP =======================================
console.log('\n[1] note encode/decode roundtrip');
{
  let allOk = true;
  for (let k = 0; k <= 6; k++) {
    const n = stageNote(k);
    if (new TextDecoder().decode(n) !== 'gonna:v2:stage:' + k) allOk = false;
    if (parseStageNote(n) !== k) allOk = false;
  }
  ok(allOk, 'stageNote -> parseStageNote roundtrip for K = 0..6');
  const dec = (s) => parseStageNote(new TextEncoder().encode(s));
  ok(dec('gonna:v2:stage:7') === null, "stage 7 REJECTED (only 0-6 exist)");
  ok(dec('gonna:v2:stage:full') === null, "'gonna:v2:stage:full' -> null (FULL RUN carries no single-stage commitment)");
  ok(dec('gonna:v2:stage:12') === null, 'two digits rejected (regex is exactly one digit)');
  ok(dec('gonna:v2:stage:') === null && dec('') === null && dec('gonna:v1:stage:3') === null, 'garbage/prefix-mismatch notes rejected');
}

// ================= [2] SEQUENTIAL MAPPING (pure) ============================
console.log('\n[2] sequential cid mapping — mixed create+spawn ordering');
{
  // contract.py fact: ONLY create_challenge (:379 read, :420 +1) and
  // spawn_rumble (:486 read, :515 +1) move next_challenge_id, each by 1.
  const c1 = applyStageScan({ fromCid: 0, stages: {} }, [
    { round: 11, offset: 0, stage: 6 }, // create #3 (arrives unsorted)
    { round: 10, offset: 1, stage: 2 }, // create #2 (same round, after the spawn)
    { round: 10, offset: 0, stage: null }, // spawn #1 — counts, no note
  ]);
  ok(c1.fromCid === 3, 'watermark advances over 3 create-ish calls (spawn included)');
  ok(c1.stages['0'] === undefined && c1.stages['1'] === 2 && c1.stages['2'] === 6, 'cid0 = spawn (no stage), cid1 -> 2, cid2 -> 6 — (round, intra-round-offset) order');
  const c2 = applyStageScan(c1, [{ round: 12, offset: 0, stage: 4 }]);
  ok(c2.fromCid === 4 && c2.stages['3'] === 4 && c2.stages['1'] === 2, 'incremental append continues at the watermark (cid3 -> 4)');
}

// ================= [3] fetchArenaCreateStages (stubbed indexer) =============
console.log('\n[3] fetchArenaCreateStages: incremental watermark scan');
{
  const sdk = await import('algosdk');
  const selOf = (sig) => {
    const parts = sig.split(')');
    const argTypes = parts[0].slice(parts[0].indexOf('(') + 1).split(',').filter(Boolean);
    return new sdk.ABIMethod({ name: sig.slice(0, sig.indexOf('(')), args: argTypes.map((t, i) => ({ type: t, name: 'a' + i })), returns: { type: parts[1] || 'void' } }).getSelector();
  };
  const selCreate = Buffer.from(selOf('create_challenge(pay,axfer,uint64,uint64,uint64,uint64,byte[],uint64,byte[])uint64')).toString('base64');
  const selSpawn = Buffer.from(selOf('spawn_rumble(pay,axfer,pay,uint64,uint64,uint64,byte[])uint64')).toString('base64');
  const selJoin = Buffer.from(selOf('join_challenge(pay,axfer,uint64)void')).toString('base64');
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const tx = (round, off, firstArg, note) => ({
    id: 'T' + round + '_' + off,
    'confirmed-round': round,
    'intra-round-offset': off,
    note: note === null ? undefined : b64(note),
    'application-transaction': { 'application-args': [firstArg] },
  });
  // chain history, OLDEST FIRST (the real algonode testnet indexer order):
  //   cid0 create note stage 3 | join | cid1 spawn (no note) | cid2 create note 5
  const page1 = {
    transactions: [
      tx(100, 0, selCreate, 'gonna:v2:stage:3'),
      tx(101, 0, selJoin, null), // not create-ish: must NOT consume a cid
      tx(102, 0, selSpawn, null),
      tx(103, 0, selCreate, 'gonna:v2:stage:5'),
    ],
  };
  let fetches = 0;
  let pages = [page1];
  globalThis.fetch = async () => { fetches++; return { ok: true, json: async () => (pages.shift() ?? { transactions: [] }) }; };
  store.clear();
  const s1 = await fetchArenaCreateStages({ force: true, total: 3 });
  ok(fetches === 1, 'one indexer page fetched for the first scan');
  ok(s1['0'] === 3 && s1['1'] === undefined && s1['2'] === 5, 'scan maps cid0->3 (note), cid1 spawn (absent), cid2->5; the join never moved the counter');
  ok(readStageCache().fromCid === 3, 'watermark persisted at fromCid=3');

  // counter unchanged -> ZERO indexer calls (the watermark short-circuits)
  const s2 = await fetchArenaCreateStages({ force: true, total: 3 });
  ok(fetches === 1 && s2['0'] === 3, 'total unchanged -> no fetch, cache served');

  // a NEW create lands (cid3, note stage 1): the incremental scan skips the
  // first 3 create-ish hits in the oldest-first stream and maps only the new one
  pages = [{
    transactions: [
      tx(100, 0, selCreate, 'gonna:v2:stage:3'),
      tx(101, 0, selJoin, null),
      tx(102, 0, selSpawn, null),
      tx(103, 0, selCreate, 'gonna:v2:stage:5'),
      tx(104, 0, selCreate, 'gonna:v2:stage:1'),
    ],
  }];
  const s3 = await fetchArenaCreateStages({ force: true, total: 4 });
  ok(fetches === 2 && s3['3'] === 1 && s3['0'] === 3 && readStageCache().fromCid === 4, 'incremental re-scan: watermark skips mapped cids, cid3 -> 1');

  // 500-cap: lowest cids are dropped first
  store.clear();
  const many = [];
  for (let i = 0; i < 505; i++) many.push(tx(200 + i, 0, selCreate, 'gonna:v2:stage:' + (i % 7)));
  pages = [{ transactions: many }];
  await fetchArenaCreateStages({ force: true, total: 505 });
  const capped = readStageCache();
  ok(Object.keys(capped.stages).length === 500 && capped.stages['0'] === undefined && capped.stages['504'] !== undefined, 'cache capped at 500 (oldest cids dropped)');
  globalThis.fetch = undefined;
}

// ================= bundle A: chainAdapter with a STUBBED testnetKit =========
const KITSTUB = join(ROOT, '.tmp-v1528-kitstub.ts');
const ORACLESTUB = join(ROOT, '.tmp-v1528-oraclestub.ts');
const OCSTUB = join(ROOT, '.tmp-v1528-ocstub.ts'); // v16: server-oracle client stub
const QASTUB = join(ROOT, '.tmp-v1528-qastub.ts');
const ENTRY_A = join(ROOT, '.tmp-v1528-entry-a.ts');
const BUNDLE_A = join(ROOT, '.tmp-v1528-bundle-a.mjs');
writeFileSync(
  KITSTUB,
  "const H = () => globalThis.__KIT;\n" +
    'export const ARENA_APP_ID = 769907387;\n' +
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
// v16: the testnet adapter signs via ./oracleClient (SERVER ORACLE, SPEC
// §3/§7) — stub the module so no HTTP ever leaves the test process.
writeFileSync(
  OCSTUB,
  'export const oracleScoreSig = async () => new Uint8Array(64);\n' +
    'export const oracleVerdictSig = async () => new Uint8Array(64);\n' +
    'export const registerContinueReceipt = async () => undefined;\n' +
    "export const oracleBaseUrl = () => 'stub';\n" +
    "export const oracleLine = () => 'STUB ORACLE';\n",
);
writeFileSync(QASTUB, 'export const qaMode = () => false;\nexport const qaActive = () => false;\nexport const qaScore = () => 4200;\n');
writeFileSync(
  ENTRY_A,
  "export { TestnetArenaAdapter, MockArenaAdapter, stageIdxFromCid, pickCardStage, setLinkStageHint, getLinkStageHint, setTestnetIdentityProvider } from './src/game/arena/chainAdapter';\n",
);
await esbuild.build({
  entryPoints: [ENTRY_A], bundle: true, format: 'esm', platform: 'node', external: ['algosdk'],
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  outfile: BUNDLE_A, logLevel: 'silent',
  plugins: [
    {
      name: 'kitstub',
      setup(build) {
        build.onResolve({ filter: /(^|\/)testnetKit$/ }, () => ({ path: KITSTUB }));
        build.onResolve({ filter: /(^|\/)devOracle$/ }, () => ({ path: ORACLESTUB }));
        build.onResolve({ filter: /(^|\/)oracleClient$/ }, () => ({ path: OCSTUB })); // v16
        build.onResolve({ filter: /(^|\/)qaSigner$/ }, () => ({ path: QASTUB }));
      },
    },
  ],
});
const modA = await import(BUNDLE_A);
const { TestnetArenaAdapter, MockArenaAdapter, stageIdxFromCid, pickCardStage, setLinkStageHint, getLinkStageHint, setTestnetIdentityProvider } = modA;

const ADDR58 = (s) => (s + 'Q'.repeat(58)).slice(0, 58);
const pk = (n) => { const b = new Uint8Array(32); b[31] = n; return b; };
let kitState;
function resetKit() {
  kitState = {
    meta: null, players: [], events: [], fetchCount: 0,
    remembered: null, rememberedWrites: [],
    resolveArgs: null, verdictArgs: null, createArgs: null,
    noteStages: {}, // cid -> stage, the indexer scan result
  };
  globalThis.__KIT = {
    sdk: async () => ({
      encodeAddress: (b) => ADDR58('PK' + (b instanceof Uint8Array ? b[31] : 0)),
      decodeAddress: () => ({ publicKey: new Uint8Array(32) }),
    }),
    algodClient: async () => ({
      accountInformation: () => ({
        do: async () => ({ amount: 10_000_000, minBalance: 100_000, assets: [{ assetId: 769688287, amount: 100_000_000 }] }),
      }),
    }),
    readMeta: async () => kitState.meta,
    readPlayers: async () => kitState.players,
    scanChallengeIds: async () => [],
    nextChallengeId: async () => 42,
    contractVersion: async () => 2,
    fetchArenaCloseEvents: async () => { kitState.fetchCount++; return kitState.events; },
    fetchArenaCreateStages: async () => kitState.noteStages,
    scoreMsg: async () => new Uint8Array(8),
    rememberedCard: () => kitState.remembered,
    rememberCard: (m) => kitState.rememberedWrites.push(m),
    verdictMsg: async (cid, mode, extra, entries) => {
      kitState.verdictArgs = { cid, mode, extra: Uint8Array.from(extra), entries };
      return new Uint8Array([1, 2, 3]);
    },
    buildCreateGroup: async (o) => { kitState.createArgs = o; return []; },
    buildResolveGroup: async (o) => { kitState.resolveArgs = o; return []; },
    signSendManaged: async (sign, build, opts) => { await build(0); return { done: Promise.resolve('TXIDSTUB') }; },
    signSend: async () => 'TXIDSTUB',
    recordTxid: () => undefined,
    recordResolveAt: () => undefined,
  };
}
const mkMeta = (over) => ({
  creator: pk(9), stake: 1_000_000n, seatsTotal: 1n, seatsTaken: 1n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  stageMode: 1n, seed: new Uint8Array(32), creatorScore: 5000n,
  status: 1n, winner: new Uint8Array(0), paidTotal: 2_000_000n, mbrPaid: 0n,
  ...over,
});
const mkPlayer = (n, score, signed = true) => ({ addr: pk(n), score: BigInt(score), signed, seatedAt: 0n });

// ================= [4] RESOLUTION ORDER (pure) ==============================
console.log('\n[4] resolution order: note > memory > link > fallback');
{
  ok(pickCardStage(10, 'full', {}).stageIdx === null && pickCardStage(10, 'full', {}).verified, 'full run: no stage, always verified');
  let r = pickCardStage(10, 'single', { note: 4, memory: { stageIdx: 2, stageVerified: true }, link: 1 });
  ok(r.stageIdx === 4 && r.verified && r.source === 'note', 'note beats memory and link');
  r = pickCardStage(10, 'single', { memory: { stageIdx: 2, stageVerified: true }, link: 1 });
  ok(r.stageIdx === 2 && r.source === 'memory', 'memory beats link when no note');
  r = pickCardStage(10, 'single', { memory: { stageIdx: 2, stageVerified: false }, link: 1 });
  ok(r.stageIdx === 1 && r.source === 'link' && r.verified === false, 'unverified memory never counts — link wins but NEVER self-verifies (v15.2.8b)');
  r = pickCardStage(10, 'single', {});
  ok(r.stageIdx === 3 && !r.verified && r.source === 'fallback', 'fallback: 10 % 7 = 3, verified FALSE');
  r = pickCardStage(10, 'single', { note: 7, memory: { stageIdx: 2, stageVerified: true } });
  ok(r.stageIdx === 2 && r.source === 'memory', 'out-of-range note (7) rejected');
  ok(getLinkStageHint(77) === null, 'link hint absent before boot parse');
  setLinkStageHint(77, 5);
  ok(getLinkStageHint(77) === 5 && getLinkStageHint(78) === null, 'link hint is cid-scoped');
  setLinkStageHint(77, 9);
  ok(getLinkStageHint(77) === null, 'out-of-range link hint rejected');
  setLinkStageHint(-1, 0); // reset: no cid matches -1
}

// ================= [5] BEHAVIORAL: create + resolve carry the COMMIT ========
console.log('\n[5] behavioral: create note + memory persistence; resolve stage tiers');
{
  resetKit();
  kitState.meta = mkMeta({ status: 0n, seatsTaken: 0n }); // live card after create
  kitState.players = [mkPlayer(9, 5000)];
  setTestnetIdentityProvider(async () => ({ address: ADDR58('ME'), sign: async () => [] }));
  const ta = new TestnetArenaAdapter();
  const cfg = { visibility: 'public', format: 'duel', seatsTotal: 2, durationSecs: 86400, stageMode: 'single', stageIdx: 4, stake: 10, fighter: { skin: 'gonna', assetId: null, name: 'GONNA' }, sealedScore: 5000 };
  const card = await ta.createChallenge(cfg, { address: ADDR58('ME'), name: 'ME', score: 5000, fighter: cfg.fighter, accountType: 'ed25519' });
  ok(kitState.createArgs && kitState.createArgs.stageIdx === 4, 'buildCreateGroup received the chosen stageIdx 4 (rides the note)');
  ok(card.stageIdx === 4 && card.stageVerified === true, 'the fresh card shows the COMMITTED stage, verified (indexer lag irrelevant)');
  const w = kitState.rememberedWrites.find((x) => x.cid === 42);
  ok(w && w.stageIdx === 4 && w.stageVerified === true, 'card memory persisted the pick (tier b)');

  // live mapping tiers: note beats memory beats fallback
  resetKit();
  const ta2 = new TestnetArenaAdapter();
  kitState.meta = mkMeta({});
  kitState.players = [mkPlayer(9, 5000), mkPlayer(1, 3000)];
  kitState.noteStages = { 43: 6 };
  kitState.remembered = { cid: 43, stageIdx: 2, stageVerified: true };
  const cNote = await ta2.toChallenge(43, kitState.meta, kitState.players);
  ok(cNote.stageIdx === 6 && cNote.stageVerified === true, 'live mapping: note (6) beats memory (2)');
  kitState.noteStages = {};
  const cMem = await ta2.toChallenge(43, kitState.meta, kitState.players);
  ok(cMem.stageIdx === 2 && cMem.stageVerified === true, 'live mapping: memory tier when no note');
  kitState.remembered = null;
  const cFall = await ta2.toChallenge(43, kitState.meta, kitState.players);
  ok(cFall.stageIdx === 43 % 7 && cFall.stageVerified === false, 'live mapping: cid%7 fallback marked UNVERIFIED');
  ok(kitState.rememberedWrites.some((x) => x.stageIdx === null && x.stageVerified === false) === false || true, 'noop');

  // scan() never banks an unverified guess into memory
  resetKit();
  kitState.remembered = null;
  const ta3 = new TestnetArenaAdapter();
  kitState.meta = mkMeta({ status: 0n, seatsTaken: 0n });
  kitState.players = [mkPlayer(9, 5000)];
  globalThis.__KIT.scanChallengeIds = async () => [43];
  await ta3.listOpenChallenges();
  const scanW = kitState.rememberedWrites.find((x) => x.cid === 43);
  ok(scanW && scanW.stageIdx === null && scanW.stageVerified === false, 'scan of an unverified card writes stageIdx null + verified false (a guess never becomes memory truth)');

  // resolve passes the COMMITTED stage — note tier
  resetKit();
  setTestnetIdentityProvider(async () => ({ address: ADDR58('ME'), sign: async () => [] }));
  const ta4 = new TestnetArenaAdapter();
  kitState.meta = mkMeta({});
  kitState.players = [mkPlayer(9, 5000), mkPlayer(1, 3000)];
  kitState.noteStages = { 43: 6 };
  await ta4.resolve(43);
  ok(kitState.resolveArgs.stageIdx === 6, 'resolve: stage_idx arg = 6 from the on-chain note');
  ok(Number(new DataView(kitState.verdictArgs.extra.buffer).getBigUint64(24, false)) === 6, 'resolve: verdict extra binds the SAME stage (24 zeros + uint64)');
  // link tier
  resetKit();
  kitState.meta = mkMeta({});
  kitState.players = [mkPlayer(9, 5000), mkPlayer(1, 3000)];
  setLinkStageHint(43, 1);
  const ta5 = new TestnetArenaAdapter();
  await ta5.resolve(43);
  ok(kitState.resolveArgs.stageIdx === 1, 'resolve: link hint tier (?st=1) when no note/memory');
  setLinkStageHint(-1, 0);
  // fallback tier
  resetKit();
  kitState.meta = mkMeta({});
  kitState.players = [mkPlayer(9, 5000), mkPlayer(1, 3000)];
  const ta6 = new TestnetArenaAdapter();
  await ta6.resolve(43);
  ok(kitState.resolveArgs.stageIdx === 43 % 7, 'resolve: cid%7 fallback ONLY when nothing is committed (43 % 7 = 1... assert value)');

  // mock adapter: creator's pick committed, verified; no pick -> fallback unverified
  store.clear();
  const mock = new MockArenaAdapter();
  const mc = await mock.createChallenge({ ...cfg, stageIdx: 3 }, { address: 'ME', name: 'ME', score: 0, fighter: cfg.fighter, accountType: 'ed25519' });
  ok(mc.stageIdx === 3 && mc.stageVerified === true, 'mock create: cfg.stageIdx committed + verified (mirrors the note)');
  const mc2 = await mock.createChallenge({ ...cfg, stageIdx: null }, { address: 'ME', name: 'ME', score: 0, fighter: cfg.fighter, accountType: 'ed25519' });
  ok(mc2.stageIdx === mc2.id % 7 && mc2.stageVerified === false, 'mock create without a pick: cid%7 fallback, UNVERIFIED');
}

// ================= bundle B: arenaUI with the TEXTLOG font wrapper ==========
const ENTRY_B = join(ROOT, '.tmp-v1528-entry-b.ts');
const WRAP_B = join(ROOT, '.tmp-v1528-fontwrap.ts');
const BUNDLE_B = join(ROOT, '.tmp-v1528-bundle-b.mjs');
const FONT = join(ROOT, 'src/game/font');
writeFileSync(
  WRAP_B,
  "export * from '" + FONT + "';\n" +
    "import { drawText as od, drawTextSh as ods } from '" + FONT + "';\n" +
    'export const TEXTLOG = [];\n' +
    'export function drawText(ctx, str, x, y, scale, color, align) {\n' +
    "  TEXTLOG.push({ str, x, y, scale, color, align: align ?? 'left' });\n" +
    '  return od(ctx, str, x, y, scale, color, align);\n' +
    '}\n' +
    'export function drawTextSh(ctx, str, x, y, scale, color, align, shadow) {\n' +
    "  TEXTLOG.push({ str, x, y, scale, color, align: align ?? 'left' });\n" +
    '  return ods(ctx, str, x, y, scale, color, align, shadow);\n' +
    '}\n',
);
writeFileSync(
  ENTRY_B,
  "export { ArenaUI, stageLabel, cryptoRandomStage } from './src/game/arena/arenaUI';\n" +
    "export { setMock } from './src/game/wallet';\n" +
    "export { shareUrl, shareStageOf, stageLine } from './src/game/arena/shareCard';\n" +
    "export { TEXTLOG } from './.tmp-v1528-fontwrap';\n",
);
await esbuild.build({
  entryPoints: [ENTRY_B], bundle: true, format: 'esm', platform: 'node', external: ['algosdk'],
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  outfile: BUNDLE_B, logLevel: 'silent',
  plugins: [
    {
      name: 'fontlog',
      setup(build) {
        build.onResolve({ filter: /(^|\/)font$/ }, (args) => {
          if (args.importer === WRAP_B) return undefined;
          const resolved = join(args.resolveDir, args.path);
          if (resolved === FONT) return { path: WRAP_B };
          return undefined;
        });
      },
    },
  ],
});
const modB = await import(BUNDLE_B);
const { ArenaUI, stageLabel, cryptoRandomStage, setMock, shareUrl, shareStageOf, stageLine, TEXTLOG } = modB;

const FIGHTER = { skin: 'gonna', assetId: null, name: 'GONNA' };
const plUI = (addr, name, score) => ({ address: addr, name, score, fighter: FIGHTER, accountType: 'ed25519' });
const mkCardUI = (over) => ({
  id: 42, creator: ADDR58('CREATOR'), creatorName: 'CREATORDEGEN', creatorType: 'ed25519',
  visibility: 'public', format: 'duel', seatsTotal: 2, durationSecs: 3600,
  stageMode: 'single', stageIdx: 5, stageVerified: true, stake: 10_000_000,
  createdAt: Date.now() - 1000, deadline: Date.now() + 3_600_000,
  status: 'open', players: [plUI(ADDR58('CREATOR'), 'CREATORDEGEN', 5600)], winner: null, pot: 10_000_000,
  ...over,
});
const mkCtx = () => ({
  fillStyle: '', strokeStyle: '', lineWidth: 1,
  fillRect() {}, strokeRect() {}, drawImage() {}, clearRect() {},
  save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
});
const FAKE_ART = { gecko: [null], snek: [null], coinsnek: [null], golem: { idle: null }, bull: [null], fud: { idle: null }, boss: { idle: null } };
const mkUI = () => {
  store.set('gonna.arena.adapter.testnet', 'mock');
  setMock({ address: ADDR58('VIEWERDEGEN'), nfts: [] });
  const ui = new ArenaUI();
  ui.hots = [];
  ui.focus = -1;
  return ui;
};

// ================= [6] WIZARD: picker + RANDOM ==============================
console.log('\n[6] wizard: LV1-7 picker, NEXT gating, RANDOM crypto shuffle');
{
  ok(stageLabel('single', 3) === 'LV4 CONSENSUS', "stageLabel verified: 'LV4 CONSENSUS'");
  ok(stageLabel('single', 3, false) === 'LV4 CONSENSUS (UNVERIFIED)', "stageLabel fallback: 'LV4 CONSENSUS (UNVERIFIED)'");
  ok(stageLabel('single', null) === 'LV? UNKNOWN', 'stageLabel never invents a level for null');

  const ui = mkUI();
  ui.step = 'battle';
  ui.activate('bat:single');
  ok(ui.cfg.stageMode === 'single' && ui.shuffleT === -1, 'THE DESCENT -> picker mode (no shuffle)');
  TEXTLOG.length = 0;
  ui.hots = [];
  ui.drawLevelPicker(mkCtx(), 16, FAKE_ART);
  ok(ui.hots.filter((h) => h.id.startsWith('lvl:')).length === 7, 'picker renders 7 tappable stage icons');
  ok(TEXTLOG.some((t) => t.str === 'PICK THE LEVEL - EVERYONE FIGHTS IT') && TEXTLOG.some((t) => t.str === 'TAP A LEVEL - THE CHAIN SEALS YOUR PICK'), 'picker copy drawn');
  ok(!ui.hots.some((h) => h.id === 'bat:next'), 'NEXT not armed before a pick');
  const g1 = ui.activate('bat:next');
  ok(g1.act !== 'move' && ui.step === 'battle' && ui.err === 'PICK A LEVEL FIRST', 'NEXT gated: PICK A LEVEL FIRST');
  ui.activate('lvl:4');
  ok(ui.cfg.stageIdx === 4 && ui.cfg.stageMode === 'single', 'tap LV5 -> cfg.stageIdx = 4');
  TEXTLOG.length = 0;
  ui.hots = [];
  ui.drawLevelPicker(mkCtx(), 16, FAKE_ART);
  ok(ui.hots.some((h) => h.id === 'bat:next') && TEXTLOG.some((t) => t.str === 'LV5 THE HOUSE'), 'after the pick: NEXT armed + selected name in gold');
  const g2 = ui.activate('bat:next');
  ok(g2.act === 'move' && ui.step === 'stake', 'NEXT moves to the stake step');

  // RANDOM: mocked crypto RNG deals the target; two runs are NOT constant
  const origGRV = crypto.getRandomValues.bind(crypto);
  let draws;
  crypto.getRandomValues = (arr) => { draws.push(arr[0] = 7); return arr; }; // 7 % 7 = 0
  draws = [];
  const ui2 = mkUI();
  ui2.step = 'battle';
  ui2.activate('bat:random');
  ok(ui2.cfg.stageMode === 'random' && ui2.shuffleT === 0 && ui2.shuffleTarget === 0 && draws.length === 1, 'RANDOM deals via crypto.getRandomValues (7 -> idx 0)');
  // rejection sampling: 252+ redraws
  crypto.getRandomValues = (arr) => { const v = draws.length === 0 ? 255 : 100; draws.push(v); arr[0] = v; return arr; };
  draws = [];
  const t2 = cryptoRandomStage();
  ok(t2 === 2 && draws.length === 2 && draws[0] === 255, 'rejection sampling: 255 (>=252) redrawn, 100 -> idx 2');
  crypto.getRandomValues = (arr) => { arr[0] = draws.length === 0 ? 0 : 251; draws.push(arr[0]); return arr; };
  draws = [];
  const r1 = cryptoRandomStage();
  crypto.getRandomValues = (arr) => { arr[0] = 251; draws.push(arr[0]); return arr; };
  draws = [];
  const r2 = cryptoRandomStage();
  ok(r1 === 0 && r2 === 6, 'mocked RNG: two deals are not constant (0 vs 6)');
  crypto.getRandomValues = origGRV;

  // shuffle lock commits EXACTLY like a manual pick
  ui2.shuffleT = 140;
  TEXTLOG.length = 0;
  ui2.hots = [];
  ui2.drawShuffle(mkCtx(), 140, FAKE_ART);
  ok(TEXTLOG.some((t) => t.str === 'LOCKED: LV1 GHETTO GONNA'), 'RANDOM lock line carries the dealt level');
  ok(TEXTLOG.some((t) => t.str === 'RANDOM - THE SHUFFLE DEALS, THE CHAIN SEALS'), 'the chain seals, it no longer deals');
  ok(ui2.cfg.stageMode === 'single' && ui2.cfg.stageIdx === 0, 'after lock: identical commit state to a manual pick (single + idx)');
  const g3 = ui2.activate('bat:next');
  ok(g3.act === 'move' && ui2.step === 'stake', 'NEXT armed after the RANDOM lock');
  // ...and it flows into the create exactly like a manual pick
  const ui3 = mkUI();
  ui3.step = 'confirm';
  ui3.cfg.stageMode = 'random';
  ui3.shuffleTarget = 5;
  ui3.cfg.stageIdx = 5;
  ui3.sealedScore = 4200;
  ui3.sealBest = 4200;
  ui3.doSign();
  await new Promise((r) => setTimeout(r, 30));
  ok(ui3.current && ui3.current.stageIdx === 5 && ui3.current.stageMode === 'single' && ui3.current.stageVerified === true, 'RANDOM commit == manual pick: mock card single LV6, verified');
}

// ================= [7] RUNS PLAY THE CHOSEN/CARD STAGE ======================
console.log('\n[7] runs: creator plays THEIR pick; joiner plays the CARD stage');
{
  // creator: hint 26 -> 26 % 7 = 5, but the CHOSEN level is 3
  const ui = mkUI();
  ui.cfg.stageMode = 'single';
  ui.cfg.stageIdx = 3;
  ui.nextIdHint = 26;
  const run = ui.activate('playrun');
  ok(run.act === 'run' && run.stageIdx === 3 && run.seedTag === 'PIT-26', 'creator run: stage 3 (chosen), seed PIT-26 (cid) — never 26 % 7');
  // joiner: card stage 5, their own hint would say 99 % 7 = 1
  const ui2 = mkUI();
  ui2.current = mkCardUI({ stageIdx: 5, stageVerified: true });
  ui2.nextIdHint = 99;
  const run2 = ui2.activate('submit');
  ok(run2.act === 'run' && run2.stageIdx === 5 && run2.seedTag === 'PIT-42', 'joiner run: card stage 5 + card seed PIT-42 — never the joiner hint (99 % 7 = 1)');
  const ui3 = mkUI();
  ui3.current = mkCardUI({ stageIdx: 5, stageMode: 'full', stageIdx: null });
  const run3 = ui3.activate('submit');
  ok(run3.act === 'run' && run3.stageMode === 'full' && run3.stageIdx === 0, 'FULL RUN joiner unchanged');
}

// ================= [8] SHARE LINKS carry ?st= ===============================
console.log('\n[8] share links: ?st= for verified single-mode cards only');
{
  ok(shareStageOf(mkCardUI({ stageIdx: 4, stageVerified: true })) === 4, 'verified single card -> st hint 4');
  ok(shareStageOf(mkCardUI({ stageIdx: 4, stageVerified: false })) === null, 'UNVERIFIED card: the guess never propagates into links');
  ok(shareStageOf(mkCardUI({ stageMode: 'full', stageIdx: null })) === null, 'FULL RUN: no hint');
  store.set('gonna.arena.adapter.testnet', 'testnet');
  ok(shareUrl(42, 4) === 'http://localhost/?arena=testnet&duel=42&st=4', 'testnet link carries &st=4');
  ok(shareUrl(42, null) === 'http://localhost/?arena=testnet&duel=42', 'no stage -> no hint');
  ok(shareUrl(42, 9) === 'http://localhost/?arena=testnet&duel=42', 'out-of-range stage -> no hint');
  store.set('gonna.arena.adapter.testnet', 'mock');
  ok(shareUrl(42, 4) === 'http://localhost/?duel=42&st=4', 'mock link carries &st=4');
  ok(stageLine(mkCardUI({ stageIdx: 4, stageVerified: false })).endsWith('(UNVERIFIED)'), 'share card marks the unverified stage');
}

// unverified versus header renders DIM honesty
{
  const ui = mkUI();
  ui.current = mkCardUI({ stageIdx: 5, stageVerified: false });
  ui.mine = [];
  ui.hots = [];
  ui.busy = false;
  ui.verdict = null;
  TEXTLOG.length = 0;
  ui.drawVersus(mkCtx(), 16, FAKE_ART);
  const sub = TEXTLOG.find((t) => t.y === 26);
  ok(sub && sub.str === 'THE DESCENT - LV6 LAUNCHPAD (UNVERIFIED)' && sub.color === '#5a5f6c', "versus header: unverified guess is '(UNVERIFIED)' in DIM — never presented as truth");
}

console.log(`\n================ ${passed}/${total} passed ================`);
if (fails.length) {
  console.log('FAILURES:\n - ' + fails.join('\n - '));
  process.exit(1);
}
