# QuantumArena v2.1 — deploy plan (C-FIX tie bug). NO DEPLOY before GO.

## What ships

`contracts/quantum_arena/contract.py` tie branch of `resolve`: emits
`ChallengeResolved(zero-address, 0, 0)` FIRST, then delegates to
`_refund_all(cid, meta, roster, reason=3)` (by-value subroutine args →
materialized roster → box deletes are safe). Box deletes moved into the
non-tie branch only. Same refunds, same MBR payback, same events, same
event order. No other logic change.

Compiled artifacts are committed (`contracts/quantum_arena/artifacts/`,
puya **5.10.0** — pinned: the pre-fix source recompiles byte-identical to
the previously deployed artifact; 5.10.1 drifts and must NOT be used).

## Pre-flight (all green on branch contract-v21)

- `pytest contracts/quantum-arena/tests/` → **78/78** (72 legacy + 6 C-FIX)
- static TEAL gate: no box read reachable after box_del in any subroutine
- fixed approval TEAL assembles via algod (4405 bytes; pre-fix was 4473)

## Deploy steps (after GO)

```bash
cd contracts/quantum-arena/deploy
python3 deploy_v21.py --dry-run   # sanity: keys, state, backup plan
python3 deploy_v21.py             # create + bootstrap via stock deploy_contract.py
```

`deploy_v21.py` backs up `testnet.json` → `testnet.json.bak-v2`, clears the
v2 app keys, runs the stock deploy (same DEPLOYER/TREASURY/ORACLE keys from
gitignored `testnet.secrets.json`), prints the new `app_id` + escrow.
On failure it restores the backup.

## Flip list (app id 769767443 → NEW v2.1 id) — LEAD owns, NOT touched here

Runtime constants (REQUIRED):
- `src/game/arena/testnetKit.ts:8` — `export const ARENA_APP_ID = 769767443;` (single source of truth)
- oracle server env: `ARENA_APP_ID` (`.env.example:6` default + the live env); the server asserts health.appId == env
- `oracle-server/replay-bundles/engine-*.mjs:35254` — embedded ARENA_APP_ID; **rebuild bundles** (`node scripts/build-replay-bundle.mjs --from-dist`) after the kit flip, commit new VER, keep old ones for in-flight logs

Deploy state/docs:
- `contracts/quantum-arena/deploy/testnet.json:28` — written by deploy_v21.py
- `contracts/quantum-arena/deploy/README-testnet.md:118,139` — app id + explorer URL

QA/test constants (harnesses; flip when re-running against v2.1):
- `oracle-server/test/helpers.ts:22` (`TEST_APP_ID`), `oracle-server/test/vectors.test.ts:22`, `oracle-server/test/receiptRateBoot.test.ts:123`
- `scripts/test-v1527.mjs:108`, `test-v1527b.mjs:137`, `test-v1528.mjs:232`, `test-v1528b.mjs:77` (embedded `export const ARENA_APP_ID`), plus comments in `sim-*.mjs`, `test-v1529/v1531`, `recon-v1529.mjs`
- `src/game/arena/chainAdapter.ts:903`, `testnetKit.ts:5,1073` (comments)

## Chain-state notes

- v2 app 769767443 stays live for its existing cards; v2.1 is a NEW app id.
- cid 56 (bricked tie) is recoverable on v2 via `catastrophe_refund` from
  2026-09-03T01:36:29Z (deadline + 7d) — no action needed now.
- After the kit flip, `fetchArenaCreateStages`/indexer history for v2 cards
  is unaffected (history is per-app-id).
