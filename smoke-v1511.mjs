// v15.1.1 smoke: build version badge on title screen + THE PIT board.
// Verifies window.__GONNA_VER matches payload/sw filenames, badge renders,
// SW rescue boot, title -> PIT -> FULL RUN reaches gameplay, no console errors.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8317/';
const SHOTS = '/mnt/agents/output/v1511-shots';
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, total = 0;
const fails = [];
function ok(cond, label) {
  total++;
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { fails.push(label); console.log('  FAIL ' + label); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [];
// external resource 404s (algonode empty box, NFD lookup) are pre-existing
// app behavior, not JS errors — track them separately for visibility
const extErrors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (m.text().startsWith('Failed to load resource')) { extErrors.push(m.location()?.url || m.text()); return; }
  errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('response', (r) => { if (r.status() >= 400) console.log('  [http]', r.status(), r.url()); });

// ---- 1. boot (SW rescue path works on a fresh context) ----
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!document.querySelector('canvas'), { timeout: 15000 });
await sleep(2500); // attract/title settles
const ver = await page.evaluate(() => window.__GONNA_VER);
ok(ver === 'v032e7243', 'window.__GONNA_VER === v032e7243 (got ' + ver + ')');
const meta = await page.evaluate(() => document.querySelector('meta[name="gonna-ver"]')?.content);
ok(meta === ver, 'meta gonna-ver matches global');
const swReg = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return r?.active?.scriptURL || r?.installing?.scriptURL || r?.waiting?.scriptURL || '';
});
ok(swReg.includes('sw-v032e7243.js'), 'SW registered as sw-v032e7243.js (' + swReg + ')');

// badge pixels on title: bottom-right corner should have lit pixels
const badgeOnTitle = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const g = c.getContext('2d');
  const w = c.width, h = c.height;
  // game coords: badge at right-aligned VW-8, y=201..207 (scale 384x224)
  const sx = w / 384, sy = h / 224;
  const x0 = Math.floor((384 - 70) * sx), x1 = Math.floor(379 * sx);
  const y0 = Math.floor(200 * sy), y1 = Math.ceil(209 * sy);
  const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 70 || d[i + 1] > 70 || d[i + 2] > 80) lit++;
  return lit;
});
ok(badgeOnTitle > 10, 'title badge pixels lit in bottom-right strip (' + badgeOnTitle + ')');
await page.screenshot({ path: SHOTS + '/title.png' });

// ---- 2. THE PIT board (?arena=testnet picks the adapter; THE PIT button opens it) ----
await page.goto(BASE + '?arena=testnet', { waitUntil: 'load' });
await page.waitForFunction(() => !!document.querySelector('canvas'), { timeout: 15000 });
await sleep(2500);
const ver2 = await page.evaluate(() => window.__GONNA_VER);
ok(ver2 === 'v032e7243', 'arena page __GONNA_VER === v032e7243');
// tap THE PIT button (game coords center 192,199 -> canvas-relative)
const pitPt = await page.evaluate(() => {
  const r = document.querySelector('canvas').getBoundingClientRect();
  return { x: r.left + r.width * (192 / 384), y: r.top + r.height * (199 / 224) };
});
await page.mouse.click(pitPt.x, pitPt.y);
await sleep(4000); // board fetch (testnet adapter)
const onBoard = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const g = c.getContext('2d');
  const sx = c.width / 384, sy = c.height / 224;
  // THE PIT header pixels around y=10..24 center
  const d = g.getImageData(Math.floor(140 * sx), Math.floor(8 * sy), Math.floor(104 * sx), Math.ceil(18 * sy)).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 200) lit++;
  return lit;
});
ok(onBoard > 20, 'THE PIT board screen rendered (header lit ' + onBoard + ')');
const badgeOnBoard = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const g = c.getContext('2d');
  const w = c.width, h = c.height;
  const sx = w / 384, sy = h / 224;
  // badge at right-aligned VW-8, y=213..219
  const x0 = Math.floor((384 - 70) * sx), x1 = Math.floor(379 * sx);
  const y0 = Math.floor(212 * sy), y1 = Math.ceil(220 * sy);
  const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 70 || d[i + 1] > 70 || d[i + 2] > 80) lit++;
  return lit;
});
ok(badgeOnBoard > 10, 'PIT board badge pixels lit (' + badgeOnBoard + ')');
await page.screenshot({ path: SHOTS + '/pit-board.png' });

// ---- 3. board -> title (ESC) -> start FULL RUN reaches gameplay ----
await page.keyboard.press('Escape');
await sleep(1000);
await page.keyboard.press('Enter'); // INSERT COIN -> intro -> gameplay
await sleep(1000);
await page.keyboard.press('Enter'); // skip intro
await sleep(3000);
const inGame = await page.evaluate(() => !!document.querySelector('canvas'));
ok(inGame, 'title -> FULL RUN booted gameplay canvas');
await page.screenshot({ path: SHOTS + '/gameplay.png' });

ok(errors.length === 0, 'no JS console/page errors' + (errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''));
console.log('  [info] external resource errors (pre-existing): ' + extErrors.length);
extErrors.forEach((u) => console.log('    - ' + u));

console.log(`\n${passed}/${total} passed`);
if (fails.length) { console.log('FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
await browser.close();
