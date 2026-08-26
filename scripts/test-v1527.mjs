// GONNA FIGHT v15.2.7 suite — RETCONNED to v15.2.8 (node-only, no browser).
// The v15.2.7 chain-deals-cid%7 stage model is REJECTED (owner decree: "il
// primo giocatore sceglie il livello"); stageIdxFromCid survives ONLY as the
// UNVERIFIED fallback. This suite keeps its original coverage — pot truth and
// terminal-card honesty are unchanged — and its stage-model asserts now pin
// the v15.2.8 truth:
//   BUG-1  pot = stake x players.length (creator is seat 0; seats_taken counts
//          joiners only — contract.py:128). Live mapping + resolve preview +
//          mock adapter all agree with the chain.
//   BUG-2  the DESCENT level is the CREATOR's pick, committed ON-CHAIN in the
//          create note ('gonna:v2:stage:<K>'): live mapping + resolve() verdict
//          + arg bind the COMMITTED stage (note > memory > link); cid % 7 only
//          when nothing is committed, and then stageVerified === false.
//   BUG-3  terminal card: stake from card memory ONLY (NaN -> '-', never
//          pot/2); pot exact from the event; both-missing deep-link retries
//          the event log 3x over ~6s then renders 'SETTLED - DATA ON CHAIN',
//          never '0 $GONNA POT' / 'TOOK 0'.
//   FEAT   stageLabel: 'LV6 GHETTO GONNA' on the versus header, board, wizard
//          LOCKED line ('(UNVERIFIED)' on a fallback guess); the wizard LV1-7
//          picker sets cfg.stageIdx and RANDOM deals via the crypto RNG.
// Run: node scripts/test-v1527.mjs   (from /mnt/agents/output/app)
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
console.log('\n[0] SOURCE: chainAdapter + arenaUI carry the v15.2.7/v15.2.8 truths');
{
  const ca = readFileSync(join(ROOT, 'src/game/arena/chainAdapter.ts'), 'utf8');
  ok(ca.includes('export function stageIdxFromCid(cid: number): number {') && ca.includes('return cid % 7;'), 'stageIdxFromCid exported: cid % 7 (v15.2.8: UNVERIFIED fallback only)');
  ok(ca.includes('pot: (Number(meta.stake) * players.length) / 1e6'), 'live mapping pot = stake x players box length (BUG-1)');
  ok(!ca.includes('pot: (Number(meta.stake) * seatsTaken) / 1e6'), 'old seats_taken pot mapping gone');
  ok(ca.includes('const potMicro = Number(meta.stake) * players.length'), 'resolve preview pot = stake x roster length');
  ok(ca.includes('const feeMicro = tie ? 0 : Math.floor(potMicro * 0.05)') && ca.includes('payout: (potMicro - feeMicro) / 1e6'), 'resolve legs: 5% floor fee, winner takes pot - fee');
  ok(ca.includes("const chosenStage = Number(meta.stageMode) === 1 ? (await this.cardStage(id, 'single')).stageIdx! : 0;"), 'resolve derives chosenStage = the COMMITTED stage (note > memory > link > fallback) for MODE_STAGE_IDX');
  ok(ca.includes('stageIdx: chosenStage'), 'buildResolveGroup receives the SAME chosenStage the verdict binds');
  ok(ca.includes('setBigUint64(24, BigInt(chosenStage), false)'), 'verdict extra payload carries chosenStage (contract asserts equality)');
  ok(!ca.includes('TODO(mainnet): real chosen stage') && !ca.includes('stageIdx: 0, // TODO'), 'hardcoded stage 0 TODOs eliminated');
  ok(ca.includes('const stageRes = await this.cardStage(cid, stageMode);') && ca.includes('stageIdx: stageRes.stageIdx,') && ca.includes('stageVerified: stageRes.verified,'), 'live mapping: stage from cardStage (note > memory > link > cid%7 UNVERIFIED), full -> null');
  ok(ca.includes('stake: mem?.stake ?? NaN'), 'terminal stake from memory ONLY (NaN = unknown), never pot/2');
  ok(!ca.includes('potMicro / 1e6 / 2'), 'duel-only pot/2 stake guess eliminated');
  ok(ca.includes("if (!Number.isFinite(n)) return '—';"), "fmtStake renders '—' for the unknown stake");
  ok(ca.includes('[0, 2000, 4000]'), 'deep-link retry: bounded backoff, 3 tries over ~6s');
  ok(ca.includes("if (opts?.deepLink) return this.terminalChallenge(id, 'resolved', null, null)"), 'both-missing deep-link renders the terminal-unknown card');
  ok(ca.includes("stageIdx: cfg.stageMode === 'full' ? null : (cfg.stageIdx ?? stageIdxFromCid(id)),"), 'mock create: the creator pick committed; cid % 7 only when NO pick');
  ok(ca.includes("stageVerified: cfg.stageMode === 'full' ? true : cfg.stageIdx != null,"), 'mock create: pick -> verified, no pick -> UNVERIFIED fallback');
  ok(!ca.includes('Math.floor(Math.random() * 7)'), 'mock adapter: no Math.random stage anywhere');
  ok(ca.includes('c.pot = c.stake * c.players.length'), 'mock pot = stake x roster length');

  const ui = readFileSync(join(ROOT, 'src/game/arena/arenaUI.ts'), 'utf8');
  ok(ui.includes("const base = 'LV' + (stageIdx + 1) + ' ' + STAGE_NAMES[stageIdx];") && ui.includes("return verified ? base : base + ' (UNVERIFIED)';"), "stageLabel single -> 'LV<n> <NAME>', '(UNVERIFIED)' on a fallback guess");
  ok(ui.includes("if (stageMode === 'full') return 'FULL RUN - ALL 7 STAGES';"), 'stageLabel full banner');
  ok(ui.includes("'LOCKED: ' + stageLabel('single', this.shuffleTarget)"), 'wizard LOCKED line carries LV');
  ok(ui.includes("'RANDOM - THE SHUFFLE DEALS, THE CHAIN SEALS'") && !ui.includes('THE CHAIN DEALS THE LEVEL'), "RANDOM dim line under LOCKED; v15.2.7 'chain deals' copy gone");
  ok(ui.includes('private drawLevelPicker') && ui.includes("id: 'lvl:' + i"), 'LV1-7 picker: the creator CHOOSES the level (v15.2.8)');
  ok(ui.includes("return this.fail('PICK A LEVEL FIRST')"), 'wizard NEXT gated until a level is picked');
  ok(ui.includes('this.shuffleTarget = cryptoRandomStage()'), 'RANDOM shuffle target dealt LOCALLY by the crypto RNG');
  ok(!ui.includes('shufflePending') && !ui.includes('startChainShuffle') && ui.includes('crypto.getRandomValues(b);') && ui.includes('>= 252'), 'chain-shuffle machinery removed; crypto RNG with uniform rejection sampling');
  ok(ui.includes("drawTextSh(c, 'SETTLED - DATA ON CHAIN'"), "terminal-unknown versus block: 'SETTLED - DATA ON CHAIN'");
  ok(ui.includes("potUnknown ? '—' : fmtStake(card.pot)"), 'duel pot center never prints an invented 0');
  ok(ui.includes("getChallenge(deepDuel, { deepLink: true })"), 'deep-link opts into the event-log retry');
  const font = readFileSync(join(ROOT, 'src/game/font.ts'), 'utf8');
  ok(font.includes("'—':"), 'font has an em-dash glyph for the unknown value');
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
const { writeFileSync, rmSync } = await import('node:fs');
const KITSTUB = join(ROOT, '.tmp-v1527-kitstub.ts');
const ORACLESTUB = join(ROOT, '.tmp-v1527-oraclestub.ts');
const OCSTUB = join(ROOT, '.tmp-v1527-ocstub.ts'); // v16: server-oracle client stub
const QASTUB = join(ROOT, '.tmp-v1527-qastub.ts');
const ENTRY_A = join(ROOT, '.tmp-v1527-entry-a.ts');
const BUNDLE_A = join(ROOT, '.tmp-v1527-bundle-a.mjs');
writeFileSync(
  KITSTUB,
  '// test stub: delegates every call to globalThis.__KIT hooks\n' +
    'const H = () => globalThis.__KIT || {};\n' +
    'export const ARENA_APP_ID = 769907387;\n' +
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
// §3/§7) — stub the module so no HTTP ever leaves the test process. The dev
// stub above stays for oracleLink/devOracle themselves (QA-only paths).
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
  "export { TestnetArenaAdapter, MockArenaAdapter, stageIdxFromCid, splitPot, fmtStake, setTestnetIdentityProvider } from './src/game/arena/chainAdapter';\n",
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
const { TestnetArenaAdapter, MockArenaAdapter, stageIdxFromCid, splitPot, fmtStake, setTestnetIdentityProvider } = modA;

// ---- kit hook harness ------------------------------------------------------
const ADDR58 = (s) => (s + 'Q'.repeat(58)).slice(0, 58);
const pk = (n) => { const b = new Uint8Array(32); b[31] = n; return b; };
let kitState;
function resetKit() {
  kitState = {
    meta: null, // cid -> meta
    players: [], // cid -> tuples (single roster for the test card)
    events: [],
    fetchCount: 0,
    remembered: null,
    rememberedWrites: [],
    resolveArgs: null,
    verdictArgs: null,
    noteStages: {}, // v15.2.8: cid -> committed stage, the indexer note scan
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
    fetchArenaCloseEvents: async () => {
      kitState.fetchCount++;
      return kitState.events;
    },
    fetchArenaCreateStages: async () => kitState.noteStages,
    rememberedCard: () => kitState.remembered,
    rememberCard: (m) => kitState.rememberedWrites.push(m),
    verdictMsg: async (cid, mode, extra, entries) => {
      kitState.verdictArgs = { cid, mode, extra: Uint8Array.from(extra), entries };
      return new Uint8Array([1, 2, 3]);
    },
    buildResolveGroup: async (o) => {
      kitState.resolveArgs = o;
      return [];
    },
    signSend: async () => 'TXIDSTUB',
    recordTxid: () => undefined,
    recordResolveAt: () => undefined,
  };
}
const mkMeta = (over) => ({
  creator: pk(9),
  stake: 1_000_000n, // 1 GONNA
  seatsTotal: 1n, // JOINER seats (contract truth) — 1 = duel
  seatsTaken: 1n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  stageMode: 1n, // MODE_STAGE_IDX
  seed: new Uint8Array(32),
  creatorScore: 5000n,
  status: 1n, // CLOSED (full)
  winner: new Uint8Array(0),
  paidTotal: 2_000_000n,
  mbrPaid: 0n,
  ...over,
});
const mkPlayer = (n, score, signed = true) => ({ addr: pk(n), score: BigInt(score), signed, seatedAt: 0n });

// ================= [1] POT MATH =============================================
console.log('\n[1] BUG-1: pot = stake x players.length (the players box IS the truth)');
{
  resetKit();
  const ta = new TestnetArenaAdapter();
  // duel: 1 joiner seat taken, creator seated -> 2 in the players box -> pot 2
  const duel = await ta.toChallenge(21, mkMeta({}), [mkPlayer(9, 5000), mkPlayer(1, 3000)]);
  ok(duel.pot === 2, 'live mapping duel: stake 1 GONNA x 2 seated -> pot 2 (got ' + duel.pot + ')');
  // table: 4 joiner seats taken, creator seated -> 5 in the box -> pot 5
  // (on-chain proof: cid 21, 5 players x 1 GONNA -> pot 5,000,000 micro)
  const table = await ta.toChallenge(
    21,
    mkMeta({ seatsTotal: 4n, seatsTaken: 4n, paidTotal: 5_000_000n }),
    [mkPlayer(9, 5000), mkPlayer(1, 3000), mkPlayer(2, 100), mkPlayer(3, 0, false), mkPlayer(4, 0, false)],
  );
  ok(table.pot === 5, 'live mapping table: stake 1 GONNA x 5 seated -> pot 5 (got ' + table.pot + ')');
  ok(table.seatsTotal === 5, 'UI seats convention intact: 4 joiner seats + creator = 5');
  // mock mirrors the chain: create (1 seat) -> join (2 seats)
  store.clear();
  const mock = new MockArenaAdapter();
  const cfg = { visibility: 'public', format: 'duel', seatsTotal: 2, durationSecs: 3600, stageMode: 'single', stageIdx: null, stake: 10, fighter: { skin: 'gonna', assetId: null, name: 'GONNA' } };
  const mc = await mock.createChallenge(cfg, { address: 'ME', name: 'ME', score: 0, fighter: cfg.fighter, accountType: 'ed25519' });
  ok(mc.pot === 10 && mc.players.length === 1, 'mock create: pot = stake x 1 (creator seat)');
  const mj = await mock.join(mc.id, { address: 'RIVAL', name: 'RIVAL', score: 0, fighter: cfg.fighter, accountType: 'ed25519' });
  ok(mj.pot === 20 && mj.players.length === 2, 'mock join: pot = stake x 2 (got ' + mj.pot + ')');
}

console.log('\n[1B] resolve preview: pot/fee/winner legs consistent with the roster');
{
  resetKit();
  setTestnetIdentityProvider(async () => ({ address: ADDR58('ME'), sign: async () => [] }));
  const ta = new TestnetArenaAdapter();
  kitState.meta = mkMeta({}); // stake 1 GONNA, duel, full+signed
  kitState.players = [mkPlayer(9, 5000), mkPlayer(1, 3000)];
  const done = await ta.resolve(43);
  const w = kitState.rememberedWrites[0];
  ok(!!w, 'resolve wrote card memory');
  ok(w && w.payout === 1.9 && w.fee === 0.1, 'memory legs: pot 2 GONNA -> fee 0.1 (5% floor), winner 1.9 (got fee ' + (w && w.fee) + ', payout ' + (w && w.payout) + ')');
  ok(done.status === 'resolved', 'resolve returns the terminal resolved card');
}

// ================= [2] STAGE RESOLUTION (fallback purity + tiers) ===========
console.log('\n[2] BUG-2 (v15.2.8): stageIdxFromCid fallback purity + live-mapping tiers');
{
  let inRange = true;
  let deterministic = true;
  for (let cid = 0; cid <= 200; cid++) {
    const s = stageIdxFromCid(cid);
    if (s !== cid % 7 || s < 0 || s > 6) inRange = false;
    if (stageIdxFromCid(cid) !== s) deterministic = false;
  }
  ok(inRange, 'cid % 7 stays in 0-6 for cid 0..200 (fallback domain)');
  ok(deterministic, 'same cid -> same stage (pure function)');
  ok(stageIdxFromCid(21) === 0 && stageIdxFromCid(26) === 5, 'spot check: cid 21 -> idx 0, cid 26 -> idx 5');

  resetKit();
  const ta = new TestnetArenaAdapter();
  const single = await ta.toChallenge(26, mkMeta({ stageMode: 1n }), [mkPlayer(9, 5000), mkPlayer(1, 3000)]);
  ok(single.stageIdx === 5 && single.stageVerified === false, 'live mapping single, NOTHING committed: cid 26 -> 5 (26 % 7), UNVERIFIED');
  kitState.noteStages = { 26: 2 }; // the create note committed stage 2
  const noted = await ta.toChallenge(26, mkMeta({ stageMode: 1n }), [mkPlayer(9, 5000), mkPlayer(1, 3000)]);
  ok(noted.stageIdx === 2 && noted.stageVerified === true, 'live mapping single: the on-chain NOTE (2) beats the cid % 7 fallback');
  const full = await ta.toChallenge(26, mkMeta({ stageMode: 0n }), [mkPlayer(9, 5000), mkPlayer(1, 3000)]);
  ok(full.stageIdx === null, 'live mapping full: stageIdx stays null');
}

console.log('\n[2B] resolve passes the COMMITTED stage — verdict payload AND resolve arg agree');
{
  resetKit();
  setTestnetIdentityProvider(async () => ({ address: ADDR58('ME'), sign: async () => [] }));
  const ta = new TestnetArenaAdapter();
  kitState.meta = mkMeta({ stageMode: 1n });
  kitState.players = [mkPlayer(9, 5000), mkPlayer(1, 3000)];
  kitState.noteStages = { 43: 6 }; // the create note committed stage 6
  await ta.resolve(43); // 43 % 7 = 1, but the COMMITTED stage is 6
  ok(kitState.resolveArgs && kitState.resolveArgs.stageIdx === 6, 'buildResolveGroup stageIdx = 6 from the on-chain note, NOT 43 % 7 = 1 (got ' + (kitState.resolveArgs && kitState.resolveArgs.stageIdx) + ')');
  const ex = kitState.verdictArgs && kitState.verdictArgs.extra;
  ok(kitState.verdictArgs && kitState.verdictArgs.mode === 1 && ex && ex.length === 32 && ex[31] === 6 && ex.slice(0, 24).every((b) => b === 0), 'verdict extra = 24 zeros + committed stage idx 6 — the SAME value the resolve arg carries');
  // fallback tier: nothing committed -> cid % 7 (and the card is UNVERIFIED)
  resetKit();
  setTestnetIdentityProvider(async () => ({ address: ADDR58('ME'), sign: async () => [] }));
  kitState.meta = mkMeta({ stageMode: 1n });
  kitState.players = [mkPlayer(9, 5000), mkPlayer(1, 3000)];
  await ta.resolve(43);
  ok(kitState.resolveArgs && kitState.resolveArgs.stageIdx === 1, 'fallback ONLY when nothing is committed: 43 % 7 = 1 (got ' + (kitState.resolveArgs && kitState.resolveArgs.stageIdx) + ')');
  // FULL mode pins stage 0 (contract asserts stage_idx == 0 for MODE_FULL)
  resetKit();
  setTestnetIdentityProvider(async () => ({ address: ADDR58('ME'), sign: async () => [] }));
  kitState.meta = mkMeta({ stageMode: 0n });
  kitState.players = [mkPlayer(9, 5000), mkPlayer(1, 3000)];
  await ta.resolve(44);
  ok(kitState.resolveArgs && kitState.resolveArgs.stageIdx === 0, 'FULL run resolve keeps stageIdx 0 (contract assert)');
}

console.log('\n[2C] mock mirrors the chain: the creator pick is committed');
{
  store.clear();
  const mock = new MockArenaAdapter();
  const hint = await mock.peekNextId();
  const cfg = { visibility: 'public', format: 'duel', seatsTotal: 2, durationSecs: 3600, stageMode: 'single', stageIdx: 0, stake: 10, fighter: { skin: 'gonna', assetId: null, name: 'GONNA' } };
  const c = await mock.createChallenge(cfg, { address: 'ME', name: 'ME', score: 0, fighter: cfg.fighter, accountType: 'ed25519' });
  ok(typeof hint === 'number' && hint === c.id, 'mock peekNextId predicts the created id (' + hint + ' -> ' + c.id + ')');
  ok(c.stageIdx === 0 && c.stageVerified === true, 'mock single card commits the creator pick cfg.stageIdx=0, VERIFIED (the create-note equivalent)');
  const cr = await mock.createChallenge({ ...cfg, stageMode: 'random', stageIdx: null }, { address: 'ME', name: 'ME', score: 0, fighter: cfg.fighter, accountType: 'ed25519' });
  ok(cr.stageIdx === cr.id % 7 && cr.stageVerified === false, 'mock without a pick: id % 7 fallback, UNVERIFIED (no Math.random)');
}

// ================= [3] TERMINAL CARD HONESTY ================================
console.log('\n[3] BUG-3: terminal cards never invent numbers');
{
  // (b) pot exact from the event; (a) stake unknown without memory (never pot/2)
  resetKit();
  const ta = new TestnetArenaAdapter();
  kitState.events = [{ cid: 77, kind: 'resolved', winner: ADDR58('WINNER'), payout: 4_750_000, fee: 250_000, round: 100, at: 1_700_000_000_000 }];
  const card = await ta.getChallenge(77);
  ok(card !== null && card.pot === 5, 'event-only terminal: pot exact from event (payout+fee)/1e6 = 5 (got ' + (card && card.pot) + ')');
  ok(card !== null && !Number.isFinite(card.stake), 'event-only terminal: stake UNKNOWN (NaN), not pot/2 = 2.5');
  ok(card.status === 'resolved' && card.winner === ADDR58('WINNER'), 'event-only terminal: settled, winner from the event');
  ok(fmtStake(NaN) === '—', "fmtStake(NaN) renders '—'");
}
{
  // memory pair: a TABLE keeps its real per-seat stake — never derived pot/2
  resetKit();
  const ta = new TestnetArenaAdapter();
  kitState.remembered = {
    cid: 78,
    creator: ADDR58('CREATOR'),
    stake: 5,
    seatsTotal: 5,
    stageMode: 'single',
    stageIdx: 1,
    deadline: 0,
    players: [0, 1, 2, 3, 4].map((i) => ({ address: ADDR58('P' + i), score: 1000 * (i + 1), signed: true })),
    closedKind: 'resolved',
    winner: ADDR58('P4'),
    payout: 23.75,
    fee: 1.25,
    closedAt: 1_700_000_000_000,
  };
  const card = await ta.getChallenge(78);
  ok(card !== null && card.stake === 5, 'memory terminal table: stake 5 from MEMORY, never pot/2 (' + (card && card.stake) + ')');
  ok(card.pot === 25 && card.format === 'open' && card.players.length === 5, 'memory terminal table: pot 25 exact, roster + format from memory');
}
console.log('\n[3B] both-missing deep-link: 3 event fetches over ~6s, then the honest unknown card');
{
  resetKit();
  const ta = new TestnetArenaAdapter();
  const t0 = Date.now();
  const card = await ta.getChallenge(99, { deepLink: true });
  const elapsed = Date.now() - t0;
  ok(kitState.fetchCount === 3, 'fetchArenaCloseEvents retried exactly 3 times (got ' + kitState.fetchCount + ')');
  ok(elapsed >= 5500 && elapsed <= 12000, 'bounded backoff span ~6s (took ' + elapsed + 'ms)');
  ok(card !== null && card.status === 'resolved', 'both-missing deep-link renders the terminal card (not a 404)');
  ok(!Number.isFinite(card.stake) && card.pot === 0 && card.winner === null, 'unknown card: stake NaN, pot 0, no winner — nothing invented');
  // a NON-deep-link caller keeps the old null contract (post-op guards fire)
  resetKit();
  const card2 = await ta.getChallenge(100);
  ok(card2 === null && kitState.fetchCount === 1, 'non-deep-link both-missing: single fetch, null returned (create/close guards intact)');
}

// ================= bundle B: arenaUI with the TEXTLOG font wrapper ==========
const ENTRY_B = join(ROOT, '.tmp-v1527-entry-b.ts');
const WRAP_B = join(ROOT, '.tmp-v1527-fontwrap.ts');
const BUNDLE_B = join(ROOT, '.tmp-v1527-bundle-b.mjs');
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
  "export { ArenaUI, stageLabel } from './src/game/arena/arenaUI';\n" +
    "export { setMock } from './src/game/wallet';\n" +
    "export { TEXTLOG } from './.tmp-v1527-fontwrap';\n",
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
const { ArenaUI, stageLabel, setMock, TEXTLOG } = modB;

const FIGHTER = { skin: 'gonna', assetId: null, name: 'GONNA' };
const plUI = (addr, name, score) => ({ address: addr, name, score, fighter: FIGHTER, accountType: 'ed25519' });
const mkCardUI = (over) => ({
  id: 42,
  creator: ADDR58('CREATOR'),
  creatorName: 'CREATORDEGEN',
  creatorType: 'ed25519',
  visibility: 'public',
  format: 'duel',
  seatsTotal: 2,
  durationSecs: 3600,
  stageMode: 'single',
  stageIdx: 5,
  stake: 10_000_000,
  createdAt: Date.now() - 1000,
  deadline: Date.now() + 3_600_000,
  status: 'open',
  players: [plUI(ADDR58('CREATOR'), 'CREATORDEGEN', 5600)],
  winner: null,
  pot: 10_000_000,
  ...over,
});
const mkCtx = () => ({
  fillStyle: '', strokeStyle: '', lineWidth: 1,
  fillRect() {}, strokeRect() {}, drawImage() {}, clearRect() {},
  save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
});
const FAKE_ART = { gecko: [null], snek: [null], coinsnek: [null], golem: { idle: null }, bull: [null], fud: { idle: null }, boss: { idle: null } };
function renderVersus(card) {
  store.set('gonna.arena.adapter', 'mock');
  setMock({ address: ADDR58('VIEWERDEGEN'), nfts: [] });
  const ui = new ArenaUI();
  ui.current = card;
  ui.mine = [];
  ui.hots = [];
  ui.focus = -1;
  ui.busy = false;
  ui.verdict = null;
  TEXTLOG.length = 0;
  ui.drawVersus(mkCtx(), 16, FAKE_ART);
  return { texts: TEXTLOG.slice(), hots: ui.hots.map((h) => h.id) };
}
const mkArenaUI = () => {
  store.set('gonna.arena.adapter', 'mock');
  setMock({ address: ADDR58('VIEWERDEGEN'), nfts: [] });
  const ui = new ArenaUI();
  ui.hots = [];
  ui.focus = -1;
  return ui;
};

// ================= [4] THE LEVEL IS WRITTEN EVERYWHERE ======================
console.log('\n[4] FEAT: stageLabel + LV everywhere');
{
  ok(stageLabel('single', 5) === 'LV6 LAUNCHPAD', "stageLabel('single', 5) = 'LV6 LAUNCHPAD' (STAGE_NAMES[5]; owner example 'GHETTO GONNA' is actually idx 0/LV1)");
  ok(stageLabel('single', 0) === 'LV1 GHETTO GONNA', "stageLabel('single', 0) = 'LV1 GHETTO GONNA'");
  ok(stageLabel('full', null) === 'FULL RUN - ALL 7 STAGES', 'stageLabel full banner');
  // versus header carries the level
  const { texts } = renderVersus(mkCardUI({}));
  const sub = texts.find((t) => t.y === 26);
  ok(sub && sub.str === 'THE DESCENT - LV6 LAUNCHPAD', "versus header: 'THE DESCENT - LV6 LAUNCHPAD' (got '" + (sub && sub.str) + "')");
  ok(stageLabel('single', 5, false) === 'LV6 LAUNCHPAD (UNVERIFIED)', "stageLabel fallback guess: 'LV6 LAUNCHPAD (UNVERIFIED)'");
  // an UNVERIFIED versus header is marked, never presented as truth
  const unv = renderVersus(mkCardUI({ stageVerified: false }));
  const subU = unv.texts.find((t) => t.y === 26);
  ok(subU && subU.str === 'THE DESCENT - LV6 LAUNCHPAD (UNVERIFIED)', "versus header: fallback guess rendered '(UNVERIFIED)' (got '" + (subU && subU.str) + "')");

  // v15.2.8 wizard: the LV1-7 picker — NEXT gated until the creator picks
  const ui = mkArenaUI();
  ui.step = 'battle';
  ui.activate('bat:single');
  ok(ui.cfg.stageMode === 'single' && ui.shuffleT === -1, 'THE DESCENT -> picker mode (no shuffle)');
  ui.hots = [];
  TEXTLOG.length = 0;
  ui.drawLevelPicker(mkCtx(), 16, FAKE_ART);
  ok(ui.hots.filter((h) => h.id.startsWith('lvl:')).length === 7, 'picker renders 7 tappable stage icons (LV1-LV7)');
  ok(!ui.hots.some((h) => h.id === 'bat:next'), 'NEXT not armed before a pick');
  const g1 = ui.activate('bat:next');
  ok(g1.act !== 'move' && ui.step === 'battle' && ui.err === 'PICK A LEVEL FIRST', 'NEXT gated: PICK A LEVEL FIRST');
  ui.activate('lvl:5');
  ok(ui.cfg.stageIdx === 5, 'tap LV6 -> cfg.stageIdx = 5 (the creator CHOICE, committed in the note)');
  ui.hots = [];
  TEXTLOG.length = 0;
  ui.drawLevelPicker(mkCtx(), 16, FAKE_ART);
  ok(ui.hots.some((h) => h.id === 'bat:next') && TEXTLOG.some((t) => t.str === 'LV6 LAUNCHPAD'), 'after the pick: NEXT armed + selected name in gold');
  const g2 = ui.activate('bat:next');
  ok(g2.act === 'move' && ui.step === 'stake', 'NEXT moves to the stake step');

  // RANDOM: the crypto RNG deals the target; the lock commits EXACTLY like a
  // manual pick (the chain SEALS the pick — it never deals it)
  const origGRV = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = (arr) => { arr[0] = 40; return arr; }; // 40 % 7 = 5
  const ui2 = mkArenaUI();
  ui2.step = 'battle';
  ui2.activate('bat:random');
  ok(ui2.cfg.stageMode === 'random' && ui2.shuffleT === 0 && ui2.shuffleTarget === 5, 'RANDOM target dealt by crypto.getRandomValues (40 % 7 = 5)');
  crypto.getRandomValues = origGRV;
  ui2.shuffleT = 140; // reels stopped
  TEXTLOG.length = 0;
  ui2.hots = [];
  ui2.drawShuffle(mkCtx(), 140, FAKE_ART);
  ok(TEXTLOG.some((t) => t.str === 'LOCKED: LV6 LAUNCHPAD'), "wizard LOCKED line: 'LOCKED: LV6 LAUNCHPAD' (RNG-dealt, LV prefix)");
  ok(TEXTLOG.some((t) => t.str === 'RANDOM - THE SHUFFLE DEALS, THE CHAIN SEALS'), 'shuffle dim line: the chain SEALS the pick (never deals it)');
  ok(ui2.hots.some((h) => h.id === 'bat:next') && ui2.cfg.stageIdx === 5 && ui2.cfg.stageMode === 'single', 'NEXT armed once dealt; cfg.stageIdx locked to the RNG pick — identical commit state to a manual pick');
}

// ================= [5] TERMINAL UI HONESTY ==================================
console.log('\n[5] BUG-3 UI: the terminal-unknown card never prints invented numbers');
{
  const unknown = mkCardUI({
    id: 99,
    stake: NaN,
    pot: 0,
    status: 'resolved',
    winner: null,
    players: [],
  });
  const { texts } = renderVersus(unknown);
  ok(texts.some((t) => t.str === 'SETTLED - DATA ON CHAIN'), "terminal block says 'SETTLED - DATA ON CHAIN'");
  ok(!texts.some((t) => /TOOK 0/.test(t.str)), "never prints 'TOOK 0'");
  ok(!texts.some((t) => /0 \$GONNA POT/.test(t.str) || t.str === '0'), "never prints '0 $GONNA POT' (or a bare 0 pot)");
  const title = texts.find((t) => t.y === 8);
  ok(title && title.str === '— DUEL', "title renders the honest unknown: '— DUEL' (got '" + (title && title.str) + "')");
  // a SETTLED card WITH data keeps the full copy
  const settled = renderVersus(mkCardUI({ status: 'resolved', winner: ADDR58('CREATOR'), pot: 20_000_000, players: [plUI(ADDR58('CREATOR'), 'CREATORDEGEN', 5600), plUI(ADDR58('P2'), 'DEGEN TWO', 1200)] }));
  ok(settled.texts.some((t) => t.str === 'SETTLED - POT PAID ON-CHAIN') && settled.texts.some((t) => t.str === 'CREATORDEGEN TOOK 20M $GONNA'), 'known settled card keeps POT PAID + TOOK lines');
}

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
for (const f of [ENTRY_A, BUNDLE_A, ENTRY_B, WRAP_B, BUNDLE_B, KITSTUB, ORACLESTUB, OCSTUB, QASTUB]) rmSync(f, { force: true });
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
