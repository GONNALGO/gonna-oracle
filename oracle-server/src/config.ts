// config.ts — env-driven configuration (SPEC §2). The mnemonic is ONLY ever
// read from ORACLE_MNEMONIC_FILE (0600, mounted secret); it is never accepted
// inline via env and never logged.
export interface ScoreCaps {
  full: number;
  stage: number[]; // indexed by stageIdx 0..6
}

export interface OracleConfig {
  network: 'testnet' | 'mainnet';
  appId: number;
  gonnaAsaId: number;
  treasuryAddr: string;
  algodUrl: string;
  indexerUrl: string;
  oracleMnemonicFile: string;
  port: number;
  corsOrigins: string[];
  ratePerMinIp: number;
  ratePerMinAddr: number;
  scoreCaps: ScoreCaps;
  dbPath: string;
  // M2 replay verification (SPEC-m2 §5)
  replayEnforce: boolean; // REPLAY_ENFORCE (default 1); 0 = recovery mode (M1 structural only)
  allowLegacyGil: boolean; // ALLOW_LEGACY_GIL (default 1 testnet / 0 mainnet)
  replayBundlesDir: string; // REPLAY_BUNDLES_DIR (default <pkg>/replay-bundles)
  replayTimeoutMs: number; // REPLAY_TIMEOUT_MS (default 30000; 0 = abort at first checkpoint)
}

/** Generous M1 caps (mission brief): refined in M2 by deterministic replay. */
export const DEFAULT_SCORE_CAPS: ScoreCaps = {
  full: 2_000_000,
  stage: [500_000, 500_000, 500_000, 500_000, 500_000, 500_000, 500_000],
};

const DEFAULT_ALGOD: Record<string, string> = {
  testnet: 'https://testnet-api.algonode.cloud',
  mainnet: 'https://mainnet-api.algonode.cloud',
};
const DEFAULT_INDEXER: Record<string, string> = {
  testnet: 'https://testnet-idx.algonode.cloud',
  mainnet: 'https://mainnet-idx.algonode.cloud',
};

function req(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v || !v.trim()) throw new Error(`config: missing required env ${key}`);
  return v.trim();
}

function intEnv(env: NodeJS.ProcessEnv, key: string, dflt: number): number {
  const v = env[key];
  if (v == null || v.trim() === '') return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`config: ${key} must be a non-negative integer`);
  return n;
}

function reqInt(env: NodeJS.ProcessEnv, key: string): number {
  const v = req(env, key);
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`config: ${key} must be a non-negative integer`);
  return n;
}

function parseRate(v: string | undefined): { ip: number; addr: number } {
  // SPEC §2: MAX_SIG_PER_MIN default 30/IP, 6/addr. Accept "30" (ip only,
  // addr defaults to 6) or "30,6" (explicit pair).
  if (!v || !v.trim()) return { ip: 30, addr: 6 };
  const parts = v.split(',').map((s) => Number(s.trim()));
  if (parts.some((n) => !Number.isInteger(n) || n <= 0) || parts.length > 2) {
    throw new Error('config: MAX_SIG_PER_MIN must be "N" or "N,M" (positive integers)');
  }
  return { ip: parts[0] as number, addr: parts.length === 2 ? (parts[1] as number) : 6 };
}

function parseScoreCaps(v: string | undefined): ScoreCaps {
  if (!v || !v.trim()) return DEFAULT_SCORE_CAPS;
  let j: unknown;
  try {
    j = JSON.parse(v);
  } catch {
    throw new Error('config: SCORE_CAPS_JSON is not valid JSON');
  }
  const o = j as Partial<ScoreCaps>;
  const full = typeof o.full === 'number' && Number.isInteger(o.full) && o.full > 0 ? o.full : DEFAULT_SCORE_CAPS.full;
  const stage = Array.isArray(o.stage) && o.stage.every((n) => Number.isInteger(n) && n > 0) ? o.stage : DEFAULT_SCORE_CAPS.stage;
  return { full, stage };
}

export function capFor(caps: ScoreCaps, stageMode: 'full' | 'stage', stageIdx: number | null): number {
  if (stageMode === 'full') return caps.full;
  const i = stageIdx ?? -1;
  return caps.stage[i] ?? DEFAULT_SCORE_CAPS.stage[i] ?? 500_000;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OracleConfig {
  const networkRaw = req(env, 'ARENA_NETWORK');
  if (networkRaw !== 'testnet' && networkRaw !== 'mainnet') {
    throw new Error(`config: ARENA_NETWORK must be testnet|mainnet (got ${JSON.stringify(networkRaw)})`);
  }
  const rate = parseRate(env['MAX_SIG_PER_MIN']);
  const cors = (env['CORS_ORIGIN'] ?? 'https://gonna.bond')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    network: networkRaw,
    appId: reqInt(env, 'ARENA_APP_ID'),
    gonnaAsaId: intEnv(env, 'GONNA_ASA_ID', 0),
    treasuryAddr: req(env, 'TREASURY_ADDR'),
    algodUrl: (env['ALGOD_URL'] ?? DEFAULT_ALGOD[networkRaw] ?? '').trim(),
    indexerUrl: (env['INDEXER_URL'] ?? DEFAULT_INDEXER[networkRaw] ?? '').trim(),
    oracleMnemonicFile: req(env, 'ORACLE_MNEMONIC_FILE'),
    port: intEnv(env, 'PORT', 8787),
    corsOrigins: cors,
    ratePerMinIp: rate.ip,
    ratePerMinAddr: rate.addr,
    scoreCaps: parseScoreCaps(env['SCORE_CAPS_JSON']),
    dbPath: (env['DB_PATH'] ?? '/data/oracle.db').trim(),
    replayEnforce: (env['REPLAY_ENFORCE'] ?? '1').trim() !== '0',
    allowLegacyGil: (env['ALLOW_LEGACY_GIL'] ?? (networkRaw === 'testnet' ? '1' : '0')).trim() !== '0',
    replayBundlesDir: (env['REPLAY_BUNDLES_DIR'] ?? new URL('../replay-bundles/', import.meta.url).pathname).trim(),
    replayTimeoutMs: intEnv(env, 'REPLAY_TIMEOUT_MS', 30_000),
  };
}

/** One-line boot log: public data only, never the mnemonic. */
export function configLogLine(cfg: OracleConfig): string {
  return `network=${cfg.network} appId=${cfg.appId} algod=${cfg.algodUrl} indexer=${cfg.indexerUrl} ` +
    `port=${cfg.port} cors=[${cfg.corsOrigins.join(' ')}] rate=${cfg.ratePerMinIp}/ip,${cfg.ratePerMinAddr}/addr db=${cfg.dbPath} ` +
    `replay=${cfg.replayEnforce ? `enforce(legacyGil=${cfg.allowLegacyGil ? 'on' : 'off'},bundles=${cfg.replayBundlesDir})` : 'OFF'}`;
}
