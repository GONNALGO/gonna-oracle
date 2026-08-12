// v9.5: live Algorand block number for the THRONE ROOM frieze.
// The game is on-chain — the cathedral wall proves it. Cheap, cached, silent.

let lastRound = 0;
let lastFetch = 0;
let flying = false;

// ~2.9s per block on mainnet: estimate between indexer polls so the frieze
// keeps counting live instead of jumping every 30s.
export function latestAlgorandRound(): number {
  const now = Date.now();
  if (!flying && now - lastFetch > 30000) {
    flying = true;
    lastFetch = now;
    fetch('https://mainnet-idx.algonode.cloud/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        const round = (j as { round?: number } | null)?.round;
        if (typeof round === 'number' && round > 0) lastRound = round;
      })
      .catch(() => {
        /* cosmetic — the frieze just keeps its last number */
      })
      .finally(() => {
        flying = false;
      });
  }
  if (lastRound === 0) return 0;
  return lastRound + Math.floor((now - lastFetch) / 2900);
}
