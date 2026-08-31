// THE ARENA — wallet connect, isolated on purpose.
// Pera / Defly sessions already live in ../wallet.ts (THE GATE); this module
// is the ARENA-facing facade: identity + account type (ed25519 vs Falcon PQ)
// + the future signing entry point for challenge transactions.
//
// TODO(testnet): real transaction signing arrives AFTER the QuantumArena
// testnet deploy. Today every "SIGN & ..." button in the ARENA runs on the
// MOCK adapter (chainAdapter.ts) — nothing here touches a wallet prompt yet.
// Wiring checklist when the deploy lands:
//   1. set ARENA_APP_ID / GONNA_ASA_TESTNET in chainAdapter.ts
//   2. pass wallet.signTransactions into TestnetArenaAdapter (sign fn)
//   3. detect the account type from the connected account (Falcon accounts
//      advertise a PQ signature scheme — until the standard finalizes we
//      fall back to 'ed25519' + the QA override flag)
//   4. surface connectArenaWallet() on the CREATE CARD screen (the gate
//      connect scene already handles Pera/Defly app-switch on mobile)

import * as wallet from '../wallet';
import type { AccountType, ChallengePlayer } from './chainAdapter';
import { arenaMode, mockAccountType, setTestnetIdentityProvider } from './chainAdapter';
import { connectTestnetPera, isPeraSessionFatal, liveTestnetSignFn, recoverTestnetSession, testnetAddress } from './testnetWallet';
import { qaActive, qaPlayerAddress, qaSignFn } from './qaSigner';
import { setSignRecoverHook } from './testnetKit';
import { netLsKey } from './arenaKit';
import type { TxSignFn } from './testnetKit';

export type ArenaWalletProvider = wallet.WalletProvider;

export interface ArenaSession {
  connected: boolean;
  address: string | null;
  label: string; // pixel-UI identity (NFD segment or short address)
  accountType: AccountType;
  mocked: boolean;
}

export function arenaSession(): ArenaSession {
  const w = wallet.getWallet();
  return {
    connected: w.address !== null,
    address: w.address,
    label: w.address ? wallet.identityLabel(16) : '',
    accountType: mockAccountType(), // TODO(testnet): detect Falcon from the account
    mocked: w.mocked,
  };
}

// wallet-less degens still get a STABLE pseudo-address (persisted) so a QA
// session can create -> join -> submit -> claim without a wallet prompt
// M-1: NETWORK-SCOPED — anon arena identities stay inside their network
const LS_ANON = netLsKey('gonna.arena.anon');
const LS_QA_ADDR = 'gonna.qa.player.addr'; // injected by the QA harness
export function arenaAddress(): string {
  if (arenaMode() === 'live') {
    // TESTNET identity: QA signer first (automation), then Pera testnet
    try {
      const qa = window.localStorage.getItem(LS_QA_ADDR);
      if (qaActive() && qa) return qa;
    } catch { /* no storage */ }
    const p = testnetAddress();
    if (p) return p;
  }
  const w = wallet.getWallet();
  if (w.address) return w.address;
  try {
    let a = window.localStorage.getItem(LS_ANON);
    if (!a) {
      a = 'ANON' + Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[b & 31]).join('');
      window.localStorage.setItem(LS_ANON, a);
    }
    return a;
  } catch {
    return 'ANONDEGEN';
  }
}

// the ARENA signs with the SAME Pera/Defly session as THE GATE in mock/mainnet
// mode; on testnet it uses the dedicated chainId-416002 Pera instance.
export async function connectArenaWallet(provider: ArenaWalletProvider): Promise<string> {
  if (arenaMode() === 'live') return connectTestnetPera();
  return wallet.connect(provider);
}

// TESTNET identity provider for the real adapter: QA signer (automation)
// first, then whichever Pera session is ALIVE — the arena-side instance OR
// the main gate (ONE GATE, ONE NETWORK). The sign fn is BULLETPROOF: it
// probes the arena instance per call and falls back to the gate session;
// if nothing can sign, it throws a VISIBLE error instead of a dead click.
setTestnetIdentityProvider(async () => {
  if (qaActive()) {
    const address = await qaPlayerAddress();
    if (address) return { address, sign: await qaSignFn() };
  }
  const arenaAddr = testnetAddress(); // adopted at gate connect or board CONNECT
  const gateAddr = wallet.isConnected() ? wallet.getWallet().address : null;
  const target = arenaAddr ?? gateAddr;
  if (!target) return null;
  const sign: TxSignFn = async (groups) => {
    // 1) arena-side Pera instance — only with a verified live session
    const arenaSign = await liveTestnetSignFn(target);
    if (arenaSign) {
      console.debug('[arena] signer chosen: arena Pera (live session)');
      try {
        return await arenaSign(groups);
      } catch (e) {
        // v17.0.9 (Prince: the DEAD DUPLICATE request): the gate fallback must
        // fire ONLY when the arena session is genuinely DEAD (null WC client).
        // ANY other error — user rejection, wallet timeout, a lost response —
        // already delivered a request to Pera; re-signing through the gate
        // fires a SECOND, IDENTICAL request that surfaces minutes later as a
        // dead transaction to sign. Rethrow instead: one group, one request.
        if (!isPeraSessionFatal(e)) throw e;
        console.debug('[arena] arena Pera session fatal, trying gate fallback:', e);
      }
    }
    // 2) main-gate session (same WC storage; the gate speaks testnet here)
    if (gateAddr === target && wallet.isConnected()) {
      console.debug('[arena] signer chosen: gate session fallback');
      return wallet.signTransactions(groups);
    }
    console.debug('[arena] NO live signer — WALLET NOT CONNECTED');
    throw new Error('WALLET NOT CONNECTED - TAP CONNECT');
  };
  return { address: target, sign };
});

// v15.2.2: the WEDGE CURE behind every RETRY on a stuck sign wait. Drops the
// wedged WalletConnect session and forces a FRESH reconnect BEFORE the
// re-send (the founder's manual disconnect+reconnect, automated). Heals
// whichever session the signer chain would actually use.
setSignRecoverHook(async () => {
  // CI hook (same precedent as __arenaIdProvider): the harness stubs the heal
  // — a real recovery opens a Pera pairing that no headless degen can approve
  const ov = (window as unknown as { __arenaRecover?: () => Promise<void> }).__arenaRecover;
  if (ov) return ov();
  if (qaActive()) return; // the QA signer never wedges — nothing to heal
  if (arenaMode() === 'live') {
    if (testnetAddress()) {
      await recoverTestnetSession(); // arena-side Pera (chainId 416002)
      return;
    }
    if (wallet.isConnected()) return wallet.recoverSession(); // gate IS the arena identity on staging
    return;
  }
  if (wallet.isConnected()) await wallet.recoverSession(); // mock/mainnet gate signer
});

export async function disconnectArenaWallet(): Promise<void> {
  return wallet.disconnect();
}

// build the player record that joins/creates a challenge
export function arenaPlayer(fighter: { skin: string; assetId: number | null; name: string }): ChallengePlayer {
  const s = arenaSession();
  return {
    address: arenaAddress(),
    name: s.connected ? s.label : 'YOU_DEGEN',
    score: 0,
    fighter: { ...fighter },
    accountType: s.accountType,
  };
}

// CI/QA: flip the local account to Falcon (PQ fees + QUANTUM SEAL badge)
export function debugSetFalcon(on: boolean): void {
  try {
    if (on) window.localStorage.setItem('gonna.arena.falcon', '1');
    else window.localStorage.removeItem('gonna.arena.falcon');
  } catch { /* storage unavailable */ }
}
