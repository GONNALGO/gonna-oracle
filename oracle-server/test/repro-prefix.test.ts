// v17.0.11 CHECKPOINT PREFIX: the edge-swipe armor seals a PREFIX of the run
// (tape + score snapshotted every 300 frames / on pagehide). The oracle must
// sign a prefix exactly like a full run: replaying N recorded frames lands on
// EXACTLY the score the client had after stepping frame N-1. This test proves
// the prefix property on the shipped bundle (v3 tapes, sub-frame taps mixed).
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

describe('checkpoint prefix property (v17.0.11 recovery)', () => {
  for (const stage of [1, 3]) {
    it(`stage ${stage}: any 300-frame prefix replays to the snapshotted score`, () => {
      const A = bootGame(eng);
      startStageRun(A, stage, 'PFX-' + stage);
      // record with mixed held + sub-frame taps; snapshot score every 300 frames
      const snaps: { frames: number; score: number }[] = [];
      let f = 0;
      while (f < 3600 && A.scene && A.inputLogMasks) {
        if (A.scene === 'play') {
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
          if (near && f % 2 === 0) {
            if (f % 6 === 0) A.input.pressed.punch = true; // sub-frame tap
            else { A.input.pressed.punch = true; A.input.down.punch = true; }
          }
          if (f % 211 < 2) A.input.pressed.jump = true;
          A.step();
          f++;
          // mirror of engine.step(): checkpoint AFTER stepping frame f-1
          if (f % 300 === 0) snaps.push({ frames: f, score: A.score });
        } else {
          for (const b of BTNS) { A.input.down[b] = false; A.input.pressed[b] = false; }
          if (A.scene === 'clear' || A.scene === 'victory') A.input.pressed.start = true;
          A.step();
        }
      }
      expect(snaps.length).toBeGreaterThan(0);
      const masks: Uint8Array = A.inputLogMasks ? Uint8Array.from(A.inputLogMasks.subarray(0, f)) : (eng as any).decodeInputLogB64((A as any).arena.sealedRun.inputLogB64).masks;
      const edges: Uint8Array | null = A.inputLogEdges ? Uint8Array.from(A.inputLogEdges.subarray(0, f)) : (eng as any).decodeInputLogB64((A as any).arena.sealedRun.inputLogB64).edges;
      expect(edges).not.toBeNull();
      for (const s of snaps) {
        const B = bootGame(eng);
        startStageRun(B, stage, 'PFX-' + stage);
        const res = await replayCampaign(B, masks.subarray(0, s.frames), 60_000, edges!.subarray(0, s.frames));
        expect(res.score).toBe(s.score); // prefix N frames -> EXACT snapshot score
      }
      console.log(`stage ${stage}: ${snaps.length} prefix checkpoints all byte-exact (last: ${snaps[snaps.length - 1]!.frames} frames = ${snaps[snaps.length - 1]!.score} pts)`);
    }, 300_000);
  }
});
