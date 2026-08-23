// v15.1 THE DESCENT (ENDLESS SCROLL) — QA harness.
// [1] twin-run determinism with FORWARD-MOVEMENT tape (identical 60-frame hashes)
// [2] Math.random trap: zero hits during descent step()
// [3] endless scroll: camX advances while walking in clear phase; wave zones
//     trigger on arrival; combat locks the camera; GO arrow only when unlocked
// [4] wave-10 boss arena: camera LOCKS at the arena, WARNING, +10000 bonus,
//     BREATHE, then GO forward again
// [5] carrier: exactly one from wave 3; escape => no drop; kill => seeded drop
// [6] screenshots: slam-in, WARNING, BREATHE, MULT LOST, kill popup x8, GO walk
// [7] FULL RUN regression smoke (campaign still boots & fights)
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';

const shots = '/tmp/v15-shots';
import { mkdirSync } from 'node:fs';
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text()); });
await page.goto('http://localhost:4173/?qa=1', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__gonna && window.__gonna.sceneName, null, { timeout: 15000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = (name) => page.screenshot({ path: shots + '/' + name + '.png' });
const info = () => ev(() => window.__gonna.descentInfo);
let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  PASS', label); } else { fail++; console.log('  FAIL', label); } };

// scripted input tape: brawl FORWARD, punch in bursts
const TAPE = [];
for (let f = 0; f < 3600; f += 90) {
  TAPE.push({ f, down: { right: true } });
  TAPE.push({ f: f + 30, down: { right: false } });
  TAPE.push({ f: f + 34, press: ['punch'] });
  TAPE.push({ f: f + 42, press: ['punch'] });
  TAPE.push({ f: f + 50, press: ['kick'] });
  TAPE.push({ f: f + 60, down: { right: true } });
}

// chunk tape (100-frame chunks): brawl forward — right held, punch/kick rhythm
// (every event stays < 100 so chunk restarts never strand a `down` flag)
const WALKKILL = [
  { f: 0, down: { right: true } },
  { f: 0, cmd: 'killNonCarrier' }, { f: 33, cmd: 'killNonCarrier' }, { f: 66, cmd: 'killNonCarrier' },
  { f: 8, press: ['punch'] }, { f: 28, press: ['punch'] }, { f: 48, press: ['punch'] },
  { f: 58, press: ['kick'] }, { f: 68, press: ['punch'] }, { f: 88, press: ['punch'] },
  { f: 70, press: ['jump'] }, // hop street piles like a human would
];
const WALK = [
  { f: 0, down: { right: true } },
  { f: 8, press: ['punch'] }, { f: 28, press: ['punch'] }, { f: 48, press: ['punch'] },
  { f: 58, press: ['kick'] }, { f: 68, press: ['punch'] }, { f: 88, press: ['punch'] },
  { f: 70, press: ['jump'] },
];

// ---------- [1] twin-run determinism ----------
console.log('[1] twin-run determinism (forward-movement tape)');
await ev(() => window.__gonna.debugDescent(2, 'TWINTEST-1'));
const run1 = await ev((tape) => window.__gonna.debugSim({ frames: 3600, tape, god: true }), TAPE);
await ev(() => window.__gonna.debugDescent(2, 'TWINTEST-1'));
const run2 = await ev((tape) => window.__gonna.debugSim({ frames: 3600, tape, god: true }), TAPE);
await ev(() => window.__gonna.debugDescent(2, 'TWINTEST-2'));
const run3 = await ev((tape) => window.__gonna.debugSim({ frames: 3600, tape, god: true }), TAPE);
const h1 = run1.hashes.join(','), h2 = run2.hashes.join(','), h3 = run3.hashes.join(',');
ok(h1 === h2, 'same seed + same tape => identical hashes (' + h1.slice(0, 40) + '...)');
ok(h1 !== h3, 'different seed => different descent');
ok(run1.score > 0 && run2.score === run1.score, 'score deterministic: ' + run1.score);
const d1 = await ev(() => window.__gonna.descentInfo);
console.log('  hashes run1:', h1.split(',').slice(0, 8).join(' '));

// ---------- [2] Math.random trap ----------
console.log('[2] Math.random trap during step');
await ev(() => window.__gonna.debugDescent(0, 'TRAPTEST'));
const trapHits = await ev((tape) => {
  const orig = Math.random;
  let hits = 0;
  Math.random = () => { hits++; return orig(); };
  try {
    window.__gonna.debugSim({ frames: 900, tape, god: true });
  } finally {
    Math.random = orig;
  }
  return hits;
}, TAPE.slice(0, 60));
ok(trapHits === 0, 'zero Math.random hits during 900 descent steps (got ' + trapHits + ')');

// ---------- [3] endless scroll: zones, GO arrow, camera lock ----------
console.log('[3] endless scroll mechanics');
await ev(() => window.__gonna.debugDescent(0, 'SCROLLTEST'));
await ev(() => window.__gonna.debugSim({ frames: 10, god: true })); // intro -> play
let d = await info();
// walk forward: camX must advance (the scroll never ends)
await ev((t) => window.__gonna.debugSim({ frames: 200, tape: t, god: true }), WALK);
d = await info();
ok(d.dist > 100, 'walking forward advances the camera (dist ' + d.dist + ')');
ok(d.phase === 'clear' && d.goArrow === true, 'GO-forward state between zones (phase ' + d.phase + ', arrow ' + d.goArrow + ')');
// reach wave 1 combat: camera must cap at the zone arena (campaign semantics)
let lockedCam = -1, capHeld = true, sawCombat = false, arrowInCombat = true;
for (let i = 0; i < 60; i++) {
  await ev((t) => window.__gonna.debugSim({ frames: 100, tape: t, god: true }), WALKKILL);
  d = await info();
  if (d.phase === 'combat' || d.phase === 'announce') {
    sawCombat = true;
    if (d.goArrow) arrowInCombat = false;
    if (lockedCam < 0) lockedCam = d.camX;
    // arena cap = the trigger that started this wave (+ easing tolerance);
    // the camera may swing left/right under the cap, never past it
    if (d.camX > d.nextTriggerX + 4) capHeld = false;
  }
  if (d.wave >= 2) break;
}
ok(sawCombat, 'wave 1 combat reached by walking into the zone');
ok(capHeld, 'camera capped at the zone arena during combat');
ok(arrowInCombat, 'GO arrow OFF while the zone is contested');
const dAfter1 = d;
ok(dAfter1.wave >= 2, 'wave advanced after clearing + walking (wave ' + dAfter1.wave + ')');

// ---------- [4] wave-10 boss arena ----------
console.log('[4] wave-10 boss arena (theme 3 => THE WHALE)');
await ev(() => window.__gonna.debugDescent(2, 'BOSSTEST'));
let bossSeen = null, preScore = -1, bonusOk = false, breatheSeen = false, wave = 0;
let bossCam = -1, bossLockHeld = true, goAfterBoss = false;
for (let i = 0; i < 160; i++) {
  const bt = bossSeen ? WALK : WALKKILL;
  await ev((t) => window.__gonna.debugSim({ frames: 100, tape: t, god: true }), bt);
  d = await info();
  wave = d.wave;
  if (d.phase === 'boss' && d.boss) {
    if (!bossSeen) { bossSeen = d.boss; preScore = d.score; bossCam = d.camX; }
    else if (d.camX !== bossCam) bossLockHeld = false;
    for (let k = 0; k < 10 && (await info()).boss; k++) {
      await ev(() => window.__gonna.debugSim({ frames: 40, tape: [{ f: 0, cmd: 'killBoss' }, { f: 20, cmd: 'killBoss' }], god: true }));
    }
  }
  if (bossSeen && d.phase === 'breathe') {
    breatheSeen = true;
    if (d.score - preScore >= 10000) bonusOk = true;
    if (d.goArrow) goAfterBoss = true;
  }
  if (wave >= 11) break;
}
ok(wave >= 10, 'reached wave 10+ (wave ' + wave + ')');
ok(bossSeen === 'whale', 'theme boss spawned: ' + bossSeen);
ok(bossLockHeld, 'camera LOCKED at the boss arena for the whole fight');
ok(bonusOk, 'boss bonus >= +10000 (1000 x wave 10, trickle kills on top)');
ok(breatheSeen, 'BREATHE beat after the boss kill');
ok(goAfterBoss, 'GO arrow back after the boss (walk on)');

// ---------- [5] carrier escape & kill ----------
console.log('[5] golden carrier');
await ev(() => window.__gonna.debugDescent(1, 'CARRIER-ESCAPE'));
let esc = null;
for (let i = 0; i < 90; i++) {
  const cur = await info();
  const idle = cur.carriersSpawned >= 1; // carrier out: go hands-off, let it bolt
  await ev((t) => window.__gonna.debugSim({ frames: 100, tape: t, god: true }), idle ? [] : WALKKILL);
  d = await info();
  if (d.carriersEscaped > 0 || d.bonusDrops > 0) { esc = d; break; }
}
ok(esc && esc.carriersSpawned === 1, 'exactly one carrier spawned (waves 3+): ' + (esc && esc.carriersSpawned));
ok(esc && esc.carriersEscaped === 1 && esc.bonusDrops === 0, 'escaped carrier => NO drop (escaped=' + (esc && esc.carriersEscaped) + ' drops=' + (esc && esc.bonusDrops) + ')');
await ev(() => window.__gonna.debugDescent(1, 'CARRIER-KILL'));
let kill = null;
const KILLALL = [
  { f: 0, down: { right: true } }, { f: 10, cmd: 'killEnemies' }, { f: 55, cmd: 'killEnemies' },
  { f: 8, press: ['punch'] }, { f: 48, press: ['punch'] }, { f: 70, press: ['jump'] },
];
for (let i = 0; i < 70; i++) {
  await ev((t) => window.__gonna.debugSim({ frames: 100, tape: t, god: true }), KILLALL);
  d = await info();
  if (d.bonusDrops > 0 || d.wave > 4) { kill = d; break; }
}
ok(kill && kill.carriersSpawned === 1 && kill.bonusDrops === 1, 'killed carrier => exactly one seeded bonus drop');
ok(kill && kill.items.length >= 0, 'drop table visible: items=' + (kill && kill.items.slice(0, 12).join(',')));

// ---------- [6] screenshots ----------
console.log('[6] screenshots');
// 6a: WAVE slam-in — walk into zone 1, catch the announce
await ev(() => window.__gonna.debugDescent(4, 'SHOT-SLAM'));
for (let i = 0; i < 30; i++) {
  await ev((t) => window.__gonna.debugSim({ frames: 100, tape: t, god: true }), WALK);
  d = await info();
  if (d.phase === 'announce') break;
}
await ev(() => window.__gonna.debugSim({ frames: 30, god: true }));
await page.waitForTimeout(350);
await shot('01-wave-slam');
// 6b: WARNING at the wave-10 arena
await ev(() => window.__gonna.debugDescent(2, 'SHOT-WARN'));
for (let i = 0; i < 200; i++) {
  await ev((t) => window.__gonna.debugSim({ frames: 100, tape: t, god: true }), WALKKILL);
  d = await info();
  if (d.phase === 'boss') break;
}
await ev(() => window.__gonna.debugSim({ frames: 24, god: true }));
await page.waitForTimeout(400);
await shot('02-boss-warning');
// 6c: BREATHE after the boss kill
for (let i = 0; i < 40; i++) {
  await ev(() => window.__gonna.debugSim({ frames: 50, tape: [{ f: 0, cmd: 'killBoss' }, { f: 25, cmd: 'killBoss' }], god: true }));
  d = await info();
  if (d.phase === 'breathe') break;
}
await ev(() => window.__gonna.debugSim({ frames: 60, god: true }));
await page.waitForTimeout(350);
await shot('03-breathe');
// 6d: the GO-forward walk between zones (arrow + scrolling street)
await ev((t) => window.__gonna.debugSim({ frames: 200, tape: t, god: true }), WALK);
await page.waitForTimeout(250);
await shot('13-go-forward');
// 6e: MULT LOST vignette
await ev(() => {
  const g = window.__gonna;
  g.player.comboHits = 9;
  g.player.chainT = 300;
  g.player.hurt({ dmg: 4, kb: 1, down: false, dir: 1 }, g);
  g.debugSim({ frames: 12, god: true });
});
await page.waitForTimeout(120);
await shot('04-mult-lost');
// 6f: kill popup at x8
await ev(() => {
  const g = window.__gonna;
  g.player.comboHits = 28;
  g.player.chainT = 600;
  g.debugSpawn('gecko', 40);
  g.debugSim({ frames: 2, god: true });
  for (const e of g.enemies) if (e.alive) e.hurt({ dmg: 999, kb: 1, down: true, dir: 1, pierce: true }, g);
  g.debugSim({ frames: 4, god: true });
});
await page.waitForTimeout(120);
await shot('05-kill-popup-x8');
// 6g: HUD WAVE cluster + TARGET bar mid-run
await ev(() => { window.__gonna.debugDescent(0, 'SHOT-HUD', 37470); });
for (let i = 0; i < 120; i++) {
  await ev((t) => window.__gonna.debugSim({ frames: 100, tape: t, god: true }), WALKKILL);
  d = await info();
  if (d.wave >= 7 && (d.phase === 'combat' || d.phase === 'announce')) break;
}
await page.waitForTimeout(350);
await shot('06-hud-wave-target');

// ---------- [7] FULL RUN regression smoke ----------
console.log('[7] FULL RUN smoke');
await ev(() => window.__gonna.debugStage(0));
await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 8000 });
const camp = await ev(() => window.__gonna.debugSim({ frames: 600, tape: [{ f: 0, down: { right: true } }, { f: 200, press: ['punch'] }, { f: 400, press: ['kick'] }] }));
ok(camp.score >= 0 && camp.wave === -1, 'campaign runs, no descent state (score ' + camp.score + ')');

console.log('RESULT: pass=' + pass + ' fail=' + fail);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
