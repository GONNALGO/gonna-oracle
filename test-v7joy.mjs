// GONNA FIGHT v7joy — bulletproof mobile joystick verification (headless Chromium, touch emulation)
//   1. joystick hold -> pointercancel (on WINDOW, iOS-steal path) WITHOUT up -> released, new touch works
//   2. rotation mid-hold -> no ghost, no stuck direction, fresh touch works after rotate (both ways)
//   3. stuck joyId (debug injection, lost up/cancel) -> new left-half touch reclaims
//   4. spawn attempts over the II/M/Z row in portrait do NOT create a joystick
//   5. hold-still joystick (no pointermove for 1.5s) is NEVER falsely released
//   6. multi-touch: joystick + punch simultaneously, independent release
//   7. scene transition (play -> intro) force-releases joystick + buttons; late ups harmless
//   8. zero page errors
// Run: node test-v7joy.mjs   (needs the vite preview on :4173)
import { chromium, devices } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const SHOTS = process.env.SHOT_DIR || '/tmp/v7joy-shots';
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let total = 0;
const fails = [];
function ok(cond, label) {
  total++;
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { fails.push(label); console.log('  FAIL ' + label); }
}

const pageErrors = [];
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
await sleep(400);

const G = (fn, ...args) => page.evaluate(fn, ...args);
// synthetic touch pointer events: __pe -> canvas, __we -> window (backstop path)
await G(() => {
  const mk = (type, id, cx, cy) => new PointerEvent(type, {
    pointerId: id, pointerType: 'touch', isPrimary: false,
    clientX: cx, clientY: cy, bubbles: true, cancelable: true,
  });
  window.__pe = (type, id, cx, cy) => { document.querySelector('canvas').dispatchEvent(mk(type, id, cx, cy)); };
  window.__we = (type, id, cx, cy) => { window.dispatchEvent(mk(type, id, cx, cy)); };
});

const joyActive = () => G(() => window.__gonna.touch.joyActive);
const dirState = () => G(() => {
  const i = window.__gonna.input.down;
  return { l: i.left, r: i.right, u: i.up, d: i.down };
});
const ptrCount = () => G(() => window.__gonna.touch.ptrCount);
const playerX = () => G(() => window.__gonna.player.x);

async function startPlay() {
  await page.touchscreen.tap(195, 422);
  await sleep(350);
  await page.touchscreen.tap(195, 422);
  await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 6000 });
}
async function calm() { // deterministic walking: no enemies, no damage
  await G(() => { window.__gonna.debugKillEnemies(); window.__gonna.player.invuln = 999999; window.__gonna.debugWarp(100); });
  await sleep(120);
}

await startPlay();
ok(await G(() => window.__gonna.input.touchMode === true), 'mobile: touch controls active');
const sy = await G(() => window.__gonna.touch.sysLayout);
const zoneTop = await G(() => window.__gonna.touch.joyZoneTop);
const fitP = await G(() => window.__gonna.fit);
console.log('  portrait ' + fitP.cssW + 'x' + fitP.cssH + ', sys row y=' + sy.pause.y + '..' + (sy.pause.y + sy.pause.h) + ', joyZoneTop=' + zoneTop);

// ============================ 1. CANCEL WITHOUT UP (iOS steal, window path) ============================
console.log('\n[1] pointercancel without up -> release + immediate re-touch');
await calm();
await G(() => window.__pe('pointerdown', 5, 80, 600));
await G(() => window.__pe('pointermove', 5, 135, 600));
await sleep(80);
ok(await joyActive(), 'joystick held before the steal');
ok((await dirState()).r === true, 'RIGHT held before the steal');
// iOS steals the gesture: the cancel NEVER reaches the canvas — window backstop only
await G(() => window.__we('pointercancel', 5, 135, 600));
await sleep(60);
ok(!(await joyActive()), 'window-level pointercancel releases the joystick (backstop)');
{
  const d = await dirState();
  ok(!d.l && !d.r && !d.u && !d.d, 'no direction stuck after the steal');
}
ok((await ptrCount()) === 0, 'no ghost pointer left in tracking');
// a new touch works IMMEDIATELY (this was the user-reported deadlock)
const x0 = await playerX();
await G(() => window.__pe('pointerdown', 6, 80, 600));
await sleep(50);
ok(await joyActive(), 'new left-half touch spawns joystick immediately after steal');
await G(() => window.__pe('pointermove', 6, 140, 600));
await sleep(60);
ok((await dirState()).r === true, 'new joystick drives RIGHT');
await page.waitForFunction((x) => window.__gonna.player.x > x + 3, x0, { timeout: 5000 }).catch(() => {});
ok((await playerX()) > x0 + 3, 'player walks with the post-steal joystick (' + x0.toFixed(0) + ' -> ' + (await playerX()).toFixed(0) + ')');
await G(() => window.__pe('pointerup', 6, 140, 600));
await sleep(50);
ok(!(await joyActive()), 'clean release after normal up');

// ============================ 2. ROTATION MID-HOLD ============================
console.log('\n[2] rotation mid-hold -> drop, never ghost');
await calm();
await G(() => window.__pe('pointerdown', 7, 80, 600));
await G(() => window.__pe('pointermove', 7, 135, 600));
await sleep(80);
ok(await joyActive() && (await dirState()).r, 'joystick held RIGHT in portrait');
await page.setViewportSize({ width: 844, height: 390 }); // rotate to landscape
await sleep(800); // refit timers at 0/80/320ms must all have settled
ok(!(await joyActive()), 'rotation force-releases the joystick (no ghost base)');
{
  const d = await dirState();
  ok(!d.l && !d.r && !d.u && !d.d, 'no stuck direction after rotation');
}
ok((await ptrCount()) === 0, 'ghost pointer swept on rotation');
// the late up for the dead pointer must be harmless
await G(() => window.__we('pointerup', 7, 135, 600));
await sleep(50);
ok(!(await joyActive()) && (await ptrCount()) === 0, 'late up of the rotated-away pointer is a no-op');
// fresh touch in landscape: joystick + movement work right away
const lx0 = await playerX();
await G(() => window.__pe('pointerdown', 8, 100, 300));
await sleep(50);
ok(await joyActive(), 'landscape: fresh left-half touch spawns joystick');
const ljoy = await G(() => ({ x: window.__gonna.touch.joyOriginX, y: window.__gonna.touch.joyOriginY }));
ok(Math.abs(ljoy.x - 100) <= 2 && Math.abs(ljoy.y - 300) <= 2, 'landscape: origin at the NEW touch point (no stale coords)');
await G(() => window.__pe('pointermove', 8, 160, 300));
await sleep(60);
await page.waitForFunction((x) => window.__gonna.player.x > x + 3, lx0, { timeout: 5000 }).catch(() => {});
ok((await playerX()) > lx0 + 3, 'landscape: player walks after rotation');
await G(() => window.__pe('pointerup', 8, 160, 300));
// rotate BACK to portrait while holding a new joystick
await G(() => window.__pe('pointerdown', 9, 100, 300));
await G(() => window.__pe('pointermove', 9, 160, 300));
await sleep(80);
ok(await joyActive(), 'joystick held in landscape before rotating back');
await page.setViewportSize({ width: 390, height: 844 });
await sleep(800);
ok(!(await joyActive()) && !(await dirState()).r, 'rotate back to portrait: dropped again, never ghosted');
await G(() => window.__we('pointerup', 9, 160, 300)); // late up, harmless
const px0 = await playerX();
await G(() => window.__pe('pointerdown', 10, 80, 600));
await G(() => window.__pe('pointermove', 10, 140, 600));
await sleep(60);
await page.waitForFunction((x) => window.__gonna.player.x > x + 3, px0, { timeout: 5000 }).catch(() => {});
ok((await playerX()) > px0 + 3, 'portrait: movement works after rotating back');
await G(() => window.__pe('pointerup', 10, 140, 600));
await sleep(50);

// ============================ 3. STUCK joyId (lost up/cancel) -> RECLAIM ============================
console.log('\n[3] debug-injected stuck joyId -> new touch reclaims');
await calm();
await G(() => window.__gonna.touch.debugStickJoy(4242, 60, 260)); // ghost near the sys row, holds RIGHT
ok(await joyActive(), 'ghost joystick injected (the reported deadlock state)');
ok((await dirState()).r === true, 'ghost holds a stale direction');
ok((await ptrCount()) === 0, 'ghost has NO tracked pointer (its up/cancel was lost)');
await G(() => window.__pe('pointerdown', 11, 80, 620)); // user taps again -> must reclaim
await sleep(60);
ok(await joyActive(), 'reclaim: new touch adopts the joystick');
const rjoy = await G(() => ({ x: window.__gonna.touch.joyOriginX, y: window.__gonna.touch.joyOriginY }));
ok(Math.abs(rjoy.x - 80) <= 2 && Math.abs(rjoy.y - 620) <= 2, 'reclaim: origin moved to the new touch (ghost position gone)');
{
  const d = await dirState();
  ok(!d.l && !d.r && !d.u && !d.d, 'reclaim: stale ghost direction cleared');
}
ok((await ptrCount()) === 1, 'reclaim: exactly one tracked pointer (the new touch)');
const rx0 = await playerX();
await G(() => window.__pe('pointermove', 11, 140, 620));
await sleep(60);
await page.waitForFunction((x) => window.__gonna.player.x > x + 3, rx0, { timeout: 5000 }).catch(() => {});
ok((await playerX()) > rx0 + 3, 'reclaim: movement works with the adopted touch');
await G(() => window.__pe('pointerup', 11, 140, 620));
await sleep(50);
ok(!(await joyActive()) && (await ptrCount()) === 0, 'reclaim: clean release afterwards');

// ============================ 4. SPAWN ZONE: II/M/Z ROW IS OFF-LIMITS ============================
console.log('\n[4] spawn attempts over the sys-buttons row (portrait) do NOT create a joystick');
await calm();
// a point INSIDE the sys-row band but NOT on any button (between Z and center)
const gapX = Math.round(((sy.zoom.x + sy.zoom.w) + fitP.cssW / 2) / 2); // ~170 on 390 wide
const rowY = Math.round(sy.pause.y + sy.pause.h / 2);
await G((p) => window.__pe('pointerdown', 12, p.x, p.y), { x: gapX, y: rowY });
await sleep(60);
ok(!(await joyActive()), 'touch beside II/M/Z on the sys row: NO joystick spawned');
ok(await G(() => !window.__gonna.isPaused), 'sys buttons untouched (game not paused)');
await G((p) => window.__pe('pointerup', 12, p.x, p.y), { x: gapX, y: rowY });
// a point just under the game view but ABOVE the sys row
const gb = fitP.fitOffY + 224 * fitP.fitScale;
await G((y) => window.__pe('pointerdown', 13, 80, y), Math.round(gb + 4));
await sleep(60);
ok(!(await joyActive()), 'touch in the gap above the sys row: NO joystick spawned');
await G((y) => window.__pe('pointerup', 13, 80, y), Math.round(gb + 4));
// and just below the row boundary it DOES spawn (zone edge is exact)
await G((y) => window.__pe('pointerdown', 14, 80, y), Math.round(zoneTop + 2));
await sleep(60);
ok(await joyActive(), 'touch below the sys row: joystick spawns (zone edge exact)');
await G((y) => window.__pe('pointerup', 14, 80, y), Math.round(zoneTop + 2));
await sleep(50);
ok((await ptrCount()) === 0, 'spawn-zone probes left no tracked pointers');

// ============================ 5. HOLD-STILL IS NEVER FALSELY RELEASED ============================
console.log('\n[5] hold-still joystick (no events for 1.5s) stays alive');
await calm();
await G(() => window.__pe('pointerdown', 15, 80, 600));
await G(() => window.__pe('pointermove', 15, 135, 600));
await sleep(80);
ok(await joyActive() && (await dirState()).r, 'joystick held RIGHT');
await sleep(1500); // finger perfectly still: ZERO pointer events
ok(await joyActive(), 'still active after 1.5s of silence (no watchdog)');
ok((await dirState()).r === true, 'RIGHT still held after 1.5s of silence');
const sx0 = await playerX();
await sleep(400);
ok((await playerX()) > sx0 + 2, 'player kept walking while the finger was still');
await G(() => window.__pe('pointerup', 15, 135, 600));
await sleep(50);
ok(!(await joyActive()) && !(await dirState()).r, 'clean release after hold-still');

// ============================ 6. MULTI-TOUCH: JOYSTICK + PUNCH ============================
console.log('\n[6] multi-touch: joystick + punch simultaneously');
await calm();
const punch = await G(() => window.__gonna.touch.padLayout.find((b) => b.btn === 'punch'));
await G(() => window.__pe('pointerdown', 16, 80, 620));
await G(() => window.__pe('pointermove', 16, 135, 620));
await sleep(60);
await G((p) => window.__pe('pointerdown', 17, p.x, p.y), { x: Math.round(punch.x), y: Math.round(punch.y) });
await sleep(60);
ok(await G(() => window.__gonna.input.down.punch === true), 'punch held while joystick held');
ok(await joyActive() && (await dirState()).r, 'joystick RIGHT still held with punch down');
ok((await ptrCount()) === 2, 'two pointers tracked independently');
await G((p) => window.__pe('pointerup', 17, p.x, p.y), { x: Math.round(punch.x), y: Math.round(punch.y) });
await sleep(60);
ok(await G(() => window.__gonna.input.down.punch === false), 'punch released');
ok(await joyActive() && (await dirState()).r, 'joystick SURVIVES the punch release');
await G(() => window.__pe('pointerup', 16, 135, 620));
await sleep(50);
ok(!(await joyActive()) && (await ptrCount()) === 0, 'joystick released last, tracking empty');

// ============================ 7. SCENE TRANSITION FORCE-RELEASE ============================
console.log('\n[7] scene transition (play -> intro) force-releases joystick + buttons');
await calm();
await G(() => window.__pe('pointerdown', 18, 80, 620));
await G(() => window.__pe('pointermove', 18, 135, 620));
await G((p) => window.__pe('pointerdown', 19, p.x, p.y), { x: Math.round(punch.x), y: Math.round(punch.y) });
await sleep(80);
ok(await joyActive() && (await dirState()).r, 'joystick held before the scene cut');
ok(await G(() => window.__gonna.input.down.punch === true), 'punch held before the scene cut');
await G(() => window.__gonna.debugStage(0)); // play -> intro (real setScene path)
await sleep(80);
ok(await G(() => window.__gonna.sceneName === 'intro'), 'scene cut to intro');
ok(!(await joyActive()), 'joystick force-released on scene cut');
{
  const d = await dirState();
  ok(!d.l && !d.r && !d.u && !d.d, 'no direction leaked into the new scene');
}
ok(await G(() => window.__gonna.input.down.punch === false), 'punch force-released on scene cut');
ok((await ptrCount()) === 0, 'all pointers swept on scene cut');
// late ups for the pre-cut fingers must be harmless no-ops
await G(() => window.__we('pointerup', 18, 135, 620));
await G((p) => window.__we('pointerup', 19, p.x, p.y), { x: Math.round(punch.x), y: Math.round(punch.y) });
await sleep(50);
ok((await ptrCount()) === 0 && !(await joyActive()), 'late ups after scene cut are no-ops');
// back to play: joystick fully functional
await page.touchscreen.tap(195, 422);
await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 6000 });
await calm();
const fx0 = await playerX();
await G(() => window.__pe('pointerdown', 20, 80, 620));
await G(() => window.__pe('pointermove', 20, 140, 620));
await sleep(60);
await page.waitForFunction((x) => window.__gonna.player.x > x + 3, fx0, { timeout: 5000 }).catch(() => {});
ok((await playerX()) > fx0 + 3, 'joystick works in the new play scene');
await G(() => window.__pe('pointerup', 20, 140, 620));

// ============================ 8. PAGE ERRORS ============================
console.log('\n[8] page errors');
ok(pageErrors.length === 0, 'zero page errors (' + pageErrors.length + ')' + (pageErrors.length ? ' -> ' + pageErrors.join(' | ') : ''));

await page.screenshot({ path: SHOTS + '/v7joy-final.png' });
await ctx.close();
await browser.close();
console.log('\n=================================');
console.log('V7JOY ASSERTIONS: ' + passed + '/' + total);
if (fails.length) { console.log('FAILURES: ' + fails.join(' | ')); process.exit(1); }
