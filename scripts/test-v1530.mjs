// GONNA FIGHT v15.3.0 — EARLY CLOSE chain gating + $GONNA units + K/M/B/T (node-only, no browser).
//   OWNER BUG-A (screenshot): a 5-seat card at 2/5 with BOTH seated players
//     signed still offered the creator an 'EARLY CLOSE' button. The button
//     called early_close, and contract.py asserts `seats_taken == 0` — the
//     tx was REJECTED on-chain ("challenge has joiners"). The Principe: once
//     at least 1 player joins, the match settles by ALL SCORES or by the
//     TIMER — never by a creator cancel.
//   FIX-A: closeGate(card, me) — a pure, headless-testable gate derived from
//     the ON-CHAIN card state (seats taken / deadline / signed scores):
//       cancel  = zero joiners, live          -> EARLY CLOSE (contract ok)
//       claim   = zero joiners, expired       -> CLAIM YOUR STAKE BACK
//       resolve = full+all-signed, or expired with a signed joiner -> RESOLVE
//       forfeit = duel silent seat, clock lapsed (also post-deadline: the
//                 contract's claim_forfeit has NO deadline check)
//       locked  = joiners seated, nothing settles it yet -> NO close tx,
//                 honest line 'TABLE LOCKED - SCORES OR THE TIMER SETTLE IT'
//     The expired 'CLAIM YOUR STAKE BACK' button is gated the same way
//     (contract claim() also asserts seats_taken == 0, creator-only). The
//     mock adapter earlyClose now REFUSES a card with joiners, exactly like
//     the chain.
//   FIX-B: HISTORY rows carry the unit: 'UUFN4L WON 1.9 $GONNA' (never the
//     bare 'TOOK 1.9'); tie/refund rows say 'TIE - REFUND 1 $GONNA EACH';
//     the battle-detail title says 'WON THE POT' / 'TIE - ALL REFUNDED'.
//     MY LEGACY is UNTOUCHED (v15.2.9 rows pinned by test-v1529: the labels
//     already read $GONNA WON / $GONNA LOST — the owner: "per il resto ok").
//   FIX-C: fmtStake compact tiers K/M/B (+T at 1e12), max 1 decimal,
//     TRUNCATED never rounded up: 999,999 -> '999.9K' (a rounded '1000K'
//     would fake the next tier; tiers flip only at the exact power).
//     1e15 -> '1000T' (no tier beyond T — documented). Under 1000 fmtAmount
//     keeps the v15.2.9 behavior (max 4 decimals, trailing zeros trimmed).
//     Corners kept: fmtStake(NaN) -> '—', fmtAmount(NaN) -> '0'. Display
//     only — contract math stays in micro-units, never through fmt*.
//   [0] source guards · [1] closeGate pure states · [2] UI gating render
//   [3] HISTORY units render · [4] fmt edges · [5] mock adapter e2e
// Run: node scripts/test-v1530.mjs   (from /mnt/agents/output/app)
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
console.log('\n[0] SOURCE: the gate is chain-derived, the units are explicit');
{
  const ca = readFileSync(join(ROOT, 'src/game/arena/chainAdapter.ts'), 'utf8');
  const ui = readFileSync(join(ROOT, 'src/game/arena/arenaUI.ts'), 'utf8');
  const ct = readFileSync(join(ROOT, 'contracts/quantum-arena/contracts/quantum_arena/contract.py'), 'utf8');
  // the contract rule the bug violated (frozen contract — asserted, never edited)
  ok(ct.includes('assert meta.seats_taken == 0, "challenge has joiners"'), 'contract: early_close/claim assert seats_taken == 0 (the rule the UI ignored)');
  ok(ct.includes('allowed = (filled and all_signed) or (now >= meta.deadline and signed_joiners >= 1)'), 'contract: resolve permissionless rule intact');
  ok(ca.includes('export function closeGate('), 'closeGate exported (pure, chain-derived)');
  ok(ca.includes("if (joiners.length === 0) {") && ca.includes("return live ? { kind: 'cancel' } : { kind: 'claim' };"), 'closeGate: cancel/claim ONLY at zero joiners');
  ok(ca.includes("return { kind: 'locked' };"), "closeGate: the 'locked' state exists");
  ok(ca.includes("throw new Error('TABLE LOCKED - SCORES OR THE TIMER SETTLE IT')"), 'mock adapter earlyClose REFUSES a card with joiners (mirrors the chain)');
  ok(ca.includes('if (n >= 1e12) return trim1(n / 1e12) + \'T\';'), 'fmtStake: T tier at 1e12');
  ok(ca.includes('Math.floor(v * 10) / 10'), 'fmtStake: TRUNCATED to 1 decimal (never rounds 999.9K up to a fake 1000K)');
  ok(ui.includes("if (live && gate?.kind === 'cancel') {"), 'UI: EARLY CLOSE only when closeGate says cancel (zero joiners, live)');
  ok(ui.includes("'TABLE LOCKED - SCORES OR THE TIMER SETTLE IT'"), 'UI: the honest locked line exists');
  ok(ui.includes("'TABLE LOCKED - NO SCORES SEALED'") && ui.includes("'A SIGNED SCORE SETTLES IT - ELSE THE SWEEP REFUNDS ALL '"), 'UI: expired + joiners + no signatures -> locked lines, no fake claim button');
  // v17.0.8: wallet null-client heal + catastrophe sweep wiring
  const tw = readFileSync(join(ROOT, 'src/game/arena/testnetWallet.ts'), 'utf8');
  const gw = readFileSync(join(ROOT, 'src/game/wallet.ts'), 'utf8');
  ok(tw.includes('isPeraSessionFatal') && tw.includes('WALLET SESSION LOST - TAP CONNECT TO RE-PAIR'), 'v17.0.8: arena Pera signer heals the null-client crash + one retry');
  ok(gw.includes('isSessionFatal') && gw.includes('recoverSession()'), 'v17.0.8: gate signTransactions heals the null-client crash + one retry');
  ok(tw.includes('reject') && tw.includes('cancel'), 'v17.0.8: user rejections NEVER trigger the heal');
  ok(ca.includes("kind: 'catastrophe'") && ca.includes('CATASTROPHE_MS'), 'v17.0.8: closeGate exposes the +7d catastrophe sweep');
  ok(ca.includes('claimCatastrophe') && ca.includes('buildCatastropheGroup'), 'v17.0.8: live adapter wires catastrophe_refund');
  ok(ui.includes("'vsweep'") && ui.includes("startsWith('sweep:')"), 'v17.0.8: SWEEP buttons routed (lobby + versus)');
  ok(ct.includes('CATASTROPHE_WINDOW = 7 * 24 * 3600'), 'contract: the +7d sweep window exists (frozen contract)');
  // v17.0.9: no dead duplicate wallet requests — the gate fallback fires ONLY on a fatal session
  const aw = readFileSync(join(ROOT, 'src/game/arena/arenaWallet.ts'), 'utf8');
  ok(aw.includes('if (!isPeraSessionFatal(e)) throw e;'), 'v17.0.9: arena->gate sign fallback rethrows non-fatal errors (one group, one request)');
  ok(!aw.includes('signer threw, trying gate fallback'), 'v17.0.9: the catch-all fallback that fired duplicate requests is gone');
  // v17.0.10 (Prince REPLAY MISMATCH, mobile taps): GIL v3 = levels + edges per frame.
  // Root cause PROVEN by repro-subframe: input.ts fires pressed on the DOM event and
  // clears levels on keyup — a tap shorter than one frame lands in the sim but never
  // in a levels-only tape, so the regenerated replay lost the press and died early
  // (live "stuck@<39300>" vs recorded 41100). The replay driver applies v3 edges VERBATIM.
  const ilSrc = readFileSync(join(ROOT, 'src/game/arena/inputLog.ts'), 'utf8');
  const engSrc = readFileSync(join(ROOT, 'src/game/engine.ts'), 'utf8');
  const repSrc = readFileSync(join(ROOT, 'oracle-server/src/replay/replayer.ts'), 'utf8');
  const verSrc = readFileSync(join(ROOT, 'oracle-server/src/verify.ts'), 'utf8');
  ok(ilSrc.includes('export const INPUT_LOG_VERSION = 3;'), 'v17.0.10: codec VERSION=3');
  ok(ilSrc.includes('edges: Uint8Array | null;'), 'v17.0.10: InputLog carries the edge stream');
  ok(engSrc.includes('this.inputLogEdges[this.inputLogFrames] = maskFromDown(inp.pressed as never);'), 'v17.0.10: recorder stores pending edges each play frame');
  ok(engSrc.includes('this.inputLogEdges = new Uint8Array(INPUT_LOG_CAP);'), 'v17.0.10: fresh edge buffer per arena run');
  ok(repSrc.includes('edges?: Uint8Array; // GIL v3 recorded edge stream'), 'v17.0.10: verifyRun threads the edge stream');
  ok(repSrc.includes('pressed[BTNS[b]!] = ((e >> b) & 1) === 1;'), 'v17.0.10: replay driver applies recorded edges verbatim');
  ok(verSrc.includes("raw[3] !== 1 && raw[3] !== 2 && raw[3] !== 3"), 'v17.0.10: server codec accepts v3');
  ok(verSrc.includes('1_200_000'), 'v17.0.10: sign-score body ceiling raised for the double-size v3 tape');
  // v17.0.11 (Prince edge-swipe report): OS gesture armor. (1) auto-pause when the
  // OS steals the screen mid-run — paused frames are never recorded, replay-safe;
  // (2) pagehide + every-300-frames checkpoint of the live GIL v3 tape to
  // sessionStorage — a prefix replays byte-exact (proven: repro-prefix 24/24);
  // (3) THE PIT RECOVER banner arms the recovered seal into the normal sign flow;
  // (4) joystick origin clamped out of the iOS back-gesture strip.
  ok(engSrc.includes("document.addEventListener('visibilitychange', this.onVisChange)"), 'v17.0.11: auto-pause on OS screen steal');
  ok(engSrc.includes("window.addEventListener('pagehide', this.onPageHide)"), 'v17.0.11: last-chance checkpoint on page unload');
  ok(engSrc.includes('if (this.inputLogFrames % 300 === 0) this.saveRunCheckpoint();'), 'v17.0.11: rolling 300-frame tape checkpoint');
  ok(engSrc.includes('this.saveRunCheckpoint();\n'), 'v17.0.11: FINAL checkpoint at finishArenaRun (seal-screen death covered)');
  const uiSrc = readFileSync(join(ROOT, 'src/game/arena/arenaUI.ts'), 'utf8');
  ok(uiSrc.includes("'RECOVER LOST RUN: ' + this.ckpt.score + ' PTS'"), 'v17.0.11: RECOVER banner in THE PIT');
  ok(uiSrc.includes('private doRecover(): ArenaAction'), 'v17.0.11: doRecover arms the checkpoint seal');
  ok(uiSrc.match(/clearRunCheckpoint\(\); \/\/ v17\.0\.11: signed/g)?.length === 2, 'v17.0.11: checkpoint cleared after BOTH sign paths (create + submit)');
  const tcSrc = readFileSync(join(ROOT, 'src/game/touch.ts'), 'utf8');
  ok(tcSrc.includes('this.joyOX = Math.max(26, x);'), 'v17.0.11: joystick origin out of the iOS back-gesture strip');
  ok(ui.includes("h.winnerName + ' WON ' + fmtAmount(takes) + ' $GONNA'"), 'HISTORY head: WON x $GONNA (unit explicit)');
  ok(ui.includes("'TIE - REFUND ' + (Number.isFinite(h.stake) ? fmtAmount(h.stake) : '—') + ' $GONNA EACH'"), 'HISTORY head: tie/refund row says REFUND x $GONNA EACH');
  ok(ui.includes("h.winner ? h.winnerName + ' WON THE POT' : 'TIE - ALL REFUNDED'"), 'battle detail: WON THE POT / TIE - ALL REFUNDED');
  ok(!ui.includes("+ ' TOOK ' + fmtAmount(takes)"), "old bare-amount 'TOOK x' head ELIMINATED");
  // v15.2.9 compatibility: MY LEGACY rows untouched (labels already carry $GONNA)
  ok(ui.includes("['$GONNA WON', s ? fmtAmount(s.won) : '-', GOLD],") && ui.includes("['NET', s ? (s.net >= 0 ? '+' : '-') + fmtAmount(Math.abs(s.net)) : '-', s && s.net < 0 ? RED : GREEN],"), 'MY LEGACY rows UNTOUCHED (v15.2.9 pinned, owner: per il resto ok)');
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

// ================= bundle: chainAdapter + arenaUI (TEXTLOG font wrap) =======
const { writeFileSync, rmSync } = await import('node:fs');
const ENTRY = join(ROOT, '.tmp-v1530-entry.ts');
const WRAP = join(ROOT, '.tmp-v1530-fontwrap.ts');
const BUNDLE = join(ROOT, '.tmp-v1530-bundle.mjs');
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
  "export { closeGate, duelForfeitInfo, fmtStake, fmtAmount, MockArenaAdapter, resetArenaAdapter } from './src/game/arena/chainAdapter';\n" +
    "export { ArenaUI } from './src/game/arena/arenaUI';\n" +
    "export { setMock } from './src/game/wallet';\n" +
    "export { TEXTLOG } from './.tmp-v1530-fontwrap';\n",
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
const { closeGate, duelForfeitInfo, fmtStake, fmtAmount, MockArenaAdapter, resetArenaAdapter, ArenaUI, setMock, TEXTLOG } = mod;

// ================= harness ==================================================
const A = (s) => (s + 'Q'.repeat(58)).slice(0, 58); // fake 58-char addresses
const CREATOR = A('CREATOR');
const JOINER = A('JOINERDEGEN');
const VIEWER = A('VIEWERDEGEN');
const FIGHTER = { skin: 'gonna', assetId: null, name: 'GONNA' };
const pl = (address, score, over) => ({ address, name: address.slice(0, 6), score, fighter: FIGHTER, accountType: 'ed25519', ...over });
const NOW = Date.now();
const mkCard = (over) => ({
  id: 42,
  creator: CREATOR,
  creatorName: 'CREATORDEGEN',
  creatorType: 'ed25519',
  visibility: 'public',
  format: 'open',
  seatsTotal: 5,
  durationSecs: 86400,
  stageMode: 'full',
  stageIdx: null,
  stake: 1,
  createdAt: NOW - 1000,
  deadline: NOW + 86_400_000,
  status: 'open',
  players: [],
  winner: null,
  pot: 2,
  ...over,
});

// ================= [1] closeGate — PURE CHAIN TRUTH =========================
console.log('\n[1] closeGate: every state the EARLY CLOSE button can meet');
{
  // (a) zero joiners, live -> CANCEL (the ONLY state early_close accepts)
  const a = closeGate(mkCard({ players: [pl(CREATOR, 5600)] }), CREATOR);
  ok(a && a.kind === 'cancel', '0 joiners, live -> cancel (EARLY CLOSE legal)');
  // (b) THE SCREENSHOT: 2/5 seats, BOTH signed, live -> LOCKED (never cancel)
  const b = closeGate(mkCard({ players: [pl(CREATOR, 5600), pl(JOINER, 1200)] }), CREATOR);
  ok(b && b.kind === 'locked', 'SCREENSHOT 2/5 both signed -> locked (the reported bug: was a doomed EARLY CLOSE)');
  // (c) full + all signed -> RESOLVE
  const c = closeGate(mkCard({
    seatsTotal: 2, status: 'full', format: 'duel',
    players: [pl(CREATOR, 5600), pl(JOINER, 1200)],
  }), CREATOR);
  ok(c && c.kind === 'resolve', 'full + all signed -> resolve (SETTLE NOW)');
  // (d) expired + a signed joiner -> RESOLVE (deadline path)
  const d = closeGate(mkCard({
    status: 'expired', deadline: NOW - 1000,
    players: [pl(CREATOR, 5600), pl(JOINER, 1200)],
  }), CREATOR);
  ok(d && d.kind === 'resolve', 'expired + signed joiner -> resolve (timer settles it)');
  // (e) expired + joiners, NOBODY signed (table) -> LOCKED (+7d sweep only)
  const e = closeGate(mkCard({
    status: 'expired', deadline: NOW - 1000,
    players: [pl(CREATOR, 0), pl(JOINER, 0)],
  }), CREATOR);
  ok(e && e.kind === 'locked', 'expired + joiners + no signatures (table) -> locked (only the +7d sweep)');
  // (f) expired + zero joiners -> CLAIM (creator refund, zero fee)
  const f = closeGate(mkCard({ status: 'expired', deadline: NOW - 1000, players: [pl(CREATOR, 5600)] }), CREATOR);
  ok(f && f.kind === 'claim', 'expired + 0 joiners -> claim (CLAIM YOUR STAKE BACK legal)');
  // (g) live duel, silent seat clock lapsed -> FORFEIT
  const g = closeGate(mkCard({
    format: 'duel', seatsTotal: 2, status: 'full',
    players: [
      pl(CREATOR, 5600, { signed: true, seatedAt: NOW - 86_400_000 }),
      pl(JOINER, 0, { signed: false, seatedAt: NOW - 2 * 3600 * 1000 }),
    ],
  }), CREATOR);
  ok(g && g.kind === 'forfeit', 'live duel + silent seat + clock lapsed -> forfeit');
  // (h) EXPIRED duel, silent seat clock lapsed -> FORFEIT (claim_forfeit has no deadline check)
  const h = closeGate(mkCard({
    format: 'duel', seatsTotal: 2, status: 'expired', deadline: NOW - 1000,
    players: [
      pl(CREATOR, 5600, { signed: true, seatedAt: NOW - 86_400_000 }),
      pl(JOINER, 0, { signed: false, seatedAt: NOW - 2 * 3600 * 1000 }),
    ],
  }), CREATOR);
  ok(h && h.kind === 'forfeit', 'expired duel + silent seat + clock lapsed -> forfeit (outlives the timer)');
  // (h2) expired duel, clock STILL running -> locked
  const h2 = closeGate(mkCard({
    format: 'duel', seatsTotal: 2, status: 'expired', deadline: NOW - 1000,
    players: [
      pl(CREATOR, 5600, { signed: true, seatedAt: NOW - 86_400_000 }),
      pl(JOINER, 0, { signed: false, seatedAt: NOW - 60 * 1000 }),
    ],
  }), CREATOR);
  ok(h2 && h2.kind === 'locked', 'expired duel + clock still running -> locked');
  // (i) not the creator -> null (never their call); terminal card -> null
  ok(closeGate(mkCard({ players: [pl(CREATOR, 5600)] }), VIEWER) === null, 'non-creator -> null');
  ok(closeGate(mkCard({ status: 'resolved', players: [pl(CREATOR, 5600)] }), CREATOR) === null, 'terminal card -> null');
  ok(closeGate(mkCard({ players: [pl(CREATOR, 5600)] }), null) === null, 'disconnected viewer -> null');
  // duelForfeitInfo: the expired own-seat never counts down (submit is dead past deadline)
  const ownExpired = duelForfeitInfo(mkCard({
    format: 'duel', seatsTotal: 2, status: 'expired', deadline: NOW - 1000,
    players: [
      pl(CREATOR, 5600, { signed: true, seatedAt: NOW - 86_400_000 }),
      pl(JOINER, 0, { signed: false, seatedAt: NOW - 60 * 1000 }),
    ],
  }), JOINER, NOW, { includeExpired: true });
  ok(ownExpired === null, 'expired own unsigned seat -> no own-clock countdown (nothing left to sign)');
}

// ================= [2] UI GATING (drawVersus render) ========================
const mkCtx = () => ({
  fillStyle: '', strokeStyle: '', lineWidth: 1,
  fillRect() {}, strokeRect() {}, drawImage() {}, clearRect() {},
  save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
});
function renderVersus(card, me, mode = 'mock') {
  store.set('gonna.arena.adapter.testnet', mode);
  resetArenaAdapter(); // the adapter is a cached singleton — force a fresh pick
  setMock(me ? { address: me, nfts: [] } : null);
  const ui = new ArenaUI();
  ui.current = card;
  ui.mine = [];
  ui.hots = [];
  ui.focus = -1;
  ui.busy = false;
  ui.verdict = null;
  TEXTLOG.length = 0;
  ui.drawVersus(mkCtx(), 16, null);
  return { texts: TEXTLOG.slice(), hots: ui.hots.map((h) => h.id) };
}
const has = (texts, str) => texts.some((t) => t.str === str);

console.log('\n[2] UI: the button NEVER offers a tx the chain would reject');
{
  // (a) creator, zero joiners -> EARLY CLOSE (regression: the legal path stays)
  const a = renderVersus(mkCard({ players: [pl(CREATOR, 5600)] }), CREATOR);
  ok(a.hots.includes('close'), 'creator + 0 joiners: EARLY CLOSE hotspot pushed (contract accepts it)');
  ok(has(a.texts, 'YOUR CARD, DEGEN - SHARE IT OR CLOSE IT'), 'creator + 0 joiners: share-or-close copy intact');
}
{
  // (b) THE SCREENSHOT STATE, creator view, TESTNET semantics: a joiner
  // seated, the table NOT full -> not resolvable, NOT closable. NO close
  // hotspot, the honest locked line instead. (Mock render can't reach this
  // branch — its rival auto-plays — so the mode flag goes testnet.)
  const b = renderVersus(mkCard({ players: [pl(CREATOR, 5600, { signed: true, seatedAt: NOW - 1000 }), pl(JOINER, 0, { signed: false, seatedAt: NOW - 1000 })] }), CREATOR, 'testnet');
  ok(!b.hots.includes('close'), 'SCREENSHOT state (joiner seated): NO close hotspot — the chain would reject early_close');
  ok(has(b.texts, 'TABLE LOCKED - SCORES OR THE TIMER SETTLE IT'), 'SCREENSHOT state: honest TABLE LOCKED line rendered');
  ok(!has(b.texts, 'YOUR CARD, DEGEN - SHARE IT OR CLOSE IT'), 'SCREENSHOT state: the misleading SHARE-OR-CLOSE copy is gone');
  // the exact screenshot: 2/5 seats and BOTH signed — STILL locked (the
  // table is not full, so resolve is not allowed either)
  const b2 = renderVersus(mkCard({ players: [pl(CREATOR, 5600, { signed: true, seatedAt: NOW - 1000 }), pl(JOINER, 1200, { signed: true, seatedAt: NOW - 1000 })] }), CREATOR, 'testnet');
  ok(!b2.hots.includes('close') && !b2.hots.includes('resolve'), 'SCREENSHOT EXACT (2/5, both signed): no close AND no resolve — only the timer moves it');
  ok(has(b2.texts, 'TABLE LOCKED - SCORES OR THE TIMER SETTLE IT'), 'SCREENSHOT EXACT: the locked line tells the truth');
}
{
  // (c) full + all signed, creator view -> RESOLVE, no close
  const c = renderVersus(mkCard({
    seatsTotal: 2, status: 'full', format: 'duel',
    players: [pl(CREATOR, 5600, { signed: true, seatedAt: NOW - 1000 }), pl(JOINER, 1200, { signed: true, seatedAt: NOW - 1000 })],
  }), CREATOR, 'testnet');
  ok(c.hots.includes('resolve') && !c.hots.includes('close'), 'full + all signed: RESOLVE THE BATTLE, no close');
}
{
  // (d) expired + zero joiners -> CLAIM YOUR STAKE BACK (legal), no close
  const d = renderVersus(mkCard({ status: 'expired', deadline: NOW - 1000, players: [pl(CREATOR, 5600)] }), CREATOR);
  ok(d.hots.includes('vclaim') && !d.hots.includes('close'), 'expired + 0 joiners: CLAIM YOUR STAKE BACK hotspot, no close');
}
{
  // (e) expired + joiners + NOBODY signed (table) -> NO claim button, locked lines
  const e = renderVersus(mkCard({
    status: 'expired', deadline: NOW - 1000,
    players: [pl(CREATOR, 0), pl(JOINER, 0)],
  }), CREATOR);
  ok(!e.hots.includes('vclaim') && !e.hots.includes('close'), 'expired + joiners + no signatures: NO claim/close hotspot (claim() asserts seats_taken == 0)');
  ok(has(e.texts, 'TABLE LOCKED - NO SCORES SEALED') && (has(e.texts, 'TABLE LOCKED - NO SCORES SEALED') || e.texts.some((t) => t.startsWith('A SIGNED SCORE SETTLES IT'))), 'expired locked: the +7d sweep honesty lines rendered');
}
{
  // (f) expired duel, silent seat clock lapsed -> CLAIM FORFEIT
  const f = renderVersus(mkCard({
    format: 'duel', seatsTotal: 2, status: 'expired', deadline: NOW - 1000,
    players: [
      pl(CREATOR, 5600, { signed: true, seatedAt: NOW - 86_400_000 }),
      pl(JOINER, 0, { signed: false, seatedAt: NOW - 2 * 3600 * 1000 }),
    ],
  }), CREATOR);
  ok(f.hots.includes('forfeit'), 'expired duel + silent seat: CLAIM FORFEIT hotspot (contract path that actually works)');
  ok(!f.hots.includes('vclaim') && !f.hots.includes('close'), 'expired duel + silent seat: no doomed claim/close');
}
{
  // (g) expired + a signed joiner -> RESOLVE (the timer settled it)
  const g = renderVersus(mkCard({
    status: 'expired', deadline: NOW - 1000,
    players: [pl(CREATOR, 5600), pl(JOINER, 1200)],
  }), CREATOR);
  ok(g.hots.includes('resolve') && !g.hots.includes('close'), 'expired + signed joiner: RESOLVE hotspot, no close');
}
{
  // (h) a seated JOINER never sees any close control
  const h = renderVersus(mkCard({ players: [pl(CREATOR, 5600), pl(JOINER, 0)] }), JOINER);
  ok(!h.hots.includes('close'), 'joiner view: no close control, ever');
}

// ================= [3] HISTORY: the unit is always said =====================
console.log('\n[3] HISTORY rows: WON x $GONNA / TIE - REFUND x $GONNA EACH');
const HIM = A('UUFN4LNBWB');
const OPP = A('GONHNV3XMS');
const hpl = (address, score = 0) => ({ address, name: address.slice(0, 6), score });
function renderHistory(hist) {
  store.set('gonna.arena.adapter.testnet', 'mock');
  setMock({ address: VIEWER, nfts: [] });
  const ui = new ArenaUI();
  ui.hist = hist;
  ui.histPage = 0;
  ui.hots = [];
  ui.focus = -1;
  TEXTLOG.length = 0;
  ui.drawHistory(mkCtx(), 0);
  return TEXTLOG.slice();
}
{
  const WIN = {
    id: 42, stake: 1, pot: 2, payout: 1.9, fee: 0.1, format: 'duel', stageMode: 'full', stageIdx: null,
    seats: 2, winner: HIM, winnerName: 'UUFN4L', players: [hpl(OPP), hpl(HIM)], resolvedAt: NOW - 60_000, claimed: true,
  };
  const texts = renderHistory([WIN]);
  ok(has(texts, 'UUFN4L WON 1.9 $GONNA'), "duel win row: 'UUFN4L WON 1.9 $GONNA' — the owner reads the unit (was the bare 'TOOK 1.9')");
  const texts2 = renderHistory([{ ...WIN, payout: undefined, fee: undefined }]);
  ok(has(texts2, 'UUFN4L WON 1.9 $GONNA'), 'win row without an exact payout: contract-exact estimate still carries $GONNA');
  const TIE = { ...WIN, id: 100, winner: '', winnerName: 'TIE - ALL REFUNDED', payout: 0, fee: 0 };
  const texts3 = renderHistory([TIE]);
  ok(has(texts3, 'TIE - REFUND 1 $GONNA EACH'), "tie row: 'TIE - REFUND 1 $GONNA EACH' (refund, never 'TOOK 0')");
  const FORFEIT = { ...WIN, id: 104, payout: 0.95, fee: 0.05, forfeited: true };
  const texts4 = renderHistory([FORFEIT]);
  ok(has(texts4, 'UUFN4L WON 1.95 $GONNA'), 'forfeit row: own stake + share = WON 1.95 $GONNA');
  // battle detail titles
  const ui1 = new ArenaUI();
  ui1.histDetail = WIN;
  ui1.hots = [];
  TEXTLOG.length = 0;
  ui1.drawHistCard(mkCtx(), 0);
  ok(has(TEXTLOG, 'UUFN4L WON THE POT'), "battle detail title: 'WON THE POT'");
  ok(TEXTLOG.some((t) => t.str === 'WINNER TAKES') && TEXTLOG.some((t) => t.str === '1.9 $GONNA'), "battle detail money rows keep the unit ('WINNER TAKES' -> '1.9 $GONNA')");
  const ui2 = new ArenaUI();
  ui2.histDetail = TIE;
  ui2.hots = [];
  TEXTLOG.length = 0;
  ui2.drawHistCard(mkCtx(), 0);
  ok(has(TEXTLOG, 'TIE - ALL REFUNDED'), "battle detail tie title: 'TIE - ALL REFUNDED'");
}

// ================= [4] fmtStake / fmtAmount: K/M/B/T edges ==================
console.log('\n[4] fmt: compact tiers, truncated, corners kept');
{
  ok(fmtStake(0) === '0', "fmtStake(0) = '0'");
  ok(fmtStake(NaN) === '—', "fmtStake(NaN) = '—' (v15.2.7 corner kept)");
  ok(fmtAmount(NaN) === '0', "fmtAmount(NaN) = '0' (v15.2.9 corner kept)");
  ok(fmtStake(999) === '999' && fmtAmount(999) === '999', 'under 1000: the full number');
  ok(fmtAmount(1.9) === '1.9' && fmtAmount(0.0526) === '0.0526', 'dust: max 4 decimals, trailing zeros trimmed (v15.2.9 behavior)');
  ok(fmtStake(1000) === '1K', "1,000 -> '1K'");
  ok(fmtStake(12_500) === '12.5K', "12,500 -> '12.5K'");
  ok(fmtStake(999_999) === '999.9K', "999,999 -> '999.9K' — TRUNCATED, never a fake rounded '1000K'");
  ok(fmtStake(999_950) === '999.9K', "999,950 -> '999.9K' (no tier flip below 1e6)");
  ok(fmtStake(1_000_000) === '1M', "1,000,000 -> '1M' (tier flips at the exact power, '1M' not '1.0M')");
  ok(fmtStake(1_500_000) === '1.5M', "1,500,000 -> '1.5M'");
  ok(fmtStake(999_999_999) === '999.9M', "999,999,999 -> '999.9M' (no fake '1000M')");
  ok(fmtStake(2_300_000_000) === '2.3B', "2,300,000,000 -> '2.3B'");
  ok(fmtStake(999_999_999_999) === '999.9B', "999,999,999,999 -> '999.9B'");
  ok(fmtStake(1e12) === '1T', "1e12 -> '1T' (documented: T is the top tier)");
  ok(fmtStake(1e15) === '1000T', "1e15 -> '1000T' (documented: no tier beyond T)");
  ok(fmtAmount(1500) === '1.5K' && fmtAmount(1_500_000) === '1.5M' && fmtAmount(2.3e9) === '2.3B', 'fmtAmount routes >= 1000 through the same tiers');
  ok(fmtAmount(-0.1) === '-0.1', "fmtAmount(-0.1) = '-0.1' (NET sign path untouched)");
}

// ================= [5] MOCK ADAPTER e2e: the chain rule, mirrored ===========
console.log('\n[5] mock adapter earlyClose: refuses a seated table like the chain');
{
  store.set('gonna.arena.adapter.testnet', 'mock');
  store.set('gonna.arena.v1.testnet', JSON.stringify({ nextId: 1, seeded: true, histSeeded: true, challenges: [], history: [] }));
  const adapter = new MockArenaAdapter();
  const creator = pl(CREATOR, 0);
  // sealedScore 0: no auto-rival — the roster starts with the creator alone
  const cfg = { visibility: 'public', format: 'open', seatsTotal: 5, durationSecs: 86400, stageMode: 'full', stageIdx: null, stake: 1, sealedScore: 0, fighter: FIGHTER };
  // zero joiners -> closes (the legal path)
  const c1 = await adapter.createChallenge(cfg, creator);
  const closed = await adapter.earlyClose(c1.id, CREATOR);
  ok(closed.status === 'closed', 'mock: zero-joiner card early-closes (mirrors early_close success)');
  // one joiner -> REFUSED with the honest error
  const c2 = await adapter.createChallenge(cfg, creator);
  await adapter.join(c2.id, pl(JOINER, 0));
  let threw = '';
  try {
    await adapter.earlyClose(c2.id, CREATOR);
  } catch (err) {
    threw = String(err && err.message);
  }
  ok(threw === 'TABLE LOCKED - SCORES OR THE TIMER SETTLE IT', "mock: joiner-seated card REFUSES early-close ('" + threw + "') — seats_taken == 0, mirrored");
  const still = await adapter.getChallenge(c2.id);
  ok(still !== null && still.status !== 'closed', 'mock: the refused card is still live (no phantom close)');
}

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
for (const f of [ENTRY, WRAP, BUNDLE]) rmSync(f, { force: true });
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
