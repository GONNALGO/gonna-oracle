// §3.4 continue receipts, §2/§3.5 rate limiting, §2 boot asserts.
import { describe, expect, it } from 'vitest';
import algosdk from 'algosdk';
import { ORACLE, PLAYER_A, PLAYER_B, StubChain, mkFixture, testConfig } from './helpers.js';
import { bootChecks } from '../src/index.js';
import { signerFromMnemonic } from '../src/sign.js';

describe('continue receipt endpoint', () => {
  it('registers a verified receipt once; 409 on replay', async () => {
    const f = mkFixture({ continueOk: true });
    const body = { refId: 'r-100', addr: PLAYER_A.addr, txid: 'T'.repeat(52) };
    const r1 = await f.post('/v1/continue/receipt', body);
    expect(r1.status).toBe(200);
    expect(r1.json['ok']).toBe(true);
    const r2 = await f.post('/v1/continue/receipt', body, '203.0.113.50');
    expect(r2.status).toBe(409);
    expect(String(r2.json['error'])).toMatch(/already registered/);
  });

  it('rejects when the payment does not verify on-chain', async () => {
    const f = mkFixture({ continueOk: false });
    const r = await f.post('/v1/continue/receipt', { refId: 'r-101', addr: PLAYER_A.addr, txid: 'U'.repeat(52) });
    expect(r.status).toBe(400);
    expect(String(r.json['error'])).toMatch(/not verified/);
    expect(f.store.getReceipt('r-101')).toBeNull();
  });

  it('rejects malformed bodies and bad addresses', async () => {
    const f = mkFixture({});
    expect((await f.post('/v1/continue/receipt', { refId: 'x' })).status).toBe(400);
    expect((await f.post('/v1/continue/receipt', { refId: 'x', addr: 'BAD', txid: 'V'.repeat(52) })).status).toBe(400);
  });

  it('txid uniqueness: the same payment cannot back two receipts', async () => {
    const f = mkFixture({ continueOk: true });
    const txid = 'W'.repeat(52);
    expect((await f.post('/v1/continue/receipt', { refId: 'r-1', addr: PLAYER_A.addr, txid })).status).toBe(200);
    const r2 = await f.post('/v1/continue/receipt', { refId: 'r-2', addr: PLAYER_B.addr, txid }, '203.0.113.51');
    expect(r2.status).toBe(409);
  });
});

describe('rate limiting (429 + Retry-After)', () => {
  it('limits per IP on /v1/verdict', async () => {
    const f = mkFixture({}, { ratePerMinIp: 3, ratePerMinAddr: 100 });
    let last = 0;
    let retryAfter: string | null = null;
    for (let i = 0; i < 4; i++) {
      const r = await f.post('/v1/verdict', { cid: 1 });
      last = r.status;
      retryAfter = r.retryAfter;
    }
    expect(last).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(60);
  });

  it('limits per addr on /v1/sign-score independently of IP', async () => {
    const f = mkFixture({ nextChallengeId: 50 }, { ratePerMinIp: 100, ratePerMinAddr: 2 });
    const body = { cid: 50, seat: 0, addr: PLAYER_A.addr, score: 1, stageMode: 'full', build: 'b', run: { seedLabel: 's', frames: 600, durationSec: 10 } };
    const r1 = await f.post('/v1/sign-score', body, '198.51.100.1');
    const r2 = await f.post('/v1/sign-score', body, '198.51.100.2'); // different IP, same addr
    const r3 = await f.post('/v1/sign-score', body, '198.51.100.3');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(String(r3.json['error'])).toMatch(/addr/);
    expect(Number(r3.retryAfter)).toBeGreaterThan(0);
  });

  it('different addrs are not affected by each other', async () => {
    const f = mkFixture({ nextChallengeId: 50 }, { ratePerMinIp: 100, ratePerMinAddr: 1 });
    const mk = (addr: string) => ({ cid: 50, seat: 0, addr, score: 1, stageMode: 'full', build: 'b', run: { seedLabel: 's', frames: 600, durationSec: 10 } });
    expect((await f.post('/v1/sign-score', mk(PLAYER_A.addr))).status).toBe(200);
    expect((await f.post('/v1/sign-score', mk(PLAYER_B.addr))).status).toBe(200);
    expect((await f.post('/v1/sign-score', mk(PLAYER_A.addr))).status).toBe(429);
  });
});

describe('boot asserts (SPEC §2)', () => {
  const cfg = testConfig();

  it('passes when derived key and treasury match the global state', async () => {
    const chain = new StubChain({});
    await expect(bootChecks(cfg, chain, signerFromMnemonic(ORACLE.mnemonic))).resolves.toBeUndefined();
  });

  it('refuses to start when the key does not match oracle_pub_key', async () => {
    const chain = new StubChain({});
    chain.gs = { ...chain.gs, oraclePubKey: PLAYER_A.pk };
    await expect(bootChecks(cfg, chain, signerFromMnemonic(ORACLE.mnemonic))).rejects.toThrow(/oracle/);
  });

  it('refuses to start when TREASURY_ADDR mismatches the global state', async () => {
    const chain = new StubChain({});
    chain.gs = { ...chain.gs, treasury: PLAYER_B.pk };
    await expect(bootChecks(cfg, chain, signerFromMnemonic(ORACLE.mnemonic))).rejects.toThrow(/treasury/i);
  });

  it('refuses to start on a non-v2 app', async () => {
    const chain = new StubChain({});
    chain.gs = { ...chain.gs, version: 1 };
    await expect(bootChecks(cfg, chain, signerFromMnemonic(ORACLE.mnemonic))).rejects.toThrow(/version/);
  });

  it('mnemonic roundtrip: derived address equals account address (seed slicing)', () => {
    const acct = algosdk.generateAccount();
    const mn = algosdk.secretKeyToMnemonic(acct.sk);
    const signer = signerFromMnemonic(mn);
    expect(signer.addr).toBe(acct.addr.toString());
    expect(Buffer.from(signer.publicKey).equals(Buffer.from(acct.addr.publicKey))).toBe(true);
  });
});

describe('health', () => {
  it('exposes only public data', async () => {
    const f = mkFixture({});
    const res = await f.app.fetch(new Request('http://test/v1/health'));
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j['ok']).toBe(true);
    expect(j['network']).toBe('testnet');
    expect(j['appId']).toBe(769767443);
    expect(j['oracleAddr']).toBe(ORACLE.addr);
    expect(typeof j['uptimeSec']).toBe('number');
    expect(JSON.stringify(j)).not.toMatch(/mnemonic|seed/i);
  });
});

describe('CORS', () => {
  it('allows only the configured origin', async () => {
    const f = mkFixture({});
    const good = await f.app.fetch(new Request('http://test/v1/health', { headers: { origin: 'https://gonna.bond' } }));
    expect(good.headers.get('access-control-allow-origin')).toBe('https://gonna.bond');
    const bad = await f.app.fetch(new Request('http://test/v1/health', { headers: { origin: 'https://evil.example' } }));
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
});
