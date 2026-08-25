#!/usr/bin/env node
// smoke-testnet.mjs — live testnet smoke for the oracle server (M1).
//
// Boots the COMPILED server (dist/index.js) locally with the testnet ORACLE
// key from ../contracts/quantum-arena/deploy/testnet.secrets.json. The
// mnemonic is written to a 0600 temp file and is NEVER printed (only the
// public oracle ADDRESS is reported). Checks:
//   1. GET  /v1/health            -> ok, oracleAddr matches the key's address
//   2. POST /v1/verdict (resolved card cid 16) -> 409 (boxes deleted on-chain)
//   3. POST /v1/sign-score fake cid (seat 1)   -> 404 chain truth rejection
//   4. POST /v1/sign-score cid drift (seat 0)  -> 409 anti CID-drift
// Usage: npm run build && node scripts/smoke-testnet.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DEPLOY = join(HERE, '..', '..', 'contracts', 'quantum-arena', 'deploy');
const PORT = Number(process.env.SMOKE_PORT ?? 18789);
const BASE = `http://127.0.0.1:${PORT}`;

const cfg = JSON.parse(readFileSync(join(DEPLOY, 'testnet.json'), 'utf8'));
const secrets = JSON.parse(readFileSync(join(DEPLOY, 'testnet.secrets.json'), 'utf8'));
const oracleAddr = secrets?.ORACLE?.address;
const oracleMnemonic = secrets?.ORACLE?.mnemonic;
if (!oracleAddr || !oracleMnemonic) {
  console.error('SMOKE FAIL: ORACLE entry missing in testnet.secrets.json');
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'gonna-oracle-smoke-'));
const mnFile = join(tmp, 'oracle_mnemonic');
writeFileSync(mnFile, oracleMnemonic, { mode: 0o600 });
const dbPath = join(tmp, 'smoke.db');

const env = {
  ...process.env,
  ARENA_NETWORK: 'testnet',
  ARENA_APP_ID: String(cfg.app_id),
  GONNA_ASA_ID: String(cfg.gonna_asa_id),
  TREASURY_ADDR: cfg.treasury_addr,
  ALGOD_URL: cfg.node ?? 'https://testnet-api.algonode.cloud',
  INDEXER_URL: 'https://testnet-idx.algonode.cloud',
  ORACLE_MNEMONIC_FILE: mnFile,
  PORT: String(PORT),
  CORS_ORIGIN: 'https://gonna.bond',
  DB_PATH: dbPath,
};

console.log(`[smoke] oracle address (public): ${oracleAddr}`);
console.log(`[smoke] app ${cfg.app_id} on testnet, port ${PORT}`);

const server = spawn(process.execPath, [join(HERE, '..', 'dist', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

let failed = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) failed++;
};

async function waitHealth(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/v1/health`);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    if (server.exitCode !== null) throw new Error('server exited early:\n' + serverLog);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not become healthy in time:\n' + serverLog);
}

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})), retryAfter: r.headers.get('retry-after') };
}

try {
  const health = await waitHealth(30_000);
  check('health ok', health.ok === true, `network=${health.network} appId=${health.appId}`);
  check('health oracleAddr matches key address', health.oracleAddr === oracleAddr, health.oracleAddr);
  check('boot assert passed (server up with chain-verified key)', true);

  // resolved duel from deploy/testnet.json v1524_live (boxes deleted on-chain)
  const resolvedCid = cfg?.v1524_live?.joiner_wins?.cid ?? 16;
  const v = await post('/v1/verdict', { cid: resolvedCid });
  check(`verdict on resolved card cid=${resolvedCid} -> 409`, v.status === 409, JSON.stringify(v.json));

  // fake cid, seat 1: no such challenge on-chain -> chain truth rejection
  const s1 = await post('/v1/sign-score', {
    cid: 9_999_999, seat: 1, addr: cfg.player_a_addr, score: 1000, stageMode: 'full',
    build: 'smoke', run: { seedLabel: 'PIT-X', frames: 3600, durationSec: 60 },
  });
  check('sign-score fake cid (seat 1) -> 404 chain truth', s1.status === 404, JSON.stringify(s1.json));

  // seat 0 with a cid that is NOT next_challenge_id -> anti CID-drift
  const s0 = await post('/v1/sign-score', {
    cid: 9_999_999, seat: 0, addr: cfg.player_a_addr, score: 1000, stageMode: 'full',
    build: 'smoke', run: { seedLabel: 'PIT-X', frames: 3600, durationSec: 60 },
  });
  check('sign-score cid drift (seat 0) -> 409', s0.status === 409, JSON.stringify(s0.json));

  // no secrets may ever leak into the server log
  check('no mnemonic words in server log', !oracleMnemonic.split(' ').some((w) => w.length > 3 && serverLog.includes(w)));
} catch (e) {
  failed++;
  console.error('SMOKE ERROR:', e instanceof Error ? e.message : String(e));
} finally {
  server.kill('SIGTERM');
  rmSync(tmp, { recursive: true, force: true }); // deletes the temp key file
}

console.log(failed === 0 ? 'SMOKE OK' : `SMOKE FAILED (${failed} checks)`);
process.exit(failed === 0 ? 0 : 1);
