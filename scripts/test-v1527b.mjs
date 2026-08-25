// GONNA FIGHT v15.2.7b — the cid-race guard (node-only, no browser):
//   (a) createChallenge with nextChallengeId != runCid rejects CID_MOVED
//       BEFORE any oracle sign / wallet prompt / algod post.
//   (b) counter == runCid proceeds normally (guard is invisible).
//   (c) post-sign 400 cid-race: counter still == runCid -> SAFE retry with a
//       fresh cid-bound sig; counter != runCid -> CID_MOVED surfaces, and no
//       attempt ever builds a card under a mismatched cid.
//   (d) UI: CID_MOVED -> amber NOTE toast ('THE PIT MOVED WHILE YOU PLAYED -
//       RE-SEAL YOUR RUN'), sealed draft DISCARDED, back on wizard CONFIRM,
//       counter re-hinted. Never red, stake never left the wallet.
//   SIM  scripts/sim-multiplayer.mjs resolves single-mode cards at the
//        COMMITTED create-note stage (v15.2.8); cid % 7 fallback only when
//        nothing is committed (UNVERIFIED).
// Run: node scripts/test-v1527b.mjs   (from /mnt/agents/output/app)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ================= [0] SOURCE-LEVEL =========================================
console.log('\n[0] SOURCE: the cid-race guard is wired end to end');
{
  const ca = readFileSync(join(ROOT, 'src/game/arena/chainAdapter.ts'), 'utf8');
  ok(ca.includes('runCid?: number;'), 'ChallengeConfig carries runCid (the id the sealed run was played for)');
  ok(ca.includes("export class CidMovedError extends Error") && ca.includes("readonly code = 'CID_MOVED'"), 'CidMovedError: typed, code CID_MOVED');
  ok(ca.includes("export function isCidMovedError(e: unknown): boolean"), 'isCidMovedError guard exported');
  ok(ca.includes("export const CID_MOVED_MSG = 'THE PIT MOVED WHILE YOU PLAYED - RE-SEAL YOUR RUN';"), 'CID_MOVED_MSG constant');
  {
    // toastLines() wraps at 48 on a word boundary — replay its exact logic
    const msg = 'THE PIT MOVED WHILE YOU PLAYED - RE-SEAL YOUR RUN';
    const lines = [];
    let rest = msg;
    while (rest.length > 48 && lines.length < 1) {
      let cut = rest.lastIndexOf(' ', 48);
      if (cut < 24) cut = 48;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    lines.push(rest.slice(0, 48));
    ok(lines.length <= 2 && lines.every((l) => l.length <= 48 && l.length > 0), 'toast wraps to <=2 lines of <=48 chars (' + lines.map((l) => l.length).join('+') + ': "' + lines.join('" / "') + '")');
  }
  ok(
    ca.includes('if (cfg.runCid !== undefined && cid !== cfg.runCid) throw new CidMovedError(cfg.runCid, cid);'),
    'testnet build(): guard fires right after nextChallengeId(), BEFORE the oracle sign + wallet prompt',
  );
  const guardIdx = ca.indexOf('if (cfg.runCid !== undefined && cid !== cfg.runCid) throw new CidMovedError');
  // v16: the sig ask is oracleScoreSig(...) (server oracle) — the cid-bound
  // scoreMsg payload rides inside it; the guard must still fire FIRST
  const signIdx = ca.indexOf('kit.scoreMsg(cid, 0, myPk, score)');
  ok(guardIdx > 0 && signIdx > guardIdx, 'guard is textually BEFORE the oracle sig ask / buildCreateGroup');
  ok(
    ca.includes('if (cfg.runCid !== undefined && cfg.runCid !== s.nextId) throw new CidMovedError(cfg.runCid, s.nextId);'),
    'mock mirrors the guard (same typed error, counter NOT bumped on a mismatch)',
  );
  ok(ca.includes('autoRetries: 2'), 'v15.2.1 post-sign 400 auto-retry kept as belt&braces');

  const ui = readFileSync(join(ROOT, 'src/game/arena/arenaUI.ts'), 'utf8');
  ok(ui.includes('private sealRunCid: number | null = null;'), 'arenaUI pins sealRunCid');
  ok(ui.includes("this.sealRunCid = this.sealRole === 'creator' ? this.nextIdHint : null;"), 'onRunFinished pins the cid the run was played for (creator runs only)');
  ok(ui.includes('if (this.sealRunCid !== null) cfg.runCid = this.sealRunCid;'), 'doSign passes runCid alongside sealedScore');
  ok(ui.includes('this.sealRunCid = null;'), 'resetSeal clears the pinned cid (draft wipe clears it too)');
  ok(ui.includes('} else if (isCidMovedError(e)) {') && ui.includes('this.cidMovedDiscard();'), 'run() routes CID_MOVED to cidMovedDiscard (not the red fail path)');
  ok(ui.includes('private cidMovedDiscard(): ArenaAction {') && ui.includes('return this.note(CID_MOVED_MSG);'), 'cidMovedDiscard: amber NOTE toast with CID_MOVED_MSG');
  {
    const m = ui.match(/private cidMovedDiscard\(\)[\s\S]*?\n  \}/);
    ok(!!m && m[0].includes('this.resetSeal();'), 'cidMovedDiscard wipes the sealed draft (RUN DISCARDED semantics)');
    ok(!!m && m[0].includes("this.screen = 'create';") && m[0].includes("this.step = 'confirm';"), 'cidMovedDiscard lands on the wizard CONFIRM step');
    ok(!!m && m[0].includes('peekNextId?.()'), 'cidMovedDiscard re-hints the counter for the re-sealed run');
    ok(!!m && !m[0].includes('console.'), 'cidMovedDiscard is log-free');
  }

  const sim = readFileSync(join(ROOT, 'scripts/sim-multiplayer.mjs'), 'utf8');
  ok(sim.includes('const stageIdxFromCid = (cid) => cid % 7;'), 'sim resolve helper: stageIdxFromCid one-liner kept (v15.2.8: FALLBACK ONLY)');
  ok(sim.includes('kit.fetchArenaCreateStages({ force: true })'), 'sim resolve: committed stage recovered from the on-chain create NOTE scan');
  ok(sim.includes('const chosenStage = Number(meta.stageMode) === 1 ? (committed ?? stageIdxFromCid(cid)) : 0;'), 'sim resolve: single-mode cards resolve at the COMMITTED note stage; cid % 7 fallback only when unverified');
  ok(sim.includes('stageIdx: chosenStage'), 'sim buildResolveGroup receives chosenStage (no hardcoded 0)');
  ok(!sim.includes('buildResolveGroup({ caller: addr(callerRole), cid, stageIdx: 0,'), 'sim: hardcoded stageIdx 0 eliminated from the resolve helper');
  ok(sim.includes('setBigUint64(24, BigInt(chosenStage), false)'), 'sim verdict extra binds the SAME stage idx the resolve arg passes');
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
  location: { search: '', hostname: 'localhost', pathname: '/' },
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  visualViewport: undefined,
};
globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {} }), body: { appendChild() {} }, activeElement: null };
globalThis.localStorage = localStorageStub;
globalThis.Image = class {};
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };

// ================= bundle A: chainAdapter with a STUBBED testnetKit =========
// The stub's signSendManaged is a faithful mini of the REAL retry loop
// (testnetKit.ts:598): build -> sign -> send per attempt, auto-retry on the
// cid-race 400 via a REBUILD (which re-reads nextChallengeId — the guard
// under test lives in chainAdapter's build()).
const { writeFileSync, rmSync, existsSync } = await import('node:fs');
// FUSE mounts occasionally drop a write from the reader's view — verify each
// temp file is visible and rewrite until it is (cheap, test-only).
function writeVisible(path, content) {
  for (let i = 0; i < 20; i++) {
    writeFileSync(path, content);
    try {
      if (existsSync(path) && readFileSync(path, 'utf8').length === content.length) return;
    } catch { /* rewrite */ }
  }
  throw new Error('temp file never became visible: ' + path);
}
const KITSTUB = join(ROOT, '.tmp-v1527b-kitstub.ts');
const ORACLESTUB = join(ROOT, '.tmp-v1527b-oraclestub.ts');
const OCSTUB = join(ROOT, '.tmp-v1527b-ocstub.ts'); // v16: server-oracle client stub
const QASTUB = join(ROOT, '.tmp-v1527b-qastub.ts');
const ENTRY_A = join(ROOT, '.tmp-v1527b-entry-a.ts');
const BUNDLE_A = join(ROOT, '.tmp-v1527b-bundle-a.mjs');
writeVisible(KITSTUB,
  '// test stub: delegates every call to globalThis.__KIT hooks\n' +
    'const H = () => globalThis.__KIT || {};\n' +
    'export const ARENA_APP_ID = 769767443;\n' +
    'export const LEGACY_ARENA_APP_ID = 769688298;\n' +
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
    // the REAL isCidRaceReject regex (testnetKit.ts:500)
    'export const isCidRaceReject = (e) => { const m = String((e && e.message) ?? e); return /status 400/i.test(m) && /logic eval error/i.test(m); };\n' +
    'export const isSignCancel = () => false;\n' +
    'export const isWedgeError = () => false;\n' +
    'export const setSignRecoverHook = () => undefined;\n' +
    'export const activeSignOp = () => null;\n' +
    // faithful mini of the real signSendManaged retry semantics
    'export const signSendManaged = (sign, buildTxns, opts = {}) => {\n' +
    '  let autoLeft = opts.autoRetries ?? 0;\n' +
    '  const attempt = async () => {\n' +
    '    try {\n' +
    '      const txns = await buildTxns(); // rebuild RE-READS nextChallengeId (the guard lives in chainAdapter.build)\n' +
    '      const signed = await sign(txns);\n' +
    '      const send = opts.send ?? ((s) => H().postToAlgod(s));\n' +
    '      return await send(signed);\n' +
    '    } catch (e) {\n' +
    '      if (autoLeft > 0 && opts.rebuildOnRetry && isCidRaceReject(e)) { autoLeft--; return attempt(); }\n' +
    '      throw e;\n' +
    '    }\n' +
    '  };\n' +
    '  return { done: attempt(), retry() {}, cancel() {} };\n' +
    '};\n' +
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
writeVisible(ORACLESTUB,
  'export const armDevOracle = () => undefined;\n' +
    'export const hasDevOracle = () => true;\n' +
    'export const devOracleSign = async () => { (globalThis.__ORACLE ||= { signs: 0 }).signs++; return new Uint8Array(64); };\n' +
    'export const devOracleSignScore = async () => { (globalThis.__ORACLE ||= { signs: 0 }).signs++; return new Uint8Array(64); };\n',
);
// v16: the testnet adapter signs via ./oracleClient (SERVER ORACLE, SPEC
// §3/§7) — the stub keeps the __ORACLE.signs meter the cid-race asserts read,
// and no HTTP ever leaves the test process.
writeVisible(OCSTUB,
  'export const oracleScoreSig = async () => { (globalThis.__ORACLE ||= { signs: 0 }).signs++; return new Uint8Array(64); };\n' +
    'export const oracleVerdictSig = async () => new Uint8Array(64);\n' +
    'export const registerContinueReceipt = async () => undefined;\n' +
    "export const oracleBaseUrl = () => 'stub';\n" +
    "export const oracleLine = () => 'STUB ORACLE';\n",
);
writeVisible(QASTUB, 'export const qaMode = () => false;\nexport const qaActive = () => false;\nexport const qaScore = () => 4200;\n');
writeVisible(ENTRY_A,
  "export { TestnetArenaAdapter, MockArenaAdapter, stageIdxFromCid, CidMovedError, isCidMovedError, CID_MOVED_MSG, setTestnetIdentityProvider } from './src/game/arena/chainAdapter';\n",
);
const esbuild = await import('esbuild');
await esbuild.build({
  entryPoints: [ENTRY_A],
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['algosdk'],
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  outfile: BUNDLE_A,
  logLevel: 'silent',
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
const { TestnetArenaAdapter, MockArenaAdapter, CidMovedError, isCidMovedError, CID_MOVED_MSG, setTestnetIdentityProvider } = modA;

// ---- kit hook harness ------------------------------------------------------
const ADDR58 = (s) => (s + 'Q'.repeat(58)).slice(0, 58);
const pk = (n) => { const b = new Uint8Array(32); b[31] = n; return b; };
const FIGHTER = { skin: 'gonna', assetId: null, name: 'GONNA' };
const mkMeta = (over) => ({
  creator: pk(9),
  stake: 1_000_000n,
  seatsTotal: 1n,
  seatsTaken: 0n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  stageMode: 1n,
  seed: new Uint8Array(32),
  creatorScore: 5000n,
  status: 0n, // OPEN
  winner: new Uint8Array(0),
  paidTotal: 1_000_000n,
  mbrPaid: 0n,
  ...over,
});
const mkPlayer = (n, score, signed = true) => ({ addr: pk(n), score: BigInt(score), signed, seatedAt: 0n });

let kitState;
function resetKit(counter) {
  kitState = {
    counter, // what nextChallengeId() returns (can be a fn for per-call values)
    cidReads: 0,
    posts: 0, // algod sendRawTransaction count (the 'posts to algod' meter)
    signPrompts: 0, // wallet prompts
    builds: [], // buildCreateGroup args (one per group BUILD)
    meta: null,
    players: [],
  };
  globalThis.__ORACLE = { signs: 0 };
  globalThis.__KIT = {
    sdk: async () => ({
      encodeAddress: (b) => ADDR58('PK' + (b instanceof Uint8Array ? b[31] : 0)),
      decodeAddress: () => ({ publicKey: new Uint8Array(32) }),
    }),
    algodClient: async () => ({
      // preflight GETs: rich QA wallet (opted in, funded) — never a POST
      accountInformation: () => ({ do: async () => ({ amount: 10_000_000, minBalance: 100_000, assets: [{ assetId: 769688287, amount: 1_000_000_000 }] }) }),
    }),
    nextChallengeId: async () => {
      kitState.cidReads++;
      return typeof kitState.counter === 'function' ? kitState.counter(kitState.cidReads) : kitState.counter;
    },
    scoreMsg: async () => new Uint8Array([1, 2, 3]),
    buildCreateGroup: async (o) => {
      kitState.builds.push({ ...o });
      return [{ fake: true, cid: o.cid }];
    },
    postToAlgod: async () => {
      kitState.posts++;
      return 'TXID-POST-' + kitState.posts;
    },
    readMeta: async () => kitState.meta,
    readPlayers: async () => kitState.players,
    scanChallengeIds: async () => [],
    contractVersion: async () => 2,
    fetchArenaCloseEvents: async () => [],
    fetchArenaCreateStages: async () => ({}), // v15.2.8 note scan: nothing committed in these fixtures
    rememberedCard: () => null,
    signSend: async () => 'TXIDSTUB',
    recordTxid: () => undefined,
    recordResolveAt: () => undefined,
  };
}
const mkCfg = (over) => ({
  visibility: 'public',
  format: 'duel',
  seatsTotal: 2,
  durationSecs: 86400,
  stageMode: 'single',
  stageIdx: null,
  stake: 1,
  fighter: FIGHTER,
  sealedScore: 5000,
  ...over,
});
const CREATOR = { address: ADDR58('ME'), name: 'ME', score: 0, fighter: FIGHTER, accountType: 'ed25519' };
setTestnetIdentityProvider(async () => ({
  address: ADDR58('ME'),
  sign: async () => {
    kitState.signPrompts++;
    return [new Uint8Array(8)];
  },
}));
const race400 = () => new Error('Network request error. Received status 400 (logic eval error: assert failed ed25519verify_bare)');

// ================= [1] (a) MISMATCH REJECTS PRE-SIGN ========================
console.log('\n[1] (a) counter != runCid: CID_MOVED BEFORE any sign/broadcast');
{
  resetKit(43); // the pit moved: the run was sealed for cid 42
  const ta = new TestnetArenaAdapter();
  let err = null;
  try {
    await ta.createChallenge(mkCfg({ runCid: 42 }), CREATOR);
  } catch (e) {
    err = e;
  }
  ok(err !== null && isCidMovedError(err), 'createChallenge rejects with code CID_MOVED (got ' + (err && (err.code ?? err.message)) + ')');
  ok(err instanceof CidMovedError && err.runCid === 42 && err.actualCid === 43, 'typed error carries runCid 42 / actualCid 43');
  ok(err && err.message === CID_MOVED_MSG, 'error message IS the toast line');
  ok(kitState.posts === 0, 'ZERO posts to algod (got ' + kitState.posts + ')');
  ok(kitState.signPrompts === 0, 'ZERO wallet prompts (got ' + kitState.signPrompts + ')');
  ok(kitState.builds.length === 0, 'buildCreateGroup NEVER called (got ' + kitState.builds.length + ')');
  ok(globalThis.__ORACLE.signs === 0, 'ZERO oracle signs — the sig ask itself is gated (got ' + globalThis.__ORACLE.signs + ')');
}

// ================= [2] (b) MATCH PROCEEDS NORMALLY ==========================
console.log('\n[2] (b) counter == runCid: create proceeds normally');
{
  resetKit(42);
  kitState.meta = mkMeta({});
  kitState.players = [mkPlayer(9, 5000)];
  const ta = new TestnetArenaAdapter();
  const c = await ta.createChallenge(mkCfg({ runCid: 42 }), CREATOR);
  ok(c.id === 42 && c.status === 'open', 'card created at cid 42, readable back (status ' + c.status + ')');
  ok(kitState.builds.length === 1 && kitState.builds[0].cid === 42, 'group built exactly once, for cid 42');
  ok(kitState.posts === 1 && kitState.signPrompts === 1 && globalThis.__ORACLE.signs === 1, 'exactly 1 oracle sign + 1 wallet prompt + 1 post');
  ok(c.players[0] && c.players[0].score === 5000, 'sealed score rides the create');
}

// ================= [3] (c) POST-SIGN 400 RACE ===============================
console.log('\n[3] (c1) post-sign 400, counter STILL == runCid: safe retry succeeds');
{
  resetKit(42);
  kitState.meta = mkMeta({});
  kitState.players = [mkPlayer(9, 5000)];
  let firstPost = true;
  globalThis.__KIT.postToAlgod = async () => {
    kitState.posts++;
    if (firstPost) {
      firstPost = false;
      throw race400(); // a concurrent create confirmed during wallet approval
    }
    return 'TXID-RACE-RETRY-OK';
  };
  const ta = new TestnetArenaAdapter();
  const c = await ta.createChallenge(mkCfg({ runCid: 42 }), CREATOR);
  ok(c.id === 42, 'retry landed the card at the SAME cid the run was played for');
  ok(kitState.posts === 2, 'two posts: the 400d attempt + the safe retry (got ' + kitState.posts + ')');
  ok(kitState.builds.length === 2 && kitState.builds.every((b) => b.cid === 42), 'every build targeted runCid 42 — a fresh cid-bound sig each attempt');
  ok(kitState.signPrompts === 2 && globalThis.__ORACLE.signs === 2, 'retry re-signed with a FRESH oracle sig for the same runCid');
}
console.log('\n[3] (c2) post-sign 400, counter MOVED: CID_MOVED surfaces, never a mismatched card');
{
  // counter reads: 42 (attempt 1 build), then 43 forever (the racer's create confirmed)
  resetKit((n) => (n === 1 ? 42 : 43));
  globalThis.__KIT.postToAlgod = async () => {
    kitState.posts++;
    throw race400(); // every send 400s — the cid moved
  };
  const ta = new TestnetArenaAdapter();
  let err = null;
  try {
    await ta.createChallenge(mkCfg({ runCid: 42 }), CREATOR);
  } catch (e) {
    err = e;
  }
  ok(err !== null && isCidMovedError(err), 'CID_MOVED surfaces instead of retrying into a mismatch (got ' + (err && (err.code ?? err.message)) + ')');
  ok(kitState.builds.length >= 1 && kitState.builds.every((b) => b.cid === 42), 'NO group was ever built under the moved cid 43');
  ok(kitState.posts === kitState.builds.length, 'posts == builds: only the stale-cid attempt hit the wire, and it 400d (chain never confirms it)');
  ok(kitState.signPrompts === 1, 'the wallet was prompted ONCE (attempt 1) — the retry died pre-sign (got ' + kitState.signPrompts + ')');
}
console.log('\n[3] (c3) no runCid (QA harness / legacy path): guard inert, create proceeds');
{
  resetKit(99);
  kitState.meta = mkMeta({});
  kitState.players = [mkPlayer(9, 5000)];
  const ta = new TestnetArenaAdapter();
  const c = await ta.createChallenge(mkCfg({}), CREATOR); // runCid omitted
  ok(c.id === 99 && kitState.posts === 1, 'no runCid -> no guard, create at the current counter (backward compatible)');
}

// ================= [4] (d) UI TOAST + DISCARD PATH ==========================
console.log('\n[4] (d) UI: CID_MOVED -> amber note, draft discarded, back to CONFIRM');
const ENTRY_B = join(ROOT, '.tmp-v1527b-entry-b.ts');
const BUNDLE_B = join(ROOT, '.tmp-v1527b-bundle-b.mjs');
writeVisible(ENTRY_B,
  "export { ArenaUI } from './src/game/arena/arenaUI';\n" +
    "export { setMock } from './src/game/wallet';\n" +
    "export { getArenaAdapter, CID_MOVED_MSG as MSG } from './src/game/arena/chainAdapter';\n",
);
await esbuild.build({
  entryPoints: [ENTRY_B],
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['algosdk'],
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  outfile: BUNDLE_B,
  logLevel: 'silent',
});
const modB = await import(BUNDLE_B);
const { ArenaUI, setMock, getArenaAdapter, MSG } = modB;
{
  store.clear();
  store.set('gonna.arena.adapter', 'mock');
  setMock({ address: ADDR58('DEGEN'), nfts: [] });
  const ad = getArenaAdapter();
  const hint = await ad.peekNextId(); // the mock counter BEFORE the race
  ok(typeof hint === 'number' && hint > 0, 'mock counter readable (hint=' + hint + ')');
  const openBefore = (await ad.listOpenChallenges()).length; // seeded piazza cards

  const ui = new ArenaUI();
  ui.hots = [];
  ui.focus = -1;
  ui.screen = 'create';
  ui.step = 'confirm';
  ui.sealRole = 'creator';
  // the run was sealed while the hint said hint+3 — then the pit moved
  ui.nextIdHint = hint + 3;
  ui.onRunFinished(5000);
  ok(ui.screen === 'seal' && ui.sealedScore === 5000 && ui.sealRunCid === hint + 3, 'run sealed with sealRunCid pinned to the stale hint (' + (hint + 3) + ')');

  const act = ui.doSign();
  ok(act.act === 'move' && ui.busy === true, 'SIGN & STAKE starts (busy)');
  for (let i = 0; i < 500 && ui.busy; i++) await sleep(5);
  ok(ui.busy === false, 'op settled (button back)');
  ok(ui.err === MSG, "toast is exactly '" + MSG + "' (got '" + ui.err + "')");
  ok(ui.errKind === 'note', 'errKind note — AMBER, never red');
  ok(ui.errT > 0, 'toast is visible (errT armed)');
  ok(ui.sealedScore === null && ui.sealBest === 0 && ui.sealRuns === 0 && ui.sealRunCid === null, 'sealed draft DISCARDED (RUN DISCARDED semantics)');
  ok(ui.screen === 'create' && ui.step === 'confirm', 'back on the wizard CONFIRM step (screen ' + ui.screen + '/' + ui.step + ')');
  for (let i = 0; i < 50 && ui.nextIdHint !== hint; i++) await sleep(5); // async re-hint
  ok(ui.nextIdHint === hint, 'counter re-hinted to the REAL next id (' + ui.nextIdHint + ') — the re-sealed run gets the new seed/stage');
  const openAfter = await ad.listOpenChallenges();
  ok(openAfter.length === openBefore && !openAfter.some((c) => c.id === hint + 3 || c.id === hint), 'NO card was created (stake never left the wallet)');

  // sanity: with the counter NOT moved, the same UI flow creates the card
  store.clear();
  store.set('gonna.arena.adapter', 'mock');
  const ad2 = getArenaAdapter();
  const hint2 = await ad2.peekNextId();
  const ui2 = new ArenaUI();
  ui2.hots = [];
  ui2.focus = -1;
  ui2.screen = 'create';
  ui2.step = 'confirm';
  ui2.sealRole = 'creator';
  ui2.nextIdHint = hint2;
  ui2.onRunFinished(5000);
  ui2.doSign();
  for (let i = 0; i < 500 && ui2.busy; i++) await sleep(5);
  ok(ui2.err === '' && ui2.screen === 'versus', 'counter unmoved: the SAME flow creates the card and lands on versus');
  ok(ui2.current && ui2.current.id === hint2, 'card created at exactly the hinted id (' + (ui2.current && ui2.current.id) + ' == ' + hint2 + ')');
}

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
for (const f of [ENTRY_A, BUNDLE_A, ENTRY_B, BUNDLE_B, KITSTUB, ORACLESTUB, OCSTUB, QASTUB]) rmSync(f, { force: true });
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
;
process.exit(fails.length === 0 ? 0 : 1);
rocess.exit(fails.length === 0 ? 0 : 1);
;
process.exit(fails.length === 0 ? 0 : 1);
