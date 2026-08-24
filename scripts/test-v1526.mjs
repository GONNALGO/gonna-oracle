// GONNA FIGHT v15.2.6 — arena UI transparency fix (node-only, no browser):
//   TABLE cards render the FULL ROSTER (every seat, live scores public from
//     on-chain box data, score-to-beat, open seats) instead of a two-seal
//     face-off + '+N MORE DEGENS SEATED'. DUEL cards show each signed score
//     under its seal WITHOUT the resolved/claimed gate, and a non-seated
//     viewer sees SCORE TO BEAT above the ACCEPT button.
//   [1] source-level assertions on arenaUI.ts + chainAdapter.ts score parsing
//   [2] behavior: drawVersus via esbuild bundle with a font wrapper logging
//       every drawText/drawTextSh call (str/x/y/scale/color/align)
//       A) table 3/5 seats (scores 5600/1200/0) — roster + TO BEAT + OPEN rows
//       B) duel live — creator score under seal + TO BEAT for passerby
//       C) 9-seat table — TWO columns
//       D) resolved table — roster stays, WINNER highlighted, SETTLED block
//       E) action zone intact — accept / submit / resolve / close hotspots
// Run: node scripts/test-v1526.mjs   (from /mnt/agents/output/app)
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

// ================= [1] SOURCE-LEVEL =========================================
console.log('\n[1] SOURCE: arenaUI.ts roster + ungated scores; chainAdapter parses seat scores');
{
  const src = readFileSync(join(ROOT, 'src/game/arena/arenaUI.ts'), 'utf8');
  const vs = src.slice(src.indexOf('private drawVersus'), src.indexOf('private drawClosedCard'));

  ok(vs.includes("const isTable = card.format !== 'duel' || card.players.length > 2"), 'isTable: non-duel OR >2 seated');
  ok(vs.includes("' $GONNA POT'") && vs.includes("'/SEAT'"), 'table pot line + STAKE x/SEAT dim');
  ok(vs.includes("'SCORE TO BEAT: ' + String(leader.score).padStart(6, '0')"), 'table SCORE TO BEAT line (padded 6, leader name)');
  ok(vs.includes("'NO SCORES YET - FIRST BLOOD SETS THE BAR'"), 'table empty-scores line');
  ok(vs.includes('twoCol') && vs.includes('Math.ceil(n / 2)') && vs.includes('VW / 2 + 8'), 'two-column roster when seats > 6');
  ok(vs.includes("' OPEN SEAT'") && vs.includes("'OPEN'"), 'roster rows for EVERY seat incl. OPEN rows');
  ok(vs.includes("'---'") && vs.includes("'#7ee787'"), "signed green '#7ee787', pending '---' dim");
  ok(vs.includes("' (C)'") || vs.includes("'(C)'"), 'creator (C) suffix');
  ok(vs.includes("'< LEADS'") && vs.includes("'WINNER'"), 'leader < LEADS marker + WINNER suffix');
  ok(!vs.includes('MORE DEGENS SEATED'), "'+N MORE DEGENS SEATED' collapse removed");
  ok(vs.includes('if (p0 && p0.score > 0)') && vs.includes('if (p1 && p1.score > 0)'), 'duel scores under seals gated ONLY on score > 0');
  ok(!/status === 'resolved' \|\| card\.status === 'claimed'\) \{\s*if \(p0\)/.test(vs), 'resolved/claimed gate around duel scores dropped');
  ok(vs.includes('const beatScore = p0?.score ?? 0') && vs.includes('SCORE TO BEAT: ' + "' + String(beatScore"), 'duel passerby SCORE TO BEAT above ACCEPT');
  ok(vs.includes("id: 'accept'") && vs.includes("id: 'submit'") && vs.includes("id: 'resolve'") && vs.includes("id: 'close'"), 'action-zone buttons still present in source');

  const ca = readFileSync(join(ROOT, 'src/game/arena/chainAdapter.ts'), 'utf8');
  const map = ca.slice(ca.indexOf('players: players.map'), ca.indexOf('players: players.map') + 400);
  ok(map.includes('score: Number(p.score)'), 'chainAdapter maps EVERY rumble seat score from the players box (v2 layout)');
  const tk = readFileSync(join(ROOT, 'src/game/arena/testnetKit.ts'), 'utf8');
  ok(tk.includes("'(byte[],uint64,bool,uint64)[]'") && tk.includes('score: p[1]'), 'testnetKit readPlayers decodes per-seat score (v2 box layout)');
}

// ================= browser-global stubs (BEFORE the bundle loads) ===========
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

// ================= bundle with a FONT WRAPPER logging every text call ========
const ENTRY = join(ROOT, '.tmp-v1526-entry.ts');
const WRAP = join(ROOT, '.tmp-v1526-fontwrap.ts');
const BUNDLE = join(ROOT, '.tmp-v1526-bundle.mjs');
const { writeFileSync, rmSync } = await import('node:fs');
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
  "export { ArenaUI } from './src/game/arena/arenaUI';\n" +
    "export { setMock } from './src/game/wallet';\n" +
    "export { TEXTLOG } from './.tmp-v1526-fontwrap';\n",
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
          if (args.importer === WRAP) return undefined; // the wrapper reads the REAL font
          const resolved = join(args.resolveDir, args.path);
          if (resolved === FONT) return { path: WRAP };
          return undefined;
        });
      },
    },
  ],
});
const mod = await import(BUNDLE);
const { ArenaUI, setMock, TEXTLOG } = mod;

// ================= harness ====================================================
const VW = 384;
const FIGHTER = { skin: 'gonna', assetId: null, name: 'GONNA' };
const pl = (addr, name, score) => ({ address: addr, name, score, fighter: FIGHTER, accountType: 'ed25519' });
const A = (s) => s + 'Q'.repeat(Math.max(0, 58 - s.length)); // fake 58-char addresses
const CREATOR = A('CREATOR');
const VIEWER = A('VIEWERDEGEN');
const mkCard = (over) => ({
  id: 42,
  creator: CREATOR,
  creatorName: 'CREATORDEGEN',
  creatorType: 'ed25519',
  visibility: 'public',
  format: 'open',
  seatsTotal: 5,
  durationSecs: 3600,
  stageMode: 'single',
  stageIdx: 0,
  stake: 10_000_000,
  createdAt: Date.now() - 1000,
  deadline: Date.now() + 3_600_000,
  status: 'open',
  players: [],
  winner: null,
  pot: 30_000_000,
  ...over,
});
const mkCtx = () => ({
  fillStyle: '', strokeStyle: '', lineWidth: 1,
  fillRect() {}, strokeRect() {}, drawImage() {}, clearRect() {},
  save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
});
function render(card, me) {
  store.set('gonna.arena.adapter', 'mock');
  setMock(me ? { address: me, nfts: [] } : null);
  const ui = new ArenaUI();
  ui.current = card;
  ui.mine = [];
  ui.hots = [];
  ui.focus = -1; // no lit button flicker
  ui.busy = false;
  ui.verdict = null;
  TEXTLOG.length = 0;
  ui.drawVersus(mkCtx(), 16, null);
  return { texts: TEXTLOG.slice(), hots: ui.hots.map((h) => h.id) };
}
const has = (texts, str) => texts.some((t) => t.str === str);
const find = (texts, str) => texts.find((t) => t.str === str);
const some = (texts, re) => texts.some((t) => re.test(t.str));

// ================= [2] BEHAVIOR =============================================
console.log('\n[2A] TABLE 3/5 seats (5600 / 1200 / pending) — full roster, no resolve gate');
{
  const card = mkCard({
    players: [pl(CREATOR, 'CREATORDEGEN', 5600), pl(A('P2'), 'DEGEN TWO', 1200), pl(A('P3'), 'DEGEN THREE', 0)],
  });
  const { texts, hots } = render(card, VIEWER);
  const beat = find(texts, 'SCORE TO BEAT: 005600 - CREATORDEGEN');
  ok(beat && beat.color === '#39FF14' && beat.y === 72, 'SCORE TO BEAT: 005600 - CREATORDEGEN in FLUO at y=72 (live, NOT resolve-gated)');
  ok(has(texts, '30M $GONNA POT') && find(texts, '30M $GONNA POT').color === '#f5c542', 'pot line gold: 30M $GONNA POT');
  ok(has(texts, 'STAKE 10M/SEAT'), 'STAKE 10M/SEAT dim line');
  ok(some(texts, /^3\/5 SEATS - .+ LEFT$/), 'seats + countdown status line kept');
  ok(has(texts, '1 CREATORDEGEN') && has(texts, '(C)') && has(texts, '< LEADS'), 'row 1: creator name + (C) + gold < LEADS');
  ok(has(texts, '2 DEGEN TWO') && has(texts, '3 DEGEN THREE'), 'rows 2 and 3 named');
  const s1 = find(texts, '005600'), s2 = find(texts, '001200');
  ok(s1 && s1.color === '#7ee787' && s1.align === 'right', "score 005600 right-aligned green '#7ee787'");
  ok(s2 && s2.color === '#7ee787', "score 001200 green '#7ee787'");
  const pending = find(texts, '---');
  ok(pending && pending.color === '#5a5f6c' && pending.align === 'right', "seated-but-unsigned row shows '---' dim");
  ok(has(texts, '4 OPEN SEAT') && has(texts, '5 OPEN SEAT'), 'both empty seats listed (rows 4 and 5)');
  ok(texts.filter((t) => t.str === 'OPEN' && t.color === '#b8860b').length === 2, "two right-aligned 'OPEN' markers in dim gold");
  ok(!some(texts, /MORE DEGENS/), "no '+N MORE DEGENS' collapse");
  ok(hots.includes('accept') && hots.includes('back'), 'action zone intact: accept + back hotspots pushed');
  ok(texts.every((t) => t.scale >= 1), 'nothing rendered below the standard scale 1');
}

console.log('\n[2B] DUEL live — creator score under the seal, TO BEAT for a passerby');
{
  const card = mkCard({ format: 'duel', seatsTotal: 2, pot: 10_000_000, players: [pl(CREATOR, 'CREATORDEGEN', 7777)] });
  const { texts, hots } = render(card, VIEWER);
  const under = find(texts, '007777');
  ok(under && under.y === 110 && under.x === 92, 'creator score 007777 under his seal while LIVE (gate dropped)');
  const beat = find(texts, 'SCORE TO BEAT: 007777');
  ok(beat && beat.color === '#39FF14' && beat.y === 148, 'non-seated viewer: SCORE TO BEAT: 007777 FLUO above ACCEPT');
  ok(hots.includes('accept'), 'accept hotspot intact');
  const sealName = find(texts, 'OPEN SEAT');
  ok(sealName && sealName.x === VW - 92, 'duel keeps the two-seal face-off (open seat seal at right)');
}

console.log('\n[2C] 9-seat table — TWO columns');
{
  const players = [pl(CREATOR, 'CREATORDEGEN', 900), pl(A('P2'), 'DEGEN TWO', 0), pl(A('P3'), 'DEGEN THREE', 300), pl(A('P4'), 'DEGEN FOUR', 0), pl(A('P5'), 'DEGEN FIVE', 0)];
  const card = mkCard({ seatsTotal: 9, pot: 50_000_000, players });
  const { texts } = render(card, VIEWER);
  const col2 = texts.filter((t) => t.x === VW / 2 + 8);
  ok(col2.length >= 4, 'second column at x=VW/2+8 carries rows (got ' + col2.length + ' texts)');
  const r6 = find(texts, '6 OPEN SEAT');
  ok(r6 && r6.x === VW / 2 + 8 && r6.y === 84, 'seat 6 opens column 2 at row 1 (x=200, y=84)');
  ok(has(texts, '9 OPEN SEAT'), 'seat 9 listed — every seat 1..9 rendered');
  const lastRow = texts.filter((t) => t.y >= 84 && t.y <= 141).map((t) => t.y);
  ok(Math.max(...lastRow) <= 134, 'roster ends by y~140 (max row baseline ' + Math.max(...lastRow) + ', bottom 141 < action zone 148)');
  ok(has(texts, 'SCORE TO BEAT: 000900 - CREATORDEGEN'), 'TO BEAT reflects the only signed score');
}

console.log('\n[2D] RESOLVED table — roster stays, winner highlighted, SETTLED block');
{
  const card = mkCard({
    status: 'resolved',
    winner: CREATOR,
    players: [pl(CREATOR, 'CREATORDEGEN', 5600), pl(A('P2'), 'DEGEN TWO', 1200), pl(A('P3'), 'DEGEN THREE', 900)],
  });
  const { texts, hots } = render(card, VIEWER);
  const win = find(texts, 'WINNER');
  ok(win && win.color === '#f5c542', "winner row carries gold 'WINNER' suffix");
  const wname = find(texts, '1 CREATORDEGEN');
  ok(wname && wname.color === '#f5c542', 'winner name highlighted gold');
  const wscore = texts.filter((t) => t.str === '005600').find((t) => t.color === '#f5c542');
  ok(!!wscore, 'winner score rendered gold');
  ok(has(texts, '2 DEGEN TWO') && has(texts, '001200'), 'loser rows still listed with final scores');
  ok(has(texts, 'SETTLED - POT PAID ON-CHAIN'), 'SETTLED block kept');
  ok(!hots.includes('accept') && !hots.includes('submit'), 'no dead action buttons on a settled card');
}

console.log('\n[2E] action zone intact — submit / resolve / close hotspots');
{
  // seated + unsigned on a live table -> SUBMIT SCORE
  const me2 = A('P2');
  const sub = render(mkCard({ players: [pl(CREATOR, 'CREATORDEGEN', 5600), pl(me2, 'DEGEN TWO', 0)] }), me2);
  ok(sub.hots.includes('submit'), 'submit hotspot pushed for a seated unsigned degen');
  // vclaim is drawn LOCKED until the deadline (disabled => no hotspot, by design)
  ok(some(sub.texts, /NO SCORE SEALED - CLAIMABLE AT /) && some(sub.texts, /CLAIM STAKE BACK/), 'locked claim-back block still rendered alongside submit');

  // full + all signed -> RESOLVE THE BATTLE
  const full = mkCard({
    seatsTotal: 4, status: 'full', pot: 40_000_000,
    players: [pl(CREATOR, 'CREATORDEGEN', 5600), pl(me2, 'DEGEN TWO', 1200), pl(A('P3'), 'DEGEN THREE', 900), pl(A('P4'), 'DEGEN FOUR', 100)],
  });
  const res = render(full, me2);
  ok(res.hots.includes('resolve'), 'resolve hotspot pushed on a full all-signed table');
  ok(has(res.texts, 'SCORE TO BEAT: 005600 - CREATORDEGEN'), 'live scores shown on a FULL table too (no resolve gating)');

  // creator viewing his own live card -> EARLY CLOSE
  const own = render(mkCard({ players: [pl(CREATOR, 'CREATORDEGEN', 5600)] }), CREATOR);
  ok(own.hots.includes('close'), 'close hotspot pushed for the creator');
  ok(has(own.texts, 'YOUR CARD, DEGEN - SHARE IT OR CLOSE IT'), 'creator seated-wait branch copy intact (seat 0 is always the creator)');
}

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
rmSync(ENTRY, { force: true });
rmSync(WRAP, { force: true });
rmSync(BUNDLE, { force: true });
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
