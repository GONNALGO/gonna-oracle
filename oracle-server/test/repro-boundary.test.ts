// CONFIRM: held-key scene-boundary divergence. recordRun zeroes input levels
// at every entry into 'play' (what a fixed client would do); if record→replay
// then matches, the root cause is the held-key boundary leak.
import { describe, it, expect, beforeAll } from 'vitest';
import { ReplayVerifier, bootGame, startStageRun, type ReplayEngine } from '../src/replay/replayer.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const BUNDLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../replay-bundles');
import fs from 'node:fs';
// v17.0.7 regression: run against REPRO_VER if set, else the NEWEST replay bundle on disk.
function newestVer(dir: string): string {
  const files = fs.readdirSync(dir).filter((f) => /^engine-v[0-9a-f]+\.mjs$/.test(f));
  files.sort((a, b) => fs.statSync(dir + '/' + b).mtimeMs - fs.statSync(dir + '/' + a).mtimeMs);
  if (!files.length) throw new Error('no replay bundles found');
  return files[0]!.replace(/^engine-/, '').replace(/\.mjs$/, '');
}
const VER = process.env.REPRO_VER ?? newestVer(BUNDLES_DIR);

const BTNS = ['up','down','left','right','punch','kick','jump','special'] as const;
const BTN_BIT: Record<string, number> = { up:1, down:2, left:4, right:8, punch:16, kick:32, jump:64, special:128 };
function recordRunFixed(eng: ReplayEngine, stream: Uint8Array) {
  const game = bootGame(eng);
  startStageRun(game, 2, 'PIT-90');
  const down = game.input.down; const pressed = game.input.pressed;
  let wasPlay = false;
  for (let f = 0; f < stream.length && game.inputLogMasks; f++) {
    const m = stream[f]!;
    if (game.scene === 'play' && !wasPlay) {
      // boundary: force-release all levels (the fix under test)
      for (const b of BTNS) { down[b] = false; pressed[b] = false; }
    }
    wasPlay = game.scene === 'play';
    for (let b = 0; b < 8; b++) {
      const v = ((m >> b) & 1) === 1;
      if (v && !down[BTNS[b]!]) pressed[BTNS[b]!] = true;
      down[BTNS[b]!] = v;
    }
    game.step();
  }
  const sealed = game.arena?.sealedRun;
  if (sealed?.inputLogB64) { const dec = eng.decodeInputLogB64(sealed.inputLogB64); return { masks: dec.masks, score: game.score }; }
  const n: number = game.inputLogFrames ?? 0;
  return { masks: Uint8Array.from(game.inputLogMasks.subarray(0, n)), score: game.score };
}
let eng: ReplayEngine; let verifier: ReplayVerifier;
beforeAll(async () => { verifier = new ReplayVerifier({ bundlesDir: BUNDLES_DIR, timeoutMs: 60_000 }); eng = await verifier.loadBundle(VER)!; }, 120_000);
describe('boundary fix confirm', () => {
  it('punch double-tap (was MISMATCH) replays EXACT with boundary release', async () => {
    const F = 6000;
    const stream = new Uint8Array(F);
    for (let f = 0; f < F; f++) { let m = 8; if (f%45===5||f%45===6||f%45===15||f%45===16) m |= 16; stream[f] = m; }
    const r = recordRunFixed(eng, stream);
    console.log('recorded=' + r.score + ' frames=' + r.masks.length);
    const check = await verifier.verifyRun({ build: VER, stageMode: 'stage', stageIdx: 2, seedLabel: 'PIT-90', masks: r.masks, score: r.score });
    if (!check.ok) console.log('REPLAY:', check.reason, JSON.stringify((check as any).diag));
    expect(check.ok).toBe(true);
  }, 120_000);
  it('full brawl tape (was MISMATCH) replays EXACT with boundary release', async () => {
    const F = 6000;
    const stream = new Uint8Array(F);
    for (let f = 0; f < F; f++) {
      let m = 8;
      if (f%45===5||f%45===6||f%45===15||f%45===16) m |= 16;
      if (f%45===25||f%45===26) m |= 32;
      if ((f%225)>=153 && (f%225)<173) m |= 64;
      stream[f] = m;
    }
    const r = recordRunFixed(eng, stream);
    console.log('recorded=' + r.score + ' frames=' + r.masks.length);
    const check = await verifier.verifyRun({ build: VER, stageMode: 'stage', stageIdx: 2, seedLabel: 'PIT-90', masks: r.masks, score: r.score });
    if (!check.ok) console.log('REPLAY:', check.reason, JSON.stringify((check as any).diag));
    expect(check.ok).toBe(true);
  }, 120_000);
});
