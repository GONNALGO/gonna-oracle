// GONNA FIGHT v15.2.3 — retry phase guard: NO double broadcast while the tx
// is on the wire (v15.2.2: RETRY/CANCEL on stuck wallet signing + NFT shelf).
//   PART A (node, unit): signSendManaged with FAKE signers/senders —
//     (a) a hanging signer exposes the stalled op after the nudge delay,
//     (b) RETRY heals FIRST (recover hook) then re-issues the request,
//     (c) CANCEL rejects cleanly and a LATE wallet answer is never sent,
//     (d) a wedged-session error ("REQUEST PENDING ...") auto-recovers and
//         re-sends before settling,
//     (e) v15.2.3 REGRESSION: fast sign + hanging confirm -> RETRY during
//         'sending' is a NO-OP (no second broadcast), never stalled on the wire,
//     (f) RETRY still works during the SIGNATURE wait,
//     + the v15.2.1 cid-race composition (rebuild + re-send on the 400) and
//     the hard-timeout backstop.
//   PART B (browser, TESTNET adapter, REAL chain reads + FAKE HANGING signer):
//     the founder repro — SIGN & STAKE stuck on SIGNING... gets the amber
//     "NO WORD FROM THE WALLET?" strip; RETRY re-issues; CANCEL lands back on
//     the sealed card with the draft INTACT (replay still possible). Same
//     strip on the JOIN flow.
//   PART C (browser, shelf truth): connected MOCK-mode wallet with 0 NFTs sees
//     ONLY the base GONNA (never the mock GONNA 7/42); mock shelf stays for
//     wallet-less demo mode; mock NFTs still show when injected.
//     v15.2.5: a TESTNET-connected wallet ALSO gets the GONNA 7/42 test
//     fixtures OWNED (deduped) — remove at mainnet.
// The QA keys are read from the GITIGNORED deploy/testnet.secrets.json and
// never printed.
// Run: node test-v1522.mjs   (needs the vite preview serving dist on :4173)
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

// ================= PART A: signSendManaged state machine (node) =============
console.log('\n[A] UNIT: signSendManaged — retry / cancel / wedge / cid-race / timeout');
{
  execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node', '--external:algosdk', '--outfile=.tmp-testnetKit-v1522.mjs'], { cwd: '/mnt/agents/output/app', stdio: 'pipe' });
  const kit = await import('/mnt/agents/output/app/.tmp-testnetKit-v1522.mjs');
  const algosdk = await import('algosdk');
  const acct = algosdk.generateAccount();
  const mkTxns = () => [
    algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: acct.addr, receiver: acct.addr, amount: 1000n,
      suggestedParams: { fee: 1000n, flatFee: true, firstValid: 1n, lastValid: 1000n, genesisHash: new Uint8Array(32), genesisID: 'testnet-v1.0' },
    }),
  ];
  const realSign = async (groups) => groups.flatMap((g) => g.map((w) => w.txn.signTxn(acct.sk)));
  const never = () => new Promise(() => {}); // the wedged Pera modal: silence forever
  const WEDGE = 'REQUEST PENDING: THE USER CURRENTLY HAS ANOTHER REQUEST THAT IS IN PROGRESS.';

  // ---- (a) hanging signer -> stalled op after the nudge -------------------
  {
    const h = kit.signSendManaged(never, async () => mkTxns(), { label: 'SIGN & STAKE', nudgeMs: 250, timeoutMs: 60_000, send: async () => 'NEVER' });
    h.done.catch(() => {}); // settled by the cleanup cancel below
    await sleep(80);
    let op = kit.activeSignOp();
    ok(op !== null && op.label === 'SIGN & STAKE' && op.phase === 'signing', '(a) op registers while the wallet is silent (phase signing)');
    ok(op && !op.stalled, '(a) NOT stalled before the nudge delay');
    await sleep(300);
    op = kit.activeSignOp();
    ok(op !== null && op.stalled && op.cancellable && op.attempt === 1, '(a) STALLED + cancellable after the nudge (the amber strip condition)');
    h.cancel(); // cleanup
    await sleep(30);
    ok(kit.activeSignOp() === null, '(a) op unregisters after settle');
  }

  // ---- (b) RETRY: recover FIRST, then re-issue (with a rebuild) -----------
  {
    const order = [];
    let signCalls = 0, builds = 0, recovers = 0;
    const sign = async (groups) => {
      signCalls++;
      order.push('sign' + signCalls);
      if (signCalls === 1) return never(); // first attempt hangs (wedged modal)
      return realSign(groups); // the healed session answers
    };
    const h = kit.signSendManaged(sign, async () => { builds++; return mkTxns(); }, {
      label: 'SIGN & STAKE', nudgeMs: 200, timeoutMs: 60_000, rebuildOnRetry: true,
      recover: async () => { recovers++; order.push('recover'); },
      send: async () => { order.push('send'); return 'FAKETXID1'; },
    });
    await sleep(120); // attempt 1 is hanging now
    h.retry();
    const txid = await h.done;
    ok(txid === 'FAKETXID1', '(b) RETRY resolves with the re-sent txid');
    ok(signCalls === 2, '(b) RETRY re-issued the signing request (sign x' + signCalls + ')');
    ok(recovers === 1 && order.join(',') === 'sign1,recover,sign2,send', '(b) recover ran BEFORE the re-send (' + order.join(',') + ')');
    ok(builds === 2, '(b) rebuildOnRetry re-built the group (fresh cid + oracle sig path)');
  }

  // ---- (c) CANCEL: clean reject, LATE wallet answer NEVER sent ------------
  {
    let signCalls = 0, sends = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const sign = async (groups) => {
      signCalls++;
      await gate; // hangs until the test releases it (AFTER the cancel)
      return realSign(groups);
    };
    const h = kit.signSendManaged(sign, async () => mkTxns(), { label: 'SIGN SCORE', nudgeMs: 200, timeoutMs: 60_000, send: async () => { sends++; return 'X'; } });
    await sleep(120);
    h.cancel();
    let err = null;
    try { await h.done; } catch (e) { err = e; }
    ok(err !== null && kit.isSignCancel(err), '(c) CANCEL rejects with SignCancelled ("' + (err && err.message) + '")');
    ok(signCalls === 1 && kit.activeSignOp() === null, '(c) no re-issue, op unregistered');
    release(); // the wallet answers LATE — it must be discarded, never sent
    await sleep(150);
    ok(sends === 0, '(c) late wallet answer after CANCEL was NEVER broadcast');
  }

  // ---- (d) wedged-session error -> auto recover -> re-send ----------------
  {
    const order = [];
    let signCalls = 0, recovers = 0;
    const sign = async (groups) => {
      signCalls++;
      order.push('sign' + signCalls);
      if (signCalls === 1) throw new Error(WEDGE); // the founder's verbatim wedge
      return realSign(groups);
    };
    const h = kit.signSendManaged(sign, async () => mkTxns(), {
      label: 'ACCEPT & STAKE', nudgeMs: 200, timeoutMs: 60_000,
      recover: async () => { recovers++; order.push('recover'); },
      send: async () => { order.push('send'); return 'FAKETXID2'; },
    });
    const txid = await h.done;
    ok(txid === 'FAKETXID2', '(d) wedged attempt still lands the tx after recovery');
    ok(recovers === 1 && order.join(',') === 'sign1,recover,sign2,send', '(d) wedge error triggered reconnect BEFORE re-send (' + order.join(',') + ')');
    ok(kit.isWedgeError(new Error(WEDGE)) && !kit.isWedgeError(new Error('user rejected')), '(d) isWedgeError matches REQUEST PENDING, not a plain reject');
  }

  // ---- (e) v15.2.3: RETRY is a NO-OP once the tx is ON THE WIRE -----------
  // the verifier's live repro: FAST sign + SLOW confirm -> attemptStartedAt
  // goes stale -> stalled=true -> the amber strip draws RETRY -> a second
  // broadcast -> duplicate on-chain challenge with the stake locked TWICE.
  {
    let signCalls = 0, sends = 0;
    const events = [];
    let releaseSend;
    const sendGate = new Promise((r) => { releaseSend = r; });
    const h = kit.signSendManaged(
      async (groups) => { signCalls++; return realSign(groups); }, // FAST sign
      async () => mkTxns(),
      {
        label: 'SIGN & STAKE', nudgeMs: 200, timeoutMs: 60_000,
        send: async () => { sends++; await sendGate; return 'WIRETX'; }, // the chain hangs (~3s below)
        onEvent: (ev) => events.push(ev),
      },
    );
    h.done.catch(() => {});
    await sleep(150); // signed fast; now SENDING with the chain silent
    let op = kit.activeSignOp();
    ok(op !== null && op.phase === 'sending', '(e) fast sign + hanging send -> phase is sending');
    await sleep(300); // PAST the nudge delay while the confirm is still hanging
    op = kit.activeSignOp();
    ok(op !== null && !op.stalled && !op.cancellable, '(e) NEVER stalled while sending — the strip cannot offer RETRY on the wire');
    h.retry(); // the verifier's repro: RETRY during a slow confirmation
    await sleep(150);
    ok(sends === 1 && signCalls === 1, '(e) RETRY during sending is a NO-OP — NO second broadcast (sends=' + sends + ')');
    ok(!events.includes('retry'), '(e) the guarded retry never entered the state machine');
    releaseSend(); // the chain finally answers (~3s after broadcast)
    const txid = await h.done;
    ok(txid === 'WIRETX' && sends === 1, '(e) the one true broadcast confirms normally');
  }

  // ---- (f) v15.2.3: RETRY still works during the SIGNATURE wait ------------
  {
    let signCalls = 0, sends = 0;
    const sign = async (groups) => {
      signCalls++;
      if (signCalls === 1) return never(); // attempt 1: the wallet is silent
      return realSign(groups);
    };
    const h = kit.signSendManaged(sign, async () => mkTxns(), { label: 'SIGN & STAKE', nudgeMs: 200, timeoutMs: 60_000, send: async () => { sends++; return 'RETRYOK'; } });
    await sleep(300); // stalled while WAITING FOR THE SIGNATURE
    const op = kit.activeSignOp();
    ok(op !== null && op.phase === 'signing' && op.stalled, '(f) still stalled during the signature wait (strip intact there)');
    h.retry();
    const txid = await h.done;
    ok(txid === 'RETRYOK' && signCalls === 2 && sends === 1, '(f) RETRY during the signature wait still re-issues and lands');
  }

  // ---- v15.2.1 composition: cid-race 400 -> rebuild + re-send -------------
  {
    let builds = 0, sends = 0;
    const h = kit.signSendManaged(realSign, async () => { builds++; return mkTxns(); }, {
      label: 'SIGN & STAKE', nudgeMs: 200, timeoutMs: 60_000, rebuildOnRetry: true, autoRetries: 2,
      send: async () => {
        sends++;
        if (sends === 1) throw new Error('Network request error. Received status 400: logic eval error: assert failed ... ed25519verify_bare; assert');
        return 'FRESHCID';
      },
    });
    const txid = await h.done;
    ok(txid === 'FRESHCID' && sends === 2 && builds === 2, 'cid-race 400 auto-retries with a REBUILT group (fresh next_challenge_id + oracle sig)');
  }

  // ---- backstop: the hard timeout still fires on a dead wallet ------------
  {
    const t0 = Date.now();
    const h = kit.signSendManaged(never, async () => mkTxns(), { label: 'CLAIM', nudgeMs: 100, timeoutMs: 350, send: async () => 'NEVER' });
    let err = null;
    try { await h.done; } catch (e) { err = e; }
    ok(err !== null && err.message === kit.SIGN_TIMEOUT_MSG, 'hard timeout backstop fires with the red-toast message (' + (Date.now() - t0) + 'ms)');
  }
}

// ================= browser scaffolding ======================================
const secrets = JSON.parse(readFileSync('/mnt/agents/output/app/contracts/quantum-arena/deploy/testnet.secrets.json', 'utf8'));
const tstate = JSON.parse(readFileSync('/mnt/agents/output/app/contracts/quantum-arena/deploy/testnet.json', 'utf8'));
const RUMBLE_CID = tstate.smoke_v2.rumble_cid;
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
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
  if (!h) {
    await sleep(400);
    i = await info(page);
    h = i.hots.find((x) => x.id === id);
  }
  if (!h) {
    await page.screenshot({ path: SHOTS + '/v1522-FAIL-' + id.replace(/:/g, '_') + '.png' });
    throw new Error('hot not found: ' + id + ' (screen=' + i.screen + ' have: ' + i.hots.map((x) => x.id).join(',') + ')');
  }
  const f = await fit(page);
  await page.mouse.click(f.offX + (h.x + h.w / 2) * f.scale, f.offY + (h.y + h.h / 2) * f.scale);
}

// testnet page whose wallet SIGNS NEVER (the wedged Pera repro): real chain
// reads (preflight/cid/params), fake identity provider, hanging sign fn.
async function newWedgePage(role) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 560 } });
  await ctx.addInitScript(({ addr, omn }) => {
    window.localStorage.setItem('gonna.arena.adapter', 'testnet');
    window.localStorage.setItem('gonna.arena.testnet.addr', addr);
    window.localStorage.setItem('gonna.qa.oracle.mn', omn); // dev oracle armed (never printed)
  }, { addr: secrets[role].address, omn: secrets.ORACLE.mnemonic });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
  // override the identity provider AFTER module init: real address, dead sign
  await page.evaluate((addr) => {
    window.__signCalls = 0;
    window.__recoverCalls = 0;
    window.__arenaIdProvider = async () => ({
      address: addr,
      sign: async () => {
        window.__signCalls++;
        return new Promise(() => {}); // wedged Pera modal: silence forever
      },
    });
    // stub the session heal (a real one opens a Pera pairing — no user here)
    window.__arenaRecover = async () => {
      window.__recoverCalls++;
    };
  }, secrets[role].address);
  await sleep(300);
  return { ctx, page };
}
const signCalls = (page) => page.evaluate(() => window.__signCalls);

// ================= PART B: the founder repro, headless ======================
console.log('\n[B1] SIGN & STAKE stuck -> amber RETRY/CANCEL strip -> CANCEL keeps the sealed draft');
{
  const { ctx, page } = await newWedgePage('PLAYER_B');
  await page.evaluate(() => window.__gonna.debugOpenArena());
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'board', null, { timeout: 15000 });
  // stake the MINIMUM (1 $GONNA) through the wizard custom field so the real
  // preflight passes, then seal a fake run and hit SIGN & STAKE
  await tapHot(page, 'create');
  await tapHot(page, 'vis:public');
  await tapHot(page, 'fmt:duel');
  await tapHot(page, 'bat:full');
  await tapHot(page, 'stake:custom');
  await page.evaluate(() => {
    const el = document.getElementById('arena-stake-input');
    el.value = '1';
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  });
  await sleep(200);
  await tapHot(page, 'stake:next');
  await tapHot(page, 'fighter:0'); // base GONNA
  await page.evaluate(() => window.__gonna.debugArenaSeal('creator', 777000));
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'seal' && window.__gonna.arenaInfo.hots.some((h) => h.id === 'sign'), null, { timeout: 8000 });
  await tapHot(page, 'sign'); // SIGN & STAKE — the wallet never answers
  await page.waitForFunction(() => window.__signCalls === 1, null, { timeout: 30000 });
  ok(true, 'sign request reached the (wedged) wallet — real preflight + cid + oracle passed');

  // (a) the strip: NO WORD FROM THE WALLET? after 12s of silence
  await page.waitForFunction(() => window.__gonna.arenaInfo.signOp && window.__gonna.arenaInfo.signOp.stalled, null, { timeout: 20000 });
  await sleep(200);
  let i = await info(page);
  ok(i.busy && i.signOp && i.signOp.stalled, '(a) SIGNING shows the stalled op after 12s of wallet silence');
  ok(i.hots.some((h) => h.id === 'sign:retry') && i.hots.some((h) => h.id === 'sign:cancel'), '(a) amber strip offers RETRY + CANCEL');
  await page.screenshot({ path: SHOTS + '/v1522-stuck-signing-strip.png' });

  // (b) RETRY re-issues the request (attempt 2)
  await tapHot(page, 'sign:retry');
  await page.waitForFunction(() => window.__signCalls === 2, null, { timeout: 15000 });
  i = await info(page);
  ok(i.signOp && i.signOp.attempt === 2, '(b) RETRY re-issued the signing request (attempt 2)');
  const rec = await page.evaluate(() => window.__recoverCalls);
  ok(rec === 1, '(b) RETRY healed the wedged session before the re-send (recover x' + rec + ')');

  // (c) CANCEL: back to the sealed card, draft INTACT, replay possible
  await page.waitForFunction(() => window.__gonna.arenaInfo.signOp && window.__gonna.arenaInfo.signOp.stalled, null, { timeout: 20000 });
  await sleep(200);
  await tapHot(page, 'sign:cancel');
  await page.waitForFunction(() => !window.__gonna.arenaInfo.busy, null, { timeout: 8000 });
  i = await info(page);
  ok(i.screen === 'seal', '(c) CANCEL lands back on the sealed card');
  ok(i.seal.sealed === 777000 && i.seal.runs === 1, '(c) the sealed score/draft SURVIVED the cancel (777000)');
  ok(/CANCELLED/.test(i.err), '(c) amber cancel note visible: "' + i.err + '"');
  ok(i.hots.some((h) => h.id === 'sign') && i.hots.some((h) => h.id === 'replay'), '(c) SIGN & STAKE + REPLAY are both back');
  await page.screenshot({ path: SHOTS + '/v1522-cancel-back-to-seal.png' });
  await tapHot(page, 'replay'); // the draft can still be replayed after cancel
  await page.waitForFunction(() => window.__gonna.sceneName === 'play', null, { timeout: 8000 });
  ok(true, '(c) replay still launches after the cancel (draft usable)');
  await ctx.close();
}

console.log('\n[B2] JOIN stuck -> same RETRY/CANCEL strip -> CANCEL back to the card');
{
  const { ctx, page } = await newWedgePage('PLAYER_A');
  await page.evaluate(() => window.__gonna.debugOpenArena());
  await page.waitForFunction(
    (cid) => window.__gonna.arenaInfo.screen === 'board' && window.__gonna.arenaInfo.cards.some((c) => c.id === cid),
    RUMBLE_CID, { timeout: 30000 },
  );
  await tapHot(page, 'card:' + RUMBLE_CID);
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'versus', null, { timeout: 8000 });
  await tapHot(page, 'accept'); // ACCEPT & STAKE — the wallet never answers
  await page.waitForFunction(() => window.__signCalls === 1, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__gonna.arenaInfo.signOp && window.__gonna.arenaInfo.signOp.stalled, null, { timeout: 20000 });
  await sleep(200);
  let i = await info(page);
  ok(i.signOp && i.signOp.stalled && i.hots.some((h) => h.id === 'sign:retry') && i.hots.some((h) => h.id === 'sign:cancel'), 'JOIN flow gets the same amber RETRY/CANCEL strip');
  await page.screenshot({ path: SHOTS + '/v1522-join-strip.png' });
  await tapHot(page, 'sign:cancel');
  await page.waitForFunction(() => !window.__gonna.arenaInfo.busy, null, { timeout: 8000 });
  i = await info(page);
  ok(i.screen === 'versus' && i.current && i.current.id === RUMBLE_CID, 'JOIN CANCEL returns to the card (id ' + RUMBLE_CID + ')');
  ok(i.hots.some((h) => h.id === 'accept'), 'ACCEPT & STAKE is back after the cancel (no dead end)');
  ok(/CANCELLED/.test(i.err), 'amber cancel note on the join flow too: "' + i.err + '"');
  await ctx.close();
}

// ================= PART C: the REAL NFT shelf (FIX-2) =======================
console.log('\n[C] fighter shelf truth — mock shelf only with NO wallet');
async function newMockPage(wallet) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 560 } });
  await ctx.addInitScript(() => {
    window.localStorage.setItem('gonna.arena.adapter', 'mock');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
  if (wallet !== undefined) await page.evaluate((w) => window.__gonna.debugMockWallet(w), wallet);
  await page.evaluate(() => window.__gonna.debugOpenArena());
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'board', null, { timeout: 10000 });
  await sleep(300);
  return { ctx, page };
}
async function fighterStep(page) {
  await tapHot(page, 'create');
  await tapHot(page, 'vis:public');
  await tapHot(page, 'fmt:duel');
  await tapHot(page, 'bat:full');
  await tapHot(page, 'stake:10000000'); // preset taps straight through to FIGHTER
  await page.waitForFunction(() => window.__gonna.arenaInfo.step === 'fighter', null, { timeout: 8000 });
  await sleep(200);
}

{
  // C1: NO wallet -> the demo MOCK_SHELF survives (QA flow unchanged)
  const { ctx, page } = await newMockPage(undefined);
  const i = await info(page);
  ok(i.shelf.length === 5 && i.shelf.some((s) => s.name === 'GONNA 42' && s.owned), 'no wallet: demo MOCK_SHELF (GONNA 7/42 OWNED) intact');
  await ctx.close();
}
{
  // C2: CONNECTED wallet, ZERO NFTs -> ONLY the base GONNA, no fake choices
  const { ctx, page } = await newMockPage({ address: 'CONNECTEDDEGEN' + 'Q'.repeat(44), gonna: 0, nfts: [] });
  let i = await info(page);
  ok(i.shelf.length === 1 && i.shelf[0].name === 'GONNA' && i.shelf[0].owned, 'connected + 0 NFTs: shelf is ONLY the base GONNA');
  ok(!i.shelf.some((s) => s.name === 'GONNA 7' || s.name === 'GONNA 42'), 'connected + 0 NFTs: NO fake GONNA 7/42 (the bug)');
  await fighterStep(page);
  i = await info(page);
  const fHots = i.hots.filter((h) => h.id.startsWith('fighter:'));
  ok(fHots.length === 1 && fHots[0].id === 'fighter:0', 'fighter step shows ONE choice (the real base GONNA), no fake fighters');
  await page.screenshot({ path: SHOTS + '/v1522-shelf-connected-zero-nfts.png' });
  await ctx.close();
}
{
  // C3: CONNECTED wallet WITH NFTs -> base + the real holdings (unchanged)
  const { ctx, page } = await newMockPage({ address: 'NFTRIDER' + 'R'.repeat(50), nfts: [{ id: 7007, name: 'GONNA 7', skin: 'fire' }] });
  const i = await info(page);
  ok(i.shelf.length === 2 && i.shelf[1].name === 'GONNA 7' && i.shelf[1].owned, 'connected + 1 NFT: base GONNA + the real GONNA 7');
  await ctx.close();
}
{
  // C4: TESTNET-connected wallet (no gate session), zero NFTs -> base GONNA only
  const ctx = await browser.newContext({ viewport: { width: 960, height: 560 } });
  await ctx.addInitScript((addr) => {
    window.localStorage.setItem('gonna.arena.adapter', 'testnet');
    window.localStorage.setItem('gonna.arena.testnet.addr', addr);
  }, secrets.PLAYER_A.address);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gonna, null, { timeout: 15000 });
  await page.evaluate(() => window.__gonna.debugOpenArena());
  await page.waitForFunction(() => window.__gonna.arenaInfo.screen === 'board', null, { timeout: 15000 });
  await sleep(300);
  const i = await info(page);
  // v15.2.5 (FIX-A): TESTNET TEST FIXTURES — a connected testnet wallet now
  // ALSO gets GONNA 7/42 OWNED (deduped vs real holdings); mainnet and
  // wallet-less paths are unchanged. Remove at mainnet.
  const names = i.shelf.map((s) => s.name);
  ok(
    i.shelf.length === 3 && names[0] === 'GONNA' && i.shelf.filter((s) => s.name === 'GONNA 7' && s.owned).length === 1 && i.shelf.filter((s) => s.name === 'GONNA 42' && s.owned).length === 1,
    'testnet-connected + 0 NFTs: base GONNA + v15.2.5 TESTNET fixtures GONNA 7/42 OWNED, exactly once each',
  );
  await ctx.close();
}

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
if (pageErrors.length > 0) console.log('PAGE ERRORS:\n' + pageErrors.join('\n'));
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
await browser.close();
process.exit(fails.length === 0 && pageErrors.length === 0 ? 0 : 1);
