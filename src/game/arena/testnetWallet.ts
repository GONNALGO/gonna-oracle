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
  const store = (addr: string): string => {
    try {
      window.localStorage.setItem(LS_ACCT, addr);
    } catch { /* no storage */ }
    return addr;
  };
  // v11 RECONNECT-FIRST: reuse a live WalletConnect session — connect() on
  // top of it throws "Session currently connected" (Prince's staging bug)
  try {
    const existing = await p.reconnectSession();
    if (existing && existing.length > 0) return store(existing[0]);
  } catch { /* no live session */ }
  try {
    const accounts = await p.connect();
    return store(accounts[0]);
  } catch (err) {
    const msg = String((err as { message?: string } | null)?.message ?? err);
    if (!msg.includes('Session currently connected')) throw err;
    try {
      const re = await p.reconnectSession();
      if (re && re.length > 0) return store(re[0]);
    } catch { /* fall through */ }
    try { await p.disconnect(); } catch { /* gone */ }
    const accounts = await p.connect();
    return store(accounts[0]);
  }
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
  // v11: a STALE adopted address is NOT a session — signing through a dead
  // instance dies silently (the Prince's dead SIGN & STAKE). Caller must
  // verify a LIVE session before routing signatures here.
  return null;
}

// LIVE arena-side Pera signer: null unless this instance holds a verified
// WalletConnect session for `address` right now.
export async function liveTestnetSignFn(address: string): Promise<TxSignFn | null> {
  try {
    const p = await peraInstance();
    const accounts = await p.reconnectSession();
    if (!accounts.includes(address)) return null;
    return peraSignFn(address);
  } catch {
    return null;
  }
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
