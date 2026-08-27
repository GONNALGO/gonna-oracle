// replayVerify.test.ts — M2 replay verification in /v1/sign-score (SPEC-m2
// §5, §9). Uses the REAL committed bundle fixture
// (oracle-server/replay-bundles/engine-<VER>.mjs, built by
// scripts/build-replay-bundle.mjs): honest runs are actually PLAYED headless
// by the server-side replayer, then submitted for signature.
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { mkFixture, mkMeta, mkPlayer, PLAYER_A, PLAYER_B, testConfig, StubChain, ORACLE } from './helpers.js';
import { signerFromMnemonic } from '../src/sign.js';
import { bootChecks } from '../src/index.js';
import { encodeInputLog } from '../src/verify.js';
import { ReplayVerifier, bootGame, startStageRun, startFullRunSeeded, type ReplayEngine } from '../src/replay/replayer.js';
import { b64encode } from '../src/util.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../replay-bundles');
// the committed fixture bundle for the current tree build (v16.1 engine)
const VER = 'v002d77d0';
const FRAMES = 3600;

const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'] as const;

/**
 * Produce an HONEST v2 log through the REAL client path: boot via the exact
 * arena entries (startArenaRun / debugFullRun), feed a continuous input
 * stream (every step, like a live player), let the v16.1 recorder capture
 * PLAY-scene frames only. Returns the recorded masks + the score the client
 * would seal. The server must replay this to the same score.
 */
function recordRun(eng: ReplayEngine, boot: (g: any) => void, stream: Uint8Array): { masks: Uint8Array; score: number } {
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
  // sealed mid-stream (death): the recorder buffer is gone — read the REAL
  // sealed artifact instead (same thing the client would submit)
  const sealed = game.arena?.sealedRun;
  if (sealed?.inputLogB64) {
    const dec = eng.decodeInputLogB64(sealed.inputLogB64);
    return { masks: dec.masks, score: game.score };
  }
  const n: number = game.inputLogFrames ?? 0;
  return { masks: Uint8Array.from(game.inputLogMasks.subarray(0, n)), score: game.score };
}

const BTN_BIT: Record<string, number> = { up: 1, down: 2, left: 4, right: 8, punch: 16, kick: 32, jump: 64, special: 128 };

// level tape -> per-frame masks (same fixture rhythm as the M2-0 spike)
function tapeToMasks(tape: Array<{ f: number; down: Record<string, boolean> }>, frames: number): Uint8Array {
  const masks = new Uint8Array(frames);
  const level: Record<string, boolean> = {};
  let ti = 0;
  const sorted = [...tape].sort((a, b) => a.f - b.f);
  for (let f = 0; f < frames; f++) {
    while (ti < sorted.length && sorted[ti]!.f <= f) {
      const ev = sorted[ti++]!;
      for (const k of Object.keys(ev.down)) level[k] = ev.down[k]!;
    }
    let m = 0;
    for (const k of Object.keys(level)) if (level[k]) m |= BTN_BIT[k]!;
    masks[f] = m;
  }
  return masks;
}

function buildTape(frames: number): Array<{ f: number; down: Record<string, boolean> }> {
  const tape: Array<{ f: number; down: Record<string, boolean> }> = [];
  const tap = (f: number, btn: string, hold = 2) => {
    tape.push({ f, down: { [btn]: true } });
    tape.push({ f: f + hold, down: { [btn]: false } });
  };
  for (let f = 0; f < frames; f += 90) {
    tape.push({ f, down: { right: true } });
    tape.push({ f: f + 30, down: { right: false } });
    tap(f + 34, 'punch');
    tap(f + 42, 'punch');
    tap(f + 50, 'kick');
    tape.push({ f: f + 60, down: { right: true } });
    if ((f / 90) % 4 === 2) tap(f + 12, 'jump', 20);
    if ((f / 90) % 7 === 3) tap(f + 20, 'special');
  }
  return tape;
}

function gilV2(build: string, seedLabel: string, masks: Uint8Array, truncated = false): string {
  return b64encode(encodeInputLog({ v: 2, build, seedLabel, frames: masks.length, truncated }, masks));
}

// ---- chain fixture: open duel cid 42, PLAYER_B in seat 1, stage 2 committed
function stageChain(nextChallengeId = 50): StubChain {
  return new StubChain({
    nextChallengeId,
    metas: { 42: mkMeta({ stageMode: 1 }) },
    players: { 42: [mkPlayer(PLAYER_A.pk, 0n, false), mkPlayer(PLAYER_B.pk, 0n, false)] },
    stages: { 42: { stage: 2, source: 'note' } },
  });
}

let eng: ReplayEngine;
let verifier: ReplayVerifier;
// honest runs, actually replayed once here and asserted through the API below
let stage: { masks: Uint8Array; score: number; gil: string };
let full: { masks: Uint8Array; score: number; gil: string };
let create0: { masks: Uint8Array; score: number; gil: string };

beforeAll(async () => {
  verifier = new ReplayVerifier({ bundlesDir: BUNDLES_DIR, timeoutMs: 30_000 });
  const p = verifier.loadBundle(VER);
  if (!p) throw new Error(`fixture bundle engine-${VER}.mjs missing — run: node scripts/build-replay-bundle.mjs ${VER}`);
  eng = await p;

  const stream = tapeToMasks(buildTape(FRAMES), FRAMES);
  { // stage mode: DESCENT 'PIT-42' on stage 2 — real client path + recorder
    const r = recordRun(eng, (g) => startStageRun(g, 2, 'PIT-42'), stream);
    stage = { masks: r.masks, score: r.score, gil: eng.encodeInputLogB64({ v: 2, build: VER, seedLabel: 'PIT-42', frames: r.masks.length, truncated: false, masks: r.masks }) };
    if (stage.masks.length < 600) throw new Error('stage fixture too short: ' + stage.masks.length);
  }
  { // full mode: seeded campaign 'RUN-42' — real client path + recorder
    const r = recordRun(eng, (g) => startFullRunSeeded(eng, g, 'RUN-42'), stream);
    full = { masks: r.masks, score: r.score, gil: eng.encodeInputLogB64({ v: 2, build: VER, seedLabel: 'RUN-42', frames: r.masks.length, truncated: false, masks: r.masks }) };
    if (full.masks.length < 600) throw new Error('full fixture too short: ' + full.masks.length);
  }
  { // create flow seat 0: cid = next_challenge_id = 50 -> 'PIT-50'
    const r = recordRun(eng, (g) => startStageRun(g, 2, 'PIT-50'), stream);
    create0 = { masks: r.masks, score: r.score, gil: eng.encodeInputLogB64({ v: 2, build: VER, seedLabel: 'PIT-50', frames: r.masks.length, truncated: false, masks: r.masks }) };
  }
}, 120_000);

const CFG = { replayEnforce: true, ratePerMinIp: 1000, ratePerMinAddr: 100 };

const dur = (frames: number): number => Math.ceil(frames / 60) + 2;

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cid: 42,
    seat: 1,
    addr: PLAYER_B.addr,
    score: stage.score,
    stageMode: 'stage',
    stageIdx: 2,
    build: VER,
    run: { seedLabel: 'PIT-42', frames: stage.masks.length, durationSec: dur(stage.masks.length), inputLogB64: stage.gil },
    ...over,
  };
}

describe('M2 replay verification (SPEC-m2 §5)', () => {
  it('positive stage-mode: honest replayed run is signed', async () => {
    const f = mkFixture({}, CFG);
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body());
    expect(r.status).toBe(200);
    expect(typeof r.json['sigB64']).toBe('string');
  }, 60_000);

  it('positive create flow (seat 0, cid == next_challenge_id)', async () => {
    const f = mkFixture({ nextChallengeId: 50 }, CFG);
    const r = await f.post('/v1/sign-score', {
      cid: 50,
      seat: 0,
      addr: PLAYER_A.addr,
      score: create0.score,
      stageMode: 'stage',
      stageIdx: 2,
      build: VER,
      run: { seedLabel: 'PIT-50', frames: create0.masks.length, durationSec: dur(create0.masks.length), inputLogB64: create0.gil },
    });
    expect(r.status).toBe(200);
    expect(typeof r.json['sigB64']).toBe('string');
  }, 60_000);

  it('positive full-mode: seeded campaign RUN-42 replay is signed (server-side mirror; client parity pending m2-client)', async () => {
    const f = mkFixture({}, CFG);
    f.chain.metas = { 42: mkMeta({ stageMode: 0 }) };
    f.chain.players = stageChain().players;
    const r = await f.post('/v1/sign-score', {
      cid: 42,
      seat: 1,
      addr: PLAYER_B.addr,
      score: full.score,
      stageMode: 'full',
      build: VER,
      run: { seedLabel: 'RUN-42', frames: full.masks.length, durationSec: dur(full.masks.length), inputLogB64: full.gil },
    });
    expect(r.status).toBe(200);
    expect(typeof r.json['sigB64']).toBe('string');
  }, 60_000);

  it('negative: one flipped bit in the log -> REPLAY MISMATCH', async () => {
    const bad = Uint8Array.from(stage.masks);
    bad[10] = bad[10]! ^ 0x08; // early 'right' movement: perturbs the whole trajectory
    const f = mkFixture({}, CFG);
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body({ run: { seedLabel: 'PIT-42', frames: stage.masks.length, durationSec: dur(stage.masks.length), inputLogB64: gilV2(VER, 'PIT-42', bad) } }));
    expect(r.status).toBe(400);
    expect(r.json['error']).toBe('REPLAY MISMATCH');
  }, 60_000);

  it('negative: inflated score -> REPLAY MISMATCH', async () => {
    const f = mkFixture({}, CFG);
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body({ score: stage.score + 1 }));
    expect(r.status).toBe(400);
    expect(r.json['error']).toBe('REPLAY MISMATCH');
  }, 60_000);

  it('negative: unknown build -> BUILD UNKNOWN TO THE ORACLE', async () => {
    const gil = gilV2('vNOPE0000', 'PIT-42', stage.masks);
    const f = mkFixture({}, CFG);
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body({ build: 'vNOPE0000', run: { seedLabel: 'PIT-42', frames: stage.masks.length, durationSec: dur(stage.masks.length), inputLogB64: gil } }));
    expect(r.status).toBe(400);
    expect(r.json['error']).toBe('BUILD UNKNOWN TO THE ORACLE');
  });

  it('negative: truncated log -> RUN LOG TRUNCATED', async () => {
    const gil = gilV2(VER, 'PIT-42', stage.masks, true);
    const f = mkFixture({}, CFG);
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body({ run: { seedLabel: 'PIT-42', frames: stage.masks.length, durationSec: dur(stage.masks.length), inputLogB64: gil } }));
    expect(r.status).toBe(400);
    expect(r.json['error']).toBe('RUN LOG TRUNCATED');
  });

  it('negative: wrong seedLabel -> SEED MISMATCH', async () => {
    const gil = gilV2(VER, 'PIT-999', stage.masks);
    const f = mkFixture({}, CFG);
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body({ run: { seedLabel: 'PIT-999', frames: stage.masks.length, durationSec: dur(stage.masks.length), inputLogB64: gil } }));
    expect(r.status).toBe(400);
    expect(r.json['error']).toBe('SEED MISMATCH');
  });

  it('legacy v1: allowed when ALLOW_LEGACY_GIL=1 (M1 structural path, no replay)', async () => {
    const gil = b64encode(encodeInputLog({ build: VER, seedLabel: 'PIT-42', frames: stage.masks.length }, stage.masks)); // v1
    const f = mkFixture({}, CFG);
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body({ score: 100_000, run: { seedLabel: 'PIT-42', frames: stage.masks.length, durationSec: dur(stage.masks.length), inputLogB64: gil } }));
    expect(r.status).toBe(200);
    expect(typeof r.json['sigB64']).toBe('string');
  });

  it('legacy v1: refused when ALLOW_LEGACY_GIL=0 -> LEGACY LOG REFUSED', async () => {
    const gil = b64encode(encodeInputLog({ build: VER, seedLabel: 'PIT-42', frames: stage.masks.length }, stage.masks));
    const f = mkFixture({}, { ...CFG, allowLegacyGil: false });
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body({ run: { seedLabel: 'PIT-42', frames: stage.masks.length, durationSec: dur(stage.masks.length), inputLogB64: gil } }));
    expect(r.status).toBe(400);
    expect(r.json['error']).toBe('LEGACY LOG REFUSED');
  });

  it('negative: no input log under enforcement -> RUN LOG REQUIRED', async () => {
    const f = mkFixture({}, CFG);
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body({ run: { seedLabel: 'PIT-42', frames: stage.masks.length, durationSec: dur(stage.masks.length) } }));
    expect(r.status).toBe(400);
    expect(r.json['error']).toBe('RUN LOG REQUIRED');
  });

  it('recovery mode REPLAY_ENFORCE=0: M1 structural-only path (no log needed)', async () => {
    const f = mkFixture({}, { replayEnforce: false, ratePerMinIp: 1000, ratePerMinAddr: 100 });
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body({ run: { seedLabel: 'PIT-42', frames: stage.masks.length, durationSec: dur(stage.masks.length) } }));
    expect(r.status).toBe(200);
    expect(typeof r.json['sigB64']).toBe('string');
  });

  it('wall-clock guard: replayTimeoutMs 0 -> 500 REPLAY TIMEOUT - RETRY', async () => {
    const f = mkFixture({}, { ...CFG, replayTimeoutMs: 0 });
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body());
    expect(r.status).toBe(500);
    expect(r.json['error']).toBe('REPLAY TIMEOUT - RETRY');
  }, 60_000);
});

// SEV follow-up: every M2 refusal must emit ONE structured console.warn line
// (ops visibility) without breaking the flow and without sensitive data.
describe('M2 reject telemetry (console.warn)', () => {
  afterEach(() => vi.restoreAllMocks());

  function lastWarn(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]![0] as string;
    return JSON.parse(line) as Record<string, unknown>;
  }

  it('REPLAY MISMATCH (inflated score): logs claimed vs replayed + seeds', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = mkFixture({}, CFG);
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body({ score: stage.score + 1 }));
    expect(r.status).toBe(400);
    expect(r.json['error']).toBe('REPLAY MISMATCH'); // flow unchanged
    const w = lastWarn(spy);
    expect(w['ev']).toBe('sign-score-reject');
    expect(w['reason']).toBe('REPLAY MISMATCH');
    expect(w['cid']).toBe(42);
    expect(w['seat']).toBe(1);
    expect(w['addr']).toBe(PLAYER_B.addr.slice(0, 8)); // truncated, never full
    expect(w['build']).toBe(VER);
    expect(w['seedLabel']).toBe('PIT-42');
    expect(w['gilSeed']).toBe('PIT-42');
    expect(w['expectedSeed']).toBe('PIT-42');
    expect(w['frames']).toBe(stage.masks.length);
    expect(w['claimedScore']).toBe(stage.score + 1);
    expect(w['replayedScore']).toBe(stage.score); // recomputed by the oracle
    expect(typeof w['playFrames']).toBe('number');
    expect(JSON.stringify(w)).not.toContain(PLAYER_B.addr); // no full address
  }, 60_000);

  it('LEGACY LOG REFUSED: logs gil version + seed', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gil = b64encode(encodeInputLog({ build: VER, seedLabel: 'PIT-42', frames: stage.masks.length }, stage.masks));
    const f = mkFixture({}, { ...CFG, allowLegacyGil: false });
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body({ run: { seedLabel: 'PIT-42', frames: stage.masks.length, durationSec: dur(stage.masks.length), inputLogB64: gil } }));
    expect(r.status).toBe(400);
    expect(r.json['error']).toBe('LEGACY LOG REFUSED');
    const w = lastWarn(spy);
    expect(w['reason']).toBe('LEGACY LOG REFUSED');
    expect(w['gilVersion']).toBe(1);
    expect(w['gilSeed']).toBe('PIT-42');
  });

  it('SEED MISMATCH: logs gil seed vs derived expected seed', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gil = gilV2(VER, 'PIT-999', stage.masks);
    const f = mkFixture({}, CFG);
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body({ run: { seedLabel: 'PIT-999', frames: stage.masks.length, durationSec: dur(stage.masks.length), inputLogB64: gil } }));
    expect(r.status).toBe(400);
    expect(r.json['error']).toBe('SEED MISMATCH');
    const w = lastWarn(spy);
    expect(w['reason']).toBe('SEED MISMATCH');
    expect(w['gilSeed']).toBe('PIT-999');
    expect(w['expectedSeed']).toBe('PIT-42');
  });

  it('REPLAY TIMEOUT: logs timeout marker, flow unchanged (500)', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = mkFixture({}, { ...CFG, replayTimeoutMs: 0 });
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body());
    expect(r.status).toBe(500);
    expect(r.json['error']).toBe('REPLAY TIMEOUT - RETRY');
    const w = lastWarn(spy);
    expect(w['reason']).toBe('REPLAY TIMEOUT - RETRY');
    expect(String(w['replayedScore'])).toMatch(/^timeout/); // 'timeout@<partial>' when the engine had booted
  }, 60_000);

  it('RUN LOG REQUIRED: logged as well', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = mkFixture({}, CFG);
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body({ run: { seedLabel: 'PIT-42', frames: stage.masks.length, durationSec: dur(stage.masks.length) } }));
    expect(r.status).toBe(400);
    expect(r.json['error']).toBe('RUN LOG REQUIRED');
    expect(lastWarn(spy)['reason']).toBe('RUN LOG REQUIRED');
  });

  it('honest run: NO warn emitted', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = mkFixture({}, CFG);
    f.chain.metas = stageChain().metas;
    f.chain.players = stageChain().players;
    f.chain.stages = stageChain().stages;
    const r = await f.post('/v1/sign-score', body());
    expect(r.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  }, 60_000);
});

describe('M2 boot assert (SPEC-m2 §6)', () => {
  it('boot fails when enforcement is on but no bundle exists', async () => {
    const cfg = testConfig({ replayEnforce: true, replayBundlesDir: '/nonexistent-bundles-dir' });
    const chain = new StubChain();
    await expect(bootChecks(cfg, chain, signerFromMnemonic(ORACLE.mnemonic))).rejects.toThrow(/engine bundles/);
  });

  it('boot passes with the fixture bundle present', async () => {
    const cfg = testConfig({ replayEnforce: true, replayBundlesDir: BUNDLES_DIR });
    const chain = new StubChain();
    await expect(bootChecks(cfg, chain, signerFromMnemonic(ORACLE.mnemonic))).resolves.toBeUndefined();
  });

  it('boot passes without bundles when enforcement is off (recovery)', async () => {
    const cfg = testConfig({ replayEnforce: false, replayBundlesDir: '/nonexistent-bundles-dir' });
    const chain = new StubChain();
    await expect(bootChecks(cfg, chain, signerFromMnemonic(ORACLE.mnemonic))).resolves.toBeUndefined();
  });
});
