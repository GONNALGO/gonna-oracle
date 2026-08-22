// ============================================================================
// THE ARENA — TESTNET wallet connect (Pera / Defly), chainId 416002.
// Isolated from ../wallet.ts on purpose: THE GATE is mainnet-locked, THE
// ARENA speaks testnet until the mainnet deploy is approved by the Prince.
// Mobile: Pera wallet app -> developer settings -> TESTNET mode.
// ============================================================================
import type { TxSignFn } from './testnetKit';

type PeraWalletConnectT = import('@perawallet/connect').PeraWalletConnect;

const LS_ACCT = 'gonna.arena.testnet.addr';

let pera: PeraWalletConnectT | null = null;

async function peraInstance(): Promise<PeraWalletConnectT> {
  if (pera) return pera;
  const mod = await import('@perawallet/connect');
  pera = new mod.PeraWalletConnect({ chainId: 416002 }); // TESTNET
  return pera;
}

export function testnetAddress(): string | null {
  try {
    return window.localStorage.getItem(LS_ACCT);
  } catch {
    return null;
  }
}

// identity bridge: the main GATE session (wallet.ts) adopts the ARENA
// testnet identity on the staging path — one connect covers both.
export function adoptTestnetAddress(addr: string): void {
  try {
    window.localStorage.setItem(LS_ACCT, addr);
  } catch { /* no storage */ }
}

export function clearTestnetAddress(): void {
  try {
    window.localStorage.removeItem(LS_ACCT);
  } catch { /* no storage */ }
}

export async function connectTestnetPera(): Promise<string> {
  const p = await peraInstance();
  const accounts = await p.connect();
  const addr = accounts[0];
  try {
    window.localStorage.setItem(LS_ACCT, addr);
  } catch { /* no storage */ }
  return addr;
}

export async function reconnectTestnetPera(): Promise<string | null> {
  try {
    const p = await peraInstance();
    const accounts = await p.reconnectSession();
    if (accounts.length > 0) {
      try {
        window.localStorage.setItem(LS_ACCT, accounts[0]);
      } catch { /* no storage */ }
      return accounts[0];
    }
  } catch { /* no session */ }
  return testnetAddress();
}

export async function disconnectTestnetPera(): Promise<void> {
  try {
    if (pera) await pera.disconnect();
  } catch { /* already gone */ }
  try {
    window.localStorage.removeItem(LS_ACCT);
  } catch { /* no storage */ }
}

// Pera-compatible atomic-group signer for the connected testnet account
export async function peraSignFn(address: string): Promise<TxSignFn> {
  const p = await peraInstance();
  return async (groups) => {
    const signed = await p.signTransaction(groups.map((g) => g.map((w) => ({ txn: w.txn, signers: [address] }))));
    return signed as Uint8Array[];
  };
}
