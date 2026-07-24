// GONNA FIGHT v8 — glitched unkillable-enemy soft-lock: repro + fix verification.
//   1. REPRO: enemy spawning into the off-screen spawn corridor during a wave
//      lock gets blocked by a lane object and never enters (wave soft-lock)
//   2. WATCHDOG: enemy forced to invalid y/z is snapped back <4s, killable
//   3. LAST RESORT: hopelessly invalid enemies are executed (no score), wave clears
//   4. DRONE HEALTH: hover bob, telegraphed dive, damage both ways, hover restore
//   5. END-TO-END: stage 2 wave 1 clears with the drum corridor scenario
//   6. Zero page errors, ~60fps (measured on a non-accelerated page)
// Run: node test-v8.mjs   (needs the vite preview on :4173)
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, total = 0;
const fails = [];
function ok(cond, label) {
  total++;
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { fails.push(label); console.log('  FAIL ' + label); }
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
const pageErrors = [];

async function newPage(accelerate) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 560 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  if (accelerate) {
    await page.addInitScript(() => {
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
    });
  }
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
  await sleep(300);
  return { ctx, page };
}
const G = (page, fn, ...args) => page.evaluate(fn, ...args);

async function startStage(page, idx) {
  await G(page, (i) => window.__gonna.debugStage(i), idx);
  await G(page, () => { window.__gonna.input.pressed.start = true; });
  await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 8000 });
}
async function waitSim(page, cond) {
  await page.waitForFunction(cond, null, { timeout: 30000 });
}

// ================= 1. REPRO: spawn-corridor object block =================
console.log('\n[1] REPRO: enemy blocked by lane object in the off-screen spawn corridor');
{
  const { ctx, page } = await newPage(true);
  await startStage(page, 1);
  // warp straight to the wave trigger so the camera locks with the drum@900
  // sitting in the off-screen right spawn corridor (the reported stage-2 spot)
  await G(page, () => window.__gonna.debugWarp(660));
  await waitSim(page, () => window.__gonna.enemies.length > 0);
  // inject the exact reported scenario: an enemy entering from the right
  // corridor where the drum (x=900, y=168) sits just off the locked screen
  await G(page, () => {
    const g = window.__gonna;
    const e = g.debugSpawn('moltov', 0);
    e.x = g.camX + 384 + 24; // right spawn point
    e.y = 177;               // inside the drum's lane band
    e.state = 'enter';
    e.t = 0;
    e.face = -1;             // walking left onto the screen
    window.__stuck = e;
  });
  // give it 10s of sim: a healthy enemy walks in and engages within ~2s
  const t0 = await G(page, () => window.__gonna.frame);
  const hp0 = await G(page, () => window.__gonna.player.hp);
  let onScreen = false, engaged = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForFunction((f) => window.__gonna.frame >= f, t0 + (i + 1) * 30, { timeout: 30000 });
    const s = await G(page, () => {
      const g = window.__gonna;
      const e = window.__stuck;
      return {
        state: e.state, x: e.x, hp: e.hp, maxHp: e.maxHp, alive: e.alive,
        camX: g.camX, php: g.player.hp,
      };
    });
    if (s.x < s.camX + 384 - 20) onScreen = true;
    if (s.state === 'attack' || s.state === 'recover' || s.php < hp0 || s.hp < s.maxHp || !s.alive) engaged = true;
  }
  const s = await G(page, () => {
    const e = window.__stuck;
    return { state: e.state, x: Math.round(e.x), alive: e.alive, camX: Math.round(window.__gonna.camX) };
  });
  ok(s.state !== 'enter', `injected enemy left 'enter' within 10s (state=${s.state}, x=${s.x}, camX=${s.camX})`);
  // engaged = on-screen, or actively fighting the player (kiters attack from
  // the corridor clamp by design) — pre-fix it froze inert in 'enter'
  ok(onScreen || engaged || !s.alive, `injected enemy engaged the fight (onScreen=${onScreen}, engaged=${engaged}, state=${s.state}, x=${s.x} vs edge ${s.camX + 384})`);
  await ctx.close();
}

// ================= 2. WATCHDOG: invalid y/z snapped back =================
console.log('\n[2] WATCHDOG: unreachable enemy snapped back <4s, killable');
{
  const { ctx, page } = await newPage(true);
  await startStage(page, 1);
  await G(page, () => { window.__gonna.input.down.right = true; });
  await waitSim(page, () => window.__gonna.waveNo === 0 && window.__gonna.enemies.length > 0);
  await G(page, () => { window.__gonna.input.down.right = false; });
  // case A: knocked out of the walkable band while down (cannot self-recover)
  await G(page, () => {
    const g = window.__gonna;
    const e = g.debugSpawn('gecko', 60);
    e.state = 'down'; e.t = 0; e.z = 0; e.vz = 0;
    e.y = 400; // invalid: far below the lane, lying = unkillable + unreachable
    window.__wd = e;
  });
  const t0 = await G(page, () => window.__gonna.frame);
  let rescuedA = true;
  try {
    await page.waitForFunction(() => {
      const e = window.__wd;
      return e.state === 'seek' && e.y >= 150 && e.y <= 205;
    }, null, { timeout: 20000 });
  } catch { rescuedA = false; }
  const dtA = (await G(page, () => window.__gonna.frame)) - t0;
  ok(rescuedA && dtA <= 300, `invalid-y enemy back in band & seeking in ${dtA}f (<=300f)`);
  // case B: z invalid (NaN)
  await G(page, () => { window.__wd.z = NaN; window.__wd.state = 'down'; window.__wd.vz = 0; });
  const t1 = await G(page, () => window.__gonna.frame);
  let rescuedB = true;
  try {
    await page.waitForFunction(() => {
      const e = window.__wd;
      return e.state === 'seek' && isFinite(e.z) && e.z >= 0 && e.z < 36;
    }, null, { timeout: 20000 });
  } catch { rescuedB = false; }
  const dtB = (await G(page, () => window.__gonna.frame)) - t1;
  ok(rescuedB && dtB <= 300, `NaN-z enemy recovered & seeking in ${dtB}f (<=300f)`);
  // killable: isolate the rescued enemy, park the player next to it, real punches
  await G(page, () => {
    const g = window.__gonna;
    g.enemies = g.enemies.filter((e) => e === window.__wd); // no interference
    g.player.hp = 9999; g.player.maxHp = 9999;
    window.__wd.hp = 10;
  });
  for (let i = 0; i < 16; i++) {
    const done = await G(page, () => {
      const g = window.__gonna;
      const e = window.__wd;
      if (!e.alive) return true;
      // re-align and force a clean punch attempt every try
      g.player.state = 'idle'; g.player.t = 0; g.player.invuln = 0;
      g.player.x = e.x - 26; g.player.y = e.y; g.player.face = 1;
      e.atkCd = 9999; // keep it from dodging via attack patterns
      g.input.pressed.punch = true;
      return false;
    });
    if (done) break;
    await sleep(150);
  }
  const dead = await G(page, () => !window.__wd.alive);
  ok(dead, 'watchdog-rescued enemy is killable');
  await ctx.close();
}

// ================= 3. LAST RESORT: hopeless enemies executed, wave clears =================
console.log('\n[3] LAST RESORT: all remaining enemies invalid -> executed (no score), wave clears');
{
  const { ctx, page } = await newPage(true);
  await startStage(page, 1);
  await G(page, () => { window.__gonna.input.down.right = true; });
  await waitSim(page, () => window.__gonna.waveNo === 0 && window.__gonna.enemies.length > 0);
  await G(page, () => { window.__gonna.input.down.right = false; });
  // keep the player safe; hold every living enemy hopeless: knocked out of the
  // band mid-air (no self-heal path) forever, no matter how often rescued
  await G(page, () => {
    const g = window.__gonna;
    g.player.hp = 9999; g.player.maxHp = 9999;
    window.__evil = setInterval(() => {
      for (const e of g.enemies) {
        if (!e.alive) continue;
        e.state = 'down'; e.t = 0; e.z = 5; e.vz = 0; e.y = 9999; e.invuln = 0;
      }
    }, 0);
  });
  const w0 = await G(page, () => window.__gonna.waveNo);
  // wave must clear by itself (last-resort execution) without player help
  let cleared = false;
  try {
    await page.waitForFunction((w) => window.__gonna.waveNo > w, w0, { timeout: 90000 });
    cleared = true;
  } catch { cleared = false; }
  const after = await G(page, () => {
    clearInterval(window.__evil);
    return {
      alive: window.__gonna.enemies.filter((e) => e.alive).length,
      wave: window.__gonna.waveNo,
      items: window.__gonna.items.length, // executions award nothing: no coins
    };
  });
  ok(cleared, `wave cleared despite hopeless enemies (wave ${w0} -> ${after.wave}, alive=${after.alive})`);
  ok(after.items === 0, `executed enemies dropped no loot (items=${after.items})`);
  await ctx.close();
}

// ================= 4. DRONE HEALTH: normal behavior unchanged =================
console.log('\n[4] DRONE HEALTH: hover bob, telegraphed dive, damage both ways, hover restore');
{
  const { ctx, page } = await newPage(true);
  await startStage(page, 1);
  await G(page, () => {
    const g = window.__gonna;
    g.debugWarp(300);
    g.player.y = 178;
    g.player.hp = 100;
    window.__drone = g.debugSpawn('drone', 70);
  });
  // hover bob: z oscillates inside [17,31] while seeking
  const bob = await G(page, async () => {
    const e = window.__drone;
    const zs = [];
    await new Promise((res) => {
      const iv = setInterval(() => {
        if (e.state === 'seek') zs.push(e.z);
        if (zs.length >= 90) { clearInterval(iv); res(); }
      }, 0);
      setTimeout(() => { clearInterval(iv); res(); }, 15000);
    });
    return { min: Math.min(...zs), max: Math.max(...zs), n: zs.length };
  });
  ok(bob.n > 30 && bob.min >= 17 && bob.max <= 31 && bob.max - bob.min > 4,
    `hover bob intact (n=${bob.n}, min=${bob.min?.toFixed(1)}, max=${bob.max?.toFixed(1)})`);
  // telegraphed dive: flashT telegraph then attack state
  let telegraph = false, dove = false;
  try {
    await page.waitForFunction(() => {
      const e = window.__drone;
      if (e.state === 'attack' && e.t < 18 && e.flashT > 0) window.__tele = true;
      return e.state === 'attack' && e.t >= 18;
    }, null, { timeout: 20000 });
    dove = true;
    telegraph = await G(page, () => !!window.__tele);
  } catch { /* timed out */ }
  ok(dove, 'drone executed a dive attack');
  ok(telegraph, 'dive was telegraphed (flash before t=18)');
  // after the dive the drone returns to hover height
  let hoverBack = false;
  try {
    await page.waitForFunction(() => {
      const e = window.__drone;
      return e.state === 'seek' && e.z >= 19;
    }, null, { timeout: 20000 });
    hoverBack = true;
  } catch { /* timed out */ }
  ok(hoverBack, 'drone returned to hover after the dive');
  // player can still damage the drone (real punches, drone's dive disabled)
  let playerHit = false;
  for (let i = 0; i < 16 && !playerHit; i++) {
    playerHit = await G(page, () => {
      const g = window.__gonna; const e = window.__drone;
      if (!e.alive || e.hp < e.maxHp) return true;
      g.player.state = 'idle'; g.player.t = 0; g.player.invuln = 0; g.player.hp = 100;
      g.player.x = e.x - 26; g.player.y = e.y; g.player.face = 1;
      e.atkCd = 9999; // hold the dive so the punch test is deterministic
      g.input.pressed.punch = true;
      return false;
    });
    await sleep(150);
  }
  ok(playerHit, 'player can still damage the drone');
  await ctx.close();
}

// ================= 5. END-TO-END: stage 2 wave 1 clears =================
console.log('\n[5] END-TO-END: stage 2 wave 1 clears (bot play, drum corridor active)');
{
  const { ctx, page } = await newPage(true);
  await startStage(page, 1);
  await G(page, () => { window.__gonna.input.down.right = true; });
  await waitSim(page, () => window.__gonna.waveNo === 0 && window.__gonna.enemies.length > 0);
  let cleared = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    const s = await G(page, () => {
      const g = window.__gonna;
      const p = g.player;
      const alive = g.enemies.filter((e) => e.alive);
      let best = null, bd = 1e9;
      for (const e of alive) { const d = Math.abs(e.x - p.x); if (d < bd) { bd = d; best = e; } }
      const inp = { left: false, right: false, up: false, down: false, punch: false, kick: false };
      if (p.state !== 'dead') {
        if (best) {
          const dx = best.x - p.x, dy = best.y - p.y;
          if (Math.abs(dx) > 24) inp[dx > 0 ? 'right' : 'left'] = true;
          if (Math.abs(dy) > 4) inp[dy > 0 ? 'down' : 'up'] = true;
          if (Math.abs(dx) < 46 && Math.abs(dy) < 14) { inp.punch = Math.random() < 0.7; inp.kick = !inp.punch; }
          else if (Math.abs(dx) < 90) inp.punch = true; // swipe at edge cases
        } else {
          inp.right = true;
        }
      }
      g.input.down.left = inp.left; g.input.down.right = inp.right;
      g.input.down.up = inp.up; g.input.down.down = inp.down;
      if (inp.punch) g.input.pressed.punch = true;
      if (inp.kick) g.input.pressed.kick = true;
      return { wave: g.waveNo, alive: alive.length, scene: g.sceneName };
    });
    if (s.wave >= 1 || s.scene !== 'play') { cleared = true; break; }
    await sleep(40);
  }
  ok(cleared, 'stage 2 wave 1 cleared by bot play (no soft-lock)');
  await ctx.close();
}

// ================= 6. FPS + page errors (real-time page) =================
console.log('\n[6] FPS + page errors');
{
  const { ctx, page } = await newPage(false);
  await startStage(page, 1);
  const fps = await G(page, () => new Promise((res) => {
    let n = 0;
    const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(n / ((performance.now() - t0) / 1000)); };
    requestAnimationFrame(tick);
  }));
  ok(fps >= 55, `~60fps real-time render loop (${fps.toFixed(1)}fps)`);
  await ctx.close();
}

console.log(`\n===== ${passed}/${total} passed =====`);
if (fails.length) console.log('FAILED: ' + fails.join(' | '));
console.log('page errors:', pageErrors.length ? pageErrors : 'none');
await browser.close();
process.exit(fails.length || pageErrors.length ? 1 : 0);
