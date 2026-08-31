// v17.0.10 DEEP FUZZ: Prince's real runs diverge LATE (stage 3 @12979f,
// stage 5 @3961f) — content my short synthetic tapes never reach. God-mode
// both sides (external poke, identical in record and replay) so the bot
// survives into late waves; simHash every 60 frames to find the EXACT first
// divergent frame and what is alive then.
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

function god(game: any): void {
  const p = game.player;
  p.hp = p.maxHp;
  if (p.state === 'dead') { p.state = 'getup'; p.t = 0; }
}

// a bot that actually hunts: walk to the nearest enemy, attack in range
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
    if (f % 211 < 3) lvl.special = true;
  } else {
    lvl.right = true; // push forward between waves
  }
  return lvl;
}

function snapshot(game: any): string {
  const p = game.player;
  const es = (game.enemies ?? []).filter((e: any) => e.alive).map((e: any) => `${e.kind}@${Math.round(e.x)},${Math.round(e.y)} hp${e.hp} st${e.state}`).join(' | ');
  return `scene=${game.scene} wave=${game.descent?.wave} score=${game.score} p=(${Math.round(p.x)},${Math.round(p.y)} st=${p.state} hp=${p.hp}) enemies=[${es}]`;
}

function runTwin(stage: number, seed: string, maxFrames: number): void {
  // ---- RECORD side: client-identical boot, recorder live, god pokes
  const A = bootGame(eng);
  startStageRun(A, stage, seed);
  const hashesA: string[] = [];
  const snaps: string[] = [];
  let f = 0;
  while (f < maxFrames && A.inputLogMasks) {
    const lvl = A.scene === 'play' ? botDrive(A, f) : {};
    for (const b of BTNS) {
      const v = lvl[b] === true;
      if (v && !A.input.down[b]) A.input.pressed[b] = true;
      A.input.down[b] = v;
    }
    god(A);
    A.step();
    if (f % 60 === 59) { hashesA.push(A.simHash()); if (f % 600 === 599) snaps.push(`f${f + 1}: ` + snapshot(A)); }
    f++;
  }
  const sealed = A.arena?.sealedRun;
  const dec = sealed?.inputLogB64 ? eng.decodeInputLogB64(sealed.inputLogB64) : null;
  const masks: Uint8Array = dec ? dec.masks : Uint8Array.from(A.inputLogMasks.subarray(0, A.inputLogFrames ?? 0));
  const scoreA = A.score;

  // ---- REPLAY side: fresh boot, replayCampaign-mirror driver, god pokes
  const B = bootGame(eng);
  startStageRun(B, stage, seed);
  const hashesB: string[] = [];
  let i = 0;
  let steps = 0;
  while (i < masks.length) {
    if (++steps > masks.length * 4 + 20000) break;
    const sc = B.scene;
    if (sc !== 'play') {
      for (const b of BTNS) { B.input.down[b] = false; B.input.pressed[b] = false; }
      if (sc === 'clear' || sc === 'victory') B.input.pressed.start = true;
      god(B);
      B.step();
      continue;
    }
    const m = masks[i++]!;
    for (let b = 0; b < 8; b++) {
      const v = ((m >> b) & 1) === 1;
      if (v && !B.input.down[b]) B.input.pressed[b] = true;
      B.input.down[b] = v;
    }
    god(B);
    B.step();
    if ((steps - 1) % 60 === 59) hashesB.push(B.simHash());
  }
  const scoreB = B.score;
  // NOTE: hash indices align only if B's play/non-play step ORDER matches A's
  // — exactly what we are testing. Compare scores first, hashes as guidance.
  if (scoreA !== scoreB) {
    let firstDiff = -1;
    for (let k = 0; k < Math.min(hashesA.length, hashesB.length); k++) {
      if (hashesA[k] !== hashesB[k]) { firstDiff = (k + 1) * 60; break; }
    }
    console.log(`DIVERGE stage=${stage} seed=${seed} scoreA=${scoreA} scoreB=${scoreB} firstDiffFrame~=${firstDiff} masks=${masks.length} stepsB=${steps}`);
    console.log('record-side snapshots around divergence:');
    for (const s of snaps) console.log('  ' + s);
    console.log('  B end: ' + snapshot(B));
    throw new Error(`DIVERGENCE stage ${stage} seed ${seed}: A=${scoreA} B=${scoreB} @~f${firstDiff}`);
  }
  console.log(`stage ${stage} seed=${seed}: OK score=${scoreA} frames=${masks.length}`);
}

let eng: ReplayEngine;
beforeAll(async () => {
  const verifier = new ReplayVerifier({ bundlesDir: BUNDLES_DIR, timeoutMs: 120_000 });
  eng = (await verifier.loadBundle(VER))!;
}, 120_000);

describe('deep fuzz twin determinism', () => {
  const seeds = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'];
  for (let stage = 1; stage <= 7; stage++) {
    for (const s of seeds) {
      it(`stage ${stage} twin ${s}`, () => {
        runTwin(stage, `FUZZ-${s}`, 15000);
      }, 300_000);
    }
  }
});
