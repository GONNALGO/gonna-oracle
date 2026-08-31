// v17.0.10 BACK-TO-BACK: Prince's mismatched runs were NEVER the first run of
// the page — he played, REMATCHED, created a new card, played again. If any
// module-level gameplay state (RNG streams, caches) leaks between runs in the
// same session, run #2+ starts from a state a fresh-boot replay can never
// reproduce -> REPLAY MISMATCH on honest human runs. This test plays TWO
// sealed runs in ONE engine session and twin-replays the SECOND run fresh.
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

function botDrive(game: any, f: number): Record<string, boolean> {
  const p = game.player;
  const lvl: Record<string, boolean> = {};
  const es = (game.enemies ?? []).filter((e: any) => e.alive);
  if (es.length) {
    let best = es[0]; let bd = Math.abs(best.x - p.x);
    for (const e of es) { const d = Math.abs(e.x - p.x); if (d < bd) { bd = d; best = e; } }
    if (best.x < p.x - 26) lvl.left = true;
    else if (best.x > p.x + 26) lvl.right = true;
    if (bd < 34) { lvl.punch = f % 9 < 3; lvl.kick = f % 23 < 3; }
    if (f % 137 < 4) lvl.jump = true;
  } else lvl.right = true;
  return lvl;
}

// play one sealed run to its natural end (death or clear), return the tape
function playOneRun(game: any, stage: number, seed: string, maxFrames = 20000): { masks: Uint8Array; score: number } {
  game.startArenaRun('stage', stage, { seedTag: seed });
  let f = 0;
  while (f < maxFrames && game.inputLogMasks) {
    const lvl = game.scene === 'play' ? botDrive(game, f) : {};
    for (const b of BTNS) {
      const v = lvl[b] === true;
      if (v && !game.input.down[b]) game.input.pressed[b] = true;
      game.input.down[b] = v;
    }
    game.step();
    f++;
  }
  const sealed = game.arena?.sealedRun;
  if (sealed?.inputLogB64) {
    const dec = eng.decodeInputLogB64(sealed.inputLogB64);
    return { masks: dec.masks, score: game.score };
  }
  return { masks: Uint8Array.from(game.inputLogMasks.subarray(0, game.inputLogFrames ?? 0)), score: game.score };
}

function replayFresh(stage: number, seed: string, masks: Uint8Array): number {
  const B = bootGame(eng);
  startStageRun(B, stage, seed);
  let i = 0; let steps = 0;
  while (i < masks.length) {
    if (++steps > masks.length * 4 + 20000) break;
    const sc = B.scene;
    if (sc !== 'play') {
      for (const b of BTNS) { B.input.down[b] = false; B.input.pressed[b] = false; }
      if (sc === 'clear' || sc === 'victory') B.input.pressed.start = true;
      B.step();
      continue;
    }
    const m = masks[i++]!;
    for (let b = 0; b < 8; b++) {
      const v = ((m >> b) & 1) === 1;
      if (v && !B.input.down[b]) B.input.pressed[b] = true;
      B.input.down[b] = v;
    }
    B.step();
  }
  return B.score;
}

let eng: ReplayEngine;
beforeAll(async () => {
  const verifier = new ReplayVerifier({ bundlesDir: BUNDLES_DIR, timeoutMs: 120_000 });
  eng = (await verifier.loadBundle(VER))!;
}, 120_000);

describe('back-to-back session leak (rematch path)', () => {
  for (const [s1, s2, st1, st2] of [[1, 3, 'RUN-ONE', 'RUN-TWO'], [2, 5, 'REM-A', 'REM-B'], [4, 3, 'X', 'Y']] as const) {
    it(`run#1 stage ${s1} (seed ${st1}) then run#2 stage ${s2} (seed ${st2}) in the SAME session`, () => {
      const A = bootGame(eng);
      const r1 = playOneRun(A, s1, st1, 12000);
      console.log(`run#1 stage ${s1}: score=${r1.score} frames=${r1.masks.length}`);
      // second run in the SAME page session — Prince's rematch/new-card path
      const r2 = playOneRun(A, s2, st2, 15000);
      console.log(`run#2 stage ${s2}: score=${r2.score} frames=${r2.masks.length}`);
      const fresh = replayFresh(s2, st2, r2.masks);
      console.log(`fresh replay of run#2: score=${fresh} ${fresh === r2.score ? 'MATCH' : 'DIVERGE!'}`);
      expect(fresh).toBe(r2.score);
      // also verify run#1's tape replays fresh (control: run#1 must be clean)
      const fresh1 = replayFresh(s1, st1, r1.masks);
      console.log(`fresh replay of run#1: score=${fresh1} ${fresh1 === r1.score ? 'MATCH' : 'DIVERGE!'}`);
      expect(fresh1).toBe(r1.score);
    }, 300_000);
  }
});
