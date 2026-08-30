// ============================================================================
// v16 — SERVER ORACLE CLIENT (SPEC-oracle §3/§7): the oracle KEY lives on the
// server now — never in the served client. The testnet adapter asks this
// service for every score/verdict signature; the server re-verifies against
// the CHAIN (challenge state, stage note, score caps, run sanity, continue
// receipts) BEFORE it signs. Every failure surfaces as an honest GONNA line —
// a network error NEVER falls back to the dev-oracle in silence.
//
// Base URL: per-network default from arenaKit (M-1), overridable for QA via
// ?oracle=<url> (persisted in a NETWORK-SCOPED localStorage key — a testnet
// override must never leak into a mainnet session, M-1 leak guard).
// The reserved value '?oracle=dev' is the EXPLICIT local-QA fallback: sigs
// come from the armed dev-oracle key (a VITE_QA_ORACLE=1 build + the #oracle=
// master link, or harness injection). Production never sets it.
// ============================================================================
import { b64ToBytes } from '../b64';
import { ARENA_NETWORK, NET, netLsKey } from './arenaKit';

export const ORACLE_BASE_URL_TESTNET = 'https://gonna-arena-oracle-testnet.onrender.com'; // public Render oracle (free tier); localhost still available via ?oracle=
// M-1: same Render service today — the mainnet flip is env-side at M-2
// (rename of the Render service is an infra decision, tracked there).
export const ORACLE_BASE_URL_MAINNET = NET.oracleBaseUrl;
const ORACLE_BASE_URL_DEFAULT = ARENA_NETWORK === 'mainnet' ? ORACLE_BASE_URL_MAINNET : ORACLE_BASE_URL_TESTNET;
// network-scoped: 'gonna.arena.oracleurl.testnet' | '...mainnet'
const LS_ORACLE_URL = netLsKey('gonna.arena.oracleurl');
// reserved ?oracle= value: sign locally with the armed QA dev-oracle key
export const ORACLE_DEV = 'dev';

export function oracleBaseUrl(): string {
  try {
    // explicit query ALWAYS wins (and persists) — same pattern as arenaMode
    const q = new URLSearchParams(window.location.search).get('oracle');
    if (q) {
      window.localStorage.setItem(LS_ORACLE_URL, q);
      return q;
    }
    const stored = window.localStorage.getItem(LS_ORACLE_URL);
    if (stored) return stored;
  } catch {
    /* no window/storage (node tests) */
  }
  return ORACLE_BASE_URL_DEFAULT;
}

export function oracleIsDev(): boolean {
  return oracleBaseUrl() === ORACLE_DEV;
}

// honest one-liner for the wizard status row (arenaUI create screen)
// v17.0.6 (Prince decree): NEVER show the raw hostname — the Render service
// slug still says "testnet" from its test-era birth and a paying mainnet
// player must NEVER read that word. Mainnet shows the network, period.
// A custom ?oracle= URL (QA only) still shows its host so QA sees the truth.
export function oracleLine(): string {
  if (oracleIsDev()) return 'QA DEV ORACLE - LOCAL KEY (NEVER SHIPPED)';
  const base = oracleBaseUrl();
  const isDefault = base === ORACLE_BASE_URL_DEFAULT;
  if (isDefault) return ARENA_NETWORK === 'mainnet' ? 'SERVER ORACLE - MAINNET' : 'SERVER ORACLE - TESTNET';
  return 'CUSTOM ORACLE - ' + base.replace(/^https?:\/\//, '');
}

// ---------- errors: SPEC §3.5 ({error: reason}; 429 + Retry-After) ----------
export class OracleError extends Error {
  readonly status: number; // 0 = network/timeout (no HTTP answer at all)
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'OracleError';
    this.status = status;
  }
}

const TIMEOUT_MS = 8000; // SPEC §7: 8s + 1 retry
const MAX_ATTEMPTS = 2;

async function postJson(path: string, body: unknown, opts?: { timeoutMs?: number }): Promise<unknown> {
  const base = oracleBaseUrl();
  let lastErr: OracleError = new OracleError('THE ORACLE IS UNREACHABLE - CHECK THE LINE AND RETRY');
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      // network down OR our own abort — retried once, never silently dev-signed
      const aborted = e instanceof Error && e.name === 'AbortError';
      lastErr = new OracleError(aborted ? 'THE ORACLE IS SILENT - TIMED OUT, RETRY' : 'THE ORACLE IS UNREACHABLE - CHECK THE LINE AND RETRY');
      clearTimeout(timer);
      continue;
    }
    clearTimeout(timer);
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new OracleError('THE ORACLE TALKS GIBBERISH - BAD JSON');
      }
    }
    let reason = 'HTTP ' + res.status;
    try {
      const j = (await res.json()) as { error?: unknown };
      if (j && typeof j.error === 'string' && j.error) reason = j.error;
    } catch {
      /* no json body — the HTTP status is the honest reason */
    }
    if (res.status === 429) throw new OracleError('THE ORACLE IS BUSY - RETRY IN A BREATH', 429);
    if (res.status >= 500) {
      lastErr = new OracleError('THE ORACLE SAYS NO - ' + reason, res.status);
      continue; // one retry on a server-side wobble
    }
    throw new OracleError('THE ORACLE SAYS NO - ' + reason, res.status);
  }
  throw lastErr;
}

// ---------- SPEC §3 payloads (types aligned EXACTLY) ----------
export interface RunInfo {
  seedLabel: string;
  frames: number;
  durationSec: number;
  inputLogB64?: string;
}
export interface SignScoreRequest {
  cid: number;
  seat: number;
  addr: string;
  score: number;
  stageMode: 'full' | 'stage';
  stageIdx?: number;
  build: string;
  run: RunInfo;
  continueRef?: string;
}
export interface SignScoreResponse {
  sigB64: string;
  oracleAddr: string;
}
export interface VerdictResponse {
  verdictSigB64: string;
  digestB64: string;
  extraB64: string;
  stageMode: string;
  stageIdx: number;
  playerCount: number;
}

export async function signScore(req: SignScoreRequest, opts?: { timeoutMs?: number }): Promise<SignScoreResponse> {
  const j = (await postJson('/v1/sign-score', req, opts)) as Partial<SignScoreResponse>;
  if (typeof j.sigB64 !== 'string' || typeof j.oracleAddr !== 'string') {
    throw new OracleError('THE ORACLE TALKS GIBBERISH - BAD SIGN RECEIPT');
  }
  return { sigB64: j.sigB64, oracleAddr: j.oracleAddr };
}

export async function fetchVerdict(cid: number, opts?: { timeoutMs?: number }): Promise<VerdictResponse> {
  const j = (await postJson('/v1/verdict', { cid }, opts)) as Partial<VerdictResponse>;
  if (typeof j.verdictSigB64 !== 'string' || typeof j.digestB64 !== 'string' || typeof j.extraB64 !== 'string') {
    throw new OracleError('THE ORACLE TALKS GIBBERISH - BAD VERDICT');
  }
  return j as VerdictResponse;
}

export async function postContinueReceipt(refId: string, addr: string, txid: string, opts?: { timeoutMs?: number }): Promise<void> {
  await postJson('/v1/continue/receipt', { refId, addr, txid }, opts);
}

// ---------- sig helpers used by the testnet adapter (chainAdapter) ----------
// SERVER path (default): the HTTP oracle signs after its chain checks.
// DEV path (explicit ?oracle=dev ONLY): the armed QA dev key signs the
// locally-built message — devMsg (and proof for continues) rides along for
// exactly that case and is IGNORED on the server path.

export async function oracleScoreSig(
  req: SignScoreRequest,
  dev: { msg: Uint8Array; proof?: { refId: string; addr: string } },
): Promise<Uint8Array> {
  if (oracleIsDev()) {
    const d = await import('./devOracle');
    return d.devOracleSignScore(dev.msg, dev.proof);
  }
  const r = await signScore(req);
  return b64ToBytes(r.sigB64);
}

export async function oracleVerdictSig(cid: number, devMsg: Uint8Array): Promise<Uint8Array> {
  if (oracleIsDev()) {
    const d = await import('./devOracle');
    return d.devOracleSign(devMsg);
  }
  const r = await fetchVerdict(cid);
  return b64ToBytes(r.verdictSigB64);
}

// v16 continue gate (SPEC §3.4 + §3.2 rule 5): the paid 5-ALGO receipt is
// REGISTERED with the server BEFORE the sig ask; the server marks it consumed
// atomically with the signature (real DB — the localStorage single-use set
// the dev-oracle kept is gone from the served path).
export async function registerContinueReceipt(refId: string, addr: string): Promise<void> {
  if (oracleIsDev()) return; // dev path: devOracleSignScore verifies the payment on-chain itself
  let txid: string | null = null;
  try {
    txid = window.localStorage.getItem('gonna.continue|' + refId + '|' + addr);
  } catch {
    /* no storage */
  }
  if (!txid) throw new OracleError('CONTINUE NOT PAID - PAY 5 ALGO FIRST');
  await postContinueReceipt(refId, addr, txid);
}
