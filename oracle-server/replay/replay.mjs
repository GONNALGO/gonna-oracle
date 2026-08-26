// ============================================================================
// M2 replay harness core (ex-M2-0 spike, refactored per SPEC-m2 §6).
// Loads a PINNED engine bundle artifact (oracle-server/replay-bundles/
// engine-<VER>.mjs, built by scripts/build-replay-bundle.mjs) instead of
// bundling on the fly. API kept from the spike: bootGame / startDescent /
// replayMasks / replayGIL / masksToTape / makeGIL — all take the loaded
// bundle. The production verifier lives in src/replay/replayer.ts (TS); this
// module stays for the QA probes (provaA-node, provaB-browser).
// ============================================================================
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installBrowserStubs, makeCanvas } from './stubs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
const BUNDLES_DIR = path.resolve(HERE, '..', 'replay-bundles');

const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'];

/** loadBundle(pathOrVer): import a pinned engine bundle artifact once. */
export async function loadBundle(pathOrVer) {
  const file = pathOrVer.includes(path.sep) || pathOrVer.endsWith('.mjs')
    ? pathOrVer
    : path.join(BUNDLES_DIR, `engine-${pathOrVer}.mjs`);
  installBrowserStubs(); // BEFORE the bundle's module bodies run
  return await import(pathToFileURL(file).href);
}

// Boot a Game with stub canvas + painted (stubbed) art + NO skin frames.
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

// FULL RUN (campaign) seeded boot — SPEC-m2 §4 mirror (see replayer.ts).
export function startFullRunSeeded(engine, game, seedLabel) {
  const seeded = engine.makeRng(engine.hashSeed(seedLabel));
  const origLoadStage = game.loadStage.bind(game);
  game.loadStage = (idx) => {
    origLoadStage(idx);
    game.rng = seeded;
  };
  game.startNewGame();
}

// The replay driver. Returns simHash every 60 frames + the final score.
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

// GIL v1/v2 (base64 or bytes) -> replay result.
export async function replayGIL(log, { stageIdx, god = false, engine } = {}) {
  if (!engine) throw new Error('replayGIL: engine bundle required (loadBundle)');
  const bytes = typeof log === 'string' ? Uint8Array.from(Buffer.from(log, 'base64')) : log;
  const decoded = engine.decodeInputLog(bytes);
  const game = bootGame(engine);
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

// convenience: build a GIL log from a mask array (for synthetic fixtures)
export async function makeGIL({ build = 'm2-spike', seedLabel, masks, engine }) {
  if (!engine) throw new Error('makeGIL: engine bundle required (loadBundle)');
  return engine.encodeInputLogB64({ v: 1, build, seedLabel, frames: masks.length, truncated: false, masks });
}
