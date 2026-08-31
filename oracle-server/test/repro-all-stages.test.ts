// v17.0.10 REPRO: Prince got REPLAY MISMATCH on v549adfed on STAGE 5 (cid 25)
// and STAGE 3 (cid 27) — the scene-cut fix (v17.0.7) was NOT the whole story.
// Sweep EVERY descent stage x several human-like play patterns: record on a
// client-identical boot, verify through the real oracle replay path.
import { describe, it, expect, beforeAll } from 'vitest';
import { ReplayVerifier, bootGame, startStageRun, type ReplayEngine } from '../src/replay/replayer.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const BUNDLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../replay-bundles');
function newestVer(dir: string): string {
  const files = fs.readdirSync(dir).filter((f) => /^engine-v[0-9a-f]+\.mjs$/.test(f));
  files.sort((a, b) => fs.statSync(dir + '/' + b).mtimeMs - fs.statSync(dir + '/' + a).mtimeMs);
  if (!files.length) throw new Error('no replay bundles found');
  return files[0]!.replace(/^engine-/, '').replace(/\.mjs$/, '');
}
const VER = process.env.REPRO_VER ?? newestVer(BUNDLES_DIR);

const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'] as const;
type BtnName = (typeof BTNS)[number];

function recordStageRun(eng: ReplayEngine, stageIdx: number, seedLabel: string, drive: (f: number) => Partial<Record<BtnName, boolean>>, maxFrames = 30000) {
  const game = bootGame(eng);
  startStageRun(game, stageIdx, seedLabel);
  const down = game.input.down as Record<BtnName, boolean>;
  const pressed = game.input.pressed as Record<BtnName, boolean>;
  for (let f = 0; f < maxFrames && game.inputLogMasks; f++) {
    const lvl = drive(f);
    for (const b of BTNS) {
      const v = lvl[b] === true;
      if (v && !down[b]) pressed[b] = true;
      down[b] = v;
    }
    game.step();
  }
  const sealed = game.arena?.sealedRun;
  if (sealed?.inputLogB64) {
    const dec = eng.decodeInputLogB64(sealed.inputLogB64);
    return { masks: dec.masks, score: game.score as number };
  }
  const n: number = game.inputLogFrames ?? 0;
  return { masks: Uint8Array.from(game.inputLogMasks.subarray(0, n)), score: game.score as number };
}

// human-ish patterns
const PATTERNS: Record<string, (f: number) => Partial<Record<BtnName, boolean>>> = {
  'walk+punch': (f) => ({ right: true, punch: f % 47 < 6, kick: f % 83 < 4 }),
  'jump brawl': (f) => ({ right: f % 120 < 90, left: f % 120 >= 90, jump: f % 61 < 5, punch: f % 37 < 5, kick: f % 53 < 4 }),
  'special spam': (f) => ({ right: true, special: f % 71 < 5, punch: f % 29 < 4, up: f % 97 < 8, down: f % 89 < 8 }),
  'held across scenes': (f) => ({ right: true, punch: true }), // keys held THROUGH every cut
  'crouch+kick': (f) => ({ down: f % 100 < 40, kick: f % 41 < 6, right: f % 100 >= 40, punch: f % 67 < 5 }),
};

let eng: ReplayEngine;
let verifier: ReplayVerifier;
beforeAll(async () => {
  verifier = new ReplayVerifier({ bundlesDir: BUNDLES_DIR, timeoutMs: 120_000 });
  eng = (await verifier.loadBundle(VER))!;
}, 120_000);

describe('all-stages record->replay determinism (v17.0.10 repro)', () => {
  for (let stage = 1; stage <= 7; stage++) {
    for (const [pname, drive] of Object.entries(PATTERNS)) {
      it(`stage ${stage} — ${pname}`, async () => {
        const seed = 'PIT-9' + stage;
        const r = recordStageRun(eng, stage, seed, drive);
        const check = await verifier.verifyRun({ build: VER, stageMode: 'stage', stageIdx: stage, seedLabel: seed, masks: r.masks, score: r.score });
        console.log(`stage ${stage} ${pname}: recorded=${r.score} frames=${r.masks.length} replay=${check.ok ? 'OK' : 'MISMATCH ' + JSON.stringify(check).slice(0, 200)}`);
        expect(check.ok).toBe(true);
      }, 180_000);
    }
  }
});
