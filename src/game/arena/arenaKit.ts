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

// NOTE: top-level foldable expression (NO function wrapper) — vite statically
// replaces import.meta.env?.VITE_ARENA_NETWORK and the minifier folds the
// whole chain, so IS_MAINNET/NET are build-time constants and the inactive
// network row is dead-code-eliminated from the shipped bundle.
// (import.meta.env is simply undefined under node/test bundles — `?.` never throws)
export const ARENA_NETWORK: ArenaNetwork = import.meta.env?.VITE_ARENA_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
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

// M-4: separate named rows + a STATIC conditional for NET. vite replaces
// import.meta.env.VITE_ARENA_NETWORK at build time, so on a mainnet build
// IS_MAINNET folds to `true`, the ternary folds to MAINNET_CFG, and the
// whole testnet row is dead-code-eliminated from the bundle (zip audit:
// zero testnet ids/addrs in the mainnet artifact). Keep ARENA_NETS only as
// a tooling/testing export — nothing in src may import it.
const TESTNET_CFG: ArenaNetConfig = {
    appId: 769907387, // ARENA APP v2.1
    legacyAppId: 769688298, // QuantumArena v1 (superseded)
    gonnaAsa: 769688287,
    opUpAppId: 769688641,
    treasuryAddr: '4OQ3LJ3JW67JEY55TMHLGZG3MWWLTVFZERGY67LBJEJLOGEUUX2PYHQGGM',
    oracleAddr: 'COI33V32HHFEGZFVGBZHD2A67TSQ4JHHTS5CE37VNLGIQHOHCP4FI4KNFA',
    algodUrl: 'https://testnet-api.algonode.cloud',
    oracleBaseUrl: 'https://gonna-arena-oracle-testnet.onrender.com',
};

const MAINNET_CFG: ArenaNetConfig = {
    // M-2 mainnet deploy (scripts/mainnet-deploy-report.md): app 3686311434,
    // escrow 3XEQEDORZHI…47UM (app address, derived — never hardcoded below).
    appId: 3686311434,
    legacyAppId: 0, // no legacy on mainnet
    gonnaAsa: 2582294183, // REAL mainnet $GONNA (same id as src/game/wallet.ts)
    // M-4: NO OpUp donor app on mainnet — contract.py never references it
    // (it is a CLIENT-side pooled-budget booster, not a contract dependency)
    // and the mainnet bootstrap did only the GONNA opt-in. opupTxns() omits
    // the donor calls when this is 0. If a create/join/close group ever hits
    // the opcode budget on mainnet, deploy the donor (deploy/opup.ts) and
    // fill this id — documented in the M-4 report.
    opUpAppId: 0,
    treasuryAddr: 'GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU',
    oracleAddr: '3UVNPC3IOM42HZS5HZJPVH6LBBJOJFF2WHQ4K5SDYJKKWFAJ36SKXILG4Y',
    algodUrl: 'https://mainnet-api.algonode.cloud',
    oracleBaseUrl: 'https://gonna-arena-oracle-testnet.onrender.com', // same Render service; flipped env-side to mainnet
};

// tooling/testing export — src must consume NET, never ARENA_NETS
export const ARENA_NETS: Record<ArenaNetwork, ArenaNetConfig> = { testnet: TESTNET_CFG, mainnet: MAINNET_CFG };
// static conditional: folds at build time (see comment above) — the inactive
// row never ships inside a bundle of the other network
export const NET: ArenaNetConfig = IS_MAINNET ? MAINNET_CFG : TESTNET_CFG;

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
