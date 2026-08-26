// ============================================================================
// M2-0 SPIKE — headless replay core. Bundles the REAL client engine
// (src/game/engine.ts + the GIL codec) for Node via esbuild, boots it against
// browser stubs, and replays an input log frame by frame:
//
//   loadEngine()                 esbuild bundle -> { Game, buildArt, codec }
//   bootGame()                   new Game(stubCtx, buildArt(), empty frames)
//   replayMasks(game, masks)     per-frame bitmask -> down/pressed (rising
//                                edge), step(), simHash every 60 frames
//   replayGIL(b64|bytes, opts)   decode 'GIL' v1 + fresh game + replayMasks
//   masksToTape(masks)           GIL bitmask stream -> debugSim tape (for the
//                                browser side of Prova B: identical
//                                down/pressed stream through the EXISTING
//                                window.__gonna.debugSim harness)
//
// REPLAY SEMANTICS (mirrors what the M2 server must do): the intro title card
// is force-skipped exactly like debugSim does (`scene 'intro' -> 'play'`),
// because the start/pause buttons are NOT in the 8-bit mask (GIL v1) and the
// live intro length is therefore unrecoverable from the log. See M2-0-REPORT.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBrowserStubs, makeCanvas } from './stubs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
const ENTRY = path.join(HERE, '.tmp-replay-entry.ts');
const BUNDLE = path.join(HERE, '.tmp-engine-bundle.mjs');

const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'];

let engineP = null;
export async function loadEngine() {
  if (engineP) return engineP;
  engineP = (async () => {
    writeFileSync(
      ENTRY,
      "export { Game } from '../../src/game/engine';\n" +
        "export { buildArt } from '../../src/game/sprites';\n" +
        "export { decodeInputLog, encodeInputLog, encodeInputLogB64, maskFromDown, INPUT_LOG_CAP } from '../../src/game/arena/inputLog';\n" +
        "export { hashSeed } from '../../src/game/rng';\n",
    );
    execFileSync('npx', ['esbuild', ENTRY, '--bundle', '--format=esm', '--platform=node',
      '--define:import.meta.env={"DEV":false,"PROD":true,"VITE_QA_ORACLE":""}',
      `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
      `--outfile=${BUNDLE}`], { cwd: ROOT, stdio: 'pipe' });
    installBrowserStubs(); // BEFORE the bundle's module bodies run
    return await import(BUNDLE);
  })();
  return engineP;
}

// Boot a Game with stub canvas + painted (stubbed) art + NO skin frames
// (loadFrames is browser-only; the sim never reads frame pixels).
export function bootGame(engine) {
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const art = engine.buildArt();
  // TS-private constructor — compile-time only, plain JS at runtime
  return new engine.Game(ctx, art, new Map());
}

// Start a seeded DESCENT practice run (same entry as the QA harness).
export function startDescent(game, stageIdx, seedLabel) {
  game.debugDescent(stageIdx, seedLabel);
}

// The replay driver the M2 server will run. Returns simHash every 60 frames
// + the final score, exactly like debugSim, but fed from a GIL mask stream.
export function replayMasks(game, masks, { god = false, hashEvery = 60 } = {}) {
  const down = game.input.down;
  const pressed = game.input.pressed;
  if (game.scene === 'intro') game.setScene('play'); // debugSim-equivalent skip
  const hashes = [];
  for (let f = 0; f < masks.length; f++) {
    const m = masks[f];
    for (let i = 0; i < 8; i++) {
      const v = ((m >> i) & 1) === 1;
      if (v && !down[BTNS[i]]) pressed[BTNS[i]] = true; // rising edge
      down[BTNS[i]] = v;
    }
    if (god) {
      game.player.hp = game.player.maxHp;
      if (game.player.state === 'dead') {
        game.player.state = 'getup';
        game.player.t = 0;
      }
    }
    game.step();
    if ((f + 1) % hashEvery === 0) hashes.push(game.simHash());
  }
  return { hashes, score: game.score, frames: masks.length, wave: game.descent?.wave ?? -1, kos: game.kos, scene: game.scene };
}

// GIL v1 (base64 or bytes) -> replay result. Header seedLabel is authoritative
// (stageIdx must be supplied: the v1 header does not carry it — see report).
export async function replayGIL(log, { stageIdx, god = false, engine = null } = {}) {
  const eng = engine ?? (await loadEngine());
  const bytes = typeof log === 'string' ? Uint8Array.from(Buffer.from(log, 'base64')) : log;
  const decoded = eng.decodeInputLog(bytes);
  const game = bootGame(eng);
  startDescent(game, stageIdx, decoded.seedLabel);
  const res = replayMasks(game, decoded.masks, { god });
  return { ...res, seedLabel: decoded.seedLabel, build: decoded.build, headerFrames: decoded.frames, truncated: decoded.truncated };
}

// GIL masks -> debugSim tape (same down/pressed stream the raw driver emits).
export function masksToTape(masks) {
  const tape = [];
  let prev = 0;
  for (let f = 0; f < masks.length; f++) {
    const m = masks[f];
    const delta = m ^ prev;
    if (!delta) continue;
    const ev = { f, down: {}, press: [] };
    for (let i = 0; i < 8; i++) {
      if (!((delta >> i) & 1)) continue;
      const v = ((m >> i) & 1) === 1;
      ev.down[BTNS[i]] = v;
      if (v) ev.press.push(BTNS[i]);
    }
    tape.push(ev);
    prev = m;
  }
  return tape;
}

// debugSim(tape) in Node — shares the engine's own harness code path, used to
// prove masksToTape equivalence (Prova A) and mirrored by the browser side.
export async function replayViaDebugSim({ stageIdx, seedLabel, tape, god = false, engine = null }) {
  const eng = engine ?? (await loadEngine());
  const game = bootGame(eng);
  startDescent(game, stageIdx, seedLabel);
  const r = game.debugSim({ frames: tape.frames ?? 0, tape, god });
  return r;
}

// convenience: build a GIL log from a mask array (for synthetic fixtures)
export async function makeGIL({ build = 'm2-spike', seedLabel, masks, engine = null }) {
  const eng = engine ?? (await loadEngine());
  return eng.encodeInputLogB64({ v: 1, build, seedLabel, frames: masks.length, truncated: false, masks });
}
