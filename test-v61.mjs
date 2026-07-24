// GONNA FIGHT v6.1 — true fullscreen mobile verification (Playwright, touch emulation)
// A. full-bleed canvas + internal letterbox (landscape fills full height)
// B. iPhone-style rotation resilience (resize/orientation refit, 3x rotate loop)
// C. portrait redesign: game view full-width at top, big controls below, ZOOM toggle
// D. desktop regression: no touch UI, keyboard intact, centered letterbox
import { chromium, devices } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const SHOTS = '/mnt/agents/output/shots-v61';
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
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });

// ============================================================ MOBILE PORTRAIT (iPhone 390x844)
console.log('=== MOBILE PORTRAIT (iPhone 13, 390x844, touch) ===');
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  hasTouch: true,
});
await ctx.addInitScript(() => {
  window.__vibes = [];
  const rec = (p) => { window.__vibes.push(JSON.parse(JSON.stringify(p))); return true; };
  try { Object.defineProperty(navigator, 'vibrate', { value: rec, configurable: true }); }
  catch { navigator.vibrate = rec; }
});
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
await sleep(500);

const G = (fn, ...args) => page.evaluate(fn, ...args);

// helper: dispatch synthetic touch pointer events in CLIENT (css px) coords
const installHelpers = () => G(() => {
  window.__pe = (type, id, cx, cy) => {
    const c = document.querySelector('canvas');
    c.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: false,
      clientX: cx, clientY: cy, bubbles: true, cancelable: true,
    }));
  };
});
await installHelpers();
const viewSize = () => G(() => ({ w: window.innerWidth, h: window.innerHeight }));
const tapCss = async (x, y) => page.touchscreen.tap(x, y);
const fit = () => G(() => window.__gonna.fit);
const pad = () => G(() => window.__gonna.touch.padLayout.map((b) => ({ x: b.x, y: b.y, r: b.r, btn: b.btn })));
const sys = () => G(() => window.__gonna.touch.sysLayout);
const canvasRect = () => G(() => {
  const r = document.querySelector('canvas').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
// tap a pad/system button by its current layout position
const tapPad = async (btn) => {
  const b = (await pad()).find((q) => q.btn === btn);
  await tapCss(b.x, b.y);
};
const tapSys = async (name) => {
  const s = await sys();
  const r = s[name];
  await tapCss(r.x + r.w / 2, r.y + r.h / 2);
};

// ---- A/B: full-bleed canvas ----
let vw = await viewSize();
let cr = await canvasRect();
ok(near(cr.x, 0, 1) && near(cr.y, 0, 1) && near(cr.w, vw.w, 1) && near(cr.h, vw.h, 1),
  'canvas covers the whole portrait viewport (' + cr.w + 'x' + cr.h + '@' + cr.x + ',' + cr.y + ')');

// ---- C: portrait FIT layout: full width at top, controls below ----
let f = await fit();
ok(f.touch === true && f.portrait === true, 'fit detects touch portrait');
ok(near(f.fitScale, vw.w / 384, 0.02), 'portrait FIT scale = vw/384 (' + f.fitScale.toFixed(3) + ')');
ok(near(f.fitOffX, 0, 1), 'portrait game view anchored at left edge (full width)');
const gameBottom = f.fitOffY + 224 * f.fitScale;
ok(gameBottom < vw.h * 0.45, 'game view in UPPER portion (bottom=' + gameBottom.toFixed(0) + 'px of ' + vw.h + ')');
ok(await G(() => window.__gonna.touchActive === true), 'touch controls ACTIVE');

let pd = await pad();
ok(pd.every((b) => b.y - b.r > gameBottom), 'arcade buttons live in the free lower area');
ok(pd.every((b) => b.x - b.r >= 0 && b.x + b.r <= vw.w && b.y + b.r <= vw.h), 'arcade buttons inside viewport');
const punchR = pd.find((b) => b.btn === 'punch').r;
ok(punchR >= 34, 'portrait buttons are LARGE (punch r=' + punchR.toFixed(0) + 'px)');
let sy = await sys();
ok(sy.pause.y >= gameBottom && sy.mute.y >= gameBottom && sy.zoom.y >= gameBottom,
  'system buttons (pause/mute/zoom) below the game view: never over HUD');
ok(sy.pause.w >= 36, 'portrait system buttons finger-sized (' + sy.pause.w + 'px)');

// ---- start the game via taps ----
ok(await G(() => window.__gonna.sceneName === 'title'), 'title scene on boot');
await tapCss(vw.w / 2, vw.h * 0.6);
await sleep(300);
ok(await G(() => window.__gonna.sceneName === 'intro'), 'tap starts game (title -> intro)');
await sleep(600);
await tapCss(vw.w / 2, vw.h * 0.6);
ok(await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 5000 }).then(() => true).catch(() => false), 'tap skips intro -> play');

// ---- joystick: left half of the ACTUAL viewport, dynamic origin, walks ----
console.log('--- portrait controls ---');
const joyY = gameBottom + 220;
const x0 = await G(() => window.__gonna.player.x);
await G((y) => window.__pe('pointerdown', 7, 80, y), joyY);
await sleep(60);
ok(await G(() => window.__gonna.touch.joyActive), 'joystick spawns on left-half touch');
const joy = await G(() => ({ x: window.__gonna.touch.joyOriginX, y: window.__gonna.touch.joyOriginY }));
ok(near(joy.x, 80, 2) && near(joy.y, joyY, 2), 'joystick origin = touch point (screen space)');
await G((y) => window.__pe('pointermove', 7, 130, y), joyY);
await sleep(60);
ok(await G(() => { const i = window.__gonna.input.down; return i.right && !i.left && !i.up && !i.down; }), 'joystick RIGHT held');
await sleep(450);
const x1 = await G(() => window.__gonna.player.x);
ok(x1 > x0 + 3, 'player walks right with joystick (' + x0.toFixed(0) + ' -> ' + x1.toFixed(0) + ')');
await G((y) => window.__pe('pointermove', 7, 82, y), joyY); // inside dead zone
await sleep(60);
ok(await G(() => { const i = window.__gonna.input.down; return !i.up && !i.right && !i.left && !i.down; }), 'dead zone: no direction near origin');
await G((y) => window.__pe('pointerup', 7, 82, y), joyY);
await sleep(60);
ok(await G(() => !window.__gonna.touch.joyActive && !window.__gonna.input.down.right), 'joystick released on pointerup');

// ---- arcade buttons ----
await tapPad('punch');
ok(await page.waitForFunction(() => window.__gonna.player.state === 'punch', null, { timeout: 2000 }).then(() => true).catch(() => false), 'PUNCH button -> punch state');
await sleep(400);
await tapPad('jump');
ok(await page.waitForFunction(() => window.__gonna.player.state === 'jump' && window.__gonna.player.z > 2, null, { timeout: 2000 }).then(() => true).catch(() => false), 'JUMP button -> airborne');
await page.waitForFunction(() => window.__gonna.player.z <= 0 && window.__gonna.player.state !== 'jump', null, { timeout: 3000 }).catch(() => {});

// ---- pause / mute ----
await tapSys('pause');
await sleep(150);
ok(await G(() => window.__gonna.isPaused), 'PAUSE button pauses the game');
await tapSys('pause');
await sleep(150);
ok(await G(() => !window.__gonna.isPaused), 'PAUSE button resumes');
await tapSys('mute');
await sleep(120);
ok(await G(() => window.__gonna.audio.muted === true), 'MUTE button mutes audio');
await tapSys('mute');
await sleep(120);
ok(await G(() => window.__gonna.audio.muted === false), 'MUTE button unmutes');

// ---- screenshot: portrait FIT with controls (joystick held for visibility) ----
await G((y) => window.__pe('pointerdown', 11, 78, y), gameBottom + 230);
await G((y) => window.__pe('pointermove', 11, 112, y - 26), gameBottom + 230);
await sleep(250);
await page.screenshot({ path: SHOTS + '/portrait-fit.png' });
await G((y) => window.__pe('pointerup', 11, 112, y - 26), gameBottom + 230);
await sleep(200);

// ---- ZOOM toggle ----
console.log('--- ZOOM toggle ---');
const fitScale = (await fit()).fitScale;
await tapSys('zoom');
await sleep(300);
f = await fit();
ok(f.zoom === true, 'ZOOM toggle activates zoom mode');
ok(f.zoomScale > fitScale * 1.3, 'ZOOM scale fills more height (' + f.zoomScale.toFixed(2) + ' vs fit ' + fitScale.toFixed(2) + ')');
ok(f.zoomVisW < 384, 'ZOOM crops stage sides (visible ' + f.zoomVisW.toFixed(0) + ' of 384 game px)');
ok(await G(() => window.localStorage.getItem('gonna.zoom') === '1'), 'ZOOM persisted to localStorage');
await G(() => window.__pe('pointerdown', 12, 90, 500));
await G(() => window.__pe('pointermove', 12, 130, 500));
await sleep(250);
await page.screenshot({ path: SHOTS + '/portrait-zoom.png' });
await G(() => window.__pe('pointerup', 12, 130, 500));
// walk right in zoom: camera must keep the player centered (no crash, sim alive)
const zx0 = await G(() => window.__gonna.player.x);
await G(() => window.__pe('pointerdown', 13, 90, 500));
await G(() => window.__pe('pointermove', 13, 140, 500));
await sleep(500);
await G(() => window.__pe('pointerup', 13, 140, 500));
ok((await G(() => window.__gonna.player.x)) > zx0 + 3, 'player walks while ZOOMED (crop camera follows)');
// HUD survives zoom: G-METER pixels rendered via the uncropped FIT overlay pass
ok(await G(() => window.__gonna.sceneName === 'play'), 'still in play scene after zoom walking');
ok(await G(() => {
  const c = document.querySelector('canvas');
  const g = c.getContext('2d');
  const f = window.__gonna.fit;
  const sx = Math.round((f.fitOffX + 340 * f.fitScale) * f.dpr); // G-METER box (game x 318..384)
  const sy = Math.round((f.fitOffY + 6 * f.fitScale) * f.dpr);
  const w = Math.round(40 * f.fitScale * f.dpr);
  const h = Math.round(18 * f.fitScale * f.dpr);
  const d = g.getImageData(sx, sy, w, h).data;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 40) return true;
  return false;
}), 'HUD (G-METER) still rendered while ZOOMED (uncropped overlay pass)');

// persistence across reload
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
await sleep(400);
ok(await G(() => window.__gonna.zoomOn === true), 'ZOOM preference survives reload');
f = await fit();
ok(f.zoom === true, 'zoom mode re-applied after reload');
await installHelpers(); // helpers are wiped by reload
// turn zoom off, re-enter play
await G(() => { window.__gonna.toggleZoom(); });
await sleep(200);
ok((await fit()).zoom === false && (await G(() => window.localStorage.getItem('gonna.zoom'))) === '0', 'ZOOM toggles back to FIT + persists');
await tapCss(vw.w / 2, vw.h * 0.6);
await sleep(300);
await tapCss(vw.w / 2, vw.h * 0.6);
await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 5000 }).catch(() => {});

// ---- B: rotation resilience — 3x portrait <-> landscape, never stuck ----
console.log('--- rotation x3 ---');
let rotOk = true;
let rotBackOk = true;
for (let i = 0; i < 3; i++) {
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(600);
  cr = await canvasRect();
  f = await fit();
  if (!(near(cr.w, 844, 1) && near(cr.h, 390, 1))) rotOk = false;
  if (!(f.portrait === false && near(f.fitScale, 390 / 224, 0.03))) rotOk = false;
  if (i === 0) {
    ok(near(cr.w, 844, 1) && near(cr.h, 390, 1), 'landscape: canvas = full viewport (' + cr.w + 'x' + cr.h + ')');
    ok(near(f.fitScale, 390 / 224, 0.03), 'landscape: game height = viewport height (scale ' + f.fitScale.toFixed(3) + ')');
    ok(near(f.fitOffX, (844 - 384 * f.fitScale) / 2, 2) && f.fitOffX > 40, 'landscape: side bars centered (' + f.fitOffX.toFixed(0) + 'px each)');
    ok(near(f.fitOffY, 0, 1), 'landscape: game view flush to top/bottom (offY=' + f.fitOffY + ')');
    await page.screenshot({ path: SHOTS + '/landscape-filled.png' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(600);
  cr = await canvasRect();
  f = await fit();
  vw = await viewSize();
  if (!(near(cr.w, vw.w, 1) && near(cr.h, vw.h, 1) && f.portrait === true && near(f.fitScale, vw.w / 384, 0.02))) rotBackOk = false;
}
ok(rotOk, 'rotate to landscape x3: always full-bleed, full height, never stuck');
ok(rotBackOk, 'rotate back to portrait x3: portrait layout restored every time');
await page.screenshot({ path: SHOTS + '/after-rotation.png' });
ok(await G(() => window.__gonna.sceneName === 'play'), 'game still alive after 6 rotations');
// joystick still works after the rotation storm
await G(() => window.__pe('pointerdown', 21, 80, 600));
await G(() => window.__pe('pointermove', 21, 130, 600));
await sleep(60);
ok(await G(() => window.__gonna.input.down.right === true), 'joystick works after rotation storm');
await G(() => window.__pe('pointerup', 21, 130, 600));

// ---- landscape system buttons: top-band gap, never over HUD ----
await page.setViewportSize({ width: 844, height: 390 });
await sleep(600);
f = await fit();
sy = await sys();
const gmeterLeft = f.fitOffX + 318 * f.fitScale; // G-METER starts at game x=318
const scoreRight = f.fitOffX + 210 * f.fitScale; // centered score ends well before x=210
ok(sy.pause.x >= scoreRight - 1 && sy.zoom.x + sy.zoom.w <= gmeterLeft + 1,
  'landscape pause/mute/zoom sit in the HUD gap (never over score/G-METER/TIME)');
pd = await pad();
ok(pd.every((b) => b.x - b.r >= 0 && b.x + b.r <= 844 && b.y - b.r >= 0 && b.y + b.r <= 390), 'landscape buttons inside viewport (reachable)');
await tapPad('punch');
ok(await page.waitForFunction(() => window.__gonna.player.state === 'punch', null, { timeout: 2000 }).then(() => true).catch(() => false), 'landscape PUNCH reachable + works');
await sleep(300);

// ---- no scroll, haptics alive, fps ----
ok(await G(() => window.scrollX === 0 && window.scrollY === 0), 'no page scroll after touch session');
const mfps = await G(() => new Promise((res) => {
  let n = 0;
  const t0 = performance.now();
  const loop = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(loop); else res(n / 1.5); };
  requestAnimationFrame(loop);
}));
ok(mfps >= 55, 'mobile FPS ~60 with v6.1 layout (got ' + mfps.toFixed(1) + ')');
await ctx.close();

// ============================================================ PIXEL LANDSCAPE
console.log('=== PIXEL 5 LANDSCAPE (851x393, touch) ===');
const pctx = await browser.newContext({
  ...devices['Pixel 5 landscape'],
  hasTouch: true,
});
const ppage = await pctx.newPage();
ppage.on('pageerror', (e) => pageErrors.push('pixel pageerror: ' + e.message));
ppage.on('console', (m) => { if (m.type() === 'error') pageErrors.push('pixel console: ' + m.text()); });
await ppage.goto(BASE, { waitUntil: 'networkidle' });
await ppage.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
await sleep(500);
const P = (fn, ...args) => ppage.evaluate(fn, ...args);
const pv = await P(() => ({ w: window.innerWidth, h: window.innerHeight }));
const pcr = await P(() => {
  const r = document.querySelector('canvas').getBoundingClientRect();
  return { w: r.width, h: r.height };
});
ok(near(pcr.w, pv.w, 1) && near(pcr.h, pv.h, 1), 'pixel landscape: canvas = full viewport (' + pcr.w + 'x' + pcr.h + ')');
const pf = await P(() => window.__gonna.fit);
ok(near(pf.fitScale, pv.h / 224, 0.03), 'pixel landscape: game height = viewport height');
// reach play + punch via layout coords
await P(() => {
  window.__pe2 = (type, id, cx, cy) => {
    const c = document.querySelector('canvas');
    c.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: false,
      clientX: cx, clientY: cy, bubbles: true, cancelable: true,
    }));
  };
});
await ppage.touchscreen.tap(pv.w / 2, pv.h / 2);
await sleep(300);
await ppage.touchscreen.tap(pv.w / 2, pv.h / 2);
await ppage.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 5000 }).catch(() => {});
const ppd = await P(() => window.__gonna.touch.padLayout.map((b) => ({ x: b.x, y: b.y, r: b.r, btn: b.btn })));
ok(ppd.every((b) => b.x + b.r <= pv.w && b.y + b.r <= pv.h && b.x - b.r >= 0 && b.y - b.r >= 0), 'pixel landscape: buttons reachable');
const pb = ppd.find((b) => b.btn === 'punch');
await ppage.touchscreen.tap(pb.x, pb.y);
ok(await ppage.waitForFunction(() => window.__gonna.player.state === 'punch', null, { timeout: 2000 }).then(() => true).catch(() => false), 'pixel landscape: PUNCH works');
await pctx.close();

// ============================================================ DESKTOP (no touch)
console.log('=== DESKTOP (keyboard regression) ===');
const dctx = await browser.newContext({ viewport: { width: 768, height: 448 } });
const dpage = await dctx.newPage();
dpage.on('pageerror', (e) => pageErrors.push('desktop pageerror: ' + e.message));
dpage.on('console', (m) => { if (m.type() === 'error') pageErrors.push('desktop console: ' + m.text()); });
await dpage.goto(BASE, { waitUntil: 'networkidle' });
await dpage.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
await sleep(400);
const D = (fn, ...args) => dpage.evaluate(fn, ...args);

ok(await D(() => window.__gonna.touchActive === false), 'touch controls INACTIVE on desktop');
ok(await D(() => window.__gonna.input.touchMode === false), 'desktop lift tolerance unchanged (touchMode off)');
const dcr = await D(() => {
  const r = document.querySelector('canvas').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
ok(near(dcr.w, 768, 1) && near(dcr.h, 448, 1), 'desktop: canvas full viewport');
const df = await D(() => window.__gonna.fit);
ok(near(df.fitScale, 2, 0.01) && near(df.fitOffX, 0, 1) && near(df.fitOffY, 0, 1), 'desktop: centered 2x letterbox as before');
await dpage.keyboard.press('Enter');
await sleep(400);
ok(await D(() => window.__gonna.sceneName === 'intro'), 'keyboard Enter starts game');
await sleep(700);
await dpage.keyboard.press('Enter');
await dpage.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 5000 });
const dx0 = await D(() => window.__gonna.player.x);
await dpage.keyboard.down('ArrowRight');
await sleep(450);
await dpage.keyboard.up('ArrowRight');
ok((await D(() => window.__gonna.player.x)) > dx0 + 3, 'keyboard ArrowRight walks');
await dpage.keyboard.press('KeyZ');
ok(await dpage.waitForFunction(() => window.__gonna.player.state === 'punch', null, { timeout: 2000 }).then(() => true).catch(() => false), 'keyboard Z punches');
await sleep(400);
await D(() => { const g = window.__gonna; g.debugSpawn('gecko', 36); g.player.invuln = 99999; });
for (let i = 0; i < 3; i++) {
  await dpage.keyboard.press('KeyZ');
  await sleep(300);
}
ok((await D(() => window.__gonna.comboCount)) >= 2, 'keyboard combo chain still works');
await D(() => window.__gonna.debugKillEnemies());
// desktop resize keeps centered letterbox
await dpage.setViewportSize({ width: 1024, height: 700 });
await sleep(400);
const df2 = await D(() => window.__gonna.fit);
ok(near(df2.fitScale, Math.min(1024 / 384, 700 / 224), 0.02) && near(df2.fitOffX, (1024 - 384 * df2.fitScale) / 2, 2), 'desktop resize: letterbox recenters');
await dpage.setViewportSize({ width: 768, height: 448 });
await sleep(400);
await dpage.screenshot({ path: SHOTS + '/desktop.png' });
await dctx.close();

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
