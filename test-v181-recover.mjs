// v18.1 E2E — Prince's SEED MISMATCH fix: a recovered lost run ADOPTS its
// mode+level from the tape itself, so the sign body can never contradict the
// sealed log (PIT-* -> DESCENT card, RUN-* -> FULL RUN card).
//   A) PIT-2 tape (DESCENT lvl3) -> recover arms cfg 'single' + stageIdx 3
//   B) RUN-9 tape (FULL RUN)     -> recover arms cfg 'full' + stageIdx null
//   C) board boots clean in live mode, no page errors
// Run: node test-v181-recover.mjs  (vite preview serving dist on :4173)
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

const browser = await chromium.launch();
const pageErrors = [];

const info = (page) => page.evaluate(() => window.__gonna.arenaInfo);
const fit = (page) =>
  page.evaluate(() => {
    const w = window.innerWidth, h = window.innerHeight;
    const s = Math.min(w / 384, h / 224);
    return { scale: s, offX: (w - 384 * s) / 2, offY: (h - 224 * s) / 2 };
  });
async function tapHot(page, id) {
  let i = await info(page);
  let h = i.hots.find((x) => x.id === id);
  if (!h) { await sleep(500); i = await info(page); h = i.hots.find((x) => x.id === id); }
  if (!h) throw new Error('hot not found: ' + id + ' (screen=' + i.screen + ' have: ' + i.hots.map((x) => x.id).join(',') + ')');
  const f = await fit(page);
  await page.mouse.click(f.offX + (h.x + h.w / 2) * f.scale, f.offY + (h.y + h.h / 2) * f.scale);
}

async function recoverCase(label, ckpt, wantMode, wantStage) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 560 } });
  await ctx.addInitScript((k) => {
    window.sessionStorage.setItem('gonna.arena.ckpt', JSON.stringify(k));
  }, ckpt);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(label + ': ' + e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__gonna && window.__gonna.arenaInfo), null, { timeout: 15000 });
  await sleep(1500);
  await page.evaluate(() => window.__gonna.debugOpenArena());
  await sleep(1200);
  let i = await info(page);
  ok(i.screen === 'board', label + ': board opens (got ' + i.screen + ')');
  ok(i.hots.some((h) => h.id === 'recover'), label + ': RECOVER LOST RUN banner armed');
  await tapHot(page, 'recover');
  await sleep(600);
  i = await info(page);
  ok(i.screen === 'seal', label + ': recover lands on the seal screen (got ' + i.screen + ')');
  ok(i.cfg.stageMode === wantMode, label + ': cfg.stageMode adopted from tape = ' + wantMode + ' (got ' + i.cfg.stageMode + ')');
  ok((i.cfg.stageIdx ?? null) === wantStage, label + ': cfg.stageIdx = ' + wantStage + ' (got ' + i.cfg.stageIdx + ')');
  ok(i.seal.sealed === ckpt.score, label + ': sealed score armed = ' + ckpt.score + ' (got ' + i.seal.sealed + ')');
  // the checkpoint survives a page reload (crash armor) — same recovery twice
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__gonna && window.__gonna.arenaInfo), null, { timeout: 15000 });
  await sleep(1200);
  await page.evaluate(() => window.__gonna.debugOpenArena());
  await sleep(1000);
  i = await info(page);
  ok(i.hots.some((h) => h.id === 'recover'), label + ': checkpoint still armed after reload');
  await ctx.close();
}

console.log('[A] DESCENT tape -> DESCENT card config');
await recoverCase('A(PIT-2)', { seedLabel: 'PIT-2', stageMode: 'stage', stageIdx: 3, score: 51600, frames: 14821, durationSec: 247, build: 'vb9ca8fcb', inputLogB64: 'AAAA', ts: Date.now() }, 'single', 3);

console.log('[B] FULL RUN tape -> FULL RUN card config');
await recoverCase('B(RUN-9)', { seedLabel: 'RUN-9', stageMode: 'full', stageIdx: 0, score: 8800, frames: 40000, durationSec: 667, build: 'vb9ca8fcb', inputLogB64: 'AAAA', ts: Date.now() }, 'full', null);

ok(pageErrors.length === 0, 'no page errors (' + pageErrors.length + ')');
if (pageErrors.length) console.log('  ' + pageErrors.join('\n  '));

await browser.close();
console.log('\n== ' + passed + '/' + total + ' PASS ==');
process.exit(fails.length ? 1 : 0);
