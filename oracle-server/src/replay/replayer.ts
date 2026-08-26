// replay/replayer.ts — M2 replay verification core (SPEC-m2 §5/§6).
// Loads a PINNED engine bundle (oracle-server/replay-bundles/engine-<VER>.mjs,
// built by scripts/build-replay-bundle.mjs from src/game/ at release time),
// boots it headless against browser stubs, and replays the GIL mask stream
// frame by frame to recompute the score. Bit-exactness Node<->browser proven
// in M2-0 (commit 3386f41): Node V8 11.3 <-> Chromium V8 14.1 identical.
//
// Determinism contract:
//   - fresh Game per replay (no shared state between requests);
//   - bundle module cached per build (import() once);
//   - intro force-skipped exactly like the debugSim harness (GIL v2 frame 0 =
//     first frame of scene==='play'; START is not in the mask, M2-0 finding);
//   - DESCENT stage mode seeds 'PIT-<cid>' (already seeded in the engine);
//   - FULL mode mirrors SPEC-m2 §4: a single mulberry32(hashSeed('RUN-<cid>'))
//     stream replaces the campaign rng for the WHOLE run (patched over every
//     loadStage). Cross-agent contract with m2-client: identical semantics.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installBrowserStubs, makeCanvas } from './stubs.js';

export interface ReplayEngine {
  Game: any;
  buildArt: () => any;
  hashSeed: (label: string) => number;
  makeRng: (seed: number) => any;
}

const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'] as const;

export class ReplayTimeoutError extends Error {
  constructor() {
    super('replay wall-clock budget exceeded');
    this.name = 'ReplayTimeoutError';
  }
}

/** Scan replay-bundles/ for engine-<build>.mjs artifacts. */
export function scanReplayBundles(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out; // missing dir == no bundles
  }
  for (const n of names) {
    const m = /^engine-(.+)\.mjs$/.exec(n);
    if (m && m[1]) out.set(m[1], path.join(dir, n));
  }
  return out;
}

/** Boot a fresh Game on stub canvas + stub art + no skin frames. */
export function bootGame(eng: ReplayEngine): any {
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const art = eng.buildArt();
  // TS-private constructor — compile-time only, plain JS at runtime
  return new eng.Game(ctx, art, new Map());
}

/** Seeded DESCENT run (same public QA entry the client harness uses). */
export function startDescent(game: any, stageIdx: number, seedLabel: string): void {
  game.debugDescent(stageIdx, seedLabel);
}

/**
 * FULL RUN (campaign) seeded boot — SPEC-m2 §4 mirror. The client (m2-client
 * branch) seeds the arena campaign from 'RUN-<cid>'; here we inject the SAME
 * single mulberry32 stream over every loadStage (loadStage re-assigns
 * `this.rng = mathRng` at each stage transition — the override keeps the one
 * seeded stream for the whole run, exactly per SPEC). Until m2-client merges,
 * this path is self-consistent server-side; client-parity e2e is pending.
 */
export function startFullRunSeeded(eng: ReplayEngine, game: any, seedLabel: string): void {
  const seeded = eng.makeRng(eng.hashSeed(seedLabel));
  const origLoadStage = game.loadStage.bind(game);
  game.loadStage = (idx: number) => {
    origLoadStage(idx);
    game.rng = seeded;
  };
  game.startNewGame(); // scene 'intro'; the replay driver force-skips to play
}

export interface ReplayResult {
  score: number;
  frames: number;
  wave: number;
  scene: string;
  elapsedMs: number;
}

/**
 * Replay a GIL mask stream: per frame, levels -> down + rising-edge pressed,
 * then step(). Cooperative wall-clock guard: checked every 256 frames, aborts
 * with ReplayTimeoutError once the budget is exceeded (budget 0 = abort at
 * the first checkpoint — deterministic in tests). In-process by design for
 * M2 (frame cap 300k + rate limits); worker_threads isolation = M3 hardening.
 */
export function replayMasks(game: any, masks: Uint8Array, timeoutMs: number): ReplayResult {
  const t0 = Date.now();
  const down = game.input.down;
  const pressed = game.input.pressed;
  if (game.scene === 'intro') game.setScene('play'); // debugSim-equivalent skip
  for (let f = 0; f < masks.length; f++) {
    if ((f & 0xff) === 0 && Date.now() - t0 >= timeoutMs) throw new ReplayTimeoutError();
    const m = masks[f]!;
    for (let i = 0; i < 8; i++) {
      const v = ((m >> i) & 1) === 1;
      if (v && !down[BTNS[i]!]) pressed[BTNS[i]!] = true;
      down[BTNS[i]!] = v;
    }
    game.step();
  }
  return {
    score: game.score,
    frames: masks.length,
    wave: game.descent?.wave ?? -1,
    scene: game.scene,
    elapsedMs: Date.now() - t0,
  };
}

export type ReplayCheck = { ok: true; result: ReplayResult } | { ok: false; reason: string; status: number };

export class ReplayVerifier {
  readonly bundlesDir: string;
  readonly timeoutMs: number;
  private bundles: Map<string, string>;
  private cache = new Map<string, Promise<ReplayEngine>>();

  constructor(opts: { bundlesDir: string; timeoutMs: number }) {
    this.bundlesDir = opts.bundlesDir;
    this.timeoutMs = opts.timeoutMs;
    this.bundles = scanReplayBundles(opts.bundlesDir);
  }

  hasBuild(build: string): boolean {
    return this.bundles.has(build);
  }

  /** loadBundle: import the pinned artifact once per build, then cache. */
  loadBundle(build: string): Promise<ReplayEngine> | null {
    const file = this.bundles.get(build);
    if (!file) return null;
    let p = this.cache.get(build);
    if (!p) {
      installBrowserStubs(); // before the bundle's module bodies run
      p = import(pathToFileURL(file).href) as Promise<ReplayEngine>;
      this.cache.set(build, p);
    }
    return p;
  }

  /**
   * Recompute the run from the log and compare EXACT integer score.
   * seedLabel is already validated by the caller (chain-derived); stageIdx is
   * the chain-bound one for stage mode.
   */
  async verifyRun(opts: {
    build: string;
    stageMode: 'full' | 'stage';
    stageIdx: number | null;
    seedLabel: string;
    masks: Uint8Array;
    score: number;
  }): Promise<ReplayCheck> {
    const engP = this.loadBundle(opts.build);
    if (!engP) return { ok: false, reason: 'BUILD UNKNOWN TO THE ORACLE', status: 400 };
    let eng: ReplayEngine;
    try {
      eng = await engP;
    } catch {
      return { ok: false, reason: 'replay bundle failed to load', status: 500 };
    }
    let result: ReplayResult;
    try {
      const game = bootGame(eng);
      if (opts.stageMode === 'stage') startDescent(game, opts.stageIdx ?? 0, opts.seedLabel);
      else startFullRunSeeded(eng, game, opts.seedLabel);
      result = replayMasks(game, opts.masks, this.timeoutMs);
    } catch (e) {
      if (e instanceof ReplayTimeoutError) return { ok: false, reason: 'REPLAY TIMEOUT - RETRY', status: 500 };
      throw e; // engine crash = genuine internal error (500 via onError)
    }
    if (result.score !== opts.score) return { ok: false, reason: 'REPLAY MISMATCH', status: 400 };
    return { ok: true, result };
  }
}
