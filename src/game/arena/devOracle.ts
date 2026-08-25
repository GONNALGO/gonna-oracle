// ============================================================================
// ⚠⚠⚠  QA ONLY — NEVER A PRODUCTION SIGNING PATH  ⚠⚠⚠
// DEV ORACLE SIGNER: signs creator_score / score / verdict messages with the
// throwaway TESTNET oracle key. The mnemonic is NEVER in the repo — the QA
// harness injects it into localStorage at runtime (from the gitignored
// deploy/testnet.secrets.json).
// v16 (SPEC-oracle §7): the SERVER ORACLE (./oracleClient.ts) is the DEFAULT
// signer on testnet — the key no longer lives in the served client. This
// module signs ONLY when ALL of these hold:
//   1. the build was compiled with VITE_QA_ORACLE=1 (oracleLink.ts gate),
//   2. the degen explicitly passed ?oracle=dev (persisted override),
//   3. a key was armed via the #oracle= master link / harness injection.
// A network failure against the HTTP oracle NEVER falls back here silently.
// ============================================================================
import { ARENA_APP_ID, verifyContinuePayment } from './testnetKit';

const LS_ORACLE = 'gonna.qa.oracle.mn'; // injected by QA harness or the #oracle= master link (oracleLink.ts)

export function armDevOracle(mnemonic: string): void {
  try {
    window.localStorage.setItem(LS_ORACLE, mnemonic);
  } catch { /* no storage */ }
}

export function hasDevOracle(): boolean {
  try {
    return !!window.localStorage.getItem(LS_ORACLE);
  } catch {
    return false;
  }
}

async function oracleSecret(): Promise<Uint8Array> {
  const mn = window.localStorage.getItem(LS_ORACLE);
  if (!mn) throw new Error('dev oracle key not injected (QA only)');
  const algosdk = await import('algosdk');
  const sk = algosdk.mnemonicToSecretKey(mn).sk; // 64-byte ed25519 sk
  return sk.slice(0, 32); // PyNaCl SigningKey(seed) equivalent
}

// bare ed25519 detached signature (matches deploy/common.py oracle_sign)
export async function devOracleSign(msg: Uint8Array): Promise<Uint8Array> {
  const seed = await oracleSecret();
  const nacl = (await import('tweetnacl')).default;
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return nacl.sign.detached(msg, kp.secretKey);
}

// v12 CONTINUE enforcement: a SECOND score signature for the same
// wallet+challenge requires on-chain proof of the 5-ALGO treasury payment.
// Receipt txids are single-use (localStorage set — testnet-weak on purpose;
// MAINNET = server-side oracle with a real DB of consumed receipts).
const LS_CONTINUE_USED = 'gonna.continue.used';
export async function devOracleSignScore(
  msg: Uint8Array,
  proof?: { refId: string; addr: string },
): Promise<Uint8Array> {
  if (proof) {
    let txid: string | null = null;
    try {
      txid = window.localStorage.getItem('gonna.continue|' + proof.refId + '|' + proof.addr);
    } catch { /* no storage */ }
    if (!txid) throw new Error('CONTINUE NOT PAID - PAY 5 ALGO FIRST');
    let used: string[] = [];
    try {
      used = JSON.parse(window.localStorage.getItem(LS_CONTINUE_USED) ?? '[]') as string[];
    } catch { /* fresh */ }
    if (used.includes(txid)) throw new Error('CONTINUE RECEIPT ALREADY SPENT');
    const ok = await verifyContinuePayment(txid, proof.refId, proof.addr);
    if (!ok) throw new Error('CONTINUE PAYMENT NOT VERIFIED ON-CHAIN');
    used.push(txid);
    try {
      window.localStorage.setItem(LS_CONTINUE_USED, JSON.stringify(used.slice(-64)));
    } catch { /* no storage */ }
  }
  return devOracleSign(msg);
}

export async function devOracleAddress(): Promise<string | null> {
  try {
    const mn = window.localStorage.getItem(LS_ORACLE);
    if (!mn) return null;
    const algosdk = await import('algosdk');
    return algosdk.mnemonicToSecretKey(mn).addr.toString();
  } catch {
    return null;
  }
}

export { ARENA_APP_ID };
