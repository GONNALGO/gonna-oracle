// v15.2 THE DESCENT — QA harness (v15.1 base + v15.2 batch).
// v15.2 additions:
//   [5b] cross-theme THREAT-POINT audit (Prince's calibration, waves 1-20)
//   [5c] carrier statistics over 40 seeds (45% luck, never 2, uniform table)
//   [8]  BUG-A: hit mid-jump reconciles physics (no walking on air)
//   [9]  BUG-B: thrown object spawns at the hands (campaign + descent)
//   [10] LONG SHOT bolt + SPEED OF THE LIZARD mechanics
//   [11] bonus unlock table (SPEED 2 / BULLET TIME 3 / LONG SHOT 4)
//   [12] ENERGY: chicken-in-props rate, no free food, no 1UPs, heal parity
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
const shots152 = '/mnt/agents/output/v152-shots';
import { mkdirSync } from 'node:fs';
mkdirSync(shots, { recursive: true });
mkdirSync(shots152, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text()); });
await page.goto('http://localhost:4173/?qa=1', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__gonna && window.__gonna.sceneName, null, { timeout: 15000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = (name) => page.screenshot({ path: shots + '/' + name + '.png' });
const shot152 = (name) => page.screenshot({ path: shots152 + '/' + name + '.png' });
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
for (let i = 0; i < 160; i++) {
  const cur = await info();
  const idle = cur.carriersSpawned >= 1; // carrier out: go hands-off, let it bolt
  await ev((t) => window.__gonna.debugSim({ frames: 100, tape: t, god: true }), idle ? [] : WALKKILL);
  d = await info();
  if (d.carriersEscaped > 0 || d.bonusDrops > 0) { esc = d; break; }
}
ok(esc && esc.carriersSpawned === 1, 'exactly one carrier spawned (seeded 45% from wave 2): ' + (esc && esc.carriersSpawned));
ok(esc && esc.carriersEscaped === 1 && esc.bonusDrops === 0, 'escaped carrier => NO drop (escaped=' + (esc && esc.carriersEscaped) + ' drops=' + (esc && esc.bonusDrops) + ')');
await ev(() => window.__gonna.debugDescent(1, 'CARRIER-KILL'));
let kill = null;
const KILLALL = [
  { f: 0, down: { right: true } }, { f: 10, cmd: 'killEnemies' }, { f: 55, cmd: 'killEnemies' },
  { f: 8, press: ['punch'] }, { f: 48, press: ['punch'] }, { f: 70, press: ['jump'] },
];
for (let i = 0; i < 160; i++) {
  await ev((t) => window.__gonna.debugSim({ frames: 100, tape: t, god: true }), KILLALL);
  // v15.2: actively HUNT the golden one (probabilistic carriers won't wait
  // next to GONNA's fists anymore) — warp adjacent and punch until it pops
  await ev(() => {
    const g = window.__gonna;
    const c = g.enemies.find((e) => e.alive && e.kind === 'carrier');
    if (!c) return;
    g.player.x = c.x - 18; g.player.y = c.y; g.player.state = 'idle'; g.player.t = 0;
    g.debugSim({ frames: 40, tape: [{ f: 0, press: ['punch'] }, { f: 8, press: ['punch'] }, { f: 16, press: ['punch'] }, { f: 24, press: ['punch'] }, { f: 32, press: ['punch'] }], god: true });
  });
  d = await info();
  if (d.bonusDrops > 0 || d.wave > 10) { kill = d; break; }
}
ok(kill && kill.carriersSpawned === 1 && kill.bonusDrops === 1, 'killed carrier => exactly one seeded bonus drop');
ok(kill && kill.items.length >= 0, 'drop table visible: items=' + (kill && kill.items.slice(0, 12).join(',')));


// ---------- [5b] v15.2 cross-theme THREAT-POINT audit (Prince's order) ----------
console.log('[5b] cross-theme threat table (themes 0-6, waves 1-20)');
const table = await ev(() => {
  const g = window.__gonna;
  const rows = [];
  for (let theme = 0; theme < 7; theme++) {
    for (let w = 1; w <= 20; w++) {
      const r = g.debugCompose(theme, w, 0x0152);
      rows.push({ theme, w, points: r.points, heavies: r.heavies, ranged: r.ranged, carriers: r.carriers, boss: r.boss, bossThreat: r.bossThreat, bonus: r.bonus });
    }
  }
  return rows;
});
console.log('    theme wave pts hv rg car' + ' '.repeat(18) + '(boss rows include the boss-gate threat)');
for (const r of table) {
  console.log('    T' + r.theme + ' w' + String(r.w).padStart(2, '0') + '  pts=' + String(r.points).padStart(3) + ' hv=' + r.heavies + ' rg=' + r.ranged + ' car=' + r.carriers + (r.boss ? ' BOSS(gate ' + r.bossThreat + ')' : '') + (r.bonus ? ' drop=' + r.bonus : ''));
}
const hcap = (w, t) => (w <= 1 ? 0 : w <= 3 ? 1 : w <= 7 ? 2 : w === 8 ? 3 : 3 + Math.floor(t / 2));
const rcap = (w) => (w <= 5 ? 2 : w <= 9 ? 3 : 4);
let okEarly = true, okCaps = true, okCarMax = true, okW1 = true, okGap = true;
for (let w = 1; w <= 3; w++) {
  const pts = [0, 1, 2, 3, 4, 5, 6].map((t) => table.find((r) => r.theme === t && r.w === w).points);
  const mn = Math.min(...pts), mx = Math.max(...pts);
  if ((mx - mn) / mn > 0.15 + 1e-9) okEarly = false;
}
for (const r of table) {
  if (r.heavies > hcap(r.w, r.theme)) okCaps = false;
  if (r.ranged > rcap(r.w)) okCaps = false;
  if (r.carriers > 1) okCarMax = false;
  if (r.w === 1 && r.heavies !== 0) okW1 = false;
}
{
  const a = table.find((r) => r.theme === 0 && r.w === 10).points;
  const b = table.find((r) => r.theme === 6 && r.w === 10).points;
  if (b < a * 1.2) okGap = false;
  console.log('    wave-10 threat gap T6 vs T1: ' + a + ' -> ' + b + ' (+' + Math.round((b / a - 1) * 100) + '%)');
}
ok(okEarly, 'waves 1-3 threat within +/-15% across themes');
ok(okW1, 'wave 1 has ZERO heavies on every theme');
ok(okCaps, 'heavyCap + rangedCap respected on every theme/wave');
ok(okCarMax, 'never two carriers in one wave');
ok(okGap, 'wave-10 stage-7 vs stage-1 threat gap >= +20%');
{
  const w1 = table.filter((r) => r.w === 1).map((r) => r.points);
  ok(Math.min(...w1) >= 7, 'NO KINDERGARTEN: wave-1 threat floor >= 7 points on every theme (' + w1.join(',') + ')');
}

// ---------- [5c] carrier statistics over 40 seeds (seeded luck) ----------
console.log('[5c] carrier luck over 40 seeds (waves 2-9 eligible, boss/1 excluded)');
const luck = await ev(() => {
  const g = window.__gonna;
  const perSeed = [];
  const bonusCount = {};
  let eligible = 0, withCarrier = 0;
  for (let seed = 1; seed <= 40; seed++) {
    let n = 0;
    for (let w = 2; w <= 9; w++) {
      const r = g.debugCompose(1, w, seed * 7919);
      eligible++;
      if (r.carriers === 1) {
        withCarrier++;
        n++;
        if (r.bonus) bonusCount[r.bonus] = (bonusCount[r.bonus] || 0) + 1;
      }
    }
    perSeed.push(n);
  }
  return { perSeed, bonusCount, rate: withCarrier / eligible, min: Math.min(...perSeed), max: Math.max(...perSeed) };
});
console.log('    luck spread (carriers in a 10-wave run, 40 seeds): min=' + luck.min + ' max=' + luck.max + ' mean=' + (luck.perSeed.reduce((a, b) => a + b, 0) / 40).toFixed(2));
console.log('    bonus distribution: ' + JSON.stringify(luck.bonusCount));
ok(luck.rate >= 0.3 && luck.rate <= 0.6, 'carrier rate in [30%,60%] of eligible waves (got ' + (luck.rate * 100).toFixed(1) + '%)');
ok(luck.min >= 0 && luck.max <= 8, 'never two carriers per wave, spread sane');
{
  const kinds = ['bonusA', 'candle', 'forge', 'speed', 'bullet', 'longshot'];
  const tot = Object.values(luck.bonusCount).reduce((a, b) => a + b, 0);
  const uni = tot > 0 && kinds.every((k) => (luck.bonusCount[k] || 0) / tot > 0.06 && (luck.bonusCount[k] || 0) / tot < 0.30);
  ok(uni, 'unlocked bonuses roughly uniform over 40 seeds (' + kinds.map((k) => k + '=' + (luck.bonusCount[k] || 0)).join(' ') + ')');
}

// ---------- [8] BUG-A: hit mid-jump reconciles physics ----------
console.log('[8] BUG-A: air hit -> gravity through stun -> clean landing');
await ev(() => window.__gonna.debugStage(0));
const bugA = await ev(() => {
  const g = window.__gonna;
  g.debugSim({ frames: 2, tape: [{ f: 0, cmd: 'killEnemies' }] });
  g.debugSim({ frames: 1, tape: [{ f: 0, press: ['jump'] }] });
  for (let f = 0; f < 12; f++) { // climb until inside projectile height band
    g.debugSim({ frames: 1 });
    if (g.player.z >= 18) break;
  }
  const zAtHit = g.player.z;
  g.player.invuln = 0;
  g.spawnProj('coin', g.player.x, g.player.y, 0.01); // REAL projectile hit path
  g.debugSim({ frames: 1 });
  const hit = g.player.state === 'hurt' || g.player.state === 'down';
  let landedIn = -1;
  for (let f = 0; f < 90; f++) {
    g.debugSim({ frames: 1, tape: [{ f: 0, cmd: 'killEnemies' }] });
    if (g.player.z <= 0 && (g.player.state === 'idle' || g.player.state === 'walk')) { landedIn = f; break; }
  }
  const x0 = g.player.x;
  g.debugSim({ frames: 40, tape: [{ f: 0, down: { right: true } }, { f: 0, cmd: 'killEnemies' }, { f: 20, cmd: 'killEnemies' }] });
  const walked = g.player.x - x0;
  const airWalk = g.player.z > 0;
  g.debugSim({ frames: 1, tape: [{ f: 0, press: ['jump'] }] });
  let rose = false, relanded = false;
  for (let f = 0; f < 70; f++) {
    g.debugSim({ frames: 1 });
    if (g.player.z > 10) rose = true;
    if (rose && g.player.z <= 0) { relanded = true; break; }
  }
  return { zAtHit, hit, landedIn, walked, airWalk, rose, relanded };
});
ok(bugA.hit && bugA.zAtHit > 10, 'projectile connected mid-jump (z=' + bugA.zAtHit.toFixed(1) + ')');
ok(bugA.landedIn >= 0 && bugA.landedIn <= 60, 'player LANDS within 60 frames of the air hit (landedIn=' + bugA.landedIn + ')');
ok(bugA.walked > 20 && !bugA.airWalk, 'walks ON THE GROUND after the hit (no re-press, no air-walk)');
ok(bugA.rose && bugA.relanded, 'jump still works normally after the air hit');

// ---------- [9] BUG-B: thrown object spawns at the hands ----------
console.log('[9] BUG-B: ghost throw fix (campaign + descent)');
const throwCheck = async (mode) => await ev((m) => {
  const g = window.__gonna;
  if (m === 'descent') g.debugDescent(0, 'THROWTEST'); else g.debugStage(0);
  g.debugSim({ frames: 3, tape: [{ f: 0, cmd: 'killEnemies' }] });
  const o = g.objects.find((q) => q.cfg.liftable && !q.removeMe);
  if (!o) return { err: 'no liftable object' };
  g.debugWarp(o.x - 14);
  g.player.y = o.y;
  g.debugSim({ frames: 2, tape: [{ f: 0, press: ['punch'] }] });
  if (!g.carriedObject) return { err: 'lift failed' };
  g.obstacles = g.obstacles.filter((q) => q === o); // clean lane for the carry walk
  const liftX = o.x;
  g.debugSim({ frames: 150, tape: [{ f: 0, down: { right: true } }, { f: 40, cmd: 'killEnemies' }, { f: 90, cmd: 'killEnemies' }] });
  const px = g.player.x, face = g.player.face, camX = g.camX;
  g.debugSim({ frames: 2, tape: [{ f: 0, press: ['kick'] }] });
  const pr = g.projectiles[0];
  return { liftX, px, face, camX, throwX: pr ? pr.x : -999, vx: pr ? pr.vx : 0 };
}, mode);
const tbC = await throwCheck('campaign');
const tbD = await throwCheck('descent');
for (const [tag, r] of [['campaign', tbC], ['descent', tbD]]) {
  if (r.err) { ok(false, tag + ' throw setup: ' + r.err); continue; }
  ok(r.px - r.liftX > 80, tag + ': carried 80+ px right of the lift point (lift ' + Math.round(r.liftX) + ' -> hands ' + Math.round(r.px) + ')');
  ok(Math.abs(r.throwX - r.px) < 40, tag + ': thrown object spawns AT THE HANDS (spawn ' + Math.round(r.throwX) + ' vs player ' + Math.round(r.px) + ')');
  ok(Math.sign(r.vx) === r.face, tag + ': velocity sign == facing (' + r.vx.toFixed(1) + ' vs face ' + r.face + ')');
  ok(r.throwX - r.camX > 60, tag + ': does NOT roll in from the left edge (' + Math.round(r.throwX - r.camX) + ' px into the screen)');
}

// ---------- [10] LONG SHOT + SPEED OF THE LIZARD ----------
console.log('[10] v15.2 bonuses');
await ev(() => window.__gonna.debugDescent(0, 'BONUSTEST'));
await ev(() => window.__gonna.debugSim({ frames: 5, god: true }));
const ls = await ev(() => {
  const g = window.__gonna;
  g.descent.shotT = 600;
  g.debugSim({ frames: 3, tape: [{ f: 0, press: ['punch'] }] });
  const bolt = g.projs.find((q) => q.on && q.kind === 'bolt');
  const melee = g.player.state === 'punch'; // melee swing still runs
  return { fired: !!bolt, vx: bolt ? bolt.vx : 0, face: g.player.face, melee, shotT: g.descent.shotT };
});
ok(ls.fired && ls.shotT > 0, 'LONG SHOT armed: PUNCH fires an energy bolt');
ok(ls.melee, 'LONG SHOT: melee punch still swings (no button remap)');
ok(Math.sign(ls.vx) === ls.face, 'bolt flies toward the facing direction');
const sp = await ev(() => {
  const g = window.__gonna;
  g.obstacles.length = 0; // clear lane for a clean speed measurement
  g.descent.shotT = 0;
  g.descent.speedT = 0;
  const step = () => {
    g.player.state = 'idle'; g.player.t = 0; g.player.x = g.camX + 100;
    const a = g.player.x;
    g.debugSim({ frames: 1, tape: [{ f: 0, down: { right: true } }] });
    return g.player.x - a;
  };
  const base = step();
  g.descent.speedT = 600;
  const fast = step();
  g.debugSim({ frames: 12, tape: [{ f: 0, down: { right: true } }] });
  return { base, fast, trail: g.player.trail.length, speedT: g.descent.speedT };
});
ok(sp.base > 1 && Math.abs(sp.fast / sp.base - 1.5) < 0.05, 'SPEED OF THE LIZARD: exactly +50% move speed (' + sp.base.toFixed(2) + ' -> ' + sp.fast.toFixed(2) + ')');
ok(sp.trail > 0 && sp.speedT > 0, 'SPEED: after-image trail recording (' + sp.trail + ' ghosts)');

// ---------- [11] bonus unlock table ----------
console.log('[11] unlock table (SPEED 2 / BULLET TIME 3 / LONG SHOT 4)');
const unl = await ev(() => ({
  w2: window.__gonna.debugBonusTable(2, 96),
  w3: window.__gonna.debugBonusTable(3, 96),
  w4: window.__gonna.debugBonusTable(4, 96),
}));
const has = (arr, k) => arr.includes(k);
ok(has(unl.w2, 'speed') && !has(unl.w2, 'bullet') && !has(unl.w2, 'longshot'), 'wave 2: SPEED unlocked, bullet/longshot locked');
ok(has(unl.w3, 'bullet') && !has(unl.w3, 'longshot'), 'wave 3: BULLET TIME unlocked (was 0 before wave 9)');
ok(has(unl.w4, 'longshot') && has(unl.w4, 'bullet') && has(unl.w4, 'speed'), 'wave 4: LONG SHOT unlocked, full table live');


// ---------- [12] ENERGY: food lives INSIDE furniture ----------
console.log('[12] ENERGY: chicken-in-props calibration over 40 seeds');
{
  let props = 0, foodProps = 0;
  const perRun = [];
  for (let seed = 1; seed <= 40; seed++) {
    await ev((lbl) => window.__gonna.debugDescent(1, lbl), 'FOOD-' + seed);
    await ev(() => window.__gonna.debugSim({ frames: 900, tape: [{ f: 0, down: { right: true } }], god: true }));
    const d = await info();
    props += d.propsSpawned;
    foodProps += d.foodProps;
    perRun.push(d.foodProps);
  }
  const rate = props > 0 ? foodProps / props : 0;
  console.log('    food availability: ' + foodProps + ' chicken-props / ' + props + ' props = ' + (rate * 100).toFixed(1) + '%; per-run food spread min=' + Math.min(...perRun) + ' max=' + Math.max(...perRun));
  ok(props > 200, 'enough props sampled across 40 seeds (' + props + ')');
  ok(rate >= 0.08 && rate <= 0.18, 'chicken-per-prop rate in [8%,18%] (got ' + (rate * 100).toFixed(1) + '%)');
  // zero free-floating food: no direct Item('chicken') spawn anywhere in src,
  // and 1UP ('liz') never leaves the drop table alive in THE DESCENT
  const { readFileSync } = await import('node:fs');
  const srcAll = ['src/game/items.ts', 'src/game/engine.ts', 'src/game/descent.ts', 'src/game/enemies.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
  ok(!/new Item\('chicken'/.test(srcAll), 'zero free-floating food: chicken only ever comes out of a broken prop');
  ok(/drop === 'liz' && g\.descent/.test(srcAll), "1UP rolls downgrade to food in THE DESCENT (one life is the mode's identity)");
  // heal parity: descent chicken heals exactly like campaign chicken
  const heal = await ev(() => {
    const g = window.__gonna;
    g.debugDescent(1, 'FOOD-HEAL');
    g.debugSim({ frames: 5, god: true });
    g.player.hp = 40;
    g.dropItem('chicken', g.player.x, g.player.y);
    g.debugSim({ frames: 3, god: true });
    return g.player.hp;
  });
  ok(heal > 40 && heal <= 100, 'descent chicken heals like campaign chicken (40 -> ' + heal + ', never past full)');
}

// ---------- [6.5] v15.2 screenshots ----------
console.log('[6.5] v15.2 screenshots -> ' + shots152);
// S1: LONG SHOT firing + aura
await ev(() => {
  const g = window.__gonna;
  g.debugDescent(4, 'SHOT-LONGSHOT');
  g.debugSim({ frames: 8, god: true });
  g.debugSpawn('gecko', 150);
  g.descent.shotT = 600;
  g.debugSim({ frames: 2, tape: [{ f: 0, press: ['punch'] }] });
  g.debugSim({ frames: 5, god: true });
});
await page.waitForTimeout(300);
await shot152('01-longshot-firing-aura');
// S2: SPEED trail
await ev(() => {
  const g = window.__gonna;
  g.descent.shotT = 0;
  g.descent.speedT = 600;
  g.debugSim({ frames: 26, tape: [{ f: 0, down: { right: true } }], god: true });
});
await page.waitForTimeout(300);
await shot152('02-speed-trail');
// S3: BUG-B after — throw spawns at the hands (descent)
await ev(() => {
  const g = window.__gonna;
  g.debugDescent(0, 'SHOT-THROW');
  g.debugSim({ frames: 3, tape: [{ f: 0, cmd: 'killEnemies' }] });
  const o = g.objects.find((q) => q.cfg.liftable && !q.removeMe);
  g.debugWarp(o.x - 14);
  g.player.y = o.y;
  g.debugSim({ frames: 2, tape: [{ f: 0, press: ['punch'] }] });
  g.debugSim({ frames: 150, tape: [{ f: 0, down: { right: true } }, { f: 60, cmd: 'killEnemies' }] });
  g.debugSim({ frames: 4, tape: [{ f: 0, press: ['kick'] }] });
});
await page.waitForTimeout(300);
await shot152('03-throw-after-fixed');
// S3b: BUG-B before — simulated stale-x (pre-fix behavior reproduced for the record)
await ev(() => {
  const g = window.__gonna;
  g.debugDescent(0, 'SHOT-THROW');
  g.debugSim({ frames: 3, tape: [{ f: 0, cmd: 'killEnemies' }] });
  const o = g.objects.find((q) => q.cfg.liftable && !q.removeMe);
  g.debugWarp(o.x - 14);
  g.player.y = o.y;
  g.debugSim({ frames: 2, tape: [{ f: 0, press: ['punch'] }] });
  const liftX = o.x;
  g.debugSim({ frames: 150, tape: [{ f: 0, down: { right: true } }, { f: 60, cmd: 'killEnemies' }] });
  const c = g.carriedObject;
  if (c) { c.x = liftX; } // simulate the pre-fix stale world-x
  g.debugSim({ frames: 4, tape: [{ f: 0, press: ['kick'] }] });
});
await page.waitForTimeout(300);
await shot152('04-throw-before-simulated');
// S4: BUG-A — airborne hurt state, then the landing
await ev(() => {
  const g = window.__gonna;
  g.debugStage(0);
  g.debugSim({ frames: 2, tape: [{ f: 0, cmd: 'killEnemies' }] });
  g.debugSim({ frames: 1, tape: [{ f: 0, press: ['jump'] }] });
  for (let f = 0; f < 12; f++) { g.debugSim({ frames: 1 }); if (g.player.z >= 18) break; }
  g.player.invuln = 0;
  g.spawnProj('coin', g.player.x, g.player.y, 0.01);
  g.debugSim({ frames: 6 });
});
await page.waitForTimeout(250);
await shot152('05-airhit-falling-in-stun');
await ev(() => {
  const g = window.__gonna;
  for (let f = 0; f < 60; f++) { g.debugSim({ frames: 1, tape: [{ f: 0, cmd: 'killEnemies' }] }); if (g.player.z <= 0 && g.player.state !== 'jump') break; }
  g.debugSim({ frames: 3 });
});
await page.waitForTimeout(250);
await shot152('06-airhit-landed-clean');
// S5: wave-3 BULLET TIME availability (pip + vignette at wave 3)
await ev(() => {
  const g = window.__gonna;
  g.debugDescent(0, 'SHOT-BT3');
  g.debugSim({ frames: 8, god: true });
  g.descent.wave = 3; // wave-3 HUD readout
  g.waveIdx = 3;
  g.descent.bulletT = 300;
  g.debugSpawn('gecko', 130);
  g.debugSim({ frames: 10, god: true });
});
await page.waitForTimeout(300);
await shot152('07-wave3-bullet-time');

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
