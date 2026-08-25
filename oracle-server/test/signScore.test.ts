// §3.2 sign-score: every rule in positive and negative, chain stubbed.
import { describe, expect, it } from 'vitest';
import algosdk from 'algosdk';
import nacl from 'tweetnacl';
import {
  ORACLE,
  PLAYER_A,
  PLAYER_B,
  mkFixture,
  mkMeta,
  mkPlayer,
  signScoreBody,
  validRun,
} from './helpers.js';
import { scoreMsg } from '../src/sign.js';
import type { StubChainOpts } from './helpers.js';
import { b64decode, b64encode } from '../src/util.js';
import { encodeInputLog } from '../src/verify.js';

const NOW = 1_800_000_000;

function openDuel(opts: { stageMode?: number; deadline?: bigint; status?: number } = {}): { cid: number; chainOpts: StubChainOpts } {
  const cid = 42;
  return {
    cid,
    chainOpts: {
      metas: {
        [cid]: mkMeta({
          stageMode: opts.stageMode ?? 0,
          status: opts.status ?? 0,
          deadline: opts.deadline ?? BigInt(NOW + 86_400),
          seatsTotal: 1n,
          seatsTaken: 1n,
        }),
      },
      players: { [cid]: [mkPlayer(PLAYER_A.pk, 0n, false), mkPlayer(PLAYER_B.pk, 0n, false)] },
      stages: { [cid]: { stage: 3, source: 'note' as const } },
      nowSec: NOW,
    },
  };
}

function expectValidSig(f: ReturnType<typeof mkFixture>, json: Record<string, unknown>, body: Record<string, unknown>): void {
  const sigB64 = json['sigB64'] as string;
  expect(typeof sigB64).toBe('string');
  const sig = b64decode(sigB64)!;
  expect(sig.length).toBe(64);
  const msg = scoreMsg(f.cfg.appId, body['cid'] as number, body['seat'] as number, algosdk.decodeAddress(body['addr'] as string).publicKey, body['score'] as number);
  expect(nacl.sign.detached.verify(msg, sig, ORACLE.pk)).toBe(true);
  expect(json['oracleAddr']).toBe(ORACLE.addr);
}

describe('sign-score happy path', () => {
  it('signs a valid joiner score and persists the sig row', async () => {
    const { cid, chainOpts } = openDuel();
    const f = mkFixture(chainOpts);
    const body = signScoreBody({ cid, seat: 1, addr: PLAYER_B.addr, score: 123_456 });
    const r = await f.post('/v1/sign-score', body);
    expect(r.status).toBe(200);
    expectValidSig(f, r.json, body);
    const row = f.store.getSig(cid, 1);
    expect(row).not.toBeNull();
    expect(row!.score).toBe(123_456);
    expect(row!.addr).toBe(PLAYER_B.addr);
    expect(row!.ip).toBe('203.0.113.7');
  });

  it('signs for seat 0 only when cid == next_challenge_id', async () => {
    const f = mkFixture({ nextChallengeId: 50 });
    const body = signScoreBody({ cid: 50, seat: 0, addr: PLAYER_A.addr, score: 10_000 });
    const r = await f.post('/v1/sign-score', body);
    expect(r.status).toBe(200);
    expectValidSig(f, r.json, body);
  });
});

describe('rule 1 — chain truth', () => {
  it('rejects cid drift for seat 0', async () => {
    const f = mkFixture({ nextChallengeId: 50 });
    const r = await f.post('/v1/sign-score', signScoreBody({ cid: 49, seat: 0, addr: PLAYER_A.addr }));
    expect(r.status).toBe(409);
    expect(String(r.json['error'])).toMatch(/cid drift/);
  });

  it('rejects unknown challenge for seat > 0', async () => {
    const f = mkFixture({ metas: {}, nowSec: NOW });
    const r = await f.post('/v1/sign-score', signScoreBody({ cid: 999 }));
    expect(r.status).toBe(404);
    expect(String(r.json['error'])).toMatch(/not found/);
  });

  it('rejects terminal status', async () => {
    const { cid, chainOpts } = openDuel({ status: 2 });
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid }));
    expect(r.status).toBe(409);
    expect(String(r.json['error'])).toMatch(/not active/);
  });

  it('accepts CLOSED (full table) — contract submit allows it', async () => {
    const { cid, chainOpts } = openDuel({ status: 1 });
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid }));
    expect(r.status).toBe(200);
  });

  it('rejects when addr does not occupy the seat', async () => {
    const { cid, chainOpts } = openDuel();
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid, seat: 1, addr: PLAYER_A.addr }));
    expect(r.status).toBe(400);
    expect(String(r.json['error'])).toMatch(/does not occupy/);
  });

  it('rejects seat beyond roster', async () => {
    const { cid, chainOpts } = openDuel();
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid, seat: 5 }));
    expect(r.status).toBe(400);
    expect(String(r.json['error'])).toMatch(/roster/);
  });

  it('rejects after the join/submit cutoff (deadline-600s)', async () => {
    const { cid, chainOpts } = openDuel({ deadline: BigInt(NOW + 599) });
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid }));
    expect(r.status).toBe(409);
    expect(String(r.json['error'])).toMatch(/cutoff/);
  });

  it('accepts exactly before the cutoff', async () => {
    const { cid, chainOpts } = openDuel({ deadline: BigInt(NOW + 601) });
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid }));
    expect(r.status).toBe(200);
  });

  it('rejects stageMode mismatch with on-chain meta', async () => {
    const { cid, chainOpts } = openDuel({ stageMode: 1 });
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid, stageMode: 'full' }));
    expect(r.status).toBe(400);
    expect(String(r.json['error'])).toMatch(/stageMode/);
  });

  it('rejects random mode cards (v1 oracle)', async () => {
    const { cid, chainOpts } = openDuel({ stageMode: 2 });
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid }));
    expect(r.status).toBe(400);
    expect(String(r.json['error'])).toMatch(/random/);
  });
});

describe('rule 2 — stage binding', () => {
  it('accepts stageIdx matching the create note', async () => {
    const { cid, chainOpts } = openDuel({ stageMode: 1 });
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid, stageMode: 'stage', stageIdx: 3 }));
    expect(r.status).toBe(200);
  });

  it('rejects stageIdx mismatching the create note', async () => {
    const { cid, chainOpts } = openDuel({ stageMode: 1 });
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid, stageMode: 'stage', stageIdx: 4 }));
    expect(r.status).toBe(400);
    expect(String(r.json['error'])).toMatch(/stageIdx/);
  });

  it('accepts the documented cid%7 fallback on pre-note cards', async () => {
    const cid = 41; // 41 % 7 = 6
    const f = mkFixture({
      metas: { [cid]: mkMeta({ stageMode: 1 }) },
      players: { [cid]: [mkPlayer(PLAYER_A.pk, 0n, false), mkPlayer(PLAYER_B.pk, 0n, false)] },
      stages: { [cid]: { stage: 6, source: 'fallback-cid7' } },
      nowSec: NOW,
    });
    const r = await f.post('/v1/sign-score', signScoreBody({ cid, stageMode: 'stage', stageIdx: 6 }));
    expect(r.status).toBe(200);
    const rBad = await f.post('/v1/sign-score', signScoreBody({ cid, stageMode: 'stage', stageIdx: 5 }), '203.0.113.9');
    expect(rBad.status).toBe(400);
  });

  it('fails closed when the indexer scan is unavailable', async () => {
    const { cid, chainOpts } = openDuel({ stageMode: 1 });
    chainOpts.stages = { [cid]: null };
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid, stageMode: 'stage', stageIdx: 3 }));
    expect(r.status).toBe(503);
  });
});

describe('rule 3 — score cap', () => {
  it('accepts score at the cap and rejects above it', async () => {
    const { cid, chainOpts } = openDuel();
    const f = mkFixture(chainOpts);
    const atCap = await f.post('/v1/sign-score', signScoreBody({ cid, score: 2_000_000 }));
    expect(atCap.status).toBe(200);
    const over = await f.post('/v1/sign-score', signScoreBody({ cid, score: 2_000_001 }), '203.0.113.10');
    expect(over.status).toBe(400);
    expect(String(over.json['error'])).toMatch(/cap/);
  });

  it('uses per-stage caps from SCORE_CAPS_JSON', async () => {
    const { cid, chainOpts } = openDuel({ stageMode: 1 });
    const f = mkFixture(chainOpts, { scoreCaps: { full: 2_000_000, stage: [100, 200, 300, 400, 500, 600, 700] } });
    const okR = await f.post('/v1/sign-score', signScoreBody({ cid, stageMode: 'stage', stageIdx: 3, score: 400 }));
    expect(okR.status).toBe(200);
    const over = await f.post('/v1/sign-score', signScoreBody({ cid, stageMode: 'stage', stageIdx: 3, score: 401 }), '203.0.113.11');
    expect(over.status).toBe(400);
  });

  it('rejects non-integer / negative scores at the body gate', async () => {
    const { cid, chainOpts } = openDuel();
    const f = mkFixture(chainOpts);
    for (const score of [-1, 1.5, '1000', null]) {
      const r = await f.post('/v1/sign-score', signScoreBody({ cid, score }));
      expect(r.status).toBe(400);
    }
  });
});

describe('rule 4 — run sanity + input log', () => {
  it('rejects frames < 600', async () => {
    const { cid, chainOpts } = openDuel();
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid, run: validRun(599) }));
    expect(r.status).toBe(400);
    expect(String(r.json['error'])).toMatch(/frames/);
  });

  it('rejects frames > 300000', async () => {
    const { cid, chainOpts } = openDuel();
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid, run: { seedLabel: 'PIT-42', frames: 300_001, durationSec: 999_999 } }));
    expect(r.status).toBe(400);
  });

  it('rejects absurd time compression (duration < frames/60 * 0.5)', async () => {
    const { cid, chainOpts } = openDuel();
    const f = mkFixture(chainOpts);
    const r = await f.post('/v1/sign-score', signScoreBody({ cid, run: { seedLabel: 'PIT-42', frames: 3600, durationSec: 29 } }));
    expect(r.status).toBe(400);
    expect(String(r.json['error'])).toMatch(/duration/);
  });

  it('accepts a structurally valid input log (v1 bitmask)', async () => {
    const { cid, chainOpts } = openDuel();
    const f = mkFixture(chainOpts);
    const frames = 3600;
    const log = encodeInputLog({ build: 'v0TESTBUILD', seedLabel: 'PIT-42', frames }, new Uint8Array(frames).fill(0xaa));
    const r = await f.post('/v1/sign-score', signScoreBody({ cid, run: { ...validRun(frames), inputLogB64: b64encode(log) } }));
    expect(r.status).toBe(200);
  });

  it('rejects garbage base64 / wrong frames / wrong build in the log', async () => {
    const { cid, chainOpts } = openDuel();
    const f = mkFixture(chainOpts);
    const frames = 3600;
    const bad1 = await f.post('/v1/sign-score', signScoreBody({ cid, run: { ...validRun(frames), inputLogB64: '!!!notb64!!!' } }));
    expect(bad1.status).toBe(400);
    const wrongFrames = encodeInputLog({ build: 'v0TESTBUILD', seedLabel: 'PIT-42', frames: 1200 }, new Uint8Array(1200));
    const bad2 = await f.post('/v1/sign-score', signScoreBody({ cid, run: { ...validRun(frames), inputLogB64: b64encode(wrongFrames) } }), '203.0.113.12');
    expect(bad2.status).toBe(400);
    expect(String(bad2.json['error'])).toMatch(/frames mismatch/);
    const wrongBuild = encodeInputLog({ build: 'v0OTHER', seedLabel: 'PIT-42', frames }, new Uint8Array(frames));
    const bad3 = await f.post('/v1/sign-score', signScoreBody({ cid, run: { ...validRun(frames), inputLogB64: b64encode(wrongBuild) } }), '203.0.113.13');
    expect(bad3.status).toBe(400);
    expect(String(bad3.json['error'])).toMatch(/build mismatch/);
    const full = encodeInputLog({ build: 'v0TESTBUILD', seedLabel: 'PIT-42', frames }, new Uint8Array(frames));
    const truncated = full.slice(0, full.length - 1); // corrupt: missing one bitmask byte
    const bad4 = await f.post('/v1/sign-score', signScoreBody({ cid, run: { ...validRun(frames), inputLogB64: b64encode(truncated) } }), '203.0.113.14');
    expect(bad4.status).toBe(400);
  });
});

describe('rule 5 — continue receipt (single-use, atomic)', () => {
  it('consumes a valid receipt with the sig, exactly once', async () => {
    const { cid, chainOpts } = openDuel();
    const f = mkFixture(chainOpts);
    f.store.insertReceipt('ref-1', PLAYER_B.addr, 'TXIDONE', NOW);
    const body = signScoreBody({ cid, continueRef: 'ref-1' });
    const r1 = await f.post('/v1/sign-score', body);
    expect(r1.status).toBe(200);
    expect(f.store.getReceipt('ref-1')!.consumed).toBe(true);
    const r2 = await f.post('/v1/sign-score', body, '203.0.113.15');
    expect(r2.status).toBe(409);
    expect(String(r2.json['error'])).toMatch(/already consumed/);
  });

  it('rejects unknown refId, wrong addr, and keeps the receipt unconsumed on addr mismatch', async () => {
    const { cid, chainOpts } = openDuel();
    const f = mkFixture(chainOpts);
    const missing = await f.post('/v1/sign-score', signScoreBody({ cid, continueRef: 'nope' }));
    expect(missing.status).toBe(404);
    f.store.insertReceipt('ref-2', PLAYER_A.addr, 'TXIDTWO', NOW);
    const wrongAddr = await f.post('/v1/sign-score', signScoreBody({ cid, continueRef: 'ref-2' }), '203.0.113.16');
    expect(wrongAddr.status).toBe(409);
    expect(String(wrongAddr.json['error'])).toMatch(/addr mismatch/);
    expect(f.store.getReceipt('ref-2')!.consumed).toBe(false);
  });
});

describe('rule 6 — anti-replay overwrite', () => {
  it('a new score for (cid,seat) overwrites the stored sig', async () => {
    const { cid, chainOpts } = openDuel();
    const f = mkFixture(chainOpts);
    const r1 = await f.post('/v1/sign-score', signScoreBody({ cid, score: 1000 }));
    expect(r1.status).toBe(200);
    const r2 = await f.post('/v1/sign-score', signScoreBody({ cid, score: 2000 }), '203.0.113.17');
    expect(r2.status).toBe(200);
    expect(f.store.getSig(cid, 1)!.score).toBe(2000);
    expect(r2.json['sigB64']).not.toBe(r1.json['sigB64']);
  });
});

describe('body gate', () => {
  it('rejects malformed bodies without touching the chain', async () => {
    const f = mkFixture({});
    const r1 = await f.post('/v1/sign-score', null);
    expect(r1.status).toBe(400);
    const r2 = await f.post('/v1/sign-score', signScoreBody({ addr: 'not-an-address' }));
    expect(r2.status).toBe(400);
    const r3 = await f.post('/v1/sign-score', signScoreBody({ stageMode: 'stage' })); // missing stageIdx
    expect(r3.status).toBe(400);
    const r4 = await f.post('/v1/sign-score', signScoreBody({ stageMode: 'full', stageIdx: 2 }));
    expect(r4.status).toBe(400);
    const r5 = await f.post('/v1/sign-score', 'a string');
    expect(r5.status).toBe(400);
  });

  it('never leaks a stack trace on errors', async () => {
    const f = mkFixture({});
    const r = await f.post('/v1/sign-score', signScoreBody({ cid: 999 }));
    expect(Object.keys(r.json)).toEqual(['error']);
    expect(String(r.json['error'])).not.toMatch(/at |Error:|node_modules/);
  });
});
