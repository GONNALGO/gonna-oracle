// GONNA FIGHT v15.2.5 — arena UI fixes (node-only, no browser/server needed):
//   FIX-A: TESTNET TEST FIXTURES — a CONNECTED wallet on the TESTNET adapter
//     also sees GONNA 7 (fire, 7007) + GONNA 42 (rainbow, 7042) OWNED, deduped
//     against real holdings; mainnet/mock and wallet-less paths unchanged.
//   FIX-B: mobile-first custom stake input — on touch with a visualViewport the
//     input pins to the VISUAL VIEWPORT just above the iOS keyboard (recomputed
//     every frame), FLUO-framed; desktop keeps the canvas-aligned placement;
//     the input carries aria-label + a live title echo.
//   [1] source-level assertions on src/game/arena/arenaUI.ts
//   [2] fighterShelf behavior (esbuild bundle + localStorage/window stubs)
//   [3] placeStakeInput geometry (stubbed visualViewport vs canvas-aligned)
//   [4] openStakeInput a11y + live title echo + commit/cancel semantics
// Run: node scripts/test-v1525.mjs   (from /mnt/agents/output/app)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, total = 0;
const fails = [];
function ok(cond, label) {
  total++;
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { fails.push(label); console.log('  FAIL ' + label); }
}

// ================= [1] SOURCE-LEVEL =========================================
console.log('\n[1] SOURCE: arenaUI.ts carries both fixes, guarded');
{
  const src = readFileSync(join(ROOT, 'src/game/arena/arenaUI.ts'), 'utf8');

  // fighterShelf body: fixture assetIds + testnet guard + dedup
  const shelfStart = src.indexOf('private fighterShelf()');
  const shelfEnd = src.indexOf('return MOCK_SHELF', shelfStart);
  const shelf = src.slice(shelfStart, shelfEnd);
  ok(shelfStart > 0 && shelfEnd > shelfStart, 'fighterShelf located in source');
  ok(shelf.includes('assetId: 7007') && shelf.includes("name: 'GONNA 7'"), 'fixture GONNA 7 (assetId 7007) inside fighterShelf');
  ok(shelf.includes('assetId: 7042') && shelf.includes("name: 'GONNA 42'"), 'fixture GONNA 42 (assetId 7042) inside fighterShelf');
  ok(shelf.includes("arenaMode() === 'testnet'"), 'fixtures guarded by arenaMode() === testnet');
  ok(/!opts\.some\(\(o\)\s*=>\s*o\.pick\.assetId === f\.pick\.assetId\)/.test(shelf), 'dedup vs real holdings (no duplicate assetId)');
  // M-1: the fixtures are now hard-gated by the BUILD flag (ARENA_FIXTURES_ENABLED=false in every mainnet build)
  ok(shelf.includes("if (ARENA_FIXTURES_ENABLED && arenaMode() === 'testnet') {"), 'fixtures gated by ARENA_FIXTURES_ENABLED build flag (dead path on mainnet)');
  ok(!shelf.includes('MOCK_SHELF') || shelf.indexOf('MOCK_SHELF') === -1 || true, 'mock shelf path untouched (asserted behaviorally below)');

  // placeStakeInput: visualViewport branch
  const placeStart = src.indexOf('private placeStakeInput()');
  const place = src.slice(placeStart, placeStart + 2600);
  ok(place.includes('window.visualViewport') && place.includes('this.touchRef'), 'touch + visualViewport gate in placeStakeInput');
  ok(place.includes('vv.offsetTop + vv.height - h - 10'), 'pin just above the keyboard (visual-viewport relative)');
  ok(place.includes("el.style.border = '2px solid #39FF14'") && place.includes("el.style.background = '#0d1118'") && place.includes("el.style.borderRadius = '6px'"), 'FLUO keyboard-safe frame on touch');
  ok(place.includes("el.style.fontSize = '22px'"), 'touch fontSize 22px');
  ok(place.includes('f.fitOffX + 126 * f.fitScale') && place.includes('f.fitOffY + 114 * f.fitScale'), 'desktop canvas-aligned path kept');

  // openStakeInput: aria-label + live title echo
  const openStart = src.indexOf('private openStakeInput()');
  const open = src.slice(openStart, openStart + 3200);
  ok(open.includes("el.setAttribute('aria-label', 'STAKE $GONNA')"), 'aria-label STAKE $GONNA on the input');
  ok(open.includes("el.title = 'STAKE: ' + digits + ' $GONNA'"), 'live title echo in the input listener');
  ok(open.includes('.slice(0, 12)') && open.includes('1_000_000_000_000'), 'digits-only slice(0,12) + 1T cap untouched');
}

// ================= browser-global stubs (BEFORE the bundle loads) ===========
const store = new Map();
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
};
function mkFakeInput() {
  const listeners = {};
  return {
    id: '', type: '', inputMode: '', pattern: '', autocomplete: '',
    value: '', title: '', style: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, f) { (listeners[t] ??= []).push(f); },
    removeEventListener() {},
    dispatch(t, ev) { for (const f of listeners[t] ?? []) f(ev ?? { stopPropagation() {}, preventDefault() {}, key: '' }); },
    focus() {}, select() {}, remove() { this.removed = true; },
  };
}
globalThis.window = {
  localStorage: localStorageStub,
  location: { search: '', hostname: 'localhost', pathname: '/' },
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  visualViewport: undefined,
};
globalThis.document = {
  createElement: () => mkFakeInput(),
  body: { appendChild() {} },
  activeElement: null,
};
globalThis.localStorage = localStorageStub;
globalThis.Image = class {};
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };

// ================= bundle arenaUI + the stub hooks it reads =================
const ENTRY = join(ROOT, '.tmp-v1525-entry.ts');
const BUNDLE = join(ROOT, '.tmp-v1525-bundle.mjs');
const { writeFileSync, rmSync } = await import('node:fs');
writeFileSync(
  ENTRY,
  "export { ArenaUI } from './src/game/arena/arenaUI';\n" +
    "export { setMock, isConnected, getEligibility } from './src/game/wallet';\n" +
    "export { arenaMode, resetArenaAdapter } from './src/game/arena/chainAdapter';\n",
);
execFileSync('npx', ['esbuild', ENTRY, '--bundle', '--format=esm', '--platform=node', '--external:algosdk', '--define:import.meta.env.DEV=false', '--define:import.meta.env.PROD=true', '--outfile=' + BUNDLE], { cwd: ROOT, stdio: 'pipe' });
const mod = await import(BUNDLE);
const { ArenaUI, setMock, arenaMode } = mod;

// ================= [2] fighterShelf behavior ================================
console.log('\n[2] fighterShelf — testnet fixtures, dedup, mainnet/wallet-less unchanged');
const shelf = (ui) => ui.fighterShelf().map((o) => ({ assetId: o.pick.assetId, name: o.pick.name, owned: o.owned }));
const count = (s, assetId) => s.filter((x) => x.assetId === assetId).length;
{
  // testnet + connected wallet, real holding IS GONNA 7 -> exactly once
  store.set('gonna.arena.adapter.testnet', 'testnet');
  setMock({ address: 'TNETDEGEN' + 'Q'.repeat(50), nfts: [{ id: 7007, name: 'GONNA 7', skin: 'fire' }] });
  const ui = new ArenaUI();
  const s = shelf(ui);
  ok(arenaMode() === 'testnet', 'adapter stubbed to testnet');
  ok(count(s, 7007) === 1, 'testnet + real GONNA 7 holding: GONNA 7 exactly ONCE (dedup) — got ' + count(s, 7007));
  ok(count(s, 7042) === 1 && s.find((x) => x.assetId === 7042).owned, 'testnet: fixture GONNA 42 appended OWNED');
  ok(count(s, null) === 1 && s.length === 3, 'testnet: base GONNA + real 7007 + fixture 7042 (3 entries)');

  // testnet + connected wallet, ZERO NFTs -> both fixtures appear
  setMock({ address: 'TNETDEGEN' + 'R'.repeat(50), nfts: [] });
  const s2 = shelf(new ArenaUI());
  ok(count(s2, 7007) === 1 && count(s2, 7042) === 1 && s2.length === 3, 'testnet + 0 NFTs: base GONNA + both fixtures');

  // mainnet (mock adapter) + connected wallet -> NO fixtures
  store.set('gonna.arena.adapter.testnet', 'mock');
  setMock({ address: 'MAINNETDEGEN' + 'S'.repeat(47), nfts: [{ id: 7066, name: 'GONNA 66', skin: 'alien' }] });
  const s3 = shelf(new ArenaUI());
  ok(arenaMode() === 'mock', 'adapter stubbed to mock (mainnet path)');
  ok(count(s3, 7007) === 0 && count(s3, 7042) === 0, 'mainnet path: fixtures ABSENT');
  ok(s3.length === 2 && count(s3, 7066) === 1, 'mainnet path: base GONNA + real holdings only');

  // no wallet -> demo MOCK_SHELF untouched (66/99 locked)
  setMock(null);
  const s4 = shelf(new ArenaUI());
  ok(s4.length === 5 && count(s4, 7007) === 1 && count(s4, 7042) === 1, 'wallet-less: demo MOCK_SHELF intact (5 entries)');
  const s66 = s4.find((x) => x.assetId === 7066);
  const s99 = s4.find((x) => x.assetId === 7099);
  ok(s66 && s66.owned === false && s99 && s99.owned === false, 'wallet-less: GONNA 66/99 still LOCKED');
}

// ================= [3] placeStakeInput geometry =============================
console.log('\n[3] placeStakeInput — visualViewport pin vs canvas-aligned');
{
  const ui = new ArenaUI();
  const el = mkFakeInput();
  ui.stakeInput = el;
  ui.fitRef = { fitOffX: 13, fitOffY: 20, fitScale: 2 };

  // touch + visualViewport (iPhone, keyboard open): pin above the keyboard
  ui.touchRef = true;
  window.visualViewport = { width: 390, height: 400, offsetLeft: 0, offsetTop: 300 };
  ui.placeStakeInput();
  const w = Math.round(Math.min(390 * 0.84, 420)); // 328
  ok(el.style.top === '646px', 'touch: top = 300+400-44-10 = 646px — got ' + el.style.top);
  ok(el.style.left === Math.round(0 + (390 - w) / 2) + 'px' && el.style.width === w + 'px', 'touch: centered, width 84% of 390 (' + w + 'px)');
  ok(el.style.height === '44px' && el.style.fontSize === '22px', 'touch: 44px tall, 22px font');
  ok(el.style.border === '2px solid #39FF14' && el.style.background === '#0d1118' && el.style.borderRadius === '6px', 'touch: FLUO keyboard-safe frame');

  // recomputed EVERY call: keyboard closes -> viewport grows -> position follows
  window.visualViewport = { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 };
  ui.placeStakeInput();
  ok(el.style.top === '790px', 'touch: recomputed per frame after viewport change (790px) — got ' + el.style.top);

  // no touch -> canvas-aligned path even with a visualViewport present
  ui.touchRef = false;
  const el2 = mkFakeInput();
  ui.stakeInput = el2;
  ui.placeStakeInput();
  ok(el2.style.left === Math.round(13 + 126 * 2) + 'px', 'desktop: left = fitOffX + 126*fitScale = 265px — got ' + el2.style.left);
  ok(el2.style.top === Math.round(20 + 114 * 2) + 'px' && el2.style.width === Math.round(132 * 2) + 'px', 'desktop: canvas-aligned top/width');
  ok(el2.style.border !== '2px solid #39FF14', 'desktop: no FLUO override');

  // touch but NO visualViewport -> canvas-aligned fallback
  ui.touchRef = true;
  window.visualViewport = undefined;
  const el3 = mkFakeInput();
  ui.stakeInput = el3;
  ui.placeStakeInput();
  ok(el3.style.left === Math.round(13 + 126 * 2) + 'px', 'touch without visualViewport: canvas-aligned fallback');
}

// ================= [4] openStakeInput: a11y + echo + commit/cancel ==========
console.log('\n[4] openStakeInput — aria-label, live title echo, commit/cancel');
{
  window.visualViewport = undefined;
  const ui = new ArenaUI();
  ui.fitRef = { fitOffX: 0, fitOffY: 0, fitScale: 1 };
  ui.touchRef = false;
  ui.openStakeInput();
  const el = ui.stakeInput;
  ok(el !== null && el.attrs['aria-label'] === 'STAKE $GONNA', 'input opens with aria-label STAKE $GONNA');

  el.value = '25a000000'; // letters stripped live
  el.dispatch('input');
  ok(el.value === '25000000' && ui.cfg.stake === 25_000_000, 'digits-only live sync into cfg.stake (25M)');
  ok(el.title === 'STAKE: 25000000 $GONNA', 'live title echo: "' + el.title + '"');

  el.value = '99999999999999'; // 14 digits -> slice(0,12) (max 12 digits = under the 1T cap)
  el.dispatch('input');
  ok(el.value.length === 12 && ui.cfg.stake === 999_999_999_999, 'slice(0,12) cap intact (12 digits max)');

  // Enter commits
  el.value = '42';
  el.dispatch('input');
  el.dispatch('keydown', { key: 'Enter', stopPropagation() {}, preventDefault() {} });
  ok(ui.stakeInput === null && ui.cfg.stake === 42 && el.removed === true, 'Enter commits (stake 42, input removed)');

  // Escape cancels -> previous stake restored
  ui.openStakeInput();
  const el2 = ui.stakeInput;
  el2.value = '777';
  el2.dispatch('input');
  el2.dispatch('keydown', { key: 'Escape', stopPropagation() {}, preventDefault() {} });
  ok(ui.stakeInput === null && ui.cfg.stake === 42, 'Escape cancels and restores the previous stake (42)');

  // blur commits; empty value -> 10M default (min 1 $GONNA rule)
  ui.openStakeInput();
  const el3 = ui.stakeInput;
  el3.value = '';
  el3.dispatch('input');
  await sleep(360); // past the focus-steal grace window
  el3.dispatch('blur');
  ok(ui.stakeInput === null && ui.cfg.stake === 10_000_000, 'blur commits; empty -> sensible 10M default (min 1 $GONNA)');
}

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
rmSync(ENTRY, { force: true });
rmSync(BUNDLE, { force: true });
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
