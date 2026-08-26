// index.ts — boot + routes (SPEC §2, §3). Hono app factory is exported for
// tests; main() performs the boot asserts and starts the HTTP listener.
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import algosdk from 'algosdk';
import { HttpChainClient, type ChainClient } from './chain.js';
import { configLogLine, loadConfig, resolveMnemonic, type OracleConfig } from './config.js';
import { signerFromMnemonic, type OracleSigner } from './sign.js';
import { Store } from './store.js';
import { handleContinueReceipt, handleSignScore, handleVerdict, type Deps, type Reply } from './verify.js';
import { ReplayVerifier, scanReplayBundles } from './replay/replayer.js';
import { bytesEqual } from './util.js';

export interface AppDeps extends Deps {
  startedAt?: number;
}

function clientIp(c: Context): string {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}

async function sendReply(c: Context, r: Reply): Promise<Response> {
  if (r.retryAfter != null && r.retryAfter > 0) c.header('Retry-After', String(r.retryAfter));
  return c.json(r.body, r.status as 200);
}

export function createApp(deps: AppDeps): Hono {
  const { cfg, chain, store } = deps;
  const startedAt = deps.startedAt ?? Date.now();
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: cfg.corsOrigins,
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['Content-Type'],
      maxAge: 600,
    }),
  );

  // Uniform error surface: {error} and NEVER a stack trace (SPEC §3.5)
  app.onError((err, c) => {
    console.error('[oracle] handler error:', err instanceof Error ? err.message : String(err));
    return c.json({ error: 'internal error' }, 500);
  });

  app.get('/v1/health', (c) =>
    c.json({
      ok: true,
      network: cfg.network,
      appId: cfg.appId,
      oracleAddr: deps.signer.addr,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    }),
  );

  // Fixed-window rate limit (SPEC §2/§3.2 rule 6): per IP AND per addr (when
  // the body carries one). Counted at entry so chain reads are protected.
  const rateGate = async (c: Context, addrKey: string | null): Promise<Response | null> => {
    const now = chain.now();
    const ip = clientIp(c);
    const hitIp = store.rateHit('ip:' + ip, cfg.ratePerMinIp, now);
    if (!hitIp.allowed) {
      c.header('Retry-After', String(hitIp.retryAfter));
      return c.json({ error: 'rate limited (ip)' }, 429);
    }
    if (addrKey) {
      const hitAddr = store.rateHit('addr:' + addrKey, cfg.ratePerMinAddr, now);
      if (!hitAddr.allowed) {
        c.header('Retry-After', String(hitAddr.retryAfter));
        return c.json({ error: 'rate limited (addr)' }, 429);
      }
    }
    return null;
  };

  const jsonBody = async (c: Context): Promise<unknown | null> => {
    try {
      return await c.req.json();
    } catch {
      return null;
    }
  };

  app.post('/v1/sign-score', async (c) => {
    const body = await jsonBody(c);
    const addr = body && typeof body === 'object' && typeof (body as Record<string, unknown>)['addr'] === 'string' ? ((body as Record<string, unknown>)['addr'] as string) : null;
    const limited = await rateGate(c, addr);
    if (limited) return limited;
    return sendReply(c, await handleSignScore(deps, body, clientIp(c)));
  });

  app.post('/v1/verdict', async (c) => {
    const limited = await rateGate(c, null);
    if (limited) return limited;
    return sendReply(c, await handleVerdict(deps, await jsonBody(c)));
  });

  app.post('/v1/continue/receipt', async (c) => {
    const body = await jsonBody(c);
    const addr = body && typeof body === 'object' && typeof (body as Record<string, unknown>)['addr'] === 'string' ? ((body as Record<string, unknown>)['addr'] as string) : null;
    const limited = await rateGate(c, addr);
    if (limited) return limited;
    return sendReply(c, await handleContinueReceipt(deps, body));
  });

  return app;
}

// ---------------------------------------------------------------------------
// boot asserts (SPEC §2): the derived oracle address MUST equal oracle_pub_key
// on-chain and the configured treasury MUST equal the global state — a
// mismatch means we would sign for the wrong app, so refuse to start.
// ---------------------------------------------------------------------------
export async function bootChecks(cfg: OracleConfig, chain: ChainClient, signer: OracleSigner): Promise<void> {
  const gs = await chain.getGlobalState();
  const derivedPk = algosdk.decodeAddress(signer.addr).publicKey;
  if (!bytesEqual(derivedPk, gs.oraclePubKey)) {
    throw new Error(
      `boot assert FAILED: derived oracle address does not match on-chain oracle_pub_key (app ${cfg.appId}) — refusing to start`,
    );
  }
  const onchainTreasury = algosdk.encodeAddress(gs.treasury);
  if (onchainTreasury !== cfg.treasuryAddr) {
    throw new Error(
      `boot assert FAILED: TREASURY_ADDR config (${cfg.treasuryAddr}) != on-chain treasury (${onchainTreasury}) — refusing to start`,
    );
  }
  if (gs.version !== 2) {
    throw new Error(`boot assert FAILED: on-chain version ${gs.version} != 2 (v2 box layout) — refusing to start`);
  }
  if (gs.gonnaAssetId !== cfg.gonnaAsaId) {
    console.error(`[oracle] WARN: GONNA_ASA_ID config (${cfg.gonnaAsaId}) != on-chain gonna_asset_id (${gs.gonnaAssetId})`);
  }
  // M2 boot assert (SPEC-m2 §6): with replay enforcement ON there must be at
  // least one pinned engine bundle to verify against — otherwise every
  // sign-score would 400. Recovery: REPLAY_ENFORCE=0 (see RUNBOOK).
  if (cfg.replayEnforce) {
    const n = scanReplayBundles(cfg.replayBundlesDir).size;
    if (n === 0) {
      throw new Error(
        `boot assert FAILED: REPLAY_ENFORCE=1 but no engine bundles in ${cfg.replayBundlesDir} — refusing to start (build one with scripts/build-replay-bundle.mjs <VER> or set REPLAY_ENFORCE=0 for recovery)`,
      );
    }
    console.error(`[oracle] replay bundles available: ${n} (${[...scanReplayBundles(cfg.replayBundlesDir).keys()].join(', ')})`);
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  // The mnemonic comes from ORACLE_MNEMONIC_FILE (0600, mounted secret —
  // preferred) or the ORACLE_MNEMONIC env fallback. It is never logged,
  // never returned by the API, never written to the DB.
  const mnemonic = resolveMnemonic(cfg);
  const signer = signerFromMnemonic(mnemonic);
  const chain = new HttpChainClient({
    algodUrl: cfg.algodUrl,
    indexerUrl: cfg.indexerUrl,
    appId: cfg.appId,
    treasuryAddr: cfg.treasuryAddr,
  });
  await bootChecks(cfg, chain, signer); // throws -> exit 1 below
  const store = new Store(cfg.dbPath);
  const replay = cfg.replayEnforce
    ? new ReplayVerifier({ bundlesDir: cfg.replayBundlesDir, timeoutMs: cfg.replayTimeoutMs })
    : undefined;
  const app = createApp({ cfg, chain, store, signer, replay });
  serve({ fetch: app.fetch, port: cfg.port }, (info) => {
    console.log(`[oracle] ready addr=${signer.addr} ${configLogLine(cfg)} listening=${info.port}`);
  });
}

const isMain = process.argv[1] != null && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  main().catch((err) => {
    console.error('[oracle] fatal:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
