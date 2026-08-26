// GONNA FIGHT v15.3.1 — VIEW THE PAYOUT ON-CHAIN (node-only, no browser).
//   The Principe: "voglio poter cliccare sulla transazione del vittorioso e
//   vedere realmente i fondi che si sono mossi". The battle detail badge
//   'POT PAID ON-CHAIN' was text-only; the old 'VIEW ON CHAIN' link pointed
//   at whatever the LATEST op txid was (a create/submit tx moved NO pot).
//   FIX: a dedicated CLOSE-txid memory (resolve / forfeit / claim /
//   early-close — the txs whose INNER legs move funds: winner payout + 5%
//   treasury fee + MBR refund), resolved in order:
//     (a) local close memory (WE sent the close from this browser)
//     (b) the on-chain event log (ChallengeResolved/Forfeited/Refunded name
//         the tx that emitted them — reuses the v15.2.4 indexer machinery)
//     (c) null = unknown -> honest 'TX INDEXING - RETRY' (forced refetch),
//         NEVER an invented link. Mock mode shows nothing (not on-chain).
//   The tap opens lora.algokit.io per network (testnet today, mainnet-ready
//   via ARENA_NETWORK) with window.open SYNCHRONOUSLY from the gesture —
//   the txid is PREFETCHED when the terminal card renders, because iOS
//   Safari kills window.open after an await.
//   [0] source guards · [1] URL builder per-network · [2] txid resolution
//   order · [3] UI gating + labels · [4] prefetch non-blocking + sync tap
// Run: node scripts/test-v1531.mjs   (from /mnt/agents/output/app)
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
console.log('\n[0] SOURCE: close-tx memory, per-network explorer, sync tap path');
{
  const tk = readFileSync(join(ROOT, 'src/game/arena/testnetKit.ts'), 'utf8');
  const ca = readFileSync(join(ROOT, 'src/game/arena/chainAdapter.ts'), 'utf8');
  const ui = readFileSync(join(ROOT, 'src/game/arena/arenaUI.ts'), 'utf8');
  // M-1: the constant moved to arenaKit.ts (VITE_ARENA_NETWORK build flag); testnetKit re-exports it
  const ak = readFileSync(join(ROOT, 'src/game/arena/arenaKit.ts'), 'utf8');
  ok(ak.includes("VITE_ARENA_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'") && tk.includes("export { ARENA_NETWORK, IS_MAINNET };"), 'ARENA_NETWORK centralized in arenaKit, re-exported by testnetKit (mainnet flip = build flag)');
  ok(tk.includes("return 'https://lora.algokit.io/' + network + '/transaction/' + txid;"), 'lora.algokit.io/<network>/transaction/<txid> builder');
  ok(tk.includes('export function explorerTxUrlFor(') && tk.includes('export function explorerTxUrl('), 'explorerTxUrlFor (pure, per-network) + explorerTxUrl (active network)');
  ok(tk.includes('export function recordCloseTxid(') && tk.includes('export function getCloseTxid('), 'dedicated CLOSE-txid memory (never the latest random op)');
  ok(tk.includes('export function pickCloseTxid(') && tk.includes('export function resolveCloseTxid('), 'pure event step + ordered resolver exported');
  ok(!tk.includes('perawallet.app'), 'testnetKit: the old hardcoded perawallet URL is gone');
  // the close ops record the close txid — exactly the four fund-moving paths
  const recCount = (ca.match(/kit\.recordCloseTxid\(/g) || []).length;
  ok(recCount === 4, 'chainAdapter: recordCloseTxid at RESOLVE/CLAIM/FORFEIT/EARLY CLOSE (got ' + recCount + ')');
  ok(!/label: '(CREATE|ACCEPT & STAKE|SIGN SCORE)'[^\n]*\n[^\n]*recordCloseTxid/.test(ca), 'create/join/submit NEVER record a close txid (no pot moved there)');
  ok(ca.includes('closeTxid(id: number, opts?: { force?: boolean }): Promise<string | null>;'), 'ArenaAdapter interface: closeTxid contract');
  ok(ca.includes('async closeTxid(): Promise<string | null> {\n    return null;'), 'mock adapter: honestly NO chain tx');
  ok(ca.includes('return kit.resolveCloseTxid(id, await this.closeEvents(opts?.force === true));'), 'testnet adapter: memory -> event log (30s cache, force bypass)');
  // UI labels + gating
  ok(ui.includes("'VIEW THE PAYOUT ON-CHAIN'"), "label: 'VIEW THE PAYOUT ON-CHAIN'");
  ok(ui.includes("'VIEW THE FORFEIT ON-CHAIN'") && ui.includes("'VIEW THE REFUND ON-CHAIN'"), 'labels: FORFEIT / REFUND variants for the states the UI distinguishes');
  ok(ui.includes("'TX INDEXING - RETRY'") && ui.includes('htxretry'), 'honest unknown state: TX INDEXING - RETRY (refetch, never a fake link)');
  ok(ui.includes("'LOOKING UP THE PAYOUT TX...'"), 'prefetch-in-flight state rendered');
  ok(ui.includes('private prefetchCloseTx('), 'prefetch helper exists (fires at render, never at tap)');
  ok(ui.includes("window.open(explorerTxUrl(txid), '_blank', 'noopener')"), "window.open(url, '_blank', 'noopener')");
  ok(!ui.includes('perawallet.app'), 'arenaUI: no perawallet URL left');
  // the hview button on the battle detail is the BIG primary (h=18, full width)
  ok(ui.includes("{ id: 'hview', x: 92, y: 176, w: 200, h: 18 }"), 'battle detail: hview is the large primary above BACK (200x18)');
  // STRUCTURAL: no await/.then between the tap handler and window.open
  // (line comments stripped first — the iOS-popup RULE is documented inline)
  const code = (s) => s.replace(/\/\/[^\n]*/g, '');
  const hview = code(ui.slice(ui.indexOf("if (id === 'hview') {"), ui.indexOf("if (id === 'htxretry')")));
  ok(hview.includes('window.open') && !hview.includes('await') && !hview.includes('.then('), 'hview tap path: synchronous window.open (iOS popup rule)');
  const vc = code(ui.slice(ui.indexOf("if (id === 'viewchain') {"), ui.indexOf("if (id === 'viewchain:retry')")));
  ok(vc.includes('window.open') && !vc.includes('await') && !vc.includes('.then('), 'viewchain tap path: synchronous window.open');
  const prefetch = ui.slice(ui.indexOf('private prefetchCloseTx('), ui.indexOf('private bestScore'));
  ok(!prefetch.includes('window.open'), 'prefetch NEVER opens a window (lookup only)');
}

// ================= browser-global stubs (BEFORE any bundle loads) ===========
const store = new Map();
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
};
const openCalls = [];
globalThis.window = {
  localStorage: localStorageStub,
  location: { search: '', hostname: 'localhost', pathname: '/' },
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  visualViewport: undefined,
  open: (url, target, feats) => void openCalls.push({ url, target, feats }),
};
globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {} }), body: { appendChild() {} }, activeElement: null };
globalThis.localStorage = localStorageStub;
globalThis.Image = class {};
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };

// ================= bundle: testnetKit + chainAdapter + arenaUI ==============
const { writeFileSync, rmSync } = await import('node:fs');
const ENTRY = join(ROOT, '.tmp-v1531-entry.ts');
const WRAP = join(ROOT, '.tmp-v1531-fontwrap.ts');
const BUNDLE = join(ROOT, '.tmp-v1531-bundle.mjs');
const FONT = join(ROOT, 'src/game/font');
writeFileSync(
  WRAP,
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
  ENTRY,
  "export { ARENA_NETWORK, explorerTxUrl, explorerTxUrlFor, recordTxid, getTxid, recordCloseTxid, getCloseTxid, pickCloseTxid, resolveCloseTxid } from './src/game/arena/testnetKit';\n" +
    "export { MockArenaAdapter, resetArenaAdapter } from './src/game/arena/chainAdapter';\n" +
    "export { ArenaUI } from './src/game/arena/arenaUI';\n" +
    "export { setMock } from './src/game/wallet';\n" +
    "export { TEXTLOG } from './.tmp-v1531-fontwrap';\n",
);
const esbuild = await import('esbuild');
await esbuild.build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['algosdk'],
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  outfile: BUNDLE,
  logLevel: 'silent',
  plugins: [
    {
      name: 'fontlog',
      setup(build) {
        build.onResolve({ filter: /(^|\/)font$/ }, (args) => {
          if (args.importer === WRAP) return undefined;
          const resolved = join(args.resolveDir, args.path);
          if (resolved === FONT) return { path: WRAP };
          return undefined;
        });
      },
    },
  ],
});
const mod = await import(BUNDLE);
const {
  ARENA_NETWORK, explorerTxUrl, explorerTxUrlFor, recordTxid, recordCloseTxid, getCloseTxid, pickCloseTxid, resolveCloseTxid,
  resetArenaAdapter, ArenaUI, setMock, TEXTLOG,
} = mod;

// ================= harness ==================================================
const A = (s) => (s + 'Q'.repeat(58)).slice(0, 58);
const VIEWER = A('VIEWERDEGEN');
const HIM = A('N3CVWMBATI');
const OPP = A('GONHNV3XMS');
const NOW = Date.now();
const tick = () => new Promise((r) => setTimeout(r, 0));
const mkCtx = () => ({
  fillStyle: '', strokeStyle: '', lineWidth: 1,
  fillRect() {}, strokeRect() {}, drawImage() {}, clearRect() {},
  save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
});
const has = (texts, str) => texts.some((t) => t.str === str);
const hpl = (address, score = 0) => ({ address, name: address.slice(0, 6), score });
const mkHist = (over) => ({
  id: 46, stake: 1, pot: 2, payout: 1.9, fee: 0.1, format: 'duel', stageMode: 'full', stageIdx: null,
  seats: 2, winner: HIM, winnerName: 'N3CVWM..CT2Y', players: [hpl(OPP), hpl(HIM)], resolvedAt: NOW - 60_000, claimed: true,
  ...over,
});
function mkHistUI(opts = {}) {
  store.set('gonna.arena.adapter.testnet', opts.mode ?? 'mock');
  resetArenaAdapter();
  setMock({ address: VIEWER, nfts: [] });
  const ui = new ArenaUI();
  if (opts.adapter) ui.adapter = () => opts.adapter; // shadow: fake testnet adapter, ZERO network
  return ui;
}
function drawHist(ui, h) {
  ui.histDetail = h;
  ui.hots = [];
  ui.focus = -1;
  TEXTLOG.length = 0;
  ui.drawHistCard(mkCtx(), 0);
  return { ui, texts: TEXTLOG.slice(), hots: ui.hots.map((x) => x.id) };
}
const renderHistCard = (h, opts = {}) => drawHist(mkHistUI(opts), h);

// ================= [1] URL builder per-network ==============================
console.log('\n[1] explorer URL builder: per-network, mainnet-ready');
{
  ok(ARENA_NETWORK === 'testnet', "active network is testnet (app 769767443 era)");
  ok(explorerTxUrlFor('testnet', 'TXIDABC') === 'https://lora.algokit.io/testnet/transaction/TXIDABC', 'testnet -> lora.algokit.io/testnet/transaction/<TXID>');
  ok(explorerTxUrlFor('mainnet', 'TXIDABC') === 'https://lora.algokit.io/mainnet/transaction/TXIDABC', 'mainnet -> lora.algokit.io/mainnet/transaction/<TXID> (no code change needed at the flip)');
  ok(explorerTxUrl('TXIDABC') === 'https://lora.algokit.io/testnet/transaction/TXIDABC', 'explorerTxUrl follows ARENA_NETWORK');
}

// ================= [2] txid resolution order ================================
console.log('\n[2] txid resolution: memory > indexer event > none (cached)');
{
  const ev = (cid, txid, round, kind = 'resolved') => ({ cid, kind, winner: HIM, payout: 1.9e6, fee: 0.1e6, reason: null, txid, round, at: NOW });
  ok(resolveCloseTxid(7, []) === null && getCloseTxid(7) === null, 'unknown cid, no events -> null, nothing banked (honest no-link)');
  ok(resolveCloseTxid(8, [ev(8, 'EVTX8', 100)]) === 'EVTX8', 'event log hit -> the tx that emitted the close event');
  ok(getCloseTxid(8) === 'EVTX8', 'event txid BANKED into close memory (never re-scanned)');
  recordCloseTxid(9, 'MEMTX9');
  ok(resolveCloseTxid(9, [ev(9, 'EVTX9', 100)]) === 'MEMTX9', 'local memory BEATS the event log (we sent the close ourselves)');
  ok(pickCloseTxid(10, [ev(10, 'OLD', 90), ev(10, 'NEW', 110), ev(11, 'OTHER', 120)]) === 'NEW', 'pickCloseTxid: highest round of THIS cid only');
  ok(pickCloseTxid(10, [ev(10, 'REFUNDTX', 50, 'refunded')]) === 'REFUNDTX', 'a REFUNDED event (claim/early-close/sweep) is a fund-moving tx too');
  ok(pickCloseTxid(12, [ev(11, 'OTHER', 120)]) === null, 'events for other cids ignored');
  // the legacy latest-op map must NEVER back the payout link
  recordTxid(13, 'SUBMITTX13');
  ok(getCloseTxid(13) === null && resolveCloseTxid(13, []) === null, 'a submit/create txid (latest-op memory) does NOT feed the payout link');
}

// ================= [3] UI gating + labels ===================================
console.log('\n[3] battle detail: the button only with a real close txid');
{
  // (a) THE PRINCIPE'S SCREENSHOT: settled duel, close txid known -> big gold button
  recordCloseTxid(46, 'RESOLVETX46');
  const a = renderHistCard(mkHist({}));
  ok(a.hots.includes('hview'), 'settled + txid known: hview hotspot pushed');
  ok(has(a.texts, 'VIEW THE PAYOUT ON-CHAIN'), "label: 'VIEW THE PAYOUT ON-CHAIN'");
  ok(has(a.texts, 'POT PAID ON-CHAIN') && has(a.texts, 'N3CVWM..CT2Y WON THE POT'), 'screenshot copy intact (badge + WON THE POT)');
  // (b) forfeit entry -> FORFEIT label
  recordCloseTxid(47, 'FORFEITTX47');
  const b = renderHistCard(mkHist({ id: 47, forfeited: true, payout: 0.95, fee: 0.05 }));
  ok(has(b.texts, 'VIEW THE FORFEIT ON-CHAIN'), 'forfeit battle: VIEW THE FORFEIT ON-CHAIN');
  // (c) tie -> REFUND label
  recordCloseTxid(48, 'TIETX48');
  const c = renderHistCard(mkHist({ id: 48, winner: '', winnerName: 'TIE - ALL REFUNDED', payout: 0, fee: 0 }));
  ok(has(c.texts, 'VIEW THE REFUND ON-CHAIN'), 'tie battle: VIEW THE REFUND ON-CHAIN');
  // (d) mock + NO txid -> honest nothing (mock is not on-chain: no fake retry)
  const d = renderHistCard(mkHist({ id: 49 }));
  ok(!d.hots.includes('hview') && !d.hots.includes('htxretry'), 'mock + no txid: no link, no retry (mock is not on-chain)');
  ok(!has(d.texts, 'LOOKING UP THE PAYOUT TX...'), 'mock: no lookup line either');
  // (e) testnet + indexer miss -> LOOKUP, then honest TX INDEXING - RETRY
  let calls = 0;
  const miss = { mode: 'testnet', closeTxid: () => { calls++; return Promise.resolve(null); } };
  const uiE = mkHistUI({ adapter: miss }); // SAME instance across renders (the prefetch state lives on it)
  const e1 = drawHist(uiE, mkHist({ id: 50 }));
  ok(!e1.hots.includes('hview') && has(e1.texts, 'LOOKING UP THE PAYOUT TX...'), 'testnet, txid unknown: lookup in flight, no fake link yet');
  await tick();
  const e2 = drawHist(uiE, mkHist({ id: 50 }));
  ok(e2.hots.includes('htxretry') && has(e2.texts, 'TX INDEXING - RETRY'), 'indexer miss -> honest TX INDEXING - RETRY button');
  uiE.activate('htxretry');
  ok(calls === 2, 'RETRY re-asks the indexer (forced refetch)');
  // (f) testnet + event hit -> the button appears on the next render
  const hit = {
    mode: 'testnet',
    closeTxid: (id) => { recordCloseTxid(id, 'EVENTTX51'); return Promise.resolve('EVENTTX51'); }, // banks like the real adapter
  };
  const uiF = mkHistUI({ adapter: hit });
  const f1 = drawHist(uiF, mkHist({ id: 51 }));
  ok(has(f1.texts, 'LOOKING UP THE PAYOUT TX...') && !f1.hots.includes('hview'), 'event hit pending: still the honest lookup line');
  await tick();
  const f2 = drawHist(uiF, mkHist({ id: 51 }));
  ok(f2.hots.includes('hview') && has(f2.texts, 'VIEW THE PAYOUT ON-CHAIN'), 'txid landed -> VIEW THE PAYOUT ON-CHAIN rendered');
}

// ================= [4] prefetch non-blocking + the tap is synchronous =======
console.log('\n[4] prefetch never blocks the render; the tap never awaits');
{
  // a lookup that never resolves during the render: drawHistCard returns anyway
  let resolveGate;
  const gate = new Promise((r) => (resolveGate = r));
  let calls = 0;
  const slow = { mode: 'testnet', closeTxid: () => { calls++; return gate; } };
  const uiS = mkHistUI({ adapter: slow }); // SAME instance: the in-flight guard lives on it
  const s1 = drawHist(uiS, mkHist({ id: 52 }));
  ok(has(s1.texts, 'LOOKING UP THE PAYOUT TX...'), 'slow indexer: the card RENDERS (non-blocking prefetch)');
  drawHist(uiS, mkHist({ id: 52 }));
  ok(calls === 1, 'one lookup in flight per cid (no indexer hammering across frames)');
  resolveGate(null);
  await tick();
  // the tap itself: window.open fires synchronously with the lora URL
  openCalls.length = 0;
  recordCloseTxid(53, 'TAPTX53');
  const t = renderHistCard(mkHist({ id: 53 }));
  t.ui.activate('hview');
  ok(openCalls.length === 1, 'hview tap -> exactly one window.open');
  ok(
    openCalls[0] && openCalls[0].url === 'https://lora.algokit.io/testnet/transaction/TAPTX53' && openCalls[0].target === '_blank' && openCalls[0].feats === 'noopener',
    "tap opens lora testnet tx in a new tab with noopener",
  );
  // no txid in hand -> the guard never opens an invented link
  openCalls.length = 0;
  const g = renderHistCard(mkHist({ id: 54 }));
  g.ui.activate('hview');
  ok(openCalls.length === 0, 'hview with no close txid: window.open NEVER fires (no invented link)');
  // the live card detail (versus) settled branch + the closed card branch
  store.set('gonna.arena.adapter.testnet', 'mock');
  resetArenaAdapter();
  setMock({ address: VIEWER, nfts: [] });
  const FIGHTER = { skin: 'gonna', assetId: null, name: 'GONNA' };
  const pl = (address, score) => ({ address, name: address.slice(0, 6), score, fighter: FIGHTER, accountType: 'ed25519' });
  recordCloseTxid(55, 'VERSUSTX55');
  const ui = new ArenaUI();
  ui.current = {
    id: 55, creator: HIM, creatorName: 'HIM', creatorType: 'ed25519', visibility: 'public', format: 'duel', seatsTotal: 2,
    durationSecs: 3600, stageMode: 'full', stageIdx: null, stake: 1, createdAt: NOW - 1000, deadline: NOW + 1000,
    status: 'resolved', players: [pl(HIM, 5600), pl(OPP, 1200)], winner: HIM, pot: 2,
  };
  ui.mine = [];
  ui.hots = [];
  ui.focus = -1;
  ui.busy = false;
  ui.verdict = null;
  TEXTLOG.length = 0;
  ui.drawVersus(mkCtx(), 16, null);
  ok(ui.hots.some((h) => h.id === 'viewchain') && TEXTLOG.some((t) => t.str === 'VIEW THE PAYOUT ON-CHAIN'), 'versus settled card: VIEW THE PAYOUT ON-CHAIN (viewchain)');
  // closed (refunded) card -> REFUND label on viewchain
  recordCloseTxid(56, 'CLOSETX56');
  const ui2 = new ArenaUI();
  ui2.current = { ...ui.current, id: 56, status: 'closed', winner: null, forfeited: false };
  ui2.mine = [];
  ui2.hots = [];
  ui2.focus = -1;
  ui2.busy = false;
  ui2.verdict = null;
  TEXTLOG.length = 0;
  ui2.drawVersus(mkCtx(), 16, null);
  ok(TEXTLOG.some((t) => t.str === 'VIEW THE REFUND ON-CHAIN'), 'closed card: VIEW THE REFUND ON-CHAIN');
  const ui3 = new ArenaUI();
  ui3.current = { ...ui.current, id: 56, status: 'closed', winner: null, forfeited: true };
  ui3.mine = [];
  ui3.hots = [];
  ui3.focus = -1;
  ui3.busy = false;
  ui3.verdict = null;
  TEXTLOG.length = 0;
  ui3.drawVersus(mkCtx(), 16, null);
  ok(TEXTLOG.some((t) => t.str === 'VIEW THE FORFEIT ON-CHAIN'), 'forfeited closed card: VIEW THE FORFEIT ON-CHAIN');
}

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
for (const f of [ENTRY, WRAP, BUNDLE]) rmSync(f, { force: true });
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
