# RUNBOOK — GONNA ARENA Server Oracle

## Key custody

- The oracle mnemonic lives ONLY in `ORACLE_MNEMONIC_FILE` (0600, mounted
  secret, outside the repo/image). Never in env-inline on shared hosts, never
  in git, never in logs, never in API responses, never in the DB.
- Boot log prints only public data (addresses are public on-chain).
- The server refuses to start when the derived address ≠ on-chain
  `oracle_pub_key`, so a wrong secret can never sign for the app.

## Key rotation

The oracle pubkey is **immutable on-chain** (contract v2 FROZEN: set at
`create`, no update method). Rotation therefore means:

1. Deploy a NEW contract instance with the new `oracle_pub_key` (and new
   `ARENA_APP_ID` env on the server). Old cards stay resolvable on the old app
   with the old key — keep the old server config available until every open
   card on the old app is terminal.
2. Repoint client config to the new app id.

Plan for contract v3: add an oracle-key rotation method (or a controlled
rekey) so rotation no longer implies redeploy.

## KMS/HSM target (mainnet)

M1 keeps the key in a file secret. Mainnet target:

- Move signing behind a KMS/HSM (or cloud signer) exposing ed25519 detached
  signing over the raw 32-byte seed model. `src/sign.ts` isolates signing
  behind the `OracleSigner` interface (`{addr, publicKey, sign(msg)}`) — swap
  `signerFromMnemonic` for a KMS-backed implementation without touching
  verify/chain/store.
- Until then: secret file on a tmpfs mount, host with no interactive access,
  image without the key baked in.

## Monitoring

Daily (cron + indexer):

1. **Verdict reconciliation**: list `resolve` app-calls on the app id via the
   indexer; for every resolved cid check that `sigs` has rows for it
   (`Store.knownSigCids()`). **Alert on any verdict for a cid unknown to the
   `sigs` table** — that means a verdict was signed outside this service
   (key compromise or rogue signer).
2. **Receipt audit**: `receipts` rows where `consumed=0` older than 7 days
   (paid but unused continues) — informational.
3. **Rate-limit pressure**: count of 429s in logs per IP/addr; raise
   `MAX_SIG_PER_MIN` only after checking the sigs table for abuse patterns.
4. **Indexer/algod health**: 503s with reason "stage commitment unavailable"
   mean the indexer scan is failing — the service degrades to refusing
   stage-mode signatures (fail-closed, by design).

## Failure modes

| symptom | meaning | action |
|---|---|---|
| boot exit 1 "oracle ... mismatch" | wrong/rotated key file vs app id | fix secret or app id; never bypass |
| boot exit 1 "treasury ... mismatch" | env points at another app instance | fix env |
| boot exit 1 "no engine bundles" | REPLAY_ENFORCE=1 with empty replay-bundles/ | build+commit the bundle for the live client build (`scripts/build-replay-bundle.mjs <VER>`); emergency only: `REPLAY_ENFORCE=0` (M1 structural checks, NO replay — log the incident, re-enable ASAP) |
| 400 "BUILD UNKNOWN TO THE ORACLE" | client build newer than the bundle set | build the bundle for that VER and redeploy |
| 400 "REPLAY MISMATCH" | log/score not reproducible (cheat or client bug) | legit refusal; if legit clients hit it, suspect an engine bundle/client skew — verify bundle VER == live client VER |
| 500 "REPLAY TIMEOUT - RETRY" | replay exceeded wall-clock budget | client retries; if persistent, raise REPLAY_TIMEOUT_MS and plan the worker_threads pool (M3) |
| 503 "stage commitment unavailable" | indexer down/lagging at cold start | check indexer; retry (cache 30s) |
| 409 "not resolvable yet" on verdict | legitimate — card not ready | none |
| SQLite I/O errors | `/data` not a real fs / full disk | fix volume, WAL needs mmap |

## Backup

`/data/oracle.db` (+ `-wal`) — the `sigs`/`receipts` tables are the only
non-chain state. Nightly file copy is enough; chain remains the source of
truth for everything else.
