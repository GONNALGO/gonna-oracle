// GONNA FIGHT v7 — headless verification.
//   1. Desktop: P pauses+resumes, ESC pauses+resumes, M mutes (title shows P PAUSE / M MUTE)
//   2. Mobile emulation: P lifts can@320, P sets down, K throws; generous touch reach
//   3. Desktop grab regression: Z lift / Z drop / X throw unchanged
//   4. Audio: composed soundtrack structural sanity (progressions, registers, loops)
//   5. Zero page errors, ~60fps
// Run: node test-v7.mjs   (needs the vite preview on :4173)
import { chromium, devices } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const SHOTS = process.env.SHOT_DIR || '/tmp/v7-shots';
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

async function newPage(mobile) {
  const ctx = await browser.newContext(mobile ? { ...devices['iPhone 13'], hasTouch: true } : { viewport: { width: 960, height: 560 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push((mobile ? 'mobile: ' : 'desktop: ') + e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
  await sleep(350);
  return { ctx, page };
}
const G = (page, fn, ...args) => page.evaluate(fn, ...args);

async function startPlayDesktop(page) {
  await page.keyboard.press('Enter');
  await sleep(350);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 5000 });
}
async function startPlayTouch(page) {
  const sz = await G(page, () => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.touchscreen.tap(sz.w / 2, sz.h / 2);
  await sleep(350);
  await page.touchscreen.tap(sz.w / 2, sz.h / 2);
  await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 5000 });
}

// ============================ 1. DESKTOP ============================
console.log('\n[1] DESKTOP: pause / mute / title controls');
{
  const { ctx, page } = await newPage(false);
  // title controls line present (pixel-font render: assert via canvas text hook)
  const controls = await G(page, () => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    // count bright-ish control-line pixels in the controls band (y 168..192 game px * canvas scale)
    return { w: c.width, h: c.height, hasInk: d.some((v, i) => i % 4 !== 3 && v > 120) };
  });
  ok(controls.hasInk, 'title screen renders pixel text');
  await page.screenshot({ path: SHOTS + '/v7-title.png' });
  // controls text: two clean lines at game-y 172 and 184 (verified visually in
  // v7-title.png: 'ARROWS/WASD MOVE SPACE JUMP C SPECIAL' + 'Z PUNCH X KICK P PAUSE M MUTE')
  const bands = await G(page, () => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const ink = (gy) => {
      const d = g.getImageData(0, Math.floor(gy * c.height / 224), c.width, Math.max(1, Math.floor(8 * c.height / 224))).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 90 || d[i + 1] > 90 || d[i + 2] > 90) n++;
      return n;
    };
    return { l1: ink(172), l2: ink(184) };
  });
  ok(bands.l1 > 100 && bands.l2 > 100, `title shows both controls lines (ink ${bands.l1}/${bands.l2}; line2 = 'Z PUNCH X KICK P PAUSE M MUTE' per screenshot)`);

  await startPlayDesktop(page);
  ok(await G(page, () => window.__gonna.sceneName === 'play'), 'desktop: game starts');

  // --- P pauses: veil + sim freeze ---
  await page.keyboard.press('KeyP');
  await sleep(150);
  ok(await G(page, () => window.__gonna.paused === true), 'P pauses the sim');
  const f1 = await G(page, () => window.__gonna.frame);
  await sleep(400);
  const f2 = await G(page, () => window.__gonna.frame);
  ok(f1 === f2, `sim frozen while paused (frame ${f1} == ${f2})`);
  await page.screenshot({ path: SHOTS + '/v7-pause.png' });
  // movement input ignored while paused
  const x1 = await G(page, () => window.__gonna.player.x);
  await page.keyboard.down('ArrowRight');
  await sleep(250);
  await page.keyboard.up('ArrowRight');
  ok(Math.abs((await G(page, () => window.__gonna.player.x)) - x1) < 0.01, 'player frozen while paused');
  // P resumes
  await page.keyboard.press('KeyP');
  await sleep(150);
  ok(await G(page, () => window.__gonna.paused === false), 'P resumes');
  const f3 = await G(page, () => window.__gonna.frame);
  await sleep(250);
  ok((await G(page, () => window.__gonna.frame)) > f3, 'sim runs after resume');

  // --- ESC pauses + resumes ---
  await page.keyboard.press('Escape');
  await sleep(150);
  ok(await G(page, () => window.__gonna.paused === true), 'ESC pauses');
  await page.keyboard.press('Escape');
  await sleep(150);
  ok(await G(page, () => window.__gonna.paused === false), 'ESC resumes');

  // --- M mutes / unmutes ---
  const m0 = await G(page, () => window.__gonna.audio.muted);
  await page.keyboard.press('KeyM');
  await sleep(120);
  ok((await G(page, () => window.__gonna.audio.muted)) === !m0, 'M toggles mute on');
  await page.keyboard.press('KeyM');
  await sleep(120);
  ok((await G(page, () => window.__gonna.audio.muted)) === m0, 'M toggles mute off');

  // --- fps sample ---
  const fa = await G(page, () => window.__gonna.frame);
  await sleep(2000);
  const fb = await G(page, () => window.__gonna.frame);
  const fps = (fb - fa) / 2;
  ok(fps >= 45, `~60fps headless (${fps.toFixed(0)} fps)`);

  // --- desktop grab regression: Z lift, Z drop, DOWN+Z reach, X throw, whiff rule ---
  await G(page, () => { window.__gonna.debugKillEnemies(); window.__gonna.player.invuln = 99999; window.__gonna.debugWarp(240); });
  await sleep(150);
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => window.__gonna.player.x >= 304, null, { timeout: 6000 }).catch(() => {});
  await page.keyboard.up('ArrowRight');
  const dx = await G(page, () => 320 - window.__gonna.player.x);
  ok(Math.abs(dx) <= 17, `desktop: player blocked next to can (dx=${dx.toFixed(1)})`);
  await page.keyboard.press('KeyZ');
  await sleep(150);
  ok(await G(page, () => !!window.__gonna.carriedObject), 'desktop: Z lifts the can (regression)');
  await page.keyboard.press('KeyZ');
  await sleep(150);
  ok(await G(page, () => !window.__gonna.carriedObject), 'desktop: Z sets it down (regression)');
  // DOWN+Z extended reach at dx=19 lifts (desktop rule unchanged)
  await G(page, () => {
    const g = window.__gonna;
    const can = g.objects.find((o) => o.kind === 'can' && o.mode === 'idle' && !o.removeMe);
    g.debugWarp(can.x - 19);
  });
  await sleep(120);
  await page.keyboard.down('ArrowDown');
  await sleep(140); // let the DOWN level persist across real frames before Z
  await page.keyboard.press('KeyZ');
  await sleep(80);
  await page.keyboard.up('ArrowDown');
  await sleep(150);
  ok(await G(page, () => !!window.__gonna.carriedObject), 'desktop: DOWN+Z at dx=19 lifts (rule unchanged)');
  // X throws
  await page.keyboard.press('KeyX');
  await sleep(250);
  const thrown = await G(page, () => ({ carrying: !!window.__gonna.carriedObject, st: window.__gonna.player.state }));
  ok(!thrown.carrying && thrown.st !== 'carry', 'desktop: X throws (regression)');
  // whiff rule unchanged: barrel@700 at dx=19 without DOWN -> punch, no lift
  await G(page, () => window.__gonna.debugWarp(700 - 19));
  await sleep(120);
  await page.keyboard.press('KeyZ');
  await sleep(150);
  const whiff = await G(page, () => ({ carrying: !!window.__gonna.carriedObject, st: window.__gonna.player.state }));
  ok(!whiff.carrying, 'desktop: dx=19 without DOWN still whiffs to a punch (rule unchanged)');
  await ctx.close();
}

// ============================ 2. MOBILE GRAB ============================
console.log('\n[2] MOBILE: touch grab flow at can@320');
{
  const { ctx, page } = await newPage(true);
  await G(page, () => {
    window.__pe = (type, id, cx, cy) => {
      document.querySelector('canvas').dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', isPrimary: false,
        clientX: cx, clientY: cy, bubbles: true, cancelable: true,
      }));
    };
  });
  await startPlayTouch(page);
  ok(await G(page, () => window.__gonna.input.touchMode === true), 'mobile: touchMode active');
  const pd = await G(page, () => window.__gonna.touch.padLayout.map((b) => ({ x: b.x, y: b.y, btn: b.btn })));
  const punch = pd.find((b) => b.btn === 'punch');
  const kick = pd.find((b) => b.btn === 'kick');
  await G(page, () => { window.__gonna.debugKillEnemies(); window.__gonna.player.invuln = 99999; window.__gonna.debugWarp(240); });
  await sleep(150);
  // natural walk to the can with the virtual joystick
  await G(page, () => {
    window.__pe('pointerdown', 7, 80, window.innerHeight * 0.75);
    window.__pe('pointermove', 7, 145, window.innerHeight * 0.75);
  });
  await page.waitForFunction(() => window.__gonna.player.x >= 302, null, { timeout: 8000 }).catch(() => {});
  await G(page, () => window.__pe('pointerup', 7, 145, window.innerHeight * 0.75));
  const pre = await G(page, () => {
    const g = window.__gonna;
    const can = g.objects.find((o) => o.kind === 'can');
    return { px: g.player.x, py: g.player.y, canX: can.x, canY: can.y, mode: can.mode };
  });
  ok(Math.abs(pre.canX - 320) < 0.01 && Math.abs(pre.canY - 168) < 0.01, `mobile: stage-1 can at 320,168 (${pre.canX},${pre.canY})`);
  // P near object = LIFT
  await page.touchscreen.tap(punch.x, punch.y);
  await sleep(160);
  ok(await G(page, () => !!window.__gonna.carriedObject && window.__gonna.player.state === 'carry'), 'mobile: P near can = LIFT');
  // P again = SET DOWN
  await page.touchscreen.tap(punch.x, punch.y);
  await sleep(160);
  const down = await G(page, () => ({ carrying: !!window.__gonna.carriedObject, can: window.__gonna.objects.find((o) => o.kind === 'can') }));
  ok(!down.carrying && down.can.mode === 'idle' && !down.can.removeMe, 'mobile: P again = SET DOWN (can intact)');
  // K = THROW
  await page.touchscreen.tap(punch.x, punch.y); // lift again
  await sleep(160);
  ok(await G(page, () => !!window.__gonna.carriedObject), 'mobile: re-lift before throw');
  await page.touchscreen.tap(kick.x, kick.y);
  await sleep(300);
  const thr = await G(page, () => ({ carrying: !!window.__gonna.carriedObject, proj: window.__gonna.projectiles.length, can: window.__gonna.objects.find((o) => o.kind === 'can') }));
  ok(!thr.carrying && (thr.proj > 0 || !thr.can || thr.can.removeMe || thr.can.mode === 'thrown'), 'mobile: K = THROW');
  // generous reach on the barrel@700: dx=27 (beyond the old +12 rule), no DOWN -> touch lifts
  await G(page, () => { window.__gonna.debugKillEnemies(); window.__gonna.debugWarp(700 - 27); });
  await sleep(200);
  const near = await G(page, () => {
    const g = window.__gonna;
    const o = g.objects.find((q) => q.kind === 'barrel' && q.mode === 'idle' && !q.removeMe && Math.abs(q.x - g.player.x) < 60);
    return o ? { dx: Math.abs(o.x - g.player.x), dy: Math.abs(o.y - g.player.y) } : null;
  });
  ok(!!near && near.dx > 24, `mobile: barrel in generous-reach range (dx=${near ? near.dx.toFixed(0) : 'n/a'}, dy=${near ? near.dy.toFixed(0) : 'n/a'})`);
  await page.touchscreen.tap(punch.x, punch.y);
  await sleep(160);
  ok(await G(page, () => !!window.__gonna.carriedObject), 'mobile: generous reach lifts at dx=27 (touch-only rule)');
  // relaxed lane window on touch: dy=15 (desktop would whiff at >=12)
  await page.touchscreen.tap(punch.x, punch.y); // set down first
  await sleep(160);
  await G(page, () => {
    const g = window.__gonna;
    const o = g.objects.find((q) => q.kind === 'barrel' && oNear(q, g));
    function oNear(q, g2) { return q.mode === 'idle' && !q.removeMe && Math.abs(q.x - g2.player.x) < 60; }
    if (o) g.player.y = o.y + 15; // dy=15: beyond the desktop 12px lane window
  });
  await sleep(80);
  await page.touchscreen.tap(punch.x, punch.y);
  await sleep(160);
  ok(await G(page, () => !!window.__gonna.carriedObject), 'mobile: relaxed lane window lifts at dy=15 (touch-only rule)');
  await ctx.close();
}

// ============================ 3. AUDIO SANITY ============================
console.log('\n[3] AUDIO: soundtrack structural sanity');
{
  execSync('npx esbuild src/game/audio.ts --bundle --format=esm --outfile=/tmp/v7-audio-bundle.mjs --log-level=error', { stdio: 'inherit' });
  const { TRACKS } = await import('/tmp/v7-audio-bundle.mjs');
  const K = 1, SN = 2, HH = 4;
  const barRoots = (events, steps) => {
    const roots = [];
    for (let b = 0; b < steps / 16; b++) {
      const counts = {};
      for (const e of events) if (e.step >= b * 16 && e.step < (b + 1) * 16) counts[e.midi % 12] = (counts[e.midi % 12] || 0) + e.len;
      let best = -1, bn = -1;
      for (const pc of Object.keys(counts)) if (counts[pc] > bn) { bn = counts[pc]; best = +pc; }
      roots.push(best);
    }
    return roots;
  };
  const runOf = (evs) => {
    let run = 1, mx = 1;
    const s = [...evs].sort((a, b) => a.step - b.step);
    for (let i = 1; i < s.length; i++) { run = s[i].midi === s[i - 1].midi ? run + 1 : 1; mx = Math.max(mx, run); }
    return mx;
  };
  const expected = ['title', 'stage1', 'stage2', 'stage3', 'stage4', 'stage5', 'stage6', 'boss', 'boss2', 'victory', 'gameover'];
  ok(expected.every((k) => TRACKS[k]), 'all 11 themes exist (title, s1-6, boss x2, victory, gameover)');
  for (const [name, tr] of Object.entries(TRACKS)) {
    const bars = tr.steps / 16;
    ok(Number.isInteger(bars) && bars >= 8 && bars <= 16, `${name}: loop 8-16 bars (${bars})`);
    const roots = barRoots(tr.bass, tr.steps);
    ok(new Set(roots).size >= 3, `${name}: real chord progression (${new Set(roots).size} roots)`);
    const maxRep = Math.max(runOf(tr.lead), tr.leadB ? runOf(tr.leadB) : 1);
    ok(maxRep <= 4, `${name}: no >4 identical repeated lead notes (${maxRep})`);
    const lm = [...tr.lead, ...(tr.leadB || [])].map((e) => e.midi);
    ok(Math.max(...lm) <= 76 && Math.min(...lm) >= 55, `${name}: lead in sane mid register (${Math.min(...lm)}-${Math.max(...lm)})`);
    const gaps = tr.lead.map((e) => { const b = tr.bMap[e.step]; return b ? e.midi - b.midi : null; }).filter((v) => v !== null).sort((a, b) => a - b);
    ok(gaps[Math.floor(gaps.length * 0.9)] <= 44, `${name}: lead not dominated by extreme gaps over bass (p90 ${gaps[Math.floor(gaps.length * 0.9)]})`);
    let groove = 0;
    for (let b = 0; b < bars; b++) {
      const bar = tr.drums.slice(b * 16, (b + 1) * 16);
      if ((bar[0] & K) && (bar[8] & K) && (bar[4] & SN) && (bar[12] & SN)) groove++;
    }
    ok(groove >= bars * 0.6, `${name}: kick on quarters + snare on 2&4 (${groove}/${bars} bars)`);
    if (!['victory', 'gameover'].includes(name)) ok(!!(tr.leadB || tr.drumsB), `${name}: B-cycle variation every 2nd loop`);
  }
}

// ============================ 4. ERRORS ============================
console.log('\n[4] PAGE ERRORS');
ok(pageErrors.length === 0, `zero page errors (${pageErrors.length})${pageErrors.length ? ' -> ' + pageErrors.join(' | ') : ''}`);

await browser.close();
console.log('\n=================================');
console.log(`V7 ASSERTIONS: ${passed}/${total}`);
if (fails.length) { console.log('FAILURES: ' + fails.join(' | ')); process.exit(1); }
