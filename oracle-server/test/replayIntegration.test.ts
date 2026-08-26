// replayIntegration.test.ts — THE M2-4 GATE: REAL GIL v2 logs produced by
// the client path (startArenaRun / debugFullRun + the v16.1 play-scene
// recorder, sealed artifacts included) must verify bit-exact through the
// server ReplayVerifier — stage-mode cross-stageIdx (0..3) and full-mode.
// Also pins the RNG parity contract: makeRngFromLabel(label) ===
// makeRng(hashSeed(label)) (rng.ts) — the server relies on it.
import { describe, it, expect, beforeAll } from 'vitest';
import { ReplayVerifier, bootGame, startStageRun, startFullRunSeeded, type ReplayEngine } from '../src/replay/replayer.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../replay-bundles');
const VER = 'vb1d23c1a'; // committed fixture bundle (v16.1 engine)

const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'] as const;

// scripted brawl input stream (levels), same rhythm as test-v1610 brawlMasks
function brawlStream(n: number): Uint8Array {
  const m = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    let v = 8; // right held
    const q = f % 90;
    if (q >= 30 && q < 60) v = 0;
    if (q === 34 || q === 42 || q === 68) v |= 16; // punch
    if (q === 58) v |= 32; // kick
    if (q === 70) v |= 64; // jump
    m[f] = v;
  }
  return m;
}

interface HonestLog {
  seedLabel: string;
  masks: Uint8Array;
  score: number;
  sealed: boolean;
  v: number;
  stageIdxReached: number;
}

// Drive the REAL client run (recorder ON), return exactly what the client
// would seal/submit: the recorded PLAY-scene masks + the final score.
function recordClientRun(eng: ReplayEngine, boot: (g: any) => void, seedLabel: string, stream: Uint8Array): HonestLog {
  const game = bootGame(eng);
  boot(game);
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
    return { seedLabel, masks: dec.masks, score: game.score, sealed: true, v: dec.v, stageIdxReached: game.stageIdx };
  }
  const n: number = game.inputLogFrames;
  return { seedLabel, masks: Uint8Array.from(game.inputLogMasks.subarray(0, n)), score: game.score, sealed: false, v: 2, stageIdxReached: game.stageIdx };
}

let eng: ReplayEngine;
let verifier: ReplayVerifier;

beforeAll(async () => {
  verifier = new ReplayVerifier({ bundlesDir: BUNDLES_DIR, timeoutMs: 60_000 });
  const p = verifier.loadBundle(VER);
  if (!p) throw new Error(`fixture bundle engine-${VER}.mjs missing`);
  eng = await p;
}, 120_000);

describe('M2-4 GATE: real client v2 logs -> server replay (SPEC-m2 §5)', () => {
  it('RNG parity: makeRngFromLabel === makeRng(hashSeed) stream', () => {
    const a = eng.makeRngFromLabel('RUN-4242');
    const b = eng.makeRng(eng.hashSeed('RUN-4242'));
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  for (const stageIdx of [0, 1, 2, 3]) {
    it(`stage-mode stageIdx ${stageIdx}: recorded PIT log replays to the sealed score`, async () => {
      const seedLabel = `PIT-${9000 + stageIdx}`;
      const log = recordClientRun(eng, (g) => startStageRun(g, stageIdx, seedLabel), seedLabel, brawlStream(3600));
      expect(log.masks.length).toBeGreaterThanOrEqual(600);
      const r = await verifier.verifyRun({ build: VER, stageMode: 'stage', stageIdx, seedLabel, masks: log.masks, score: log.score });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.result.score).toBe(log.score);
    }, 90_000);
  }

  it('full-mode: seeded campaign RUN-4242 log replays to the sealed score', async () => {
    const log = recordClientRun(eng, (g) => startFullRunSeeded(eng, g, 'RUN-4242'), 'RUN-4242', brawlStream(3600));
    expect(log.masks.length).toBeGreaterThanOrEqual(600);
    const r = await verifier.verifyRun({ build: VER, stageMode: 'full', stageIdx: null, seedLabel: 'RUN-4242', masks: log.masks, score: log.score });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.score).toBe(log.score);
  }, 90_000);

  it('full-mode long run: scene-aware driver crosses tally scenes without eating log frames', async () => {
    const log = recordClientRun(eng, (g) => startFullRunSeeded(eng, g, 'RUN-31337'), 'RUN-31337', brawlStream(24000));
    const r = await verifier.verifyRun({ build: VER, stageMode: 'full', stageIdx: null, seedLabel: 'RUN-31337', masks: log.masks, score: log.score });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.score).toBe(log.score);
      expect(r.result.playFrames).toBe(log.masks.length); // alignment preserved across every non-play scene
      console.log(`    [info] long full run: stageIdxReached(record)=${log.stageIdxReached} replay=${r.result.stageIdx} sealed=${log.sealed} score=${log.score} playFrames=${r.result.playFrames}`);
    }
  }, 120_000);

  it('stage-mode death run: log sealed by finishArenaRun replays exactly', async () => {
    // suicide stream: march right, never swing — the mob seals the run
    const death = new Uint8Array(30000);
    for (let f = 0; f < death.length; f++) { death[f] = 8; if (f % 90 === 70) death[f] = 8 | 64; }
    const log = recordClientRun(eng, (g) => startStageRun(g, 2, 'PIT-9001'), 'PIT-9001', death);
    expect(log.sealed).toBe(true); // the run really died and sealed
    expect(log.masks.length).toBeGreaterThanOrEqual(600);
    const r = await verifier.verifyRun({ build: VER, stageMode: 'stage', stageIdx: 2, seedLabel: 'PIT-9001', masks: log.masks, score: log.score });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.score).toBe(log.score);
  }, 120_000);
});
