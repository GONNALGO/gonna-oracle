// GONNA FIGHT v3 — headless full-playthrough warp test.
// 6 stages (intro card -> waves -> clear), 4 bosses (phases -> death), final victory.
import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';

const SHELL = process.env.CHROME_SHELL ||
  execSync('ls ~/.cache/puppeteer/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell').toString().trim();
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';

let passed = 0;
let total = 0;
const pageErrors = [];
function ok(cond, label) {
  total++;
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { console.log('  FAIL ' + label); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: SHELL,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--window-size=768,448'],
});
const page = await browser.newPage();
await page.setViewport({ width: 768, height: 448 });
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__gonna, { timeout: 15000 });
await sleep(300);

const G = (fn, ...args) => page.evaluate(fn, ...args);
const shot = (name) => page.screenshot({ path: '/mnt/agents/output/shots/' + name + '.png' });

async function waitFor(fn, timeout, label, ...args) {
  try {
    await page.waitForFunction(fn, { timeout, polling: 50 }, ...args);
    return true;
  } catch {
    console.log('  (timeout waiting: ' + label + ')');
    return false;
  }
}

// ---------- title -> new game ----------
ok(await G(() => window.__gonna.sceneName === 'title'), 'title scene on boot');
await shot('01-title');
await page.keyboard.press('Enter');
await sleep(400);
ok(await G(() => window.__gonna.sceneName === 'intro'), 'S1 intro card after Enter');
ok(await G(() => window.__gonna.stageTitle.includes('GHETTO GONNA')), 'S1 intro card text');

// keeps the player alive during boss fights so boss AI can act freely
let healStop = false;
async function healLoop() {
  while (!healStop) {
    await G(() => { const g = window.__gonna; if (g.sceneName === 'play') { g.player.hp = 100; g.player.lives = 5; } });
    await sleep(120);
  }
}

// ---------- stage runner ----------
async function runStage(idx, bossName) {
  console.log('--- STAGE ' + (idx + 1) + ' ---');
  const cur = await G(() => window.__gonna.stageNo);
  const sc = await G(() => window.__gonna.sceneName);
  if (cur !== idx || sc !== 'intro') {
    await G((i) => window.__gonna.debugStage(i), idx);
    await sleep(150);
  }
  ok(await G(() => window.__gonna.sceneName === 'intro'), 'S' + (idx + 1) + ' intro card');
  const title = await G(() => window.__gonna.stageTitle);
  ok(title.length > 0, 'S' + (idx + 1) + ' intro title: ' + title);
  await shot('s' + (idx + 1) + '-intro');
  await sleep(700); // sceneT > 30 so Enter skips
  await page.keyboard.press('Enter');
  await waitFor(() => window.__gonna.sceneName === 'play', 5000, 'play');

  // waves: warp to each trigger, kill spawns until the wave counter advances
  const triggers = await G(() => window.__gonna.stage.waves.map((w) => w.triggerX));
  for (let w = 0; w < triggers.length; w++) {
    await G((x) => window.__gonna.debugWarp(x), triggers[w] + 200);
    const spawned = await waitFor(() => window.__gonna.enemies.length > 0, 8000, 'wave spawn');
    let cleared = false;
    if (spawned) {
      for (let k = 0; k < 50; k++) {
        await G(() => window.__gonna.debugKillEnemies());
        await sleep(150);
        if (await G((wn) => window.__gonna.waveNo > wn, w)) { cleared = true; break; }
      }
    }
    ok(cleared, 'S' + (idx + 1) + ' wave ' + w + ' spawned+cleared');
  }
  if (idx === 0) await shot('s1-play');

  const meta = await G(() => ({ boss: window.__gonna.stage.boss, arena: window.__gonna.stage.arenaX, len: window.__gonna.stageLen }));
  if (!meta.boss) {
    await G((x) => window.__gonna.debugWarp(x), meta.len - 20);
    ok(await waitFor(() => window.__gonna.sceneName === 'clear', 8000, 'stage clear'), 'S' + (idx + 1) + ' stage clear tally');
    await sleep(2200);
    await page.keyboard.press('Enter');
    await sleep(300);
    return;
  }

  // ---- boss fight ----
  await G((x) => window.__gonna.debugWarp(x), meta.arena + 150);
  ok(await waitFor(() => !!window.__gonna.boss, 8000, 'boss spawn'), bossName + ' spawned');
  ok((await G(() => window.__gonna.boss.name)) === bossName, bossName + ' HP bar name');
  ok(await G(() => window.__gonna.boss.state === 'intro'), bossName + ' intro state');
  await sleep(300);
  await shot('s' + (idx + 1) + '-boss-intro');
  ok(await waitFor(() => window.__gonna.boss && window.__gonna.boss.state !== 'intro', 8000, 'intro over'), bossName + ' intro ends');

  healStop = false;
  const healer = healLoop();

  // chip the boss down to ~25% while alternating player position (close/far)
  // so every attack pattern triggers; record what we see.
  const seen = new Set();
  const t0 = Date.now();
  let far = false;
  let lastSwap = 0;
  while (Date.now() - t0 < 45000) {
    // hold Fud in P2 until the FUD STORM has been observed
    const chipTarget = bossName === 'EMPEROR FUD' && !seen.has('storm') ? 0.5 : 0.26;
    const b = await G((tgt) => {
      const g = window.__gonna;
      if (!g.boss) return null;
      if (g.boss.hp / g.boss.maxHp > tgt) g.debugHurtBoss(5);
      return {
        state: g.boss.state, alive: g.boss.alive, hpFrac: g.boss.hp / g.boss.maxHp,
        projs: g.projs.filter((p) => p.on).map((p) => p.kind),
        jackpot: !!g.boss.jackpot, phase: g.boss.phase ?? 0,
      };
    }, chipTarget);
    if (!b || !b.alive) break;
    seen.add(b.state);
    if (b.projs.includes('coin')) seen.add('proj-coin');
    if (b.projs.includes('fud')) seen.add('proj-fud');
    if (b.jackpot) seen.add('jackpot');
    if (b.phase >= 3) seen.add('phase3');
    if (Date.now() - lastSwap > 3500) {
      lastSwap = Date.now();
      far = !far;
      await G((f) => {
        const g = window.__gonna;
        if (!g.boss) return;
        const x = f ? g.camX + 40 : g.boss.x - 46;
        g.debugWarp(Math.max(g.camX + 20, x));
      }, far);
    }
    await sleep(120);
  }
  await shot('s' + (idx + 1) + '-boss-fight');

  if (bossName === 'THE WHALE OF WALL STREET') {
    ok(seen.has('swing') || seen.has('flop'), 'Whale attacks (swing/flop)');
    ok(seen.has('summon'), 'Whale phase summons');
  }
  if (bossName === 'DARK GONNA') {
    ok(seen.has('combo'), 'Dark Gonna 3-punch combo used');
    ok(seen.has('kick') || seen.has('jumpkick'), 'Dark Gonna kick/jump kick used');
    ok(seen.has('slam'), 'Dark Gonna telegraphed dark slam used');
  }
  if (bossName === 'SLOT GOLEM') {
    ok(seen.has('coins') && seen.has('proj-coin'), 'Slot Golem coin projectiles');
    ok(seen.has('slots'), 'Slot Golem slot roll used');
    ok(seen.has('stomp'), 'Slot Golem stomp used');
    ok(seen.has('jackpot'), 'Slot Golem JACKPOT MODE under 50%');
  }
  if (bossName === 'EMPEROR FUD') {
    ok(seen.has('swing'), 'Emperor Fud scepter swing (P1)');
    ok(seen.has('summon'), 'Emperor Fud summons (P1)');
    ok(seen.has('storm') && seen.has('proj-fud'), 'Emperor Fud FUD STORM (P2) w/ red rain');
    ok(seen.has('phase3'), 'Emperor Fud phase 3 (<30%)');
    ok(seen.has('charge') || seen.has('slam'), 'Emperor Fud rage charge/slam (P3)');
  }

  // kill the boss, verify death sequence plays out
  await G(() => { const g = window.__gonna; if (g.boss) g.debugHurtBoss(9999); });
  ok(await waitFor(() => !window.__gonna.boss || !window.__gonna.boss.alive, 5000, 'boss dead'), bossName + ' death triggered');
  await sleep(700);
  await shot('s' + (idx + 1) + '-boss-death');
  const finalScene = idx === 5 ? 'victory' : 'clear';
  ok(await waitFor((s) => window.__gonna.sceneName === s, 25000, finalScene, finalScene), bossName + ' -> ' + finalScene.toUpperCase());
  healStop = true;
  await healer;
  if (idx !== 5) {
    await sleep(2200);
    await page.keyboard.press('Enter');
    await sleep(300);
  }
}

await runStage(0, null);
await runStage(1, null);
await runStage(2, 'THE WHALE OF WALL STREET');
await runStage(3, 'DARK GONNA');
await runStage(4, 'SLOT GOLEM');

// FPS sample during stage 6 combat (waves)
await G(() => window.__gonna.debugStage(5));
await sleep(700);
await page.keyboard.press('Enter');
await waitFor(() => window.__gonna.sceneName === 'play', 5000, 's6 play');
await G(() => window.__gonna.debugWarp(320));
await waitFor(() => window.__gonna.enemies.length > 0, 8000, 's6 wave');
const fps = await G(() => new Promise((res) => {
  let n = 0;
  const t0 = performance.now();
  const loop = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(loop); else res(n / 2); };
  requestAnimationFrame(loop);
}));
ok(fps >= 55, 'FPS ~60 during S6 combat (got ' + fps.toFixed(1) + ')');

await runStage(5, 'EMPEROR FUD');

// final victory
ok(await G(() => window.__gonna.victoryIsFinal), 'final victory flag (rocket + credits)');
await sleep(2500);
await shot('06-final-victory');

console.log('=================================');
console.log('ASSERTIONS: ' + passed + '/' + total);
if (pageErrors.length) {
  console.log('PAGE ERRORS (' + pageErrors.length + '):');
  for (const e of pageErrors.slice(0, 12)) console.log('  ' + e);
} else {
  console.log('PAGE ERRORS: 0');
}
await browser.close();
process.exit(passed === total && pageErrors.length === 0 ? 0 : 1);
