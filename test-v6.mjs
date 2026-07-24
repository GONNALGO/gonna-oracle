// GONNA FIGHT v6 — mobile touch controls verification (Playwright, touch emulation)
// + desktop regression smoke (keyboard intact, no touch UI).
// Full v3 desktop playthrough regression runs separately via test-v3.mjs.
import { chromium, devices } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const SHOTS = '/mnt/agents/output/shots-v6';
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

// ============================================================ MOBILE (touch)
console.log('=== MOBILE (iPhone 13 landscape, touch) ===');
const ctx = await browser.newContext({
  ...devices['iPhone 13 landscape'],
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
await sleep(400);

const G = (fn, ...args) => page.evaluate(fn, ...args);

// helper installed in the page: game coords -> client coords
await G(() => {
  window.__client = (gx, gy) => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.left + (gx / 384) * r.width, y: r.top + (gy / 224) * r.height };
  };
  window.__pe = (type, id, gx, gy) => {
    const c = document.querySelector('canvas');
    const p = window.__client(gx, gy);
    c.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: false,
      clientX: p.x, clientY: p.y, bubbles: true, cancelable: true,
    }));
  };
});
const tapGame = async (gx, gy) => {
  const p = await G((q) => window.__client(q.x, q.y), { x: gx, y: gy });
  await page.touchscreen.tap(p.x, p.y);
};

// ---- touch detection + tap-to-start ----
ok(await G(() => window.__gonna.touchActive === true), 'touch controls ACTIVE on touch device');
ok(await G(() => window.__gonna.sceneName === 'title'), 'title scene on boot');
ok(await G(() => document.querySelector('meta[name=viewport]').content.includes('user-scalable=no')), 'viewport meta blocks user scaling');
await tapGame(192, 112); // tap anywhere = insert coin
await sleep(300);
ok(await G(() => window.__gonna.sceneName === 'intro'), 'tap anywhere starts game (title -> intro)');
await sleep(800);
await tapGame(192, 112); // tap skips intro
ok(await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 5000 }).then(() => true).catch(() => false), 'second tap skips intro -> play');

// ---- floating joystick: dynamic origin, 8-way, dead zone, multi-touch ----
console.log('--- joystick ---');
const x0 = await G(() => window.__gonna.player.x);
await G(() => window.__pe('pointerdown', 7, 60, 180));
await sleep(60);
ok(await G(() => window.__gonna.touch.joyActive), 'joystick spawns on left-half touch');
const joy = await G(() => ({ x: window.__gonna.touch.joyOriginX, y: window.__gonna.touch.joyOriginY }));
ok(Math.abs(joy.x - 60) < 3 && Math.abs(joy.y - 180) < 3, 'joystick origin = touch point (dynamic origin)');
await G(() => window.__pe('pointermove', 7, 100, 180)); // push right
await sleep(60);
ok(await G(() => { const i = window.__gonna.input.down; return i.right && !i.left && !i.up && !i.down; }), 'joystick RIGHT held');
await sleep(450);
const x1 = await G(() => window.__gonna.player.x);
ok(x1 > x0 + 3, 'player walks right with joystick (' + x0.toFixed(0) + ' -> ' + x1.toFixed(0) + ')');
await G(() => window.__pe('pointermove', 7, 60, 140)); // push up
await sleep(60);
ok(await G(() => { const i = window.__gonna.input.down; return i.up && !i.right && !i.left && !i.down; }), 'joystick UP held (8-way switch)');
await G(() => window.__pe('pointermove', 7, 95, 145)); // diagonal up-right
await sleep(60);
ok(await G(() => { const i = window.__gonna.input.down; return i.up && i.right && !i.left && !i.down; }), 'joystick diagonal UP+RIGHT (8-way)');
await G(() => window.__pe('pointermove', 7, 62, 181)); // inside dead zone
await sleep(60);
ok(await G(() => { const i = window.__gonna.input.down; return !i.up && !i.right && !i.left && !i.down; }), 'dead zone: no direction inside 7px');

// multi-touch: keep joystick held, tap PUNCH with a second finger
await G(() => window.__pe('pointermove', 7, 100, 180)); // right again
await sleep(60);
await tapGame(333, 168); // PUNCH button
await sleep(120);
ok(await G(() => window.__gonna.input.down.right), 'multi-touch: joystick still held while punching');
await G(() => window.__pe('pointerup', 7, 100, 180));
await sleep(60);
ok(await G(() => { const i = window.__gonna.input.down; return !i.right; }) && await G(() => !window.__gonna.touch.joyActive), 'joystick released on pointerup');
await sleep(400); // let punch finish

// ---- arcade buttons ----
console.log('--- buttons ---');
await tapGame(333, 168); // PUNCH
ok(await page.waitForFunction(() => window.__gonna.player.state === 'punch', null, { timeout: 2000 }).then(() => true).catch(() => false), 'PUNCH button -> punch state');
await sleep(400);
await tapGame(300, 182); // KICK
ok(await page.waitForFunction(() => window.__gonna.player.state === 'kick', null, { timeout: 2000 }).then(() => true).catch(() => false), 'KICK button -> kick state');
await sleep(500);
await tapGame(329, 201); // JUMP
ok(await page.waitForFunction(() => window.__gonna.player.state === 'jump' && window.__gonna.player.z > 2, null, { timeout: 2000 }).then(() => true).catch(() => false), 'JUMP button -> airborne');
await tapGame(333, 168); // punch mid-air -> jump kick
ok(await page.waitForFunction(() => window.__gonna.player.state === 'jumpkick', null, { timeout: 1500 }).then(() => true).catch(() => false), 'PUNCH in air -> jump kick');
await page.waitForFunction(() => window.__gonna.player.z <= 0 && window.__gonna.player.state !== 'jumpkick', null, { timeout: 3000 }).catch(() => {});
await G(() => { window.__gonna.player.meter = 3; });
await tapGame(361, 195); // SPECIAL
ok(await page.waitForFunction(() => window.__gonna.player.state === 'special', null, { timeout: 2000 }).then(() => true).catch(() => false), 'SPECIAL button -> BYZANTINE SLAM');
await page.waitForFunction(() => window.__gonna.player.state === 'idle', null, { timeout: 4000 }).catch(() => {});

// ---- touch combo chain + haptics ----
console.log('--- combo + haptics ---');
await G(() => { window.__gonna.player.invuln = 99999; window.__vibes.length = 0; });
for (let i = 0; i < 8; i++) {
  await G(() => {
    const g = window.__gonna;
    if (!g.enemies.some((e) => e.alive)) g.debugSpawn('gecko', 36);
    g.player.invuln = 99999;
  });
  await tapGame(333, 168); // PUNCH
  await sleep(300);
}
const combo = await G(() => window.__gonna.comboState);
ok(combo.hits >= 5, 'touch combo chain: ' + combo.hits + ' hits, rank ' + combo.rank);
const vibes = await G(() => window.__vibes);
ok(vibes.includes(10), 'haptic: 10ms on hit landed');
ok(vibes.some((v) => Array.isArray(v) && v[0] === 15 && v[2] === 15), 'haptic: double pulse on combo rank-up');
ok(vibes.includes(40), 'haptic: 40ms on finisher');
await G(() => window.__gonna.debugKillEnemies());
await sleep(400);
ok((await G(() => window.__vibes)).includes(20), 'haptic: 20ms on KO');
await G(() => { const g = window.__gonna; g.player.invuln = 0; g.player.hurt({ dmg: 1, kb: 0, down: false, dir: 1 }, g); });
await sleep(150);
ok((await G(() => window.__vibes)).includes(30), 'haptic: 30ms on player hurt');
await G(() => { window.__gonna.player.invuln = 99999; });

// ---- object lift: PUNCH near object, NO DOWN needed (relaxed touch rule) ----
console.log('--- object lift ---');
await G(() => {
  const g = window.__gonna;
  g.debugKillEnemies();
  const o = g.objects.find((q) => q.mode === 'idle' && q.cfg.liftable);
  g.debugWarp(o.x - (o.cfg.halfW + 10)); // edge distance 10: beyond desktop reach (+8), inside touch reach (+12)
  g.player.y = o.y;
  g.player.state = 'idle';
  g.player.face = -1; // face AWAY so a whiffed swing can't smash the can
});
await sleep(200);
await G(() => { window.__gonna.input.touchMode = false; }); // prove desktop rule would whiff here
await tapGame(333, 168);
await sleep(500);
ok(await G(() => window.__gonna.carriedObject === null), 'desktop tolerance (no DOWN) whiffs at edge +10px');
ok(await G(() => window.__gonna.objects.some((q) => q.mode === 'idle' && q.cfg.liftable)), 'whiff spared the object (faced away)');
await page.waitForFunction(() => window.__gonna.player.state === 'idle' || window.__gonna.player.state === 'walk', null, { timeout: 3000 });
await G(() => {
  const g = window.__gonna;
  g.input.touchMode = true;
  const o = g.objects.find((q) => q.mode === 'idle' && q.cfg.liftable);
  g.debugWarp(o.x - (o.cfg.halfW + 10));
  g.player.y = o.y;
  g.player.state = 'idle';
  g.player.face = -1;
});
await sleep(120);
await tapGame(333, 168);
await sleep(300);
ok(await G(() => window.__gonna.carriedObject !== null), 'touch lift: PUNCH near object lifts WITHOUT DOWN');
await G(() => window.__pe('pointerdown', 9, 60, 180));
await G(() => window.__pe('pointermove', 9, 100, 180));
await sleep(200);
const carryX = await G(() => window.__gonna.player.x);
await sleep(300);
ok((await G(() => window.__gonna.player.x)) > carryX, 'can walk while carrying (joystick)');
await tapGame(300, 182); // KICK = throw the object
await sleep(300);
ok(await G(() => window.__gonna.carriedObject === null && window.__gonna.projectiles.length > 0), 'KICK while carrying throws the object');
await G(() => window.__pe('pointerup', 9, 100, 180));

// ---- pause + mute ----
console.log('--- pause / mute ---');
await tapGame(253, 10); // PAUSE button
await sleep(150);
ok(await G(() => window.__gonna.isPaused), 'PAUSE button pauses the game');
const px = await G(() => window.__gonna.player.x);
await sleep(300);
ok((await G(() => window.__gonna.player.x)) === px, 'sim frozen while paused');
await tapGame(253, 10);
await sleep(150);
ok(await G(() => !window.__gonna.isPaused), 'PAUSE button resumes');
await tapGame(277, 10); // MUTE button
await sleep(120);
ok(await G(() => window.__gonna.audio.muted === true), 'MUTE button mutes audio');
await tapGame(277, 10);
await sleep(120);
ok(await G(() => window.__gonna.audio.muted === false), 'MUTE button unmutes');

// ---- screenshots: gameplay with controls (joystick held for visibility) ----
await G(() => window.__pe('pointerdown', 11, 62, 178));
await G(() => window.__pe('pointermove', 11, 92, 162));
await sleep(250);
await page.screenshot({ path: SHOTS + '/mobile-gameplay-controls.png' });
await G(() => window.__pe('pointerup', 11, 92, 162));

// ---- portrait rotate overlay ----
console.log('--- orientation ---');
await page.setViewportSize({ width: 390, height: 844 }); // portrait
await sleep(400);
ok(await G(() => {
  const el = document.getElementById('rotate-overlay');
  return !!el && getComputedStyle(el).display === 'flex';
}), 'portrait shows RUOTA IL TELEFONO overlay');
await page.screenshot({ path: SHOTS + '/portrait-rotate-overlay.png' });
await page.setViewportSize({ width: 844, height: 390 }); // back to landscape
await sleep(400);
ok(await G(() => {
  const el = document.getElementById('rotate-overlay');
  return !!el && getComputedStyle(el).display === 'none';
}), 'overlay disappears on landscape');

// ---- no scroll / no zoom ----
ok(await G(() => window.scrollX === 0 && window.scrollY === 0), 'no page scroll after touch session');
ok(await G(() => getComputedStyle(document.body).touchAction === 'none'), 'touch-action: none on body');

// mobile FPS sample
const mfps = await G(() => new Promise((res) => {
  let n = 0;
  const t0 = performance.now();
  const loop = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(loop); else res(n / 1.5); };
  requestAnimationFrame(loop);
}));
ok(mfps >= 55, 'mobile FPS ~60 with touch UI (got ' + mfps.toFixed(1) + ')');

await ctx.close();

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
const dy0 = await D(() => window.__gonna.player.y);
await dpage.keyboard.down('ArrowUp');
await sleep(300);
await dpage.keyboard.up('ArrowUp');
ok((await D(() => window.__gonna.player.y)) < dy0, 'keyboard ArrowUp moves up the lane');
await dpage.keyboard.press('KeyZ');
ok(await dpage.waitForFunction(() => window.__gonna.player.state === 'punch', null, { timeout: 2000 }).then(() => true).catch(() => false), 'keyboard Z punches');
await sleep(400);
// quick keyboard combo sanity
await D(() => { const g = window.__gonna; g.debugSpawn('gecko', 36); g.player.invuln = 99999; });
for (let i = 0; i < 3; i++) {
  await dpage.keyboard.press('KeyZ');
  await sleep(300);
}
ok((await D(() => window.__gonna.comboCount)) >= 2, 'keyboard combo chain still works');
await D(() => window.__gonna.debugKillEnemies());
// desktop lift rule unchanged: same +19px spot must whiff without DOWN
await D(() => {
  const g = window.__gonna;
  const o = g.objects.find((q) => q.mode === 'idle' && q.cfg.liftable);
  g.debugWarp(o.x - (o.cfg.halfW + 10));
  g.player.y = o.y;
  g.player.state = 'idle';
  g.player.face = -1; // face away: whiff must not smash the can
});
await sleep(200);
await dpage.keyboard.press('KeyZ');
await sleep(400);
ok(await D(() => window.__gonna.carriedObject === null), 'desktop: Z at edge +10px without DOWN still whiffs (rule intact)');
// v5 enemies still spawn and act
for (const k of ['moltov', 'bull', 'cultist']) {
  await D((kind) => window.__gonna.debugSpawn(kind, 70), k);
}
await sleep(700);
const infos = await D(() => window.__gonna.enemyInfo);
ok(['moltov', 'bull', 'cultist'].every((k) => infos.some((e) => e.kind === k && e.alive)), 'v5 enemies spawn+act (moltov/bull/cultist)');
await D(() => window.__gonna.debugKillEnemies());
await sleep(200);
await dpage.screenshot({ path: SHOTS + '/desktop-no-touch-ui.png' });
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
