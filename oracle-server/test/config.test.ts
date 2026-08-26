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
