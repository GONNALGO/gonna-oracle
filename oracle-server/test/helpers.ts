// Shared test scaffolding: throwaway keys generated on the fly, a stubbed
// ChainClient, in-memory store, and a ready-to-call Hono app.
import algosdk from 'algosdk';
import type { ChainClient, ChallengeMeta, GlobalState, PlayerEntry, StageCommitment } from '../src/chain.js';
import { DEFAULT_SCORE_CAPS, type OracleConfig } from '../src/config.js';
import { signerFromMnemonic, type OracleSigner } from '../src/sign.js';
import { Store } from '../src/store.js';
import { createApp } from '../src/index.js';
import { ReplayVerifier } from '../src/replay/replayer.js';

export function throwawayAccount(): { addr: string; pk: Uint8Array; mnemonic: string } {
  const a = algosdk.generateAccount();
  return { addr: a.addr.toString(), pk: a.addr.publicKey, mnemonic: algosdk.secretKeyToMnemonic(a.sk) };
}

export const ORACLE = throwawayAccount();
export const TREASURY = throwawayAccount();
export const PLAYER_A = throwawayAccount();
export const PLAYER_B = throwawayAccount();
export const PLAYER_C = throwawayAccount();

export const TEST_APP_ID = 769907387;

export function testConfig(overrides: Partial<OracleConfig> = {}): OracleConfig {
  return {
    network: 'testnet',
    appId: TEST_APP_ID,
    gonnaAsaId: 769688287,
    treasuryAddr: TREASURY.addr,
    algodUrl: 'https://stub.invalid',
    indexerUrl: 'https://stub.invalid',
    oracleMnemonicFile: '/nonexistent',
    port: 8787,
    corsOrigins: ['https://gonna.bond'],
    ratePerMinIp: 30,
    ratePerMinAddr: 6,
    scoreCaps: DEFAULT_SCORE_CAPS,
    dbPath: ':memory:',
    // M2 replay verification: OFF by default so the M1 suites exercise the M1
    // path verbatim; the dedicated replayVerify suite opts in explicitly.
    replayEnforce: false,
    allowLegacyGil: true,
    replayBundlesDir: new URL('../replay-bundles/', import.meta.url).pathname,
    replayTimeoutMs: 30_000,
    ...overrides,
  };
}

export interface StubChainOpts {
  nextChallengeId?: number;
  metas?: Record<number, ChallengeMeta | null>;
  players?: Record<number, PlayerEntry[]>;
  stages?: Record<number, StageCommitment | null>;
  continueOk?: boolean;
  nowSec?: number;
}

export class StubChain implements ChainClient {
  gs: GlobalState;
  metas: Record<number, ChallengeMeta | null>;
  players: Record<number, PlayerEntry[]>;
  stages: Record<number, StageCommitment | null>;
  continueOk: boolean;
  nowSec: number;

  constructor(opts: StubChainOpts = {}) {
    this.gs = {
      nextChallengeId: opts.nextChallengeId ?? 50,
      oraclePubKey: ORACLE.pk,
      treasury: TREASURY.pk,
      gonnaAssetId: 769688287,
      version: 2,
    };
    this.metas = opts.metas ?? {};
    this.players = opts.players ?? {};
    this.stages = opts.stages ?? {};
    this.continueOk = opts.continueOk ?? true;
    this.nowSec = opts.nowSec ?? 1_800_000_000;
  }

  now(): number {
    return this.nowSec;
  }
  async getGlobalState(): Promise<GlobalState> {
    return this.gs;
  }
  async getMeta(cid: number): Promise<ChallengeMeta | null> {
    return this.metas[cid] ?? null;
  }
  async getPlayers(cid: number): Promise<PlayerEntry[]> {
    return this.players[cid] ?? [];
  }
  async getStageForCid(cid: number): Promise<StageCommitment | null> {
    return this.stages[cid] ?? null;
  }
  async countContinuePayments(): Promise<number | null> {
    return null; // tests: reconciliation unknown (warn-only path)
  }
  async verifyContinuePayment(): Promise<boolean> {
    return this.continueOk;
  }
}

export function mkMeta(overrides: Partial<ChallengeMeta> = {}): ChallengeMeta {
  return {
    creator: PLAYER_A.pk,
    stake: 1_000_000n,
    seatsTotal: 1n,
    seatsTaken: 0n,
    deadline: BigInt(1_800_000_000 + 86_400),
    stageMode: 0,
    status: 0,
    ...overrides,
  };
}

export function mkPlayer(addr: Uint8Array, score: bigint, signed: boolean): PlayerEntry {
  return { addr, score, signed, seatedAt: 1_800_000_000n };
}

export interface Fixture {
  cfg: OracleConfig;
  chain: StubChain;
  store: Store;
  signer: OracleSigner;
  app: ReturnType<typeof createApp>;
  post: (path: string, body: unknown, ip?: string) => Promise<{ status: number; json: Record<string, unknown>; retryAfter: string | null }>;
}

export function mkFixture(chainOpts: StubChainOpts = {}, cfgOverrides: Partial<OracleConfig> = {}): Fixture {
  const cfg = testConfig(cfgOverrides);
  const chain = new StubChain(chainOpts);
  const store = new Store(':memory:');
  const signer = signerFromMnemonic(ORACLE.mnemonic);
  // mirrors main(): the verifier exists iff enforcement is on
  const replay = cfg.replayEnforce
    ? new ReplayVerifier({ bundlesDir: cfg.replayBundlesDir, timeoutMs: cfg.replayTimeoutMs })
    : undefined;
  const app = createApp({ cfg, chain, store, signer, replay });
  const post = async (path: string, body: unknown, ip = '203.0.113.7') => {
    const res = await app.fetch(
      new Request('http://test' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify(body),
      }),
    );
    return {
      status: res.status,
      json: (await res.json()) as Record<string, unknown>,
      retryAfter: res.headers.get('retry-after'),
    };
  };
  return { cfg, chain, store, signer, app, post };
}

export function validRun(frames = 3600): { seedLabel: string; frames: number; durationSec: number } {
  return { seedLabel: 'PIT-42', frames, durationSec: frames / 60 };
}

export function signScoreBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cid: 42,
    seat: 1,
    addr: PLAYER_B.addr,
    score: 100_000,
    stageMode: 'full',
    build: 'v0TESTBUILD',
    run: validRun(),
    ...overrides,
  };
}


