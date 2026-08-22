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
import { mockAccountType } from './chainAdapter';

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
export function arenaAddress(): string {
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

// the ARENA signs with the SAME Pera/Defly session as THE GATE — connecting
// here just forwards to the existing battle-tested flow.
export async function connectArenaWallet(provider: ArenaWalletProvider): Promise<string> {
  // TODO(testnet): after connect, hand wallet.signTransactions to the
  // TestnetArenaAdapter so SIGN & STAKE issues a real group.
  return wallet.connect(provider);
}

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
