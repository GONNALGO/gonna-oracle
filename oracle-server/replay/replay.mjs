// ============================================================================
// M2 replay harness core (ex-M2-0 spike, refactored per SPEC-m2 §6).
// Loads a PINNED engine bundle artifact (oracle-server/replay-bundles/
// engine-<VER>.mjs, built by scripts/build-replay-bundle.mjs) instead of
// bundling on the fly. API kept from the spike: bootGame / startDescent /
// replayMasks / replayGIL / masksToTape / makeGIL — all take the loaded
// bundle. The production verifier lives in src/replay/replayer.ts (TS); this
// module stays for the QA probes (provaA-node, provaB-browser).
// ============================================================================
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installBrowserStubs, makeCanvas } from './stubs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
const BUNDLES_DIR = path.resolve(HERE, '..', 'replay-bundles');
const ENTRY = path.join(HERE, '.tmp-replay-entry.ts');
const BUNDLE = path.join(HERE, '.tmp-engine-bundle.mjs');

const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'];

/** loadBundle(pathOrVer): import a pinned engine bundle artifact once.
 *  Pins globalThis.__GONNA_VER to the bundle's VER so buildVer() (sealed-log
 *  build stamp) matches the released client build. */
export async function loadBundle(pathOrVer) {
  const file = pathOrVer.includes(path.sep) || pathOrVer.endsWith('.mjs')
    ? pathOrVer
    : path.join(BUNDLES_DIR, `engine-${pathOrVer}.mjs`);
  installBrowserStubs(); // BEFORE the bundle's module bodies run
  const m = /engine-(.+)\.mjs$/.exec(file);
  if (m) globalThis.__GONNA_VER = m[1];
  return await import(pathToFileURL(file).href);
}

// loadEngine(): bundle the CURRENT src/game on the fly (.tmp artifacts, never
// committed) — kept for the client-side suites (test-v1610) that must test
// the working tree, not a pinned artifact. The server uses loadBundle.
let engineP = null;
export async function loadEngine() {
  if (engineP) return engineP;
  engineP = (async () => {
    writeFileSync(
      ENTRY,
      "export { Game } from '../../src/game/engine';\n" +
        "export { buildArt } from '../../src/game/sprites';\n" +
        "export { decodeInputLog, decodeInputLogB64, encodeInputLog, encodeInputLogB64, maskFromDown, INPUT_LOG_CAP } from '../../src/game/arena/inputLog';\n" +
        "export { hashSeed, makeRng, makeRngFromLabel } from '../../src/game/rng';\n",
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

// FULL RUN (campaign) seeded boot — the EXACT arena full-mode client entry
// (SPEC-m2 §4): the engine self-installs ONE makeRngFromLabel(seedLabel)
// campaign stream for the whole run (engine.ts startArenaRun -> loadStage ->
// this.rng = arenaRunRng ?? mathRng). No patching needed since m2-client.
export function startFullRunSeeded(engine, game, seedLabel) {
  game.debugFullRun(seedLabel);
}

// Stage run boot — the EXACT arena stage-mode client entry (DESCENT PIT-<cid>).
export function startStageRun(game, stageIdx, seedLabel) {
  game.startArenaRun('stage', stageIdx, { seedTag: seedLabel });
}

// ---------------------------------------------------------------------------
// Scene-aware replay driver (promoted from scripts/test-v1610.mjs — the M2
// replay CONTRACT). GIL v2 log frames are PLAY-scene frames ONLY:
//   - intro: force-skip (debugSim-equivalent), consumes no mask;
//   - clear tally / victory: auto START (a player mashing START — the bonus
//     lands the instant the press registers), consumes no mask;
//   - play: consume one mask (levels + rising-edge pressed), step.
// Works for both DESCENT stage runs and the seeded FULL campaign.
// ---------------------------------------------------------------------------
export function replayCampaign(game, masks, { timeoutMs = 30_000 } = {}) {
  const down = game.input.down;
  const pressed = game.input.pressed;
  const hashes = [];
  const t0 = Date.now();
  let i = 0, steps = 0;
  while (i < masks.length) {
    if (++steps > masks.length * 4 + 20000) throw new Error('driver stuck in non-play scene');
    if ((steps & 0x3ff) === 0 && Date.now() - t0 >= timeoutMs) {
      const e = new Error('replay wall-clock budget exceeded');
      e.name = 'ReplayTimeoutError';
      throw e;
    }
    const sc = game.scene;
    if (sc === 'intro') { game.setScene('play'); continue; }
    if (sc === 'clear' || sc === 'victory') { game.input.pressed.start = true; game.step(); continue; }
    if (sc !== 'play') { game.step(); continue; }
    const m = masks[i++];
    for (let b = 0; b < 8; b++) {
      const v = ((m >> b) & 1) === 1;
      if (v && !down[BTNS[b]]) pressed[BTNS[b]] = true;
      down[BTNS[b]] = v;
    }
    game.step();
    if (i % 60 === 0) hashes.push(game.simHash());
  }
  return { hashes, score: game.score, playFrames: i, steps, stageIdx: game.stageIdx, scene: game.scene, elapsedMs: Date.now() - t0 };
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
