// CLEANUP: early-close a QA-created duel via the REAL UI (versus -> EARLY
// CLOSE). Refund = stake + 358200 MBR back to PLAYER_A, 1 ALGO fee to
// treasury. Secrets never printed.
// Run: CID=5 node repro-close.mjs
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const CID = Number(process.env.CID);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secrets = JSON.parse(readFileSync('/mnt/agents/output/app/contracts/quantum-arena/deploy/testnet.secrets.json', 'utf8'));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 560 } });
await ctx.addInitScript(({ mn, addr }) => {
  window.localStorage.setItem('gonna.qa', '1');
  window.localStorage.setItem('gonna.qa.player.mn', mn);
  window.localStorage.setItem('gonna.qa.player.addr', addr);
  window.localStorage.setItem('gonna.arena.adapter', 'testnet');
}, { mn: secrets.PLAYER_A.mnemonic, addr: secrets.PLAYER_A.address });
const page = await ctx.newPage();
const crumbs = [];
page.on('console', (m) => { if (m.text().includes('[arena]')) { crumbs.push(m.text()); console.log('  ' + m.text()); } });
page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
page.on('response', async (res) => {
  if (res.url().includes('algonode') && res.status() >= 400) {
    console.log('  [NETWORK] ' + res.status() + ' ' + res.url());
    try { console.log('  [NETWORK BODY] ' + (await res.text())); } catch { /* */ }
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
  if (!h) throw new Error('hot not found: ' + id + ' (screen=' + i.screen + ' have: ' + i.hots.map((x) => x.id).join(',') + ')');
  const f = await fit();
  await page.mouse.click(f.offX + (h.x + h.w / 2) * f.scale, f.offY + (h.y + h.h / 2) * f.scale);
  await sleep(250);
}

await page.goto(BASE + '?arena=testnet&qa=1&duel=' + CID, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
// deep-link opens the card directly; fall back to the board chip
await sleep(1500);
let i = await info();
if (!(i.screen === 'versus' && i.current && i.current.id === CID)) {
  await page.evaluate(() => window.__gonna.debugOpenArena());
  await page.waitForFunction(
    (cid) => window.__gonna.arenaInfo.screen === 'board' && window.__gonna.arenaInfo.mine.some((m) => m.id === cid),
    CID, { timeout: 30000 },
  );
  await tap('chip:' + CID);
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'versus', null, { timeout: 8000 });
  await sleep(400);
  i = await info();
}
console.log('versus open: card', i.current.id, 'status', i.current.status, 'creator', String(i.current.creator || '').slice(0, 8) + '..');
await tap('close'); // EARLY CLOSE
await page.waitForFunction(
  () => !window.__gonna.arenaInfo.busy && (window.__gonna.arenaInfo.err !== '' || window.__gonna.arenaInfo.screen !== 'versus' || (window.__gonna.arenaInfo.current && window.__gonna.arenaInfo.current.status === 'closed')),
  null, { timeout: 60000 },
);
await sleep(500);
i = await info();
console.log('after close: screen=' + i.screen + ' err="' + i.err + '" current=' + (i.current ? i.current.id + '/' + i.current.status : 'null'));
const txidCrumb = crumbs.find((t) => t.includes('tx sent:'));
console.log('CLOSE_TXID:', txidCrumb ? txidCrumb.split('tx sent: ')[1].split(' ')[0] : '(none captured)');
await browser.close();
