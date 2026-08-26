// ============================================================================
// THE ARENA — NETWORK CONFIG (M-1 client mainnet). ONE module owns every
// network-bound constant of the arena: app ids, ASA, treasury/oracle addrs,
// algod, oracle base URL. The network is a BUILD-TIME choice:
//   VITE_ARENA_NETWORK=mainnet  -> mainnet row below (vite statically bakes it)
//   anything else / unset       -> testnet (today's behavior, byte-identical)
// MAINNET ROW: appId/opUp/treasury/oracle are PLACEHOLDERS until the M-2
// contract deploy — the mainnet path must not be reachable before the flip
// (see arenaMode(): the live adapter stays gated off the public default).
// The GONNA ASA is REAL already (mainnet 2582294183 — the main game wallet
// has always lived on mainnet).
// ============================================================================
export type ArenaNetwork = 'testnet' | 'mainnet';

function envNetwork(): ArenaNetwork {
  try {
    return import.meta.env?.VITE_ARENA_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  } catch {
    return 'testnet'; // node/test bundles without import.meta.env
  }
}
export const ARENA_NETWORK: ArenaNetwork = envNetwork();
export const IS_MAINNET = ARENA_NETWORK === 'mainnet';

export interface ArenaNetConfig {
  appId: number; // QuantumArena v2 application id
  legacyAppId: number; // superseded v1 app (old cards stay resolvable there)
  gonnaAsa: number; // $GONNA ASA id
  opUpAppId: number; // pooled-opcode-budget donor app
  treasuryAddr: string;
  oracleAddr: string;
  algodUrl: string;
  oracleBaseUrl: string; // same Render service on both rows today; the mainnet flip is env-side at M-2
}

export const ARENA_NETS: Record<ArenaNetwork, ArenaNetConfig> = {
  testnet: {
    appId: 769907387, // ARENA APP v2.1
    legacyAppId: 769688298, // QuantumArena v1 (superseded)
    gonnaAsa: 769688287,
    opUpAppId: 769688641,
    treasuryAddr: '4OQ3LJ3JW67JEY55TMHLGZG3MWWLTVFZERGY67LBJEJLOGEUUX2PYHQGGM',
    oracleAddr: 'COI33V32HHFEGZFVGBZHD2A67TSQ4JHHTS5CE37VNLGIQHOHCP4FI4KNFA',
    algodUrl: 'https://testnet-api.algonode.cloud',
    oracleBaseUrl: 'https://gonna-arena-oracle-testnet.onrender.com',
  },
  mainnet: {
    appId: 0, // PLACEHOLDER — M-2 deploy flips this (0 = unreachable on purpose)
    legacyAppId: 0, // no legacy on mainnet
    gonnaAsa: 2582294183, // REAL mainnet $GONNA (same id as src/game/wallet.ts)
    opUpAppId: 0, // PLACEHOLDER — M-2
    treasuryAddr: '', // PLACEHOLDER — M-2
    oracleAddr: '', // PLACEHOLDER — M-2
    algodUrl: 'https://mainnet-api.algonode.cloud',
    oracleBaseUrl: 'https://gonna-arena-oracle-testnet.onrender.com', // same Render service; flipped at M-2
  },
};

export const NET: ArenaNetConfig = ARENA_NETS[ARENA_NETWORK];

// M-1: testnet demo fixtures (GONNA 7/42 on the connected shelf, mock piazza
// dressing) are DEV-ONLY — a mainnet build must never show fake holdings.
export const ARENA_FIXTURES_ENABLED = ARENA_NETWORK === 'testnet';

// M-1 mainnet-leak guard: network-scoped localStorage keys. A testnet-era
// value (live-adapter flag, oracle override, saved account, mock piazza) must
// NEVER leak into a mainnet session — or vice versa. Every network-bound key
// carries the network suffix; game-global keys (zoom, best score) stay plain.
export function netLsKey(base: string): string {
  return base + '.' + ARENA_NETWORK;
}
