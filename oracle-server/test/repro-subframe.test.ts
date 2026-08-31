// v17.0.10 SUB-FRAME TAP: the GIL v2 recorder samples button LEVELS once per
// step (maskFromDown). A real mobile tap can go down+up BETWEEN two steps:
// the sim consumes the `pressed` edge (a punch lands, a jump starts) but the
// sampled level is 0 in BOTH adjacent frames -> the tape carries NOTHING and
// the replay can never regenerate that edge. Periodic bots always hold
// buttons >= 2 frames, which is why 35/35 + 28/28 sweeps never caught it.
// This test drives a live run with REALISTIC sub-frame taps (pressed edge
// with no level) and twin-replays the tape: if the mechanism bites, the
// replay diverges from the recorded score.
import { describe, it, expect, beforeAll } from 'vitest';
import { ReplayVerifier, bootGame, startStageRun, replayCampaign, type ReplayEngine } from '../src/replay/replayer.js';
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

let eng: ReplayEngine;
beforeAll(async () => {
  const verifier = new ReplayVerifier({ bundlesDir: BUNDLES_DIR, timeoutMs: 120_000 });
  eng = (await verifier.loadBundle(VER))!;
}, 120_000);

function snapshot(game: any): string {
  const p = game.player;
  return [game.score, Math.round(p.x), Math.round(p.y), p.hp, p.state, game.kos,
    (game.enemies ?? []).filter((e: any) => e.alive).length].join('|');
}

describe('sub-frame tap desync (Prince mobile taps)', () => {
  for (const stage of [1, 3, 5]) {
    it(`stage ${stage}: record with sub-frame taps, replay diverges`, () => {
      const A = bootGame(eng);
      startStageRun(A, stage, 'SUB-' + stage);
      const trace: string[] = [];
      let f = 0;
      while (f < 12000 && A.inputLogMasks) {
        if (A.scene === 'play') {
          // movement held normally (multi-frame levels — always replayable)
          const es = (A.enemies ?? []).filter((e: any) => e.alive);
          let dir: 'left' | 'right' | null = 'right';
          let near = false;
          if (es.length) {
            let best = es[0]; let bd = Math.abs(best.x - A.player.x);
            for (const e of es) { const d = Math.abs(e.x - A.player.x); if (d < bd) { bd = d; best = e; } }
            dir = best.x < A.player.x ? 'left' : 'right';
            near = bd < 40;
          }
          for (const b of BTNS) { A.input.pressed[b] = false; A.input.down[b] = false; }
          if (dir) A.input.down[dir] = true;
          // THE KILLER: every 3rd attack is a SUB-FRAME tap — edge consumed by
          // the sim, level never sampled. On mobile this is a fast finger tap.
          if (near && f % 2 === 0) {
            if (f % 6 === 0) A.input.pressed.punch = true; // sub-frame tap: NO down level
            else { A.input.down.punch = true; if (!A.input.down.punch) A.input.pressed.punch = true; A.input.pressed.punch = true; A.input.down.punch = true; }
          }
          if (f % 211 < 2) { A.input.pressed.jump = true; } // sub-frame jump taps
          A.step();
          if (f % 60 === 0) trace.push(f + ':' + snapshot(A));
          f++;
        } else {
          for (const b of BTNS) { A.input.down[b] = false; A.input.pressed[b] = false; }
          if (A.scene === 'clear' || A.scene === 'victory') A.input.pressed.start = true;
          A.step();
        }
      }
      const sealed = (A as any).arena?.sealedRun;
      const decoded = sealed?.inputLogB64 ? (eng as any).decodeInputLogB64(sealed.inputLogB64) : null;
      const masks: Uint8Array = decoded?.masks ?? Uint8Array.from(A.inputLogMasks.subarray(0, A.inputLogFrames ?? 0));
      const edges: Uint8Array | null = decoded?.edges ?? (A.inputLogEdges ? Uint8Array.from(A.inputLogEdges.subarray(0, A.inputLogFrames ?? 0)) : null);
      const recorded = A.score;
      console.log(`stage ${stage} recorded score=${recorded} frames=${masks.length} gilV=${decoded?.v ?? 'raw'} edges=${edges ? 'yes' : 'no'}`);

      // twin replay, fresh boot, tracking the divergence point
      const B = bootGame(eng);
      startStageRun(B, stage, 'SUB-' + stage);
      let i = 0; let steps = 0; let firstDiv = -1;
      while (i < masks.length) {
        if (++steps > masks.length * 4 + 20000) break;
        const sc = B.scene;
        if (sc !== 'play') {
          for (const b of BTNS) { B.input.down[b] = false; B.input.pressed[b] = false; }
          if (sc === 'clear' || sc === 'victory') B.input.pressed.start = true;
          B.step();
          continue;
        }
        const m = masks[i]!;
        if (edges) {
          const e = edges[i]!;
          for (let b = 0; b < 8; b++) {
            B.input.down[BTNS[b]!] = ((m >> b) & 1) === 1;
            B.input.pressed[BTNS[b]!] = ((e >> b) & 1) === 1;
          }
        } else {
          for (let b = 0; b < 8; b++) {
            const v = ((m >> b) & 1) === 1;
            if (v && !B.input.down[BTNS[b]!]) B.input.pressed[BTNS[b]!] = true;
            B.input.down[BTNS[b]!] = v;
          }
        }
        i++;
        B.step();
        const tf = (i - 1) - ((i - 1) % 60);
        if (firstDiv < 0 && (i - 1) % 60 === 0 && trace.length) {
          const want = trace.find((t) => t.startsWith(tf + ':'));
          if (want && want.split(':')[1] !== snapshot(B)) firstDiv = i - 1;
        }
      }
      console.log(`stage ${stage} replay score=${B.score} firstDivergenceFrame=${firstDiv} scene=${B.scene}`);
      // DOCUMENT the mechanism: with sub-frame taps in the live run, the
      // level-only tape MUST lose edges — a mismatch here PROVES the bug.
      // (Once the GIL v3 edges+levels fix lands this expectation flips to equality.)
      expect({ recorded, replayed: B.score, firstDiv }).toEqual({ recorded, replayed: recorded, firstDiv: -1 });
    }, 300_000);
  }
});
