// §3.3 verdict: derived entirely from chain; resolvability mirrors
// contract.py:661-672; digest/extra byte rules from SPEC §1.
import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import { ORACLE, PLAYER_A, PLAYER_B, PLAYER_C, TEST_APP_ID, mkFixture, mkMeta, mkPlayer } from './helpers.js';
import type { PlayerEntry } from '../src/chain.js';
import { verdictDigest, verdictExtraStage, verdictMsg } from '../src/sign.js';
import { b64decode } from '../src/util.js';

const NOW = 1_800_000_000;
const CID = 7;

type RosterRow = [addr: Uint8Array, score: bigint, signed: boolean];
function rosterOf(rows: RosterRow[]): PlayerEntry[] {
  return rows.map(([a, s, g]) => mkPlayer(a, s, g));
}

describe('verdict derivation', () => {
  it('signs a FULL verdict over signed players only, in seat order', async () => {
    const roster = rosterOf([
      [PLAYER_A.pk, 111n, true],
      [PLAYER_B.pk, 0n, false], // unsigned: skipped in the digest
      [PLAYER_C.pk, 222n, true],
    ]);
    const f = mkFixture({
      metas: { [CID]: mkMeta({ stageMode: 0, seatsTotal: 2n, seatsTaken: 2n, deadline: BigInt(NOW + 3600) }) },
      players: { [CID]: roster },
      nowSec: NOW,
    });
    // filled (2/2 joiners) but seat 2 unsigned -> not all signed -> blocked pre-deadline
    const early = await f.post('/v1/verdict', { cid: CID });
    expect(early.status).toBe(409);
    // after the deadline with >= 1 signed joiner -> resolvable
    f.chain.nowSec = NOW + 3601;
    const r = await f.post('/v1/verdict', { cid: CID });
    expect(r.status).toBe(200);
    expect(r.json['stageMode']).toBe('full');
    expect(r.json['stageIdx']).toBeNull();
    expect(r.json['playerCount']).toBe(2);
    expect(b64decode(r.json['extraB64'] as string)).toEqual(new Uint8Array(32));
    const digest = verdictDigest([
      { seat: 0, addr: PLAYER_A.pk, score: 111n },
      { seat: 2, addr: PLAYER_C.pk, score: 222n },
    ]);
    expect(b64decode(r.json['digestB64'] as string)).toEqual(digest);
    const sig = b64decode(r.json['verdictSigB64'] as string)!;
    const msg = verdictMsg(TEST_APP_ID, CID, 0, new Uint8Array(32), digest);
    expect(msg.length).toBe(92);
    expect(nacl.sign.detached.verify(msg, sig, ORACLE.pk)).toBe(true);
  });

  it('signs a STAGE verdict with extra = 24x0 | u64be(stageIdx) from the note', async () => {
    const roster = rosterOf([
      [PLAYER_A.pk, 10n, true],
      [PLAYER_B.pk, 20n, true],
    ]);
    const f = mkFixture({
      metas: { [CID]: mkMeta({ stageMode: 1, seatsTotal: 1n, seatsTaken: 1n }) },
      players: { [CID]: roster },
      stages: { [CID]: { stage: 5, source: 'note' } },
      nowSec: NOW,
    });
    const r = await f.post('/v1/verdict', { cid: CID });
    expect(r.status).toBe(200);
    expect(r.json['stageMode']).toBe('stage');
    expect(r.json['stageIdx']).toBe(5);
    const extra = verdictExtraStage(5);
    expect(b64decode(r.json['extraB64'] as string)).toEqual(extra);
    const digest = verdictDigest([
      { seat: 0, addr: PLAYER_A.pk, score: 10n },
      { seat: 1, addr: PLAYER_B.pk, score: 20n },
    ]);
    const sig = b64decode(r.json['verdictSigB64'] as string)!;
    expect(nacl.sign.detached.verify(verdictMsg(TEST_APP_ID, CID, 1, extra, digest), sig, ORACLE.pk)).toBe(true);
  });

  it('immediate resolve when the table is full and everyone signed', async () => {
    const f = mkFixture({
      metas: { [CID]: mkMeta({ status: 1, seatsTotal: 1n, seatsTaken: 1n, deadline: BigInt(NOW + 86_400) }) },
      players: { [CID]: rosterOf([[PLAYER_A.pk, 5n, true], [PLAYER_B.pk, 6n, true]]) },
      nowSec: NOW,
    });
    const r = await f.post('/v1/verdict', { cid: CID });
    expect(r.status).toBe(200);
  });

  it('409 when the card is not resolvable yet', async () => {
    const f = mkFixture({
      metas: { [CID]: mkMeta({ seatsTotal: 1n, seatsTaken: 0n, deadline: BigInt(NOW + 86_400) }) },
      players: { [CID]: rosterOf([[PLAYER_A.pk, 5n, true]]) },
      nowSec: NOW,
    });
    const r = await f.post('/v1/verdict', { cid: CID });
    expect(r.status).toBe(409);
    expect(String(r.json['error'])).toMatch(/not resolvable/);
  });

  it('409 when already resolved (meta box deleted on-chain)', async () => {
    const f = mkFixture({ metas: {}, nowSec: NOW });
    const r = await f.post('/v1/verdict', { cid: 16 });
    expect(r.status).toBe(409);
    expect(String(r.json['error'])).toMatch(/not active/);
  });

  it('409 on deadline-passed card with no signed joiner', async () => {
    const f = mkFixture({
      metas: { [CID]: mkMeta({ seatsTotal: 1n, seatsTaken: 1n, deadline: BigInt(NOW - 10) }) },
      players: { [CID]: rosterOf([[PLAYER_A.pk, 5n, true], [PLAYER_B.pk, 0n, false]]) },
      nowSec: NOW,
    });
    const r = await f.post('/v1/verdict', { cid: CID });
    expect(r.status).toBe(409);
  });

  it('409 on random-mode cards (seed reveal unsupported in v1)', async () => {
    const f = mkFixture({
      metas: { [CID]: mkMeta({ stageMode: 2 }) },
      players: { [CID]: rosterOf([[PLAYER_A.pk, 5n, true]]) },
      nowSec: NOW,
    });
    const r = await f.post('/v1/verdict', { cid: CID });
    expect(r.status).toBe(409);
    expect(String(r.json['error'])).toMatch(/random/);
  });

  it('503 when the stage commitment cannot be verified', async () => {
    const f = mkFixture({
      metas: { [CID]: mkMeta({ stageMode: 1, seatsTotal: 1n, seatsTaken: 1n }) },
      players: { [CID]: rosterOf([[PLAYER_A.pk, 5n, true], [PLAYER_B.pk, 6n, true]]) },
      stages: { [CID]: null },
      nowSec: NOW,
    });
    const r = await f.post('/v1/verdict', { cid: CID });
    expect(r.status).toBe(503);
  });

  it('rejects malformed bodies', async () => {
    const f = mkFixture({});
    expect((await f.post('/v1/verdict', null)).status).toBe(400);
    expect((await f.post('/v1/verdict', { cid: -1 })).status).toBe(400);
    expect((await f.post('/v1/verdict', { cid: 'x' })).status).toBe(400);
  });
});
