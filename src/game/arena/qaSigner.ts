// ============================================================================
// ⚠⚠⚠  TESTNET QA ONLY — NEVER SHIP TO MAINNET  ⚠⚠⚠
// QA SIGNER: plays as a throwaway TESTNET player, key injected at runtime by
// the Playwright harness (from gitignored deploy/testnet.secrets.json).
// Enabled ONLY with ?qa=1 (or localStorage gonna.qa=1) + an injected mnemonic.
// Real degens sign with Pera/Defly (testnetWallet.ts) — this is automation.
// ============================================================================
import type { TxSignFn } from './testnetKit';

const LS_QA = 'gonna.qa';
const LS_PLAYER = 'gonna.qa.player.mn';

export function qaMode(): boolean {
  try {
    return (
      new URLSearchParams(window.location.search).get('qa') === '1' ||
      window.localStorage.getItem(LS_QA) === '1'
    );
  } catch {
    return false;
  }
}

export function qaPlayerMnemonic(): string | null {
  try {
    return window.localStorage.getItem(LS_PLAYER);
  } catch {
    return null;
  }
}

export function qaActive(): boolean {
  return qaMode() && !!qaPlayerMnemonic();
}

export async function qaPlayerAddress(): Promise<string | null> {
  const mn = qaPlayerMnemonic();
  if (!mn) return null;
  const algosdk = await import('algosdk');
  return algosdk.mnemonicToSecretKey(mn).addr.toString();
}

// Pera-compatible group signer driven by the injected testnet key
export async function qaSignFn(): Promise<TxSignFn> {
  const mn = qaPlayerMnemonic();
  if (!mn) throw new Error('QA player key not injected');
  const algosdk = await import('algosdk');
  const sk = algosdk.mnemonicToSecretKey(mn).sk;
  return async (groups) => {
    const out: Uint8Array[] = [];
    for (const g of groups) for (const w of g) out.push(w.txn.signTxn(sk));
    return out;
  };
}

// the QA player "plays" a deterministic score (beats/looses on demand)
export function qaScore(): number {
  try {
    const v = Number(window.localStorage.getItem('gonna.qa.score'));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 5_000_000;
  } catch {
    return 5_000_000;
  }
}
