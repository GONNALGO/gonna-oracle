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

### Box sizes (measured, algopy ABI encoding) — FIX-2

Real on-chain box MBR formula: **2500 + 400·(key_len + value_len)** per box
(2500 µA flat per box + 400 µA per byte; an earlier draft of this audit used
2500/byte, which overcharged ~6.2× — corrected after reviewer measurement).

| box | key | v1 value | v2 value | v2 MBR |
|---|---|---|---|---|
| meta `m`+id | 9 B | 140 B | 148 B | 2500 + 400·157 = **65 300 µA** |
| players `p`+id (13 entries worst case) | 9 B | 613 B | 717 B (2 + 13·55) | 2500 + 400·726 = **292 900 µA** |
| **total** | | | | **CHALLENGE_MBR = 358 200 µA (≈ 0.358 ALGO)** |

This is the final number and it also resolves the SPEC's "(0.35 ALGO o il
valore esatto...)" line: the exact amount charged at create is 0.3582 ALGO,
recorded in `mbr_paid` and returned in full on EVERY close path. For the
record: v1 charged 350 000 µA, which DID cover v1's real worst case
(313 400 µA under the same formula) — v1's bug was not undercharging but
never returning the MBR (fixed by V2-B). v2's `CHALLENGE_MBR` is exact for
the 13-player worst case; any overpayment is recorded and refunded.

## Close-path model (V2-B) — "no funds locked"

Every terminal transition now **deletes both boxes** and sends an inner ALGO
payment of `mbr_paid` to the box payer (the creator). The terminal status
(RESOLVED / REFUNDED / FORFEIT) is observable via the emitted ARC-28 events;
no storage — and therefore no MBR — is left behind. After any close, every
method fails with `challenge not found`, making double-spends impossible by
construction.

## Security-review fixes (round 2)

### FIX-1 (HIGH) — ASA de-opt fund-lock: skip-if-not-opted on every payout

On-chain, an inner axfer to an account that closed its $GONNA opt-in fails
the **whole group**, on every close path, forever (reviewer triggers: griefer
joins a rumble and de-opts to lock the pot; duel winner de-opts after
winning). Fix: every $GONNA payout now routes through `_pay_gonna`, which
reads the receiver's holding via `asset_holding_get` and, if the receiver is
**not opted in, redirects that amount to the treasury** (documented behavior:
unpayable balances go to the treasury — aligns with the founder's "i fondi
vanno al tesoro" mandate). Applied to: `resolve` winner payout, `resolve`
tie refunds, `_refund_all` (claim / claim_for / early_close /
catastrophe_refund), and both `claim_forfeit` payouts. Consequences:

- **No close path can ever fail because of receiver state.** ALGO MBR
  refunds are plain payments and never needed opt-in.
- Conservation still holds exactly: payouts + fee == pot; only the
  *destination* of an unpayable leg changes (player → treasury).
- Winner *selection* is unaffected (events still name the real winner).
- Residual: if the **treasury itself** is not opted, a redirected leg (or a
  fee leg) would fail. Mitigated by FIX-4 (bootstrap gate + runbook); the
  treasury address is immutable after create.
- AVM resource availability: `asset_holding_get` on (player, $GONNA)
  requires the holding to be available. Under AVM v9+ a holding is available
  if **either** side is available, so callers of close paths SHOULD include
  the $GONNA ASA in the foreign-assets array (1 slot, covers all 13 players;
  the alternative — player accounts in the accounts array — only covers 4).
  Worst case without it: a retryable "unavailable resource" error, never a
  fund-lock. The mock framework does not model availability, so this is part
  of the pre-mainnet checklist below.
- Testing: the mock framework DOES model opt-ins (`opted_assets`); tests
  de-opt receivers via `Env.opt_out()` and assert the redirect on every
  close path (`tests/test_security_fixes.py`, 8 cases).
- **Pre-mainnet LocalNet verification note (mock can't fully model chain
  behavior):** before mainnet, run the v2 smoke flow on LocalNet/testnet
  with (a) a rumble player who closes their $GONNA opt-in mid-challenge,
  then `catastrophe_refund`/`resolve` — assert the group succeeds and the
  unpayable leg lands in the treasury; (b) a duel winner de-opting before
  `resolve`; (c) a de-opted creator on `early_close`; (d) repeat (a) with
  the $GONNA ASA omitted from foreign assets to confirm the only failure
  mode is the retryable availability error. Assert final balances to the
  microGONNA, as the v1 smoke test did.

### FIX-2 (MEDIUM) — CHALLENGE_MBR formula

Corrected to the real on-chain box formula 2500 + 400·(key+value) per box →
**358 200 µA** (see the box-size table above). `mbr_paid` recording and
refund tests re-verified against the new constant, including an exact-fit
assertion on measured ledger box sizes and below/above boundary checks.

### FIX-3 (LOW) — uint64 overflow in fee math

`pot * FEE_BPS` / `stake * FEE_BPS` overflow uint64 for amounts
≥ 2⁶⁴/500 ≈ 3.69e16 (reviewer attack A6: `resolve` panics, catastrophe
rescues — a liveness/DoS issue, not theft). All fee math now uses
`protocol_fee(amount) = (amount // 10_000) * 500 + (amount % 10_000) * 500
// 10_000`, which is **exactly** `floor(amount * 500 / 10_000)` (identity:
with a = q·b + r, ⌊a·f/b⌋ = q·f + ⌊r·f/b⌋) and keeps every intermediate
below 2⁶⁴ (q·f ≤ (2⁶⁴−1)/20, r·f < 5·10⁶). Regression tests at the previous
panic boundary (stake = 2⁶³−1 → pot = 2⁶⁴−2) for both `resolve` and
`claim_forfeit`, plus an identity sweep vs. Python big-int including 2⁶⁴−1.

### FIX-4 (LOW) — treasury opt-in liveness + create rekey

- `bootstrap` now asserts once that the treasury holds $GONNA
  (`asset_holding_get`), failing deploy-time misconfiguration before the app
  can accept challenges.
- `create` now also calls `assert_no_rekey_app_call()` (was deployer
  self-harm only, now uniform with every other entry point).
- **Deployment runbook assertion (must be checked pre-mainnet):** the
  TREASURY account MUST be opted into $GONNA before `bootstrap` is called
  (the bootstrap gate enforces it on-chain), and MUST NOT close the opt-in
  afterwards — the treasury collects protocol fees and redirected unpayable
  balances (FIX-1); if it de-opts, close paths involving a fee or a redirect
  fail until it re-opts (liveness issue, funds stay recoverable via
  catastrophe once the treasury re-opts — but do not rely on that).

## Method-by-method fund flows

### `create_challenge` (modified)

- Pays: creator — MBR (≥ 358 200 µA, recorded as `mbr_paid`) + stake in $GONNA.
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
  zero fee, **plus `mbr_paid` ALGO → creator**. Any $GONNA leg whose receiver
  is not opted in is redirected to the treasury (FIX-1); the fee uses
  overflow-safe `protocol_fee` (FIX-3).
- CEI: both boxes are deleted *before* any inner txn is submitted.
- Failure modes: unchanged v1 gates (`not active`, `not resolvable yet`,
  bad verdict/seed/stage args). An inner-txn failure cannot occur in practice:
  the app escrow always holds exactly the stakes it pays out (conservation is
  enforced at join/spawn by equality checks on the axfers), the MBR refund
  is covered by the MBR collected at create, and receiver de-opt no longer
  fails anything (FIX-1; treasury opt-in gated at bootstrap, FIX-4).

### `claim_forfeit` (NEW, V2-A — duels only)

- Gates: challenge active; `seats_total == 1`; both seats taken; `seat ∈ {0,1}`;
  caller is the opponent (the other seat); **caller signed**; **target NOT
  signed**; `now > seated_at[target] + 3600` (strict).
- Fund flow: caller's own stake → caller (in full); forfeited stake: 95% →
  caller, 5% → treasury (`fee = protocol_fee(stake)`, exactly
  `floor(stake * 500 / 10_000)` — same rounding as resolve, overflow-safe
  (FIX-3); if fee == 0 — e.g. stake = 1 base unit — no fee txn is emitted
  and the claimant gets everything, no dust is created); caller legs
  redirect to the treasury if the caller de-opted (FIX-1); `mbr_paid` ALGO
  → creator (the box payer, even when the creator is the forfeiting party).
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
  The catastrophe liveness guarantee now also covers the box MBR. Refund legs
  to de-opted payers redirect to the treasury (FIX-1) — the reviewer trigger
  "griefer de-opts to lock the pot" is dead: the close path always succeeds.

### `create` / `bootstrap` (modified)

- `create` additionally writes `version = 2` and asserts no-rekey (FIX-4).
- `bootstrap` additionally asserts the treasury holds $GONNA (FIX-4 liveness
  gate). No other fund flow changes.

## Locked-funds statement

After this audit, **no code path leaves ALGO or ASA locked in the contract
beyond the funds backing active, open challenges** (stakes + box MBR of
challenges that are still OPEN/CLOSED). Every terminal transition — `resolve`
(win or tie), `claim_forfeit`, `early_close`, `claim`, `claim_for`,
`catastrophe_refund` — distributes 100% of the escrowed ASA stakes (winner /
treasury fee / refunds, exact integer conservation: payouts + fee == pot)
and returns 100% of the recorded ALGO box MBR to its payer, deleting all
per-challenge storage. FIX-1 strengthens this statement: no close path can
be *prevented* by receiver state either — unpayable legs move to the
treasury, they never block the transition. The only balances the app ever
holds are: (a) stakes and MBR of still-open challenges, (b) the bootstrap
surplus kept for the ASA opt-in MBR and inner-txn fee headroom, which is
required for the app to function and is not player escrow.

## Rounding & edge cases

- 5% fee rounds down (exact `floor(amount * 500 / 10_000)` via overflow-safe
  `protocol_fee`, FIX-3), favoring players over the treasury; at stake = 1
  base unit the fee is 0 and no zero-amount fee txn is emitted (v1
  convention kept).
- Seat clock is strict `>` (claim at exactly `seated_at + 3600` fails).
- Rumble deadline rule: `< 4h` remaining (strict) pushes to the next day;
  exactly 4h remaining keeps the same-day 21:00 UTC.
- Clock independence: `claim_forfeit` does not consult the challenge deadline;
  it is valid during JOIN_CUTOFF and invalid only when the clock has not
  expired or the target signed. Forfeit-vs-submit races resolve deterministically
  by execution order (loser's transaction fails and its group reverts).
