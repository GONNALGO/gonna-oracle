// GONNA FIGHT — QuantumArena v2 harness (seat clock / claim_forfeit UI).
//   PART A (node, unit): duelForfeitInfo + fmtMMSS with MOCKED seated_at —
//     claimable when the opponent clock lapsed, own-clock countdown when my
//     seat is unsigned, duels only, mock cards unaffected.
//   PART B (browser, mock adapter): the real drawVersus branches headless —
//     CLAIM FORFEIT hotspot on an expired unsigned opponent seat (tap -> the
//     mock has no chain path -> VISIBLE error, never a dead click), the
//     SIGN-WITHIN countdown state on my own unsigned seat, and the terminal
//     FORFEIT - SEAT CLOCK EXPIRED closed card.
//   PART C (browser, TESTNET adapter, real chain): the duel left unsigned by
//     PLAYER_B on testnet (deploy/testnet.json smoke_v2) renders the own-clock
//     countdown for PLAYER_B and NO claim button for PLAYER_A (1h not lapsed).
//     The QA key is read from the GITIGNORED deploy/testnet.secrets.json and
//     never printed. claim_forfeit itself unlocks on-chain 1h after the smoke
//     run — flagged in the stage report, not faked here.
// Run: node test-v2.mjs   (needs the vite preview serving dist on :4173)
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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

// ================= PART A: pure seat-clock logic (mocked seated_at) =========
console.log('\n[A] UNIT: duelForfeitInfo + fmtMMSS (mocked seated_at)');
{
  execFileSync('npx', ['esbuild', 'src/game/arena/chainAdapter.ts', '--bundle', '--format=esm', '--platform=node', '--external:algosdk', '--outfile=.tmp-chainAdapter-v2.mjs'], { cwd: '/mnt/agents/output/app', stdio: 'pipe' });
  const { duelForfeitInfo, fmtMMSS, SEAT_TTL_MS } = await import('/mnt/agents/output/app/.tmp-chainAdapter-v2.mjs');
  const NOW = Date.now();
  const F = { skin: 'gonna', assetId: null, name: 'GONNA' };
  const ME = 'MEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const RIVAL = 'RIVALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const duel = (over = {}) => ({
    id: 1, creator: ME, creatorName: 'ME', creatorType: 'ed25519', visibility: 'public',
    format: 'duel', seatsTotal: 2, durationSecs: 86400, stageMode: 'full', stageIdx: null,
    stake: 1, createdAt: NOW - 7200e3, deadline: NOW + 22 * 3600e3, status: 'full',
    players: [
      { address: ME, name: 'ME', score: 1000, fighter: F, accountType: 'ed25519', signed: true, seatedAt: NOW - 7200e3 },
      { address: RIVAL, name: 'RIVAL', score: 0, fighter: F, accountType: 'ed25519', signed: false, seatedAt: NOW - 3700e3 },
    ],
    winner: null, pot: 2, ...over,
  });

  // 1. opponent unsigned, clock LAPSED (seated 3700s ago) -> claimable, seat 1
  let info = duelForfeitInfo(duel(), ME, NOW);
  ok(info && info.kind === 'claimable' && info.seat === 1, 'claimable when opponent clock lapsed (seat 1)');
  // 2. opponent unsigned but only 30min in -> nothing yet
  info = duelForfeitInfo(duel({ players: [duel().players[0], { ...duel().players[1], seatedAt: NOW - 1800e3 }] }), ME, NOW);
  ok(info === null, 'no claim while opponent clock still running');
  // 3. MY seat unsigned -> own-clock with ~50min left
  info = duelForfeitInfo(duel({ players: [{ ...duel().players[1], address: ME, seatedAt: NOW - 600e3 }, { ...duel().players[0], address: RIVAL }] }), ME, NOW);
  ok(info && info.kind === 'own-clock' && info.remainingMs > 49 * 60e3 && info.remainingMs <= 50 * 60e3, 'own-clock countdown on my unsigned seat (~50:00 left)');
  ok(fmtMMSS(info.remainingMs) === '50:00' || fmtMMSS(info.remainingMs) === '49:59', 'fmtMMSS renders mm:ss (' + fmtMMSS(info.remainingMs) + ')');
  // 4. open TABLE (seats_total>1) is exempt even with unsigned seats
  info = duelForfeitInfo(duel({ format: 'open', seatsTotal: 5 }), ME, NOW);
  ok(info === null, 'tables (seats_total>1) have no seat clock');
  // 5. mock cards (no signed/seatedAt) are unaffected
  info = duelForfeitInfo(duel({ players: [
    { address: ME, name: 'ME', score: 1000, fighter: F, accountType: 'ed25519' },
    { address: RIVAL, name: 'RIVAL', score: 0, fighter: F, accountType: 'ed25519' },
  ] }), ME, NOW);
  ok(info === null, 'mock cards without seat-clock data -> null');
  // 6. terminal/resolved cards never claim
  info = duelForfeitInfo(duel({ status: 'resolved' }), ME, NOW);
  ok(info === null, 'resolved card -> null');
  // 7. edge: exactly at expiry is NOT claimable (contract: strict >)
  info = duelForfeitInfo(duel({ players: [duel().players[0], { ...duel().players[1], seatedAt: NOW - SEAT_TTL_MS }] }), ME, NOW);
  ok(info === null, 'exactly at seated_at+3600 is NOT claimable (strict >)');
  ok(fmtMMSS(0) === '00:00', 'fmtMMSS clamps at 00:00');
}

// ================= browser scaffolding ======================================
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
const pageErrors = [];
const F = { skin: 'gonna', assetId: null, name: 'GONNA' };
const ME = 'METESTDEGEN' + 'X'.repeat(47);
const RIVAL = 'RIVALSILENT' + 'Y'.repeat(47);
const NOW = Date.now();

// mock store: 42 = claimable duel, 43 = my own-clock duel, 44 = forfeited
// closed card, 45 = open table with an unsigned seat (exempt)
const STORE = {
  nextId: 46, seeded: true, histSeeded: true, history: [],
  challenges: [
    {
      id: 42, creator: ME, creatorName: 'METESTDEGEN', creatorType: 'ed25519',
      visibility: 'public', format: 'duel', seatsTotal: 2, durationSecs: 86400,
      stageMode: 'full', stageIdx: null, stake: 1000000,
      createdAt: NOW - 7200e3, deadline: NOW + 20 * 3600e3, status: 'full',
      players: [
        { address: ME, name: 'METESTDEGEN', score: 777000, fighter: F, accountType: 'ed25519', signed: true, seatedAt: NOW - 7200e3 },
        { address: RIVAL, name: 'RIVALSILENT', score: 0, fighter: F, accountType: 'ed25519', signed: false, seatedAt: NOW - 3700e3 },
      ],
      winner: null, pot: 2000000,
    },
    {
      id: 43, creator: RIVAL, creatorName: 'RIVALSILENT', creatorType: 'ed25519',
      visibility: 'public', format: 'duel', seatsTotal: 2, durationSecs: 86400,
      stageMode: 'full', stageIdx: null, stake: 1000000,
      createdAt: NOW - 900e3, deadline: NOW + 23 * 3600e3, status: 'full',
      players: [
        { address: RIVAL, name: 'RIVALSILENT', score: 555000, fighter: F, accountType: 'ed25519', signed: true, seatedAt: NOW - 900e3 },
        { address: ME, name: 'METESTDEGEN', score: 0, fighter: F, accountType: 'ed25519', signed: false, seatedAt: NOW - 600e3 },
      ],
      winner: null, pot: 2000000,
    },
    {
      id: 44, creator: RIVAL, creatorName: 'RIVALSILENT', creatorType: 'ed25519',
      visibility: 'public', format: 'duel', seatsTotal: 2, durationSecs: 86400,
      stageMode: 'full', stageIdx: null, stake: 1000000,
      createdAt: NOW - 30000e3, deadline: NOW - 4000e3, status: 'closed', forfeited: true,
      players: [
        { address: RIVAL, name: 'RIVALSILENT', score: 555000, fighter: F, accountType: 'ed25519', signed: true, seatedAt: NOW - 30000e3 },
        { address: ME, name: 'METESTDEGEN', score: 0, fighter: F, accountType: 'ed25519', signed: false, seatedAt: NOW - 29000e3 },
      ],
      winner: RIVAL, pot: 2000000,
    },
    {
      id: 45, creator: ME, creatorName: 'METESTDEGEN', creatorType: 'ed25519',
      visibility: 'public', format: 'open', seatsTotal: 5, durationSecs: 14400,
      stageMode: 'full', stageIdx: null, stake: 1000000,
      createdAt: NOW - 3700e3, deadline: NOW + 10 * 3600e3, status: 'open',
      players: [
        { address: ME, name: 'METESTDEGEN', score: 123000, fighter: F, accountType: 'ed25519', signed: true, seatedAt: NOW - 3700e3 },
        { address: RIVAL, name: 'RIVALSILENT', score: 0, fighter: F, accountType: 'ed25519', signed: false, seatedAt: NOW - 3700e3 },
      ],
      winner: null, pot: 2000000,
    },
  ],
};

async function newMockPage() {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 560 } });
  await ctx.addInitScript(({ me, store }) => {
    window.localStorage.setItem('gonna.arena.anon', me);
    window.localStorage.setItem('gonna.arena.adapter', 'mock');
    window.localStorage.setItem('gonna.arena.v1', JSON.stringify(store));
  }, { me: ME, store: STORE });
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
    await sleep(400);
    i = await info(page);
    h = i.hots.find((x) => x.id === id);
  }
  if (!h) {
    await page.screenshot({ path: SHOTS + '/v2-FAIL-' + id.replace(':', '_') + '.png' });
    throw new Error('hot not found: ' + id + ' (screen=' + i.screen + ' have: ' + i.hots.map((x) => x.id).join(',') + ')');
  }
  const f = await fit(page);
  await page.mouse.click(f.offX + (h.x + h.w / 2) * f.scale, f.offY + (h.y + h.h / 2) * f.scale);
}
async function openCardById(page, cid, mineCount) {
  await page.evaluate(() => window.__gonna.debugOpenArena());
  await page.waitForFunction(
    (n) => window.__gonna.arenaInfo.screen === 'board' && window.__gonna.arenaInfo.mine.length >= n,
    mineCount, { timeout: 15000 },
  );
  await tapHot(page, 'chip:' + cid);
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'versus', null, { timeout: 8000 });
}

// ================= PART B: mock adapter, real draw branches =================
console.log('\n[B1] CLAIM FORFEIT renders on an expired unsigned opponent seat');
{
  const { ctx, page } = await newMockPage();
  await openCardById(page, 42, 3);
  await sleep(300);
  const i = await info(page);
  ok(i.current && i.current.id === 42, 'versus opened card 42');
  ok(i.forfeit && i.forfeit.kind === 'claimable' && i.forfeit.seat === 1, 'info.forfeit is claimable seat 1');
  ok(i.hots.some((h) => h.id === 'forfeit'), 'CLAIM FORFEIT hotspot rendered (red, prominent)');
  await page.screenshot({ path: SHOTS + '/v2-claim-forfeit-button.png' });
  // mock adapter has no chain forfeit path — the tap must surface a VISIBLE
  // error, never a dead click (anti-hang contract)
  await tapHot(page, 'forfeit');
  await page.waitForFunction(() => window.__gonna.arenaInfo.err !== '', null, { timeout: 8000 });
  const i2 = await info(page);
  ok(/FORFEIT/.test(i2.err), 'mock tap fails VISIBLY: "' + i2.err + '"');
  await ctx.close();
}

console.log('\n[B2] own unsigned seat -> SIGN-WITHIN countdown state');
{
  const { ctx, page } = await newMockPage();
  await openCardById(page, 43, 3);
  await sleep(300);
  const i = await info(page);
  ok(i.forfeit && i.forfeit.kind === 'own-clock', 'info.forfeit is own-clock');
  ok(i.forfeit.remainingMs > 49 * 60e3 && i.forfeit.remainingMs <= 50 * 60e3, 'remainingMs ~50min (' + Math.round(i.forfeit.remainingMs / 1000) + 's)');
  ok(i.hots.some((h) => h.id === 'submit'), 'SUBMIT SCORE still offered next to the countdown');
  ok(!i.hots.some((h) => h.id === 'forfeit'), 'no CLAIM FORFEIT on my own unsigned seat');
  await sleep(1100); // live countdown ticks
  const i3 = await info(page);
  ok(i3.forfeit.remainingMs < i.forfeit.remainingMs, 'countdown is LIVE (ticks down frame to frame)');
  await page.screenshot({ path: SHOTS + '/v2-sign-within-countdown.png' });
  await ctx.close();
}

console.log('\n[B3] forfeited card -> terminal FORFEIT - SEAT CLOCK EXPIRED state');
{
  // closed cards leave MY OPEN CARDS by design — the ?duel= deep-link still
  // opens them (that is exactly how a shared forfeited card is viewed)
  const ctx = await browser.newContext({ viewport: { width: 960, height: 560 } });
  await ctx.addInitScript(({ me, store }) => {
    window.localStorage.setItem('gonna.arena.anon', me);
    window.localStorage.setItem('gonna.arena.adapter', 'mock');
    window.localStorage.setItem('gonna.arena.v1', JSON.stringify(store));
  }, { me: ME, store: STORE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE + '?duel=44', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'versus' && window.__gonna.arenaInfo.current, null, { timeout: 15000 });
  await sleep(400);
  const i = await info(page);
  ok(i.current && i.current.status === 'closed' && i.current.forfeited === true, 'card 44 is terminal + forfeited');
  ok(!i.hots.some((h) => h.id === 'forfeit' || h.id === 'submit' || h.id === 'resolve' || h.id === 'accept'), 'terminal forfeit card has NO live actions');
  ok(i.hots.some((h) => h.id === 'back'), 'terminal forfeit card keeps BACK');
  await page.screenshot({ path: SHOTS + '/v2-forfeit-closed-card.png' });
  await ctx.close();
}

console.log('\n[B4] open tables are exempt from the seat clock');
{
  const { ctx, page } = await newMockPage();
  await openCardById(page, 45, 3);
  await sleep(300);
  const i = await info(page);
  ok(i.forfeit === null, 'table card (seats>2) -> no forfeit state');
  ok(!i.hots.some((h) => h.id === 'forfeit'), 'no CLAIM FORFEIT on tables');
  await ctx.close();
}

// ================= PART C: TESTNET adapter, real chain ======================
console.log('\n[C] TESTNET: real unsigned duel renders the seat clock (read-only)');
{
  const secrets = JSON.parse(readFileSync('/mnt/agents/output/app/contracts/quantum-arena/deploy/testnet.secrets.json', 'utf8'));
  const state = JSON.parse(readFileSync('/mnt/agents/output/app/contracts/quantum-arena/deploy/testnet.json', 'utf8'));
  const DUEL_CID = state.smoke_v2.duel_create_cid;
  const RUMBLE_CID = state.smoke_v2.rumble_cid;
  console.log('  on-chain fixture: duel cid=' + DUEL_CID + ' (B unsigned), rumble cid=' + RUMBLE_CID);

  async function newTestnetPage(role) {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 560 } });
    await ctx.addInitScript(({ mn, addr }) => {
      window.localStorage.setItem('gonna.qa', '1');
      window.localStorage.setItem('gonna.qa.player.mn', mn);
      window.localStorage.setItem('gonna.qa.player.addr', addr);
      window.localStorage.setItem('gonna.arena.adapter', 'testnet');
    }, { mn: secrets[role].mnemonic, addr: secrets[role].address });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(BASE + '?arena=testnet&qa=1', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
    await sleep(400);
    return { ctx, page };
  }

  // C1: PLAYER_B (unsigned seat) sees the own-clock countdown on the duel
  {
    const { ctx, page } = await newTestnetPage('PLAYER_B');
    await page.evaluate(() => window.__gonna.debugOpenArena());
    await page.waitForFunction(
      (cid) => window.__gonna.arenaInfo.screen === 'board' && window.__gonna.arenaInfo.mine.some((m) => m.id === cid),
      DUEL_CID, { timeout: 30000 },
    );
    const ib = await info(page);
    ok(ib.cards.some((c) => c.id === RUMBLE_CID), 'spawned rumble cid=' + RUMBLE_CID + ' is on the PIT board (' + (ib.cards.find((c) => c.id === RUMBLE_CID) || {}).seats + ' seats)');
    await tapHot(page, 'chip:' + DUEL_CID);
    await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'versus', null, { timeout: 8000 });
    await sleep(400);
    const i = await info(page);
    ok(i.current && i.current.id === DUEL_CID, 'opened testnet duel cid=' + DUEL_CID);
    ok(i.forfeit && i.forfeit.kind === 'own-clock', 'PLAYER_B (unsigned) sees own-clock on the REAL duel');
    ok(i.forfeit.remainingMs > 0 && i.forfeit.remainingMs <= 3600e3, 'real seated_at drives the countdown (' + Math.round(i.forfeit.remainingMs / 60000) + 'min left)');
    ok(i.hots.some((h) => h.id === 'submit'), 'SUBMIT SCORE offered on the real duel');
    await page.screenshot({ path: SHOTS + '/v2-testnet-own-clock.png' });
    await ctx.close();
  }

  // C2: PLAYER_A (signed creator) has NO claim button yet (clock not lapsed)
  {
    const { ctx, page } = await newTestnetPage('PLAYER_A');
    await page.evaluate(() => window.__gonna.debugOpenArena());
    await page.waitForFunction(
      (cid) => window.__gonna.arenaInfo.screen === 'board' && window.__gonna.arenaInfo.mine.some((m) => m.id === cid),
      DUEL_CID, { timeout: 30000 },
    );
    await tapHot(page, 'chip:' + DUEL_CID);
    await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'versus', null, { timeout: 8000 });
    await sleep(400);
    const i = await info(page);
    ok(i.forfeit === null, 'PLAYER_A: clock not lapsed -> no claimable state (honest, not faked)');
    ok(!i.hots.some((h) => h.id === 'forfeit'), 'no CLAIM FORFEIT button before seated_at+1h');
    await page.screenshot({ path: SHOTS + '/v2-testnet-signed-waiting.png' });
    await ctx.close();
  }
}

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
if (pageErrors.length > 0) console.log('PAGE ERRORS:\n' + pageErrors.join('\n'));
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
await browser.close();
process.exit(fails.length === 0 && pageErrors.length === 0 ? 0 : 1);
