// GONNA FIGHT v6.2 — PWA fullscreen install + iOS Add-to-Home hint verification
// A. manifest.webmanifest served, valid, subfolder-safe (relative paths)
// B. index.html PWA meta tags (manifest link, apple-touch-icon, capable metas)
// C. iOS Safari (not standalone): hint appears in landscape / on play, ONCE;
//    dismiss persists across reload
// D. iOS standalone (navigator.standalone=true): NO hint
// E. desktop: NO hint, game unchanged
// F. zero page errors everywhere
import { chromium, devices } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const SHOTS = '/mnt/agents/output/shots-v62';
mkdirSync(SHOTS, { recursive: true });

let passed = 0;
let total = 0;
const pageErrors = [];
function ok(cond, label) {
  total++;
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { console.log('  FAIL ' + label); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
const watch = (page, tag) => {
  page.on('pageerror', (e) => pageErrors.push(tag + ' pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(tag + ' console: ' + m.text()); });
};
const hintCount = (page) => page.locator('#gonna-a2hs').count();

// ============================================================ A/B: manifest + meta (desktop fetch)
console.log('=== A/B: MANIFEST + HTML META ===');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  watch(page, 'meta');
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const manifest = await page.evaluate(async () => {
    const r = await fetch('manifest.webmanifest');
    if (!r.ok) return { __status: r.status };
    return r.json();
  });
  ok(!manifest.__status, 'manifest.webmanifest served (200)');
  ok(manifest.name === 'GONNA FIGHT', 'manifest name = GONNA FIGHT');
  ok(manifest.short_name === 'GONNA', 'manifest short_name = GONNA');
  ok(manifest.display === 'fullscreen', 'manifest display = fullscreen');
  ok(Array.isArray(manifest.display_override) && manifest.display_override[0] === 'fullscreen' && manifest.display_override[1] === 'standalone', 'manifest display_override [fullscreen, standalone]');
  ok(manifest.orientation === 'any', 'manifest orientation = any');
  ok(manifest.background_color === '#070a14' && manifest.theme_color === '#070a14', 'manifest colors #070a14');
  ok(manifest.start_url === '.' && manifest.scope === '.', 'manifest start_url/scope relative (subfolder-safe)');
  const iconsOk = Array.isArray(manifest.icons) && manifest.icons.length >= 2 &&
    manifest.icons.every((i) => !i.src.startsWith('/') && i.purpose === 'any') &&
    manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512');
  ok(iconsOk, 'manifest icons 192/512, relative, purpose any');
  const iconFetch = await page.evaluate(async (src) => (await fetch(src)).status, manifest.icons[0].src);
  ok(iconFetch === 200, 'manifest icon src resolves (200)');

  const metas = await page.evaluate(() => ({
    manifestLink: document.querySelector('link[rel="manifest"]')?.getAttribute('href') || null,
    appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') || null,
    mwa: document.querySelector('meta[name="mobile-web-app-capable"]')?.content || null,
    amwa: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content || null,
    statusBar: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content || null,
    appTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content || null,
  }));
  ok(metas.manifestLink === 'manifest.webmanifest' || metas.manifestLink === './manifest.webmanifest', 'html: relative manifest link');
  ok(!!metas.appleIcon && !metas.appleIcon.startsWith('/'), 'html: relative apple-touch-icon');
  ok(metas.mwa === 'yes', 'html: mobile-web-app-capable=yes');
  ok(metas.amwa === 'yes', 'html: apple-mobile-web-app-capable=yes');
  ok(metas.statusBar === 'black-translucent', 'html: status-bar-style black-translucent');
  ok(metas.appTitle === 'GONNA', 'html: apple-mobile-web-app-title GONNA');
  await ctx.close();
}

// ============================================================ C: iOS Safari, NOT standalone
console.log('=== C: iOS SAFARI (not standalone) — hint once, dismiss persists ===');
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true });
  const page = await ctx.newPage();
  watch(page, 'ios');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
  await sleep(1200);

  // portrait + title screen: NOT yet (user neither landscape nor playing)
  ok((await hintCount(page)) === 0, 'iOS portrait title: no hint yet');

  // rotate to landscape -> hint appears
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(1200);
  ok((await hintCount(page)) === 1, 'iOS landscape: hint appears');
  await page.screenshot({ path: SHOTS + '/hint-landscape.png' });
  const card = page.locator('#gonna-a2hs');
  await card.screenshot({ path: SHOTS + '/hint-card.png' });

  // non-blocking: card wrapper must not eat pointer events; OK button does
  const pe = await page.evaluate(() => {
    const el = document.getElementById('gonna-a2hs');
    const btn = document.getElementById('gonna-a2hs-ok');
    return { card: getComputedStyle(el).pointerEvents, btn: getComputedStyle(btn).pointerEvents };
  });
  ok(pe.card === 'none' && pe.btn === 'auto', 'hint pointer-events: card none, OK auto');
  const txt = (await card.innerText()).toUpperCase();
  ok(txt.includes('FULLSCREEN') && txt.includes('CONDIVIDI') && txt.includes('AGGIUNGI A HOME'), 'hint text: Condividi -> Aggiungi a Home');

  // dismiss
  await page.locator('#gonna-a2hs-ok').click();
  await sleep(300);
  ok((await hintCount(page)) === 0, 'OK dismisses the hint');
  ok(await page.evaluate((k) => localStorage.getItem(k) === '1', 'gonna.a2hs.v1'), 'localStorage flag set');

  // reload -> never again (same context = same localStorage)
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
  await sleep(1500);
  ok((await hintCount(page)) === 0, 'after reload: no hint (persisted)');
  await ctx.close();

  // fresh device, hint triggered by PLAYING in portrait (not landscape)
  const ctx2 = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true });
  const page2 = await ctx2.newPage();
  watch(page2, 'ios2');
  await page2.goto(BASE, { waitUntil: 'networkidle' });
  await page2.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
  await sleep(600);
  await page2.touchscreen.tap(195, 300); // title: tap anywhere = start
  await page2.waitForFunction(() => window.__gonna.sceneName !== 'title', null, { timeout: 5000 });
  await page2.evaluate(() => { const g = window.__gonna; g.debugSkipIntro ? g.debugSkipIntro() : null; });
  await page2.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 8000 }).catch(() => {});
  const scene = await page2.evaluate(() => window.__gonna.sceneName);
  await sleep(1200); // poll interval
  ok(scene === 'play' && (await hintCount(page2)) === 1, 'iOS portrait + playing: hint appears');
  await page2.screenshot({ path: SHOTS + '/hint-portrait-playing.png' });
  await ctx2.close();
}

// ============================================================ D: iOS standalone (PWA mode) — no hint
console.log('=== D: iOS STANDALONE (navigator.standalone=true) — no hint ===');
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true });
  await ctx.addInitScript(() => {
    try { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }); }
    catch { navigator.standalone = true; }
  });
  const page = await ctx.newPage();
  watch(page, 'standalone');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
  await page.setViewportSize({ width: 844, height: 390 }); // landscape
  await sleep(2000);
  ok((await hintCount(page)) === 0, 'standalone landscape: no hint');
  // game still fills the whole viewport in standalone landscape
  const cr = await page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { w: r.width, h: r.height, iw: window.innerWidth, ih: window.innerHeight };
  });
  ok(cr.w === cr.iw && cr.h === cr.ih, 'standalone landscape: canvas fills 100% viewport');
  await ctx.close();
}

// ============================================================ E: desktop — no hint
console.log('=== E: DESKTOP — no hint, unchanged ===');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
  await sleep(1500);
  ok((await hintCount(page)) === 0, 'desktop landscape: no hint');
  await page.keyboard.press('Enter');
  await sleep(300);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 5000 });
  await sleep(1500);
  ok((await hintCount(page)) === 0, 'desktop playing: no hint');
  await ctx.close();
}

await browser.close();

console.log('=================================');
console.log('ASSERTIONS: ' + passed + '/' + total);
if (pageErrors.length) {
  console.log('PAGE ERRORS (' + pageErrors.length + '):');
  for (const e of pageErrors.slice(0, 12)) console.log('  ' + e);
} else {
  console.log('PAGE ERRORS: 0');
}
process.exit(passed === total && pageErrors.length === 0 ? 0 : 1);
