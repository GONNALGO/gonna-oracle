// BISECT: which input feature breaks record->replay determinism?
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

function masksFromLevels(levels: Array<(f: number) => Record<string, boolean>>, frames: number): Uint8Array[] {
  return levels.map((fn) => {
    const masks = new Uint8Array(frames);
    for (let f = 0; f < frames; f++) {
      const lvl = fn(f);
      let m = 0;
      for (const k of Object.keys(lvl)) if (lvl[k]) m |= BTN_BIT[k]!;
      masks[f] = m;
    }
    return masks;
  });
}

function recordRun(eng: ReplayEngine, stream: Uint8Array) {
  const game = bootGame(eng);
  startStageRun(game, 2, 'PIT-90');
  const down = game.input.down;
  const pressed = game.input.pressed;
  for (let f = 0; f < stream.length && game.inputLogMasks; f++) {
    const m = stream[f]!;
    for (let b = 0; b < 8; b++) {
      const v = ((m >> b) & 1) === 1;
      if (v && !down[BTNS[b]!]) pressed[BTNS[b]!] = true;
      down[BTNS[b]!] = v;
    }
    game.step();
  }
  const sealed = game.arena?.sealedRun;
  if (sealed?.inputLogB64) {
    const dec = eng.decodeInputLogB64(sealed.inputLogB64);
    return { masks: dec.masks, score: game.score };
  }
  const n: number = game.inputLogFrames ?? 0;
  return { masks: Uint8Array.from(game.inputLogMasks.subarray(0, n)), score: game.score };
}

let eng: ReplayEngine;
let verifier: ReplayVerifier;
beforeAll(async () => {
  verifier = new ReplayVerifier({ bundlesDir: BUNDLES_DIR, timeoutMs: 60_000 });
  eng = await verifier.loadBundle(VER)!;
}, 120_000);

const F = 6000;
const CASES: Array<[string, (f: number) => Record<string, boolean>]> = [
  ['idle (no input)', () => ({})],
  ['walk right only', () => ({ right: true })],
  ['walk + punch tap 45f', (f) => ({ right: true, punch: f % 45 < 2 })],
  ['walk + kick tap 45f', (f) => ({ right: true, kick: f % 45 < 2 })],
  ['walk + jump 45f', (f) => ({ right: true, jump: (f % 225) >= 153 && (f % 225) < 173 })],
  ['walk + special 315f', (f) => ({ right: true, special: (f % 315) >= 140 && (f % 315) < 142 })],
  ['walk + up/down wiggle', (f) => ({ right: true, up: f % 90 < 20, down: f % 90 >= 45 && f % 90 < 65 })],
  ['FULL brawl tape', (f) => ({ right: true, punch: f % 45 === 5 || f % 45 === 6 || f % 45 === 15 || f % 45 === 16, kick: f % 45 === 25 || f % 45 === 26, jump: (f % 225) >= 153 && (f % 225) < 173 })],
];

describe('bisect determinism', () => {
  for (const [name, fn] of CASES) {
    it(name, async () => {
      const [stream] = masksFromLevels([fn], F);
      const r = recordRun(eng, stream!);
      const check = await verifier.verifyRun({ build: VER, stageMode: 'stage', stageIdx: 2, seedLabel: 'PIT-90', masks: r.masks, score: r.score });
      console.log(`${name}: recorded=${r.score} frames=${r.masks.length} replay=${check.ok ? 'OK' : check.reason + ' ' + JSON.stringify((check as any).diag)}`);
      expect(check.ok).toBe(true);
    }, 120_000);
  }
});
