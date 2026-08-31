// ============================================================================
// THE ARENA — TESTNET wallet connect (Pera / Defly), chainId 416002.
// Isolated from ../wallet.ts on purpose: THE GATE is mainnet-locked, THE
// ARENA speaks testnet until the mainnet deploy is approved by the Prince.
// Mobile: Pera wallet app -> developer settings -> TESTNET mode.
// ============================================================================
import { withTimeout } from './testnetKit';
import { netLsKey } from './arenaKit';
import type { TxSignFn } from './testnetKit';

// v14.2: a stale WC session can hang reconnectSession() too — probe with a
// deadline so a dead session never freezes CONNECT or the signer chain.
const PROBE_TIMEOUT_MS = 12_000;

type PeraWalletConnectT = import('@perawallet/connect').PeraWalletConnect;

// M-1: NETWORK-SCOPED — a saved live-adapter account must not leak cross-net
// M-4: base key renamed testnet->live (the network scope already carries
// .testnet/.mainnet) — a stale testnet-named key must not ship in mainnet
const LS_ACCT = netLsKey('gonna.arena.live.addr');

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
    const existing = await withTimeout(p.reconnectSession(), PROBE_TIMEOUT_MS, 'reconnect probe timeout');
    if (existing && existing.length > 0) return store(existing[0]);
  } catch { /* no live session (or a hung one) — fall through to connect() */ }
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
    // v14.2: hang-proof probe — a stale session must NOT freeze the signer
    // chain (the fallback to the gate session has to get its chance)
    const accounts = await withTimeout(p.reconnectSession(), PROBE_TIMEOUT_MS, 'reconnect probe timeout');
    if (!accounts.includes(address)) {
      console.debug('[arena] arena Pera session dead/mismatched — no live signer here');
      return null;
    }
    console.debug('[arena] arena Pera session LIVE for ' + address.slice(0, 6) + '..');
    return peraSignFn(address);
  } catch (e) {
    console.debug('[arena] arena Pera probe failed:', e);
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

// v15.2.2 WEDGE CURE (the founder's fix, automated): a Pera modal stuck on
// "Please launch Pera Wallet..." followed by "REQUEST PENDING: THE USER
// CURRENTLY HAS ANOTHER REQUEST THAT IS IN PROGRESS" means the WalletConnect
// session is wedged. The cure that worked by hand: DISCONNECT (drops the
// pending request) then RECONNECT a fresh session — the next sign pairs clean.
// Unlike disconnectTestnetPera() the stored address SURVIVES: identity is not
// the problem, the session is.
export async function recoverTestnetSession(): Promise<void> {
  try {
    const p = await peraInstance();
    // disconnect can wedge too — never let the cure hang the RETRY
    await withTimeout(p.disconnect(), PROBE_TIMEOUT_MS, 'disconnect timeout');
  } catch {
    pera = null; // instance wedged beyond disconnect — rebuild it from scratch
  }
  // fresh WC session: reconnectSession is empty after a disconnect, so this
  // opens a NEW pairing (Pera app-switch / QR) and stores the account again
  await connectTestnetPera();
}

// v17.0.8 (Prince: "CANNOT READ PROPERTIES OF NULL (READING
// 'SENDCUSTOMREQUEST')"): the Pera lib can hand back a LIVE-looking session
// (reconnectSession returns the cached account) while its internal
// WalletConnect client is NULL — every sign then dies inside the lib with
// that raw TypeError and the degen is locked out of ACCEPT / CREATE / CLAIM.
// Narrow detector: ONLY the null-client crash class qualifies — a user
// rejection ('rejected' / 'cancelled') must NEVER trigger the heal.
export function isPeraSessionFatal(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? e ?? '').toLowerCase();
  if (m.includes('reject') || m.includes('cancel') || m.includes('declin')) return false;
  return m.includes('sendcustomrequest') || (m.includes('null') && (m.includes('client') || m.includes('reading')));
}

// Pera-compatible atomic-group signer for the connected testnet account.
// v17.0.8: on the null-client crash, HEAL (drop the wedged session, rebuild
// the instance, reconnect) and retry the SAME sign ONCE — all inside the
// original tap's user gesture, so a fresh pairing is allowed to open.
export async function peraSignFn(address: string): Promise<TxSignFn> {
  const p = await peraInstance();
  return async (groups) => {
    console.debug('[arena] pera.signTransaction → ' + groups.length + ' group(s) for ' + address.slice(0, 6) + '..');
    const toSign = groups.map((g) => g.map((w) => ({ txn: w.txn, signers: [address] })));
    try {
      const signed = await p.signTransaction(toSign);
      console.debug('[arena] pera.signTransaction ✓ ' + signed.length + ' signed');
      return signed as Uint8Array[];
    } catch (e) {
      if (!isPeraSessionFatal(e)) throw e;
      console.debug('[arena] pera session fatal mid-sign — heal + one retry:', e);
      try {
        await withTimeout(p.disconnect(), PROBE_TIMEOUT_MS, 'disconnect timeout');
      } catch {
        pera = null; // wedged beyond disconnect — rebuild from scratch
      }
      const p2 = await peraInstance();
      let accounts: string[] = [];
      try {
        accounts = await withTimeout(p2.reconnectSession(), PROBE_TIMEOUT_MS, 'reconnect timeout');
      } catch { /* session truly gone */ }
      if (!accounts.includes(address)) {
        throw new Error('WALLET SESSION LOST - TAP CONNECT TO RE-PAIR');
      }
      const signed = await p2.signTransaction(toSign);
      console.debug('[arena] pera.signTransaction ✓ after heal, ' + signed.length + ' signed');
      return signed as Uint8Array[];
    }
  };
}
