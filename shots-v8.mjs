// GONNA FIGHT v8 — DEGEN COLLECTION: share-worthy screenshots of all 6 stages
// + busy-scene FPS assertion. Needs the vite preview on :4173.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const OUT = '/mnt/agents/output/shots-v8/';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
const pageErrors = [];
const ctx = await browser.newContext({ viewport: { width: 1152, height: 672 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
await sleep(400);
const G = (fn, ...args) => page.evaluate(fn, ...args);
const shot = async (name) => {
  await page.screenshot({ path: OUT + name + '.png' });
  console.log('shot ' + name);
};

async function startStage(idx) {
  await G((i) => window.__gonna.debugStage(i), idx);
  await sleep(120);
}
async function skipIntro() {
  await G(() => { window.__gonna.input.pressed.start = true; });
  await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 8000 });
}
async function warp(x) {
  await G((wx) => window.__gonna.debugWarp(wx), x);
  await sleep(350);
}
async function waitFrame(cond) {
  await page.waitForFunction(cond, null, { timeout: 30000 });
}

// ---------- STAGE 1: GHETTO GONNA ----------
await startStage(0);
await shot('s1-intro');
await skipIntro();
await warp(60); // lounge 1 + rain + graffiti
await shot('s1-a-lounge-rain');
await warp(640); // lowrider + barrel fire
await shot('s1-b-lowrider');
await warp(1140); // lounge 2 + FUD ZONE tape
await shot('s1-c-tape-lounge2');
// foreground silhouette moment (walker crosses when frame % 620 < 150)
await waitFrame(() => { const f = window.__gonna.frame % 620; return f > 55 && f < 105; });
await shot('s1-d-foreground-silhouette');

// ---------- STAGE 2: PUMP HARBOR ----------
await startStage(1);
await shot('s2-intro');
await skipIntro();
await warp(500); // chart billboard (far 400 -> screen 275) + cranes + warehouse neon
await shot('s2-a-chart-cranes');
await warp(1050);
await shot('s2-b-harbor');
// yacht on screen: yx = 460 + (f*0.22 % 1100) - 200 - camX*0.5 in [30, 220]
await waitFrame(() => {
  const g = window.__gonna;
  const yx = 460 + ((g.frame * 0.22) % 1100) - 200 - g.camX * 0.5;
  return yx > 30 && yx < 220;
});
await shot('s2-c-yacht');

// ---------- STAGE 3: BYZANTINE WALL STREET ----------
await startStage(2);
await shot('s3-intro');
await skipIntro();
await warp(260); // ticker 1 + bull statue + lamps
await shot('s3-a-ticker-bull');
await warp(860); // ticker 2 + bear statue
await shot('s3-b-ticker-bear');
await shot('s3-c-candles');

// ---------- STAGE 4: TEMPLE OF CONSENSUS ----------
await startStage(3);
await shot('s4-intro');
await skipIntro();
await warp(450); // koi pond + lanterns + mosaic light
await sleep(500);
await shot('s4-a-pond-lanterns');
await warp(1300); // Founder statue + braziers
await shot('s4-b-founder');

// ---------- STAGE 5: THE HOUSE ----------
await startStage(4);
await shot('s5-intro');
await skipIntro();
await warp(300); // slot row spinning
await shot('s5-a-slots');
await warp(1000); // sign + more machines
await shot('s5-b-sign');
// jackpot machine (mi%8==3 -> machines[3]=232; visible while frame%480<100)
await G(() => window.__gonna.debugWarp(360));
await waitFrame(() => (window.__gonna.frame % 480) < 80);
await shot('s5-c-jackpot');

// ---------- STAGE 6: MOON LAUNCHPAD ----------
await startStage(5);
await shot('s6-intro');
await skipIntro();
await warp(200); // rocket 1 venting + countdown? cd at 654-0.55*camX
await shot('s6-a-rocket');
await warp(1050); // countdown + rocket 2 + crawler
await shot('s6-b-countdown');

// ---------- FPS: busy scene on stage 1 (rain + silhouettes + mob + flames) ----------
await startStage(0);
await skipIntro();
await G(() => {
  const g = window.__gonna;
  g.debugWarp(640);
  for (const k of ['gecko', 'snek', 'drone', 'whale', 'ninja']) g.debugSpawn(k, 60 + Math.random() * 120);
  g.spawnFlame(g.player.x + 40, 180);
  g.spawnFlame(g.player.x - 60, 190);
  g.player.hp = 9999; g.player.maxHp = 9999;
});
await sleep(600);
const fps = await G(() => new Promise((res) => {
  let n = 0;
  const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(n / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(tick);
}));
console.log('FPS busy scene: ' + fps.toFixed(1));
await shot('s1-e-busy-fps');
console.log('fps>=58: ' + (fps >= 58 ? 'PASS' : 'FAIL'));
console.log('page errors: ' + (pageErrors.length ? pageErrors.join(' | ') : 'none'));
await browser.close();
process.exit(pageErrors.length || fps < 58 ? 1 : 0);
