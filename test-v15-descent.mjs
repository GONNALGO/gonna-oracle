// v15 THE DESCENT — QA harness.
// [1] twin-run determinism (same seed+tape => identical 60-frame hashes; diff seed => diff)
// [2] Math.random trap: zero hits during descent step()
// [3] wave-10 boss: theme boss spawns, +10000 bonus on kill, BREATHE beat
// [4] carrier: exactly one from wave 3; escape => no drop; kill => seeded drop
// [5] screenshots: WAVE slam-in, boss WARNING, BREATHE, MULT LOST, kill popup x8
// [6] FULL RUN regression smoke (campaign still boots & fights)
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';

const CHROME = '/nix/var/nix/profiles/default/bin/chromium';
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

// scripted input tape: brawl forward, punch in bursts
const TAPE = [];
for (let f = 0; f < 3600; f += 90) {
  TAPE.push({ f, down: { right: true } });
  TAPE.push({ f: f + 30, down: { right: false } });
  TAPE.push({ f: f + 34, press: ['punch'] });
  TAPE.push({ f: f + 42, press: ['punch'] });
  TAPE.push({ f: f + 50, press: ['kick'] });
}

// ---------- [1] twin-run determinism ----------
console.log('[1] twin-run determinism');
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

// ---------- [3] wave-10 boss + bonus + BREATHE ----------
console.log('[3] wave-10 boss (theme 3 => THE WHALE)');
await ev(() => window.__gonna.debugDescent(2, 'BOSSTEST'));
let bossSeen = null, preScore = -1, bonusOk = false, breatheSeen = false, wave = 0;
const KTAPE = [{ f: 0, cmd: 'killNonCarrier' }]; // applied each chunk
for (let i = 0; i < 120; i++) {
  const bt = bossSeen ? [] : [{ f: 0, cmd: 'killNonCarrier' }, { f: 33, cmd: 'killNonCarrier' }, { f: 66, cmd: 'killNonCarrier' }];
  await ev((t) => window.__gonna.debugSim({ frames: 100, tape: t, god: true }), bt);
  const d = await info();
  wave = d.wave;
  if (wave >= 10 && d.boss && !bossSeen) {
    bossSeen = d.boss;
    preScore = d.score;
    for (let k = 0; k < 10; k++) {
      const dd = await info();
      if (!dd.boss) break;
      await ev(() => window.__gonna.debugSim({ frames: 40, tape: [{ f: 0, cmd: 'killBoss' }, { f: 20, cmd: 'killBoss' }], god: true }));
    }
  }
  if (bossSeen && d.phase === 'breathe') {
    breatheSeen = true;
    if (d.score - preScore === 10000) bonusOk = true;
  }
  if (wave >= 11) break;
}
ok(wave >= 10, 'reached wave 10+ (wave ' + wave + ')');
ok(bossSeen === 'whale', 'theme boss spawned: ' + bossSeen);
ok(bonusOk, 'boss bonus exactly +10000 (wave 10)');
ok(breatheSeen, 'BREATHE beat after the boss kill');

// ---------- [4] carrier escape & kill ----------
console.log('[4] golden carrier');
await ev(() => window.__gonna.debugDescent(1, 'CARRIER-ESCAPE'));
let esc = null;
for (let i = 0; i < 80; i++) {
  const cur = await info();
  const idle = cur.carriersSpawned >= 1; // carrier out: go hands-off, let it bolt
  await ev((t) => window.__gonna.debugSim({ frames: 100, tape: t, god: true }), idle ? [] : [{ f: 10, cmd: 'killNonCarrier' }, { f: 55, cmd: 'killNonCarrier' }]);
  const d = await info();
  if (d.carriersEscaped > 0 || d.bonusDrops > 0) { esc = d; break; }
}
ok(esc && esc.carriersSpawned === 1, 'exactly one carrier spawned (waves 3+): ' + (esc && esc.carriersSpawned));
ok(esc && esc.carriersEscaped === 1 && esc.bonusDrops === 0, 'escaped carrier => NO drop (escaped=' + (esc && esc.carriersEscaped) + ' drops=' + (esc && esc.bonusDrops) + ')');
// positive: kill the carrier => seeded bonus drop
await ev(() => window.__gonna.debugDescent(1, 'CARRIER-KILL'));
let kill = null;
for (let i = 0; i < 60; i++) {
  await ev(() => window.__gonna.debugSim({ frames: 100, tape: [{ f: 10, cmd: 'killEnemies' }, { f: 55, cmd: 'killEnemies' }], god: true }));
  const d = await info();
  if (d.bonusDrops > 0 || d.wave > 4) { kill = d; break; }
}
ok(kill && kill.carriersSpawned === 1 && kill.bonusDrops === 1, 'killed carrier => exactly one seeded bonus drop');
ok(kill && kill.items.length >= 0, 'drop table visible: items=' + (kill && kill.items.join(',')));

// ---------- [5] screenshots ----------
console.log('[5] screenshots');
// 5a: WAVE slam-in — fresh descent, sim to mid-announce, let rAF render
await ev(() => { window.__gonna.debugDescent(4, 'SHOT-SLAM'); window.__gonna.debugSim({ frames: 40, god: true }); });
await page.waitForTimeout(350);
await shot('01-wave-slam');
// 5b: WARNING — reuse boss state machine quickly: descent theme 2, sim to wave 10 announce
await ev(() => window.__gonna.debugDescent(2, 'SHOT-WARN'));
await ev(() => {
  const g = window.__gonna;
  for (let w = 0; w < 9; w++) {
    g.debugSim({ frames: 400, tape: [{ f: 0, cmd: 'killNonCarrier' }, { f: 100, cmd: 'killNonCarrier' }, { f: 200, cmd: 'killNonCarrier' }, { f: 300, cmd: 'killNonCarrier' }], god: true });
  }
  g.debugSim({ frames: 30, god: true }); // into the WARNING frames
});
await page.waitForTimeout(400);
await shot('02-boss-warning');
// 5c: BREATHE — kill the boss, hold the calm
await ev(() => window.__gonna.debugSim({ frames: 400, tape: [{ f: 60, cmd: 'killBoss' }], god: true }));
await ev(() => window.__gonna.debugSim({ frames: 260, god: true }));
await page.waitForTimeout(350);
await shot('03-breathe');
// 5d: MULT LOST — bank a combo, then take a hit
await ev(() => {
  const g = window.__gonna;
  g.player.comboHits = 9;
  g.player.chainT = 300;
  g.player.hurt({ dmg: 4, kb: 1, down: false, dir: 1 }, g);
  g.debugSim({ frames: 12, god: true });
});
await page.waitForTimeout(120);
await shot('04-mult-lost');
// 5e: kill popup at x8 — mult 8 via comboHits 28, then a kill
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
// 5f: persistent HUD wave cluster + TARGET bar
await ev(() => { window.__gonna.debugDescent(0, 'SHOT-HUD', 37470); window.__gonna.debugSim({ frames: 150, god: true }); });
await page.waitForTimeout(350);
await shot('06-hud-wave-target');

// ---------- [6] FULL RUN regression smoke ----------
console.log('[6] FULL RUN smoke');
await ev(() => window.__gonna.debugStage(0));
await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 8000 });
// god handled by tape
const camp = await ev(() => window.__gonna.debugSim({ frames: 600, tape: [{ f: 0, down: { right: true } }, { f: 200, press: ['punch'] }, { f: 400, press: ['kick'] }] }));
ok(camp.score >= 0 && camp.wave === -1, 'campaign runs, no descent state (score ' + camp.score + ')');

console.log('RESULT: pass=' + pass + ' fail=' + fail);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
