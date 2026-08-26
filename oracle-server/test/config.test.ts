// config.test.ts — env parsing for the oracle key source (ORACLE_MNEMONIC_FILE
// preferred, ORACLE_MNEMONIC env fallback — Render automation) and PORT
// (Render injects PORT, default 10000; local default stays 8787).
import { describe, expect, it } from 'vitest';
import { configLogLine, keySource, loadConfig, resolveMnemonic } from '../src/config.js';

const BASE: NodeJS.ProcessEnv = {
  ARENA_NETWORK: 'testnet',
  ARENA_APP_ID: '769907387',
  TREASURY_ADDR: '4OQ3LJ3JW67JEY55TMHLGZG3MWWLTVFZERGY67LBJEJLOGEUUX2PYHQGGM',
};

describe('oracle key source', () => {
  it('boots with ONLY ORACLE_MNEMONIC (env fallback)', () => {
    const cfg = loadConfig({ ...BASE, ORACLE_MNEMONIC: 'word x25' });
    expect(cfg.oracleMnemonic).toBe('word x25');
    expect(cfg.oracleMnemonicFile).toBeUndefined();
    expect(keySource(cfg)).toBe('env');
    expect(resolveMnemonic(cfg)).toBe('word x25');
  });

  it('boots with ONLY ORACLE_MNEMONIC_FILE (preferred)', () => {
    const cfg = loadConfig({ ...BASE, ORACLE_MNEMONIC_FILE: '/etc/secrets/oracle_mnemonic' });
    expect(cfg.oracleMnemonicFile).toBe('/etc/secrets/oracle_mnemonic');
    expect(cfg.oracleMnemonic).toBeUndefined();
    expect(keySource(cfg)).toBe('file');
    const seen: string[] = [];
    const m = resolveMnemonic(cfg, (p) => { seen.push(p); return 'file words'; });
    expect(m).toBe('file words');
    expect(seen).toEqual(['/etc/secrets/oracle_mnemonic']);
  });

  it('FILE wins when BOTH are set (env never even read)', () => {
    const cfg = loadConfig({ ...BASE, ORACLE_MNEMONIC_FILE: '/run/secrets/m', ORACLE_MNEMONIC: 'env words' });
    expect(keySource(cfg)).toBe('file');
    expect(resolveMnemonic(cfg, () => 'file words')).toBe('file words');
  });

  it('throws (boot exit 1) when NEITHER is set', () => {
    expect(() => loadConfig({ ...BASE })).toThrow(/ORACLE_MNEMONIC_FILE.*ORACLE_MNEMONIC/);
  });

  it('never leaks the value into the boot log line', () => {
    const cfg = loadConfig({ ...BASE, ORACLE_MNEMONIC: 'super-secret-words' });
    const line = configLogLine(cfg);
    expect(line).not.toContain('super-secret-words');
    expect(line).toContain('keysrc=env');
  });
});

describe('PORT', () => {
  it('defaults to 8787 when PORT is unset (local dev)', () => {
    const cfg = loadConfig({ ...BASE, ORACLE_MNEMONIC: 'w' });
    expect(cfg.port).toBe(8787);
  });

  it('honours an injected PORT (Render default 10000)', () => {
    const cfg = loadConfig({ ...BASE, ORACLE_MNEMONIC: 'w', PORT: '10000' });
    expect(cfg.port).toBe(10000);
  });

  it('rejects a non-integer PORT', () => {
    expect(() => loadConfig({ ...BASE, ORACLE_MNEMONIC: 'w', PORT: 'abc' })).toThrow(/PORT/);
  });
});

// ---------------------------------------------------------------------------
// M-1 mainnet hardening: NETWORK alias, SEV-1 legacy guard, CORS allow-list,
// Turso receipt persistence envs.
// ---------------------------------------------------------------------------
const MAINNET_BASE: NodeJS.ProcessEnv = {
  NETWORK: 'mainnet',
  ARENA_APP_ID: '0',
  TREASURY_ADDR: 'GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU',
  GONNA_ASA_ID: '2582294183',
  ORACLE_MNEMONIC: 'word x25',
};

describe('M-1 mainnet config', () => {
  it('NETWORK env works as an alias of ARENA_NETWORK (and wins when both set)', () => {
    const cfg = loadConfig({ ...MAINNET_BASE });
    expect(cfg.network).toBe('mainnet');
    const cfg2 = loadConfig({ ...MAINNET_BASE, ARENA_NETWORK: 'testnet' });
    expect(cfg2.network).toBe('mainnet');
  });

  it('SEV-1 guard: mainnet + ALLOW_LEGACY_GIL=1 -> boot throws', () => {
    expect(() => loadConfig({ ...MAINNET_BASE, ALLOW_LEGACY_GIL: '1' })).toThrow(/ALLOW_LEGACY_GIL must be 0 on mainnet/);
  });

  it('SEV-1 guard: mainnet default (unset) is legacy=0 -> boots', () => {
    const cfg = loadConfig({ ...MAINNET_BASE });
    expect(cfg.allowLegacyGil).toBe(false);
  });

  it('SEV-1 guard: testnet default is legacy=0 too (post-flip policy)', () => {
    const cfg = loadConfig({ ...BASE, ORACLE_MNEMONIC: 'word x25' });
    expect(cfg.allowLegacyGil).toBe(false);
  });

  it('mainnet CORS default: gonna.bond + www, NO localhost', () => {
    const cfg = loadConfig({ ...MAINNET_BASE });
    expect(cfg.corsOrigins).toEqual(['https://gonna.bond', 'https://www.gonna.bond']);
    expect(cfg.corsOrigins.join(' ')).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it('ALLOWED_ORIGINS wins over CORS_ORIGIN (both legacy names still work)', () => {
    const cfg = loadConfig({ ...MAINNET_BASE, ALLOWED_ORIGINS: 'https://a.example', CORS_ORIGIN: 'https://b.example' });
    expect(cfg.corsOrigins).toEqual(['https://a.example']);
    const legacy = loadConfig({ ...MAINNET_BASE, CORS_ORIGIN: 'https://b.example' });
    expect(legacy.corsOrigins).toEqual(['https://b.example']);
  });

  it('turso envs are optional and parsed without leaking the token to logs', () => {
    const cfg = loadConfig({ ...MAINNET_BASE, TURSO_URL: 'libsql://db-org.turso.io', TURSO_AUTH_TOKEN: 'secret-token' });
    expect(cfg.tursoUrl).toBe('libsql://db-org.turso.io');
    expect(configLogLine(cfg)).toContain('store=turso(libsql)');
    expect(configLogLine(cfg)).not.toContain('secret-token');
    const local = loadConfig({ ...MAINNET_BASE });
    expect(local.tursoUrl).toBeUndefined();
    expect(configLogLine(local)).toContain('store=sqlite-local');
  });
});
