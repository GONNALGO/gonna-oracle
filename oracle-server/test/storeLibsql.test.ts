// storeLibsql.test.ts — the libsql backend (SEV-2b) must behave EXACTLY like
// the local SQLite Store for the receipt-critical paths. Uses the file:
// driver (no Turso server/creds needed); TURSO_URL in production points at
// libsql://<db>-<org>.turso.io with the same code path.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LibsqlStore } from '../src/store-libsql.js';
import type { SigRow } from '../src/store.js';

const dir = mkdtempSync(path.join(tmpdir(), 'libsql-store-'));
const dbFile = path.join(dir, 'receipts.db');

const SIG: SigRow = {
  cid: 7,
  seat: 1,
  addr: 'ADDR7',
  score: 1234,
  build: 'vTEST',
  frames: 7200,
  ts: 1_700_000_000,
  sigB64: 'c2ln',
  ip: '127.0.0.1',
};

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('LibsqlStore (file: driver) — receipt semantics parity with SQLite Store', () => {
  it('insertReceipt dedups refId and txid (caller maps to 409)', async () => {
    const s = await LibsqlStore.connect('file:' + dbFile);
    expect(await s.insertReceipt('r1', 'ADDR7', 'TX1', 100)).toBe(true);
    expect(await s.insertReceipt('r1', 'ADDR7', 'TX1', 100)).toBe(false); // same refId
    expect(await s.insertReceipt('r2', 'ADDR7', 'TX1', 100)).toBe(false); // same txid
    await s.close();
  });

  it('consumeReceiptAndStoreSig: missing / ok / consumed / addr-mismatch', async () => {
    const s = await LibsqlStore.connect('file:' + dbFile);
    expect(await s.consumeReceiptAndStoreSig('nope', 'ADDR7', SIG)).toBe('missing');
    expect(await s.consumeReceiptAndStoreSig('r1', 'SOMEONE-ELSE', SIG)).toBe('addr-mismatch');
    expect(await s.consumeReceiptAndStoreSig('r1', 'ADDR7', SIG)).toBe('ok');
    // atomicity: the sig landed in the same transaction
    expect((await s.getSig(7, 1))?.score).toBe(1234);
    // second consume attempt is refused
    expect(await s.consumeReceiptAndStoreSig('r1', 'ADDR7', { ...SIG, score: 9999 })).toBe('consumed');
    // ...and the sig was NOT overwritten by the refused attempt
    expect((await s.getSig(7, 1))?.score).toBe(1234);
    const r = await s.getReceipt('r1');
    expect(r?.consumed).toBe(true);
    expect(r?.consumedTs).toBe(SIG.ts);
    await s.close();
  });

  it('upsertSig keeps one active sig per (cid,seat), legit score overwrites', async () => {
    const s = await LibsqlStore.connect('file:' + dbFile);
    await s.upsertSig({ ...SIG, cid: 9, seat: 0, score: 10 });
    await s.upsertSig({ ...SIG, cid: 9, seat: 0, score: 20 });
    expect((await s.getSig(9, 0))?.score).toBe(20);
    expect(await s.knownSigCids()).toContain(9);
    await s.close();
  });

  it('rateHit enforces the fixed 60s window', async () => {
    const s = await LibsqlStore.connect('file:' + dbFile);
    const t = 1_700_000_000;
    expect((await s.rateHit('ip:x', 2, t)).allowed).toBe(true);
    expect((await s.rateHit('ip:x', 2, t + 1)).allowed).toBe(true);
    const third = await s.rateHit('ip:x', 2, t + 2);
    expect(third.allowed).toBe(false);
    expect(third.retryAfter).toBeGreaterThan(0);
    // next window resets
    expect((await s.rateHit('ip:x', 2, t + 61)).allowed).toBe(true);
    await s.close();
  });

  it('receiptCount feeds the boot reconciliation warning', async () => {
    const s = await LibsqlStore.connect('file:' + dbFile);
    expect(await s.receiptCount()).toBe(1);
    await s.close();
  });

  it('persistence: a fresh connection sees the same receipts (SEV-2b point)', async () => {
    const s = await LibsqlStore.connect('file:' + dbFile);
    const r = await s.getReceipt('r1');
    expect(r?.consumed).toBe(true);
    expect(await s.receiptCount()).toBe(1);
    await s.close();
  });

  it('connect fails fast on an unreachable backend (boot must refuse)', async () => {
    await expect(LibsqlStore.connect('libsql://nonexistent.invalid')).rejects.toThrow();
  });
});
