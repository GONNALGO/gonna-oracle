// GONNA FIGHT v14.4 — THE PIT regression harness (mock adapter, headless).
//   1. BUG 1 REPRO: MY OPEN CARDS chips navigate BY CHALLENGE ID.
//      mine=[13(joined),17(created,private)] with board rows in a DIFFERENT
//      order ([9,17,13]). Tap chip labeled 13 -> opens 13; chip 17 -> opens 17.
//   2. BUG 1b: early-close removes the card from MY OPEN CARDS immediately.
//   3. BUG 2: a closed card renders the terminal "CARD CLOSED - STAKE
//      RETURNED" state — never the live OPEN SEAT versus layout.
//   4. CHANGE 3a: creator draft seal screen shows REPLAY - FREE (no 5 ALGO,
//      no 'continue' hotspot); tapping it starts a fresh run, no payment.
//   5. CHANGE 3b: joiner seal screen keeps CONTINUE - 5 ALGO - BEST OF 2
//      (single 'continue' hotspot, no 'replay').
// Run: node test-v144.mjs   (needs the vite preview serving dist on :4173)
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const SHOTS = '/mnt/agents/output/arena-shots';
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, total = 0;
const fails = [];
function ok(cond, label) {
  total++;
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { fails.push(label); console.log('  FAIL ' + label); }
}

// deterministic mock identity + store: mine=[13,17], board rows [9,17,13]
const ME = 'METESTDEGEN' + 'X'.repeat(47);
const RIVAL = 'RIVALTHIRTEEN' + 'Y'.repeat(45);
const GEKKO = 'GEKKORIDER' + 'Z'.repeat(48);
const NOW = Date.now();
const F = { skin: 'gonna', assetId: null, name: 'GONNA' };
const STORE = {
  nextId: 18,
  seeded: true,
  histSeeded: true,
  history: [],
  challenges: [
    {
      id: 9, creator: GEKKO, creatorName: 'GEKKORIDER', creatorType: 'ed25519',
      visibility: 'public', format: 'open', seatsTotal: 8, durationSecs: 43200,
      stageMode: 'full', stageIdx: null, stake: 10000000,
      createdAt: NOW - 3600e3, deadline: NOW + 2 * 3600e3, status: 'open',
      players: [{ address: GEKKO, name: 'GEKKORIDER', score: 0, fighter: F, accountType: 'ed25519' }],
      winner: null, pot: 10000000,
    },
    {
      // card 17: CREATED by me, PRIVATE (never in the public board list)
      id: 17, creator: ME, creatorName: 'METESTDEGEN', creatorType: 'ed25519',
      visibility: 'private', format: 'duel', seatsTotal: 2, durationSecs: 43200,
      stageMode: 'single', stageIdx: 0, stake: 10000000,
      createdAt: NOW - 3600e3, deadline: NOW + 5 * 3600e3, status: 'open',
      players: [{ address: ME, name: 'METESTDEGEN', score: 777000, fighter: F, accountType: 'ed25519' }],
      winner: null, pot: 10000000,
    },
    {
      // card 13: JOINED by me (seat 1, no score yet)
      id: 13, creator: RIVAL, creatorName: 'RIVALTHIRTEEN', creatorType: 'ed25519',
      visibility: 'public', format: 'duel', seatsTotal: 2, durationSecs: 43200,
      stageMode: 'single', stageIdx: 3, stake: 10000000,
      createdAt: NOW - 3600e3, deadline: NOW + 8 * 3600e3, status: 'full',
      players: [
        { address: RIVAL, name: 'RIVALTHIRTEEN', score: 555000, fighter: F, accountType: 'ed25519' },
        { address: ME, name: 'METESTDEGEN', score: 0, fighter: F, accountType: 'ed25519' },
      ],
      winner: null, pot: 20000000,
    },
  ],
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
const pageErrors = [];

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 560 } });
  await ctx.addInitScript(
    ({ me, store }) => {
      window.localStorage.setItem('gonna.arena.anon', me);
      window.localStorage.setItem('gonna.arena.adapter', 'mock');
      window.localStorage.setItem('gonna.arena.v1', JSON.stringify(store));
    },
    { me: ME, store: STORE },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
  await sleep(400);
  return { ctx, page };
}
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
  if (!h) {
    // settle a couple of frames and resample — hots are rebuilt every draw
    await sleep(400);
    i = await info(page);
    h = i.hots.find((x) => x.id === id);
  }
  if (!h) {
    await page.screenshot({ path: SHOTS + '/v144-FAIL-' + id.replace(':', '_') + '.png' });
    throw new Error('hot not found: ' + id + ' (screen=' + i.screen + ' have: ' + i.hots.map((x) => x.id).join(',') + ')');
  }
  const f = await fit(page);
  await page.mouse.click(f.offX + (h.x + h.w / 2) * f.scale, f.offY + (h.y + h.h / 2) * f.scale);
}
async function openArena(page) {
  await page.evaluate(() => window.__gonna.debugOpenArena());
  // wait for state AND the drawn hotspots (hots rebuild on the next frame
  // after the async refreshBoard resolves — sample only when both are live)
  await page.waitForFunction(
    () => window.__gonna.arenaInfo.screen === 'board' && window.__gonna.arenaInfo.mine.length === 2 && window.__gonna.arenaInfo.hots.some((h) => h.id === 'chip:13') && window.__gonna.arenaInfo.hots.some((h) => h.id === 'chip:17'),
    null,
    { timeout: 10000 },
  );
}

// ============ 1+2. BUG 1 REPRO: chip-by-id navigation ============
console.log('\n[1] BUG 1 REPRO: chip labeled N opens challenge N (board order differs)');
{
  const { ctx, page } = await newPage();
  await openArena(page);
  const i0 = await info(page);
  console.log('  board rows: [' + i0.cards.map((c) => c.id).join(',') + '] mine chips: [' + i0.mine.map((m) => m.id).join(',') + ']');
  ok(i0.mine.map((m) => m.id).join(',') === '13,17', 'mine chips are [13,17]');
  ok(i0.cards.map((c) => c.id).join(',') === '9,17,13', 'board rows ordered differently [9,17,13]');
  ok(i0.hots.some((h) => h.id === 'chip:13') && i0.hots.some((h) => h.id === 'chip:17'), 'chip hotspots carry challenge ids (chip:13 / chip:17)');

  await tapHot(page, 'chip:13');
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'versus', null, { timeout: 8000 });
  let cur = (await info(page)).current;
  ok(cur && cur.id === 13, 'tap chip labeled 13 -> versus opens challenge 13 (got ' + (cur && cur.id) + ')');

  await tapHot(page, 'back');
  await sleep(500); // let the board settle (async refreshBoard) before sampling hots
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'board' && window.__gonna.arenaInfo.mine.length === 2, null, { timeout: 8000 });
  await tapHot(page, 'chip:17');
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'versus', null, { timeout: 8000 });
  cur = (await info(page)).current;
  ok(cur && cur.id === 17, 'tap chip labeled 17 -> versus opens challenge 17 (got ' + (cur && cur.id) + ')');

  // ============ 3. BUG 2: early close -> terminal state ============
  console.log('\n[2] BUG 2: closed card renders terminal state (no OPEN SEAT zombie)');
  await tapHot(page, 'close'); // EARLY CLOSE (I'm the creator of 17)
  await page.waitForFunction(() => window.__gonna.arenaInfo.current && window.__gonna.arenaInfo.current.status === 'closed', null, { timeout: 8000 });
  await sleep(300);
  const iClosed = await info(page);
  ok(iClosed.current.status === 'closed', 'card 17 status is closed after early close');
  ok(!iClosed.hots.some((h) => h.id === 'close' || h.id === 'accept' || h.id === 'submit'), 'terminal card has NO live-duel actions (close/accept/submit)');
  ok(iClosed.hots.some((h) => h.id === 'back'), 'terminal card keeps only BACK');
  await page.screenshot({ path: SHOTS + '/v144-closed-card-terminal.png' });

  // ============ 2b. BUG 1b: closed card vanishes from MY OPEN CARDS ============
  console.log('\n[3] BUG 1b: closed card leaves MY OPEN CARDS immediately');
  await tapHot(page, 'back');
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'board', null, { timeout: 8000 });
  await page.waitForFunction(() => window.__gonna.arenaInfo.mine.length === 1, null, { timeout: 8000 });
  const iAfter = await info(page);
  ok(iAfter.mine.length === 1 && iAfter.mine[0].id === 13, 'MY OPEN CARDS is [13] only — 17 vanished (got [' + iAfter.mine.map((m) => m.id).join(',') + '])');
  ok(!iAfter.hots.some((h) => h.id === 'chip:17'), 'no chip:17 hotspot remains');
  await page.screenshot({ path: SHOTS + '/v144-board-after-close.png' });
  await ctx.close();
}

// ============ 4. CHANGE 3a: creator seal screen -> REPLAY - FREE ============
console.log('\n[4] CHANGE 3a: creator draft seal screen offers REPLAY - FREE');
{
  const { ctx, page } = await newPage();
  await openArena(page);
  await page.evaluate(() => window.__gonna.debugArenaSeal('creator', 123456));
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'seal', null, { timeout: 8000 });
  await sleep(200);
  const iSeal = await info(page);
  ok(iSeal.seal.role === 'creator', 'seal role is creator');
  ok(iSeal.hots.some((h) => h.id === 'replay'), 'creator seal screen has a REPLAY hotspot');
  ok(!iSeal.hots.some((h) => h.id === 'continue'), 'creator seal screen has NO continue (5 ALGO) hotspot');
  await page.screenshot({ path: SHOTS + '/v144-seal-creator-replay-free.png' });
  // REPLAY starts a fresh run with NO payment
  await tapHot(page, 'replay');
  await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 8000 });
  const iRun = await info(page);
  ok(iRun.seal.continuePaying === false, 'replay started a fresh run with NO 5 ALGO payment');
  await ctx.close();
}

// ============ 5. CHANGE 3b: joiner seal screen keeps CONTINUE - 5 ALGO ============
console.log('\n[5] CHANGE 3b: joiner seal screen keeps CONTINUE - 5 ALGO - BEST OF 2');
{
  const { ctx, page } = await newPage();
  await openArena(page);
  await tapHot(page, 'chip:13'); // I'm seated on 13 with no score
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'versus', null, { timeout: 8000 });
  await page.evaluate(() => window.__gonna.debugArenaSeal('joiner', 999999));
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'seal', null, { timeout: 8000 });
  await sleep(200);
  const iSeal = await info(page);
  ok(iSeal.seal.role === 'joiner', 'seal role is joiner');
  ok(iSeal.hots.some((h) => h.id === 'continue'), 'joiner seal screen keeps the CONTINUE hotspot');
  ok(!iSeal.hots.some((h) => h.id === 'replay'), 'joiner seal screen has NO free replay hotspot');
  await page.screenshot({ path: SHOTS + '/v144-seal-joiner-continue.png' });
  // mock continue: straight into run 2 (best-of-2 bookkeeping intact)
  await tapHot(page, 'continue');
  await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 8000 });
  ok(true, 'joiner CONTINUE still launches the retry run (mock path)');
  await ctx.close();
}

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
if (pageErrors.length > 0) console.log('PAGE ERRORS:\n' + pageErrors.join('\n'));
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
await browser.close();
process.exit(fails.length === 0 && pageErrors.length === 0 ? 0 : 1);
