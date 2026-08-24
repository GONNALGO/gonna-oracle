// REPRO: real UI create flow (THE PIT -> create card -> play/seal draft ->
// SIGN & STAKE) against the LIVE v2 testnet app with the QA key injected.
// Captures console '[arena]' breadcrumbs + the FULL algod response body on
// any failed POST /v2/transactions. Secrets are never printed.
// Run: node repro-create.mjs   (needs vite preview on :4173)
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const SHOTS = '/mnt/agents/output/arena-shots';
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const secrets = JSON.parse(readFileSync('/mnt/agents/output/app/contracts/quantum-arena/deploy/testnet.secrets.json', 'utf8'));
const ROLE = process.env.QA_ROLE || 'PLAYER_A';
const STAKE_GONNA = process.env.QA_STAKE || '1';
const SCORE = process.env.QA_SCORE || '1234';
const DO_CREATE = process.env.DO_CREATE !== '0'; // set 0 for dry UI-only walk

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 560 } });
await ctx.addInitScript(({ mn, addr, omn, score }) => {
  window.localStorage.setItem('gonna.qa', '1');
  window.localStorage.setItem('gonna.qa.player.mn', mn);
  window.localStorage.setItem('gonna.qa.player.addr', addr);
  window.localStorage.setItem('gonna.qa.oracle.mn', omn);
  window.localStorage.setItem('gonna.qa.score', score);
  window.localStorage.setItem('gonna.arena.adapter', 'testnet');
}, { mn: secrets[ROLE].mnemonic, addr: secrets[ROLE].address, omn: secrets.ORACLE.mnemonic, score: SCORE });
const page = await ctx.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[arena]') || m.type() === 'error' || m.type() === 'warning') console.log('  [console.' + m.type() + '] ' + t);
});
page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
// capture the FULL algod response body on failed transaction posts
page.on('response', async (res) => {
  const url = res.url();
  if (url.includes('algonode') && res.status() >= 400) {
    let body = '';
    try { body = await res.text(); } catch { /* unreadable */ }
    console.log('  [NETWORK] ' + res.status() + ' ' + res.request().method() + ' ' + url);
    console.log('  [NETWORK BODY] ' + body);
  }
});

const info = () => page.evaluate(() => window.__gonna.arenaInfo);
const fit = () => page.evaluate(() => {
  const w = window.innerWidth, h = window.innerHeight;
  const s = Math.min(w / 384, h / 224);
  return { scale: s, offX: (w - 384 * s) / 2, offY: (h - 224 * s) / 2 };
});
async function tap(id) {
  let i = await info();
  let h = i.hots.find((x) => x.id === id);
  if (!h) { await sleep(400); i = await info(); h = i.hots.find((x) => x.id === id); }
  if (!h) {
    await page.screenshot({ path: SHOTS + '/repro-FAIL-' + id.replace(/[:]/g, '_') + '.png' });
    throw new Error('hot not found: ' + id + ' (screen=' + i.screen + ' have: ' + i.hots.map((x) => x.id).join(',') + ')');
  }
  const f = await fit();
  await page.mouse.click(f.offX + (h.x + h.w / 2) * f.scale, f.offY + (h.y + h.h / 2) * f.scale);
  await sleep(250);
}
const waitScreen = (s, t = 10000) =>
  page.waitForFunction((want) => window.__gonna.arenaInfo.screen === want, s, { timeout: t });

await page.goto(BASE + '?arena=testnet&qa=1', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
await sleep(500);

console.log('== THE PIT ==');
await page.evaluate(() => window.__gonna.debugOpenArena());
await waitScreen('board', 20000);
await sleep(600);

console.log('== wizard: CREATE CARD ==');
await tap('create'); await waitScreen('create');
await tap('vis:public');
await tap('fmt:duel');
await tap('bat:single');
await tap('bat:stage:0'); // DESCENT, stage 0 — straight to stake
console.log('== stake: custom ' + STAKE_GONNA + ' GONNA ==');
await tap('stake:custom');
await page.waitForSelector('#arena-stake-input', { timeout: 5000 });
await page.evaluate((v) => {
  const el = document.getElementById('arena-stake-input');
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, STAKE_GONNA);
await tap('stake:next');
await tap('fighter:0');
console.log('== PLAY YOUR RUN (QA auto-seal, score ' + SCORE + ') ==');
await tap('playrun');
await waitScreen('seal');
await page.screenshot({ path: SHOTS + '/repro-seal.png' });
if (!DO_CREATE) { console.log('DO_CREATE=0 — stopping before SIGN & STAKE'); await browser.close(); process.exit(0); }

console.log('== SIGN & STAKE ==');
const cidBefore = await page.evaluate(() => window.__gonna.arenaInfo.nextId ?? null);
await tap('sign');
// wait until busy clears and either versus (success) or an error line appears
await page.waitForFunction(
  () => !window.__gonna.arenaInfo.busy && (window.__gonna.arenaInfo.screen === 'versus' || window.__gonna.arenaInfo.err !== ''),
  null, { timeout: 120000 },
);
const after = await info();
console.log('== RESULT == screen=' + after.screen + ' err="' + after.err + '"');
if (after.current) console.log('  card id=' + after.current.id + ' status=' + after.current.status + ' stake=' + after.current.stake);
await page.screenshot({ path: SHOTS + '/repro-after-sign.png' });
await browser.close();
process.exit(after.screen === 'versus' && after.err === '' ? 0 : 1);
