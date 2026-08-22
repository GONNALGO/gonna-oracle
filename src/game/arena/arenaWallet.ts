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
import { connectTestnetPera, peraSignFn, reconnectTestnetPera, testnetAddress } from './testnetWallet';
import { qaActive, qaPlayerAddress, qaSignFn } from './qaSigner';

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
const LS_ANON = 'gonna.arena.anon';
const LS_QA_ADDR = 'gonna.qa.player.addr'; // injected by the QA harness
export function arenaAddress(): string {
  if (arenaMode() === 'testnet') {
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
  if (arenaMode() === 'testnet') return connectTestnetPera();
  return wallet.connect(provider);
}

// TESTNET identity provider for the real adapter: QA signer (automation)
// first, then the arena-side Pera testnet session, and finally the MAIN
// GATE session (ONE GATE, ONE NETWORK: on the staging path the gate itself
// speaks testnet, so its WalletConnect session signs ARENA groups too).
setTestnetIdentityProvider(async () => {
  if (qaActive()) {
    const address = await qaPlayerAddress();
    if (address) return { address, sign: await qaSignFn() };
  }
  const addr = testnetAddress() ?? (await reconnectTestnetPera());
  if (addr) return { address: addr, sign: await peraSignFn(addr) };
  // final fallback: main-gate session (wallet.ts signs via Pera/Defly lib)
  const w = wallet.getWallet();
  if (w.address && wallet.isConnected()) {
    return { address: w.address, sign: (groups) => wallet.signTransactions(groups) };
  }
  return null;
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
