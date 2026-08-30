// v17.0.5 — carrier cornered-JUKE test (Prince's live report: golden snake
// pinned at the screen edge, back turned, looked bugged). Drives the real
// engine headless via the QA hooks: pin the carrier at the left edge with the
// player closing in, assert it BURSTS past him toward the far side.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:4173/?qa=1', { waitUntil: 'networkidle' });
const ev = (fn, arg) => page.evaluate(fn, arg);

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } };

console.log('[juke] cornered carrier bursts past the hunter');
await ev(() => window.__gonna.debugDescent(1, 'JUKE-TEST'));

// find a seed moment with a carrier out; then pin it: player just inside the
// left edge, carrier clamped at the left edge fleeing left (off-screen).
const res = await ev(() => {
  const g = window.__gonna;
  const WALKKILL = [
    { f: 0, down: { right: true } },
    { f: 0, cmd: 'killNonCarrier' }, { f: 33, cmd: 'killNonCarrier' }, { f: 66, cmd: 'killNonCarrier' },
    { f: 8, press: ['punch'] }, { f: 28, press: ['punch'] }, { f: 48, press: ['punch'] },
    { f: 58, press: ['kick'] }, { f: 68, press: ['punch'] }, { f: 88, press: ['punch'] },
    { f: 70, press: ['jump'] },
  ];
  // fast-forward until a carrier is on the field (seeded 45%/wave from w2)
  for (let i = 0; i < 300; i++) {
    g.debugSim({ frames: 100, tape: WALKKILL, god: true });
    const c = g.enemies.find((e) => e.alive && e.kind === 'carrier');
    if (c) break;
  }
  const c = g.enemies.find((e) => e.alive && e.kind === 'carrier');
  if (!c) return { found: false };
  // PIN: carrier at left edge, player close on its right (dx0 > 0 => flees left)
  c.x = g.camX + 16; c.y = g.player.y; c.state = 'seek'; c.t = 0;
  g.player.x = c.x + 60; g.player.state = 'idle'; g.player.t = 0;
  const x0 = c.x;
  const trace = [];
  for (let f = 0; f < 120; f++) {
    g.debugSim({ frames: 1, tape: [], god: true });
    if (f % 10 === 0) trace.push(Math.round(c.x - g.camX));
    if (!c.alive) break;
  }
  return { found: true, x0: Math.round(x0 - g.camX), trace, jukeT_seen: c.jukeT > 0, finalX: Math.round(c.x - g.camX), alive: c.alive, face: c.face, state: c.state };
});

ok(res.found, 'carrier on field (seeded spawn found)');
if (res.found) {
  console.log('    pinned at screen-x', res.x0, '-> trace:', res.trace.join(','), '| final screen-x:', res.finalX, '| state:', res.state, '| face:', res.face);
  // pre-fix behavior: x stays clamped at 16 forever (statue). post-fix: it
  // must MOVE SIGNIFICANTLY RIGHT (juke burst past the player).
  ok(res.finalX > res.x0 + 60, `cornered carrier escapes the edge (x0=${res.x0} -> ${res.finalX})`);
  ok(res.trace.some((x) => x > res.x0 + 30), 'visible burst within 120 frames (not a statue)');
}

// regression: un-cornered carrier still flees normally + escape clock intact
console.log('[juke] regression: normal flee unchanged');
const res2 = await ev(() => {
  const g = window.__gonna;
  g.debugDescent(1, 'JUKE-REG');
  const WALKKILL = [
    { f: 0, down: { right: true } },
    { f: 0, cmd: 'killNonCarrier' }, { f: 33, cmd: 'killNonCarrier' }, { f: 66, cmd: 'killNonCarrier' },
    { f: 8, press: ['punch'] }, { f: 28, press: ['punch'] }, { f: 48, press: ['punch'] },
    { f: 58, press: ['kick'] }, { f: 68, press: ['punch'] }, { f: 88, press: ['punch'] },
    { f: 70, press: ['jump'] },
  ];
  for (let i = 0; i < 300; i++) {
    g.debugSim({ frames: 100, tape: WALKKILL, god: true });
    const c = g.enemies.find((e) => e.alive && e.kind === 'carrier');
    if (c) break;
  }
  const c = g.enemies.find((e) => e.alive && e.kind === 'carrier');
  if (!c) return { found: false };
  // carrier mid-screen, player FAR away: should drift/flee, never juke
  c.x = g.camX + 200; c.state = 'seek'; c.t = 0;
  g.player.x = g.camX + 30; g.player.state = 'idle';
  let juked = false;
  for (let f = 0; f < 60; f++) { g.debugSim({ frames: 1, tape: [], god: true }); if (c.jukeT > 0) juked = true; }
  return { found: true, juked, face: c.face };
});
ok(res2.found && !res2.juked, 'no juke when NOT cornered (flee logic untouched)');
ok(res2.found && res2.face === 1, 'still back-turned flee (hunter left -> runs right, face=+1)');

console.log(`\nRESULT: pass=${pass} fail=${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
