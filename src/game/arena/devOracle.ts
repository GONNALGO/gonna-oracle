// ============================================================================
// ⚠⚠⚠  TESTNET ONLY — NEVER SHIP TO MAINNET  ⚠⚠⚠
// DEV ORACLE SIGNER: signs creator_score / score / verdict messages with the
// throwaway TESTNET oracle key. The mnemonic is NEVER in the repo — the QA
// harness injects it into localStorage at runtime (from the gitignored
// deploy/testnet.secrets.json). On mainnet this role is a server-side oracle
// service; this module must be compiled OUT of any mainnet build.
// ============================================================================
import { ARENA_APP_ID } from './testnetKit';

const LS_ORACLE = 'gonna.qa.oracle.mn'; // injected by the QA script only

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
