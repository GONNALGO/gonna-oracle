// GONNA FIGHT v15.2.9 — MY LEGACY truthful SIGNED P&L (node-only, no browser).
//   OWNER BUG: wallet UUFN4L…ICNM played 2 matches (1 W duel / 1 L table,
//   stake 1 GONNA each). MY LEGACY showed WON 1 / LOST 1 / NET +0 / BEST 1.
//   Two stacked bugs:
//     (a) DISPLAY: drawLegacy floored every money row through fmtGonna
//         (integer) — 1.9 -> '1', +0.9 -> '+0'.  [fixed: fmtAmount rows]
//     (b) SEMANTICS (the decree "il wallet vincitore dice net 0, dovrebbe
//         dire + o -"): legacyStats.net = won - lost only subtracted stakes
//         from LOSSES. The 1 GONNA he paid into the duel he WON never
//         entered the books. TRUE signed P&L = Σ received − Σ paid
//         = 1.9 − 2 = -0.1.
//   FIX: shared accumulateLegacy (both adapters) — paid = seat stake on every
//     settled match; received = EXACT net payout (event/memory value
//     preferred, else contract-exact floor(potMicro*500/10000) estimate;
//     a forfeit also returns the winner's own stake). HistoryEntry carries
//     gross pot + net payout + fee as SEPARATE fields; the event mapper's
//     stake=pot/2 invention is gone (NaN = UNKNOWN -> W/L counted, money
//     skipped, never invented).
//   [0] source-level guards
//   [1] REAL fixture (recon-v1529.mjs output, hardcoded): the UUFN4L entries
//   [2] synthetic: table win / tie / unknown-stake / gross-vs-net / forfeit
//   [3] mock adapter end-to-end legacyStats
//   [4] drawLegacy renders the decimals (-0.1 red, +3.75 green)
// Run: node scripts/test-v1529.mjs   (from /mnt/agents/output/app)
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
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ================= [0] SOURCE-LEVEL =========================================
console.log('\n[0] SOURCE: money semantics explicit + uniform');
{
  const ca = readFileSync(join(ROOT, 'src/game/arena/chainAdapter.ts'), 'utf8');
  ok(ca.includes('export function accumulateLegacy('), 'shared accumulateLegacy exported');
  ok(ca.includes('const feeMicro = Math.floor((potMicro * 500) / 10000);'), 'contract-exact fee: floor(potMicro*500/10000) (protocol_fee decomposition)');
  ok((ca.match(/accumulateLegacy\(/g) ?? []).length >= 3, 'BOTH adapters route legacyStats through accumulateLegacy (def + mock + testnet)');
  ok(!ca.includes('net: won - lost'), 'old net = won - lost (losses-only stakes) ELIMINATED');
  ok(!ca.includes('const takes = splitPot(h.stake, h.pot, h.players.length).takes;\n        won += takes;'), 'legacyStats no longer estimates takes via float splitPot');
  ok(ca.includes('stake: mem?.stake ?? NaN,') && !ca.includes('(ev.payout + ev.fee) / 1e6 / 2'), 'event mapper: stake from memory ONLY (NaN = unknown) — the pot/2 invention is gone');
  ok(ca.includes('payout?: number; // EXACT net $GONNA') && ca.includes('fee?: number;') && ca.includes('forfeited?: boolean;'), 'HistoryEntry: gross pot + net payout + fee + forfeited as SEPARATE fields');
  ok(ca.includes('payout: ev.payout / 1e6,') && ca.includes('forfeited: ev.kind === \'forfeited\','), 'event mapper populates exact payout/fee/forfeited');
  ok(ca.includes("payout: mem.payout > 0 ? mem.payout : undefined,") && ca.includes("forfeited: mem.closedKind === 'forfeited',"), 'memory mapper populates exact payout/fee/forfeited');
  ok(ca.includes('if (!Number.isFinite(h.stake)) continue; // stake UNKNOWN'), 'unknown stake: W/L counted, money math SKIPPED (never invented)');
  ok(ca.includes('received = h.forfeited ? h.stake + payout : payout;'), 'forfeit: own stake back in full + the winner share');

  const ui = readFileSync(join(ROOT, 'src/game/arena/arenaUI.ts'), 'utf8');
  ok(ui.includes("['$GONNA WON', s ? fmtAmount(s.won) : '-', GOLD],"), 'WON row -> fmtAmount(s.won)');
  ok(ui.includes("['$GONNA LOST', s ? fmtAmount(s.lost) : '-', RED],"), 'LOST row -> fmtAmount(s.lost)');
  ok(ui.includes("['NET', s ? (s.net >= 0 ? '+' : '-') + fmtAmount(Math.abs(s.net)) : '-', s && s.net < 0 ? RED : GREEN],"), 'NET row -> sign + fmtAmount(Math.abs(s.net))');
  ok(ui.includes("['BEST WIN', s ? fmtAmount(s.bestWin) : '-', GOLD],"), 'BEST WIN row -> fmtAmount(s.bestWin)');
  ok(!ui.includes('fmtGonna(s.won)') && !ui.includes('fmtGonna(s.lost)') && !ui.includes('fmtGonna(s.bestWin)') && !ui.includes('fmtGonna(Math.abs(s.net))'), 'no fmtGonna left on the legacy money rows');
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

// ================= bundle: chainAdapter math + arenaUI (TEXTLOG font wrap) ==
const { writeFileSync, rmSync } = await import('node:fs');
const ENTRY = join(ROOT, '.tmp-v1529-entry.ts');
const WRAP = join(ROOT, '.tmp-v1529-fontwrap.ts');
const BUNDLE = join(ROOT, '.tmp-v1529-bundle.mjs');
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
  "export { accumulateLegacy, netPayoutFromPot, MockArenaAdapter } from './src/game/arena/chainAdapter';\n" +
    "export { ArenaUI } from './src/game/arena/arenaUI';\n" +
    "export { setMock } from './src/game/wallet';\n" +
    "export { TEXTLOG } from './.tmp-v1529-fontwrap';\n",
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
const { accumulateLegacy, netPayoutFromPot, MockArenaAdapter, ArenaUI, setMock, TEXTLOG } = mod;

// ================= THE REAL FIXTURE (recon-v1529.mjs, chain truth) ==========
// app 769767443, wallet UUFN4L…ICNM — entries EXACTLY as the merged history
// builds them (event + card memory: known stake, exact event payout/fee).
const HIM = 'UUFN4LNBWB3NDAPMFMUWG7BYUZW7AJSL5QLCK7R35XZSOAFUXIYYGPICNM';
const OPP = 'GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU';
const TABLE_WINNER = 'DJG2HVYK6HOAPUPYI4P4OYCI7OLOJPCVCSXGHQR62YTVYNJPZF3LPTDH5A';
const TABLE_P4 = '4OQ3LJ3JW67JEY55TMHLGZG3MWWLTVFZERGY67LBJEJLOGEUUX2PYHQGGM';
const TABLE_P5 = 'COI33V32HHFEGZFVGBZHD2A67TSQ4JHHTS5CE37VNLGIQHOHCP4FI4KNFA';
const pl = (address, score = 0) => ({ address, name: address.slice(0, 6), score });
// cid 42: resolved duel, stake 1, GROSS pot 2, winner HIM, payout 1.9 fee 0.1
//   (event txid N67XC2LD…ZHQQ, round 66647505)
const DUEL_WIN = {
  id: 42, stake: 1, pot: 2, payout: 1.9, fee: 0.1, format: 'duel', stageMode: 'full', stageIdx: null,
  seats: 2, winner: HIM, winnerName: 'UUFN4L', players: [pl(OPP), pl(HIM)], resolvedAt: 1787638805000, claimed: true,
};
// cid 20: resolved 5-seat table, stake 1, GROSS pot 5, winner DJG2HV…DH5A,
//   payout 4.75 fee 0.25 — HE LOST (event txid T5PUL4Y7…UJBQ, round 66632345)
const TABLE_LOSS = {
  id: 20, stake: 1, pot: 5, payout: 4.75, fee: 0.25, format: 'open', stageMode: 'full', stageIdx: null,
  seats: 5, winner: TABLE_WINNER, winnerName: 'DJG2HV', players: [pl(OPP), pl(TABLE_WINNER), pl(HIM), pl(TABLE_P4), pl(TABLE_P5)],
  resolvedAt: 1787597976000, claimed: true,
};

console.log('\n[1] REAL fixture: the UUFN4L…ICNM entries -> NET -0.1 (chain truth)');
{
  const s = accumulateLegacy([DUEL_WIN, TABLE_LOSS], HIM);
  ok(s.wins === 1 && s.losses === 1, 'played 2 = 1 W (duel) + 1 L (table)');
  ok(near(s.won, 1.9), 'won = 1.9 (the EXACT net duel payout, not the gross 2, not the floored 1) — got ' + s.won);
  ok(near(s.lost, 1), 'lost = 1 (the table seat stake)');
  ok(near(s.net, -0.1), 'NET = 1.9 received − 2 paid = -0.1 — the truthful SIGNED P&L (got ' + s.net + ')');
  ok(near(s.bestWin, 1.9), 'bestWin = 1.9');
}

// ================= [2] SYNTHETIC CASES ======================================
console.log('\n[2] synthetic: table win / tie / unknown stake / gross-vs-net / forfeit');
{
  // (a) 5-seat table WIN at stake 1: payout 4.75, paid 1 -> leg net +3.75
  const TABLE_WIN = { ...TABLE_LOSS, id: 99, winner: HIM, winnerName: 'UUFN4L' };
  const a = accumulateLegacy([TABLE_WIN], HIM);
  ok(a.wins === 1 && near(a.won, 4.75) && near(a.net, 3.75) && near(a.bestWin, 4.75),
    'table 5-seat win: won 4.75, net contribution +3.75 (got won ' + a.won + ', net ' + a.net + ')');

  // (b) tie/refund entry: no winner -> skipped from W/L, net leg exactly 0
  const TIE = { ...DUEL_WIN, id: 100, winner: '', winnerName: 'TIE - ALL REFUNDED', payout: 0, fee: 0 };
  const b = accumulateLegacy([DUEL_WIN, TIE], HIM);
  ok(b.wins === 1 && b.losses === 0 && near(b.net, 0.9), 'tie entry: no W/L, net unchanged (refund = paid, leg 0) — got net ' + b.net);

  // (c) event-only entry, stake UNKNOWN (NaN): W/L counted, money SKIPPED
  const EV_ONLY = { ...DUEL_WIN, id: 101, stake: NaN, pot: 2, players: [pl(HIM)] };
  const c = accumulateLegacy([EV_ONLY], HIM);
  ok(c.wins === 1 && near(c.won, 0) && near(c.net, 0) && near(c.bestWin, 0),
    'unknown stake (event-only): win counted, money skipped — never invented (got won ' + c.won + ', net ' + c.net + ')');
  const EV_ONLY_LOSS = { ...TABLE_LOSS, id: 102, stake: NaN, players: [pl(TABLE_WINNER), pl(HIM)] };
  const c2 = accumulateLegacy([EV_ONLY_LOSS], HIM);
  ok(c2.losses === 1 && near(c2.lost, 0) && near(c2.net, 0), 'unknown-stake LOSS: loss counted, lost/net untouched');

  // (d) gross-vs-net convention guard: NO payout field -> the estimate from
  // the GROSS pot must be the contract-exact 1.9 (pot 2 is fee-INCLUSIVE —
  // never paid out whole, never double-fe'd)
  const NO_PAYOUT = { ...DUEL_WIN, id: 103 };
  delete NO_PAYOUT.payout;
  delete NO_PAYOUT.fee;
  const d = accumulateLegacy([NO_PAYOUT], HIM);
  ok(near(d.won, 1.9), 'gross pot 2 without payout -> contract-exact estimate 1.9 (got ' + d.won + ')');
  const est = netPayoutFromPot(2);
  ok(est.pot === 2 && near(est.fee, 0.1) && near(est.payout, 1.9), 'netPayoutFromPot(2): fee 0.1, payout 1.9 (micro-floor exact)');
  const est5 = netPayoutFromPot(5);
  ok(near(est5.fee, 0.25) && near(est5.payout, 4.75), 'netPayoutFromPot(5): fee 0.25, payout 4.75');

  // (e) forfeit: the contract returns the caller's OWN stake in full + 95% of
  // the forfeited seat (event payout = the SHARE only, 0.95)
  const FORFEIT = { ...DUEL_WIN, id: 104, payout: 0.95, fee: 0.05, forfeited: true };
  const e = accumulateLegacy([FORFEIT], HIM);
  ok(e.wins === 1 && near(e.won, 1.95) && near(e.net, 0.95) && near(e.bestWin, 1.95),
    'forfeit win: received = own stake 1 + share 0.95 = 1.95, net +0.95 (got won ' + e.won + ', net ' + e.net + ')');
}

// ================= [3] MOCK ADAPTER END-TO-END ==============================
console.log('\n[3] mock adapter legacyStats end-to-end (same fixture store)');
{
  store.set('gonna.arena.adapter', 'mock');
  store.set('gonna.arena.v1', JSON.stringify({ nextId: 200, seeded: true, histSeeded: true, challenges: [], history: [DUEL_WIN, TABLE_LOSS] }));
  const adapter = new MockArenaAdapter();
  const s = await adapter.legacyStats(HIM);
  ok(s.played === 2 && s.wins === 1 && s.losses === 1 && s.winRate === 50, 'mock: played 2, 1W/1L, 50%');
  ok(near(s.won, 1.9) && near(s.lost, 1) && near(s.net, -0.1) && near(s.bestWin, 1.9),
    'mock: won 1.9 / lost 1 / NET -0.1 / best 1.9 (got ' + JSON.stringify({ won: s.won, lost: s.lost, net: s.net, bestWin: s.bestWin }) + ')');
  ok(s.open === 0, 'mock: no open cards in the fixture store');
}

// ================= [4] DISPLAY: drawLegacy decimals =========================
const ADDR58 = (s) => (s + 'Q'.repeat(58)).slice(0, 58);
const mkCtx = () => ({
  fillStyle: '', strokeStyle: '', lineWidth: 1,
  fillRect() {}, strokeRect() {}, drawImage() {}, clearRect() {},
  save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
});
const GREEN = '#7fd858';
const RED = '#e23b3b';
function renderLegacy(legacy) {
  store.set('gonna.arena.adapter', 'mock');
  setMock({ address: ADDR58('VIEWERDEGEN'), nfts: [] });
  const ui = new ArenaUI();
  ui.hots = [];
  ui.focus = -1;
  ui.busy = false;
  ui.legacy = legacy;
  TEXTLOG.length = 0;
  ui.drawLegacy(mkCtx(), 0); // frame 0: no crown blink — the text rows are the subject
  const rows = {};
  for (const t of TEXTLOG) {
    if (t.x === 314 && t.align === 'right') {
      const label = TEXTLOG.find((l) => l.x === 70 && l.y === t.y);
      if (label) rows[label.str] = t;
    }
  }
  return rows;
}

console.log('\n[4] drawLegacy: the owner\'s real stats render with decimals + sign');
{
  const rows = renderLegacy({ played: 2, wins: 1, losses: 1, open: 1, winRate: 50, won: 1.9, lost: 1, net: -0.1, bestWin: 1.9 });
  ok(rows['$GONNA WON'] && rows['$GONNA WON'].str === '1.9', "WON renders '1.9' — never the floored '1' (got '" + (rows['$GONNA WON'] && rows['$GONNA WON'].str) + "')");
  ok(rows['$GONNA LOST'] && rows['$GONNA LOST'].str === '1', "LOST renders '1'");
  ok(rows['NET'] && rows['NET'].str === '-0.1', "NET renders '-0.1' — the decree: + or -, never '+0' (got '" + (rows['NET'] && rows['NET'].str) + "')");
  ok(rows['NET'] && rows['NET'].color === RED, 'negative NET is RED');
  ok(rows['BEST WIN'] && rows['BEST WIN'].str === '1.9', "BEST WIN renders '1.9'");
  ok(rows['OPEN'] && rows['OPEN'].str === '1', 'his still-open card counts (OPEN 1)');
}
{
  const rows = renderLegacy({ played: 2, wins: 1, losses: 1, open: 0, winRate: 50, won: 1.9, lost: 1, net: 0.9, bestWin: 1.9 });
  ok(rows['NET'] && rows['NET'].str === '+0.9' && rows['NET'].color === GREEN, "positive NET '+0.9' stays GREEN");
  const rows2 = renderLegacy({ played: 1, wins: 1, losses: 0, open: 0, winRate: 100, won: 4.75, lost: 0, net: 3.75, bestWin: 4.75 });
  ok(rows2['NET'] && rows2['NET'].str === '+3.75' && rows2['NET'].color === GREEN, "table-win NET '+3.75' GREEN");
  ok(rows2['$GONNA WON'] && rows2['$GONNA WON'].str === '4.75', "table-win WON renders '4.75'");
}

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
for (const f of [ENTRY, WRAP, BUNDLE]) rmSync(f, { force: true });
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
