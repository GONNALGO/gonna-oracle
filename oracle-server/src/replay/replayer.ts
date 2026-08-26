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
//   - intro STEPPED THROUGH (fixed 151-frame title card; GIL v2 frame 0 =
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

export class ReplayStuckError extends Error {
  constructor() {
    super('driver stuck in non-play scene');
    this.name = 'ReplayStuckError';
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

/** Stage run boot — the EXACT arena stage-mode client entry (v16.1). */
export function startStageRun(game: any, stageIdx: number, seedLabel: string): void {
  game.startArenaRun('stage', stageIdx, { seedTag: seedLabel });
}

/**
 * FULL RUN (campaign) seeded boot — the EXACT arena full-mode client entry
 * (SPEC-m2 §4, m2-client): the engine self-installs ONE
 * makeRngFromLabel(seedLabel) campaign stream for the whole run
 * (startArenaRun -> loadStage -> this.rng = arenaRunRng ?? mathRng).
 * RNG parity: makeRngFromLabel(label) === makeRng(hashSeed(label)) (rng.ts).
 */
export function startFullRunSeeded(eng: ReplayEngine, game: any, seedLabel: string): void {
  game.debugFullRun(seedLabel); // scene 'intro'; the replay driver force-skips
}

export interface ReplayResult {
  score: number;
  playFrames: number;
  steps: number;
  stageIdx: number;
  scene: string;
  elapsedMs: number;
}

/**
 * Scene-aware replay driver — the M2 replay CONTRACT, promoted verbatim from
 * the client reference (scripts/test-v1610.mjs replayCampaign). GIL v2 log
 * frames are PLAY-scene frames ONLY:
 *   - intro: stepped through (fixed 151 frames, unskippable), consumes no mask;
 *   - clear tally / victory: auto START (player mashing START — the bonus
 *     lands the instant the press registers), consumes no mask;
 *   - play: consume one mask (levels + rising-edge pressed), step.
 * Cooperative wall-clock guard every 1024 steps (budget 0 = abort at the
 * first checkpoint — deterministic in tests). In-process by design for M2
 * (frame cap 300k + rate limits); worker_threads isolation = M3 hardening.
 */
export function replayCampaign(game: any, masks: Uint8Array, timeoutMs: number): ReplayResult {
  const down = game.input.down;
  const pressed = game.input.pressed;
  const t0 = Date.now();
  let i = 0;
  let steps = 0;
  while (i < masks.length) {
    if (++steps > masks.length * 4 + 20000) throw new ReplayStuckError();
    if ((steps & 0x3ff) === 0 && Date.now() - t0 >= timeoutMs) throw new ReplayTimeoutError();
    const sc = game.scene;
    if (sc === 'intro') {
      game.step(); // faithful: the real client stepped these 151 frames (D-E2E)
      continue;
    }
    if (sc === 'clear' || sc === 'victory') {
      game.input.pressed.start = true;
      game.step();
      continue;
    }
    if (sc !== 'play') {
      game.step();
      continue;
    }
    const m = masks[i++]!;
    for (let b = 0; b < 8; b++) {
      const v = ((m >> b) & 1) === 1;
      if (v && !down[BTNS[b]!]) pressed[BTNS[b]!] = true;
      down[BTNS[b]!] = v;
    }
    game.step();
  }
  return {
    score: game.score,
    playFrames: i,
    steps,
    stageIdx: game.stageIdx,
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
      // the engine's recorder stamps sealed logs with buildVer() ==
      // globalThis.__GONNA_VER (fallback 'DEV') — pin it to THIS bundle so the
      // artifact behaves exactly like the released client build <VER>
      (globalThis as Record<string, unknown>)['__GONNA_VER'] = build;
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
      (globalThis as Record<string, unknown>)['__GONNA_VER'] = opts.build; // per-request pin (multi-bundle processes)
      const game = bootGame(eng);
      // EXACT client boot entries (v16.1): same scene/RNG wiring as the live run
      if (opts.stageMode === 'stage') startStageRun(game, opts.stageIdx ?? 0, opts.seedLabel);
      else startFullRunSeeded(eng, game, opts.seedLabel);
      result = replayCampaign(game, opts.masks, this.timeoutMs);
    } catch (e) {
      if (e instanceof ReplayTimeoutError) return { ok: false, reason: 'REPLAY TIMEOUT - RETRY', status: 500 };
      if (e instanceof ReplayStuckError) return { ok: false, reason: 'REPLAY MISMATCH', status: 400 }; // log never reaches a play frame for the tail masks
      throw e; // engine crash = genuine internal error (500 via onError)
    }
    if (result.score !== opts.score) return { ok: false, reason: 'REPLAY MISMATCH', status: 400 };
    return { ok: true, result };
  }
}
