// ============================================================================
// M2-0 PROVA B — THE VERDICT: Node <-> REAL BROWSER (Chromium via Playwright).
// The SAME fixture (seed, stage, GIL masks -> debugSim tape) runs:
//   - in Node, headless, via replayGIL (raw mask driver on the bundled engine)
//   - in Chromium, on the vite-preview build, via window.__gonna.debugSim
// simHash arrays + scores must be BIT-IDENTICAL.
// Requires: `vite build` once, then a preview server on :4173
//   (node node_modules/vite/bin/vite.js preview --port 4173 &)
// Run: node oracle-server/replay/provaB-browser.mjs
// ============================================================================
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { loadEngine, replayGIL, masksToTape, makeGIL } from './replay.mjs';
import { buildTape, tapeToMasks, FRAMES, FRAMES_DEEP, CASES } from './fixtures.mjs';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  PASS', label); } else { fail++; console.log('  FAIL', label); } };

const eng = await loadEngine();
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
console.log('Node ' + process.version + ' (V8 ' + process.versions.v8 + ')  vs  Chromium ' + browser.version());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:4173/?qa=1', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__gonna && window.__gonna.sceneName, null, { timeout: 20000 });
const browserUa = await page.evaluate(() => navigator.userAgent);
console.log('browser UA:', browserUa);

for (const c of CASES) {
  const tape = buildTape(FRAMES);
  const masks = tapeToMasks(tape, FRAMES);
  const gil = await makeGIL({ seedLabel: c.seedLabel, masks, engine: eng });
  const simTape = masksToTape(masks);

  const node = await replayGIL(gil, { stageIdx: c.stageIdx, engine: eng });
  const web = await page.evaluate(
    ({ stageIdx, seedLabel, frames, tape }) => {
      window.__gonna.debugDescent(stageIdx, seedLabel);
      return window.__gonna.debugSim({ frames, tape, god: false });
    },
    { stageIdx: c.stageIdx, seedLabel: c.seedLabel, frames: FRAMES, tape: simTape },
  );
  const same = JSON.stringify(web.hashes) === JSON.stringify(node.hashes) && web.score === node.score;
  ok(same, `B Node<->browser stage ${c.stageIdx} seed ${c.seedLabel}: ${node.hashes.length} hashes + score ${node.score} identical${same ? '' : ' — DIVERGED (see below)'}`);
  if (!same) {
    const i = web.hashes.findIndex((h, j) => h !== node.hashes[j]);
    console.log(`  DIVERGENCE at hash idx ${i} (frame ${(i + 1) * 60}): browser=${web.hashes[i]} node=${node.hashes[i]} | scores web=${web.score} node=${node.score}`);
  }

  // deep god run: waves 3+, carriers, boss, drone float paths
  const tapeD = buildTape(FRAMES_DEEP);
  const masksD = tapeToMasks(tapeD, FRAMES_DEEP);
  const gilD = await makeGIL({ seedLabel: c.seedLabel, masks: masksD, engine: eng });
  const nodeD = await replayGIL(gilD, { stageIdx: c.stageIdx, god: true, engine: eng });
  const webD = await page.evaluate(
    ({ stageIdx, seedLabel, frames, tape }) => {
      window.__gonna.debugDescent(stageIdx, seedLabel);
      return window.__gonna.debugSim({ frames, tape, god: true });
    },
    { stageIdx: c.stageIdx, seedLabel: c.seedLabel, frames: FRAMES_DEEP, tape: masksToTape(masksD) },
  );
  const sameD = JSON.stringify(webD.hashes) === JSON.stringify(nodeD.hashes) && webD.score === nodeD.score;
  ok(sameD, `B-deep god ${FRAMES_DEEP}f stage ${c.stageIdx}: wave ${nodeD.wave} kos ${nodeD.kos} score ${nodeD.score} identical${sameD ? '' : ' — DIVERGED'}`);
  if (!sameD) {
    const i = webD.hashes.findIndex((h, j) => h !== nodeD.hashes[j]);
    console.log(`  DEEP DIVERGENCE at hash idx ${i} (frame ${(i + 1) * 60}): browser=${webD.hashes[i]} node=${nodeD.hashes[i]} | scores web=${webD.score} node=${nodeD.score}`);
  }
}

await browser.close();
console.log(`\nPROVA B: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
