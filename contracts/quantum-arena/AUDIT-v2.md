# QuantumArena v2 — Self-Audit (fund flows & failure modes)

Scope: the v2 delta on top of v1 (`contracts/quantum_arena/contract.py`).
v1 invariants preserved intact: oracle signature binding (app+cid+seat+addr+score),
tie → full refund zero fee, `assert_no_rekey` on every entry point and on every
outer payment/axfer, checks-effects-interactions everywhere, seats ∈ {1,4,8,12},
MAX_PLAYERS=13, JOIN_CUTOFF, CATASTROPHE_WINDOW, permissionless resolve.

## State changes (V2-D)

- `ChallengeMeta` grew by `mbr_paid: UInt64` (exact ALGO paid for the boxes at
  create, recorded from the actual `mbr_payment.amount`).
- `PlayerEntry` grew by `seated_at: UInt64` (create timestamp for seat 0, join
  timestamp for joiners).
- Global state grew by `version: uint64 = 2` (deploy schema 3int/2byte → 4int/2byte;
  `deploy/deploy_contract.py` updated accordingly). Module constant `VERSION = 2`.
- New status constant `STATUS_FORFEIT = 4` (terminal transition of `claim_forfeit`).
- New event `ChallengeForfeited(challenge_id, winner, payout, fee)`.

### Box sizes (measured, algopy ABI encoding)

| box | key | v1 value | v2 value | v2 MBR |
|---|---|---|---|---|
| meta `m`+id | 9 B | 140 B | 148 B | 2500 + 2500·157 = **395 000 µA** |
| players `p`+id (13 entries worst case) | 9 B | 613 B | 717 B (2 + 13·55) | 2500 + 2500·726 = **1 817 500 µA** |
| **total** | | | | **CHALLENGE_MBR = 2 212 500 µA (≈ 2.21 ALGO)** |

v1 charged only 350 000 µA, which never covered a full 12-seat rumble on-chain
(the app balance silently subsidized resizes) and was never returned — the bug
V2-B fixes. `CHALLENGE_MBR` is now the exact worst-case requirement; any
overpayment is recorded in `mbr_paid` and returned in full on close.

## Close-path model (V2-B) — "no funds locked"

Every terminal transition now **deletes both boxes** and sends an inner ALGO
payment of `mbr_paid` to the box payer (the creator). The terminal status
(RESOLVED / REFUNDED / FORFEIT) is observable via the emitted ARC-28 events;
no storage — and therefore no MBR — is left behind. After any close, every
method fails with `challenge not found`, making double-spends impossible by
construction.

## Method-by-method fund flows

### `create_challenge` (modified)

- Pays: creator — MBR (≥ 2 212 500 µA, recorded as `mbr_paid`) + stake in $GONNA.
- Receives: app escrow (both).
- Change vs v1: records `mbr_paid`, `seated_at[creator] = now`. No inner txns
  (unchanged). Failure modes unchanged (bad proof, wrong asset/amount, low MBR,
  rekey, …) — all revert the whole group atomically.

### `spawn_rumble` (NEW, V2-C)

- Group: `[mbr pay, $GONNA stake axfer, 1 ALGO fee pay, app call]`. Permissionless.
- Pays: caller — MBR (→ app, recorded), stake (→ app escrow), exactly 1 ALGO
  anti-spam fee (→ treasury, same convention as `early_close`).
- Receives: treasury (1 ALGO), app escrow (MBR + stake).
- Caller becomes creator (seat 0) **unsigned** (no oracle gate); they may
  `submit_score` later like any player, else they forfeit into the pot at
  resolve. Deadline = next 21:00 UTC, pushed +1 day if < 4h away (minimum
  participation window, always ≫ JOIN_CUTOFF).
- seats ∈ {4,8,12} only (duels stay on `create_challenge`).
- Failure modes: any assert (bad seats/stake/fee/MBR/asset/rekey) reverts the
  whole 4-txn group — no partial funding is possible. No inner txns in this
  method. Spam is bounded only by cost (stake + MBR + 1 ALGO), per SPEC.

### `join_challenge` (modified)

- Change vs v1: records `seated_at[joiner] = now`. Fund flow unchanged
  (joiner stake → app escrow; group-atomic).

### `submit_score` (unmodified)

- No fund movement. Note: works for spawned-rumble creators too (they start
  unsigned); v1 duel creators are already signed at create and cannot resubmit
  (unchanged v1 rule).

### `resolve` (modified, V2-B)

- Eligibility, verdict verification, winner selection, tie handling: unchanged.
- Fund flow (non-tie): pot − 5% → winner, 5% → treasury (skipped if fee == 0),
  **plus `mbr_paid` ALGO → creator**. Tie: every payer refunded in full,
  zero fee, **plus `mbr_paid` ALGO → creator**.
- CEI: both boxes are deleted *before* any inner txn is submitted.
- Failure modes: unchanged v1 gates (`not active`, `not resolvable yet`,
  bad verdict/seed/stage args). An inner-txn failure cannot occur in practice:
  the app escrow always holds exactly the stakes it pays out (conservation is
  enforced at join/spawn by equality checks on the axfers) and the MBR refund
  is covered by the MBR collected at create.

### `claim_forfeit` (NEW, V2-A — duels only)

- Gates: challenge active; `seats_total == 1`; both seats taken; `seat ∈ {0,1}`;
  caller is the opponent (the other seat); **caller signed**; **target NOT
  signed**; `now > seated_at[target] + 3600` (strict).
- Fund flow: caller's own stake → caller (in full); forfeited stake: 95% →
  caller, 5% → treasury (`fee = stake * 500 // 10_000`, same rounding as
  resolve; if fee == 0 — e.g. stake = 1 base unit — no fee txn is emitted and
  the claimant gets everything, no dust is created); `mbr_paid` ALGO → creator
  (the box payer, even when the creator is the forfeiting party).
- CEI: status transition + box deletion happen before all inner txns; a second
  claim fails with `challenge not found`.
- Rekey forbidden on the app call; no outer payments to validate.
- Failure modes: `challenge not found`, `not active`, `forfeit claims are
  duel-only`, `opponent seat empty`, `invalid seat`, `only the opponent can
  claim`, `caller must have a signed score`, `target has a signed score`,
  `seat clock not expired`.
- **SPEC deviation flagged (funds-safest):** the "forfeit creator" case
  (SPEC test 2) is unreachable. v1 — preserved intact per SPEC — requires the
  creator's score to be oracle-signed *at create*, so `target.signed` is always
  true for seat 0 and the guard `not target.signed` always protects the
  creator. The only way to make creator-forfeit reachable would be to weaken
  the v1 create invariant (unsigned creators) or to make every signed joiner
  able to seize every creator's stake after 1h — both are strictly worse for
  fund safety. The test suite pins the conservative behaviour:
  `test_forfeit_creator_impossible_creator_always_signed`.

### `early_close` (modified, V2-B)

- Unchanged: creator-only, un-joined, before deadline, 1 ALGO fee → treasury.
- New: `_refund_all` deletes both boxes and refunds `mbr_paid` → creator.
- Net flow: creator pays 1 ALGO (treasury), receives stake + full MBR back.

### `claim` / `claim_for` / `catastrophe_refund` (modified via `_refund_all`, V2-B)

- Gates and recipients unchanged (stakes always back to the payers; `claim_for`
  pays the creator, never the caller). New: boxes deleted, `mbr_paid` → creator.
  The catastrophe liveness guarantee now also covers the box MBR.

### `create` / `bootstrap` (modified)

- `create` additionally writes `version = 2`. No fund flow changes.

## Locked-funds statement

After this audit, **no code path leaves ALGO or ASA locked in the contract
beyond the funds backing active, open challenges** (stakes + box MBR of
challenges that are still OPEN/CLOSED). Every terminal transition — `resolve`
(win or tie), `claim_forfeit`, `early_close`, `claim`, `claim_for`,
`catastrophe_refund` — distributes 100% of the escrowed ASA stakes (winner /
treasury fee / refunds, exact integer conservation: payouts + fee == pot)
and returns 100% of the recorded ALGO box MBR to its payer, deleting all
per-challenge storage. The only balances the app ever holds are: (a) stakes
and MBR of still-open challenges, (b) the bootstrap surplus kept for the ASA
opt-in MBR and inner-txn fee headroom, which is required for the app to
function and is not player escrow.

## Rounding & edge cases

- 5% fee rounds down (`pot * 500 // 10_000`), favoring players over the
  treasury; at stake = 1 base unit the fee is 0 and no zero-amount fee txn is
  emitted (v1 convention kept).
- Seat clock is strict `>` (claim at exactly `seated_at + 3600` fails).
- Rumble deadline rule: `< 4h` remaining (strict) pushes to the next day;
  exactly 4h remaining keeps the same-day 21:00 UTC.
- Clock independence: `claim_forfeit` does not consult the challenge deadline;
  it is valid during JOIN_CUTOFF and invalid only when the clock has not
  expired or the target signed. Forfeit-vs-submit races resolve deterministically
  by execution order (loser's transaction fails and its group reverts).
