# QUANTUM ARENA — quantum-refereed skill-challenge escrow for GONNA FIGHT

Skill-based challenge escrow on Algorand for **$GONNA** (ASA) stakes, built with
**Algorand Python (Puya / algopy 4.x)**. The referee is an off-chain oracle whose
attestations are verified **on-chain**. The contract is program-controlled:
**no admin keys, no rekeying, no update/delete path** — and player funds can
**never** be locked forever (permissionless catastrophe exit).

```
contracts/quantum_arena/contract.py      # the smart contract (Puya)
contracts/quantum_arena/artifacts/       # compiled TEAL + ARC-56 (puyapy output)
tests/conftest.py                        # fixtures, oracle signing helpers
tests/test_quantum_arena.py              # 33 tests, all green
```

## Quick start

```bash
pip install algorand-python algorand-python-testing py-algorand-sdk pytest puyapy
python -m pytest tests/ -q                      # in-process unit tests, no Docker/localnet
puyapy contracts/quantum_arena/contract.py      # recompile artifacts
```

> Environment note: `algopy_testing` executes the Python directly; `puyapy`
> compiles the same file to TEAL. Both are verified in CI-fashion here:
> 33/33 tests pass, compiler exits with 0 errors.
> (algorand-python-testing 1.1.0 requires `Array(values)` while Puya stubs
> allow `Array[T]()`; tests/conftest.py contains a 6-line compatibility shim
> so the canonical Puya form also runs under the test runtime.)

## Architecture

### State

| Storage | Content |
|---|---|
| Global `treasury` | 32-byte pk of the protocol treasury (a **Falcon-1024 PQ account**) |
| Global `oracle_pub_key` | oracle public key (ed25519 in v1, Falcon-1024 in v2) |
| Global `gonna_asset_id` | $GONNA ASA id (decimals are parametric; all amounts in base units) |
| Global `bootstrapped` | one-time ASA opt-in flag |
| Global `next_challenge_id` | monotonically increasing id, never reused |
| BoxMap `m<id>` → `ChallengeMeta` | creator, stake, seats, deadline, mode, seed commitment, creator score, status, winner, paid_total |
| BoxMap `p<id>` → `PlayerEntry[]` | roster; entry = (addr, score, signed). Presence ⇒ stake paid |

Creator always occupies **seat 0** and commits an oracle-signed score at
creation. `seats_total` counts **joiner** seats.

### Status machine

```
OPEN --(last seat filled)--> CLOSED --resolve--> RESOLVED   (payout, 5% fee)
OPEN/CLOSED --resolve--> RESOLVED                            (deadline rules)
OPEN/CLOSED --claim/early_close/tie/catastrophe--> REFUNDED  (zero fee)
```

### Oracle messages (domain-separated, replay-protected)

| Purpose | Message (all integers big-endian) |
|---|---|
| Score proof | `QA-SCORE|` ‖ app_id(8) ‖ challenge_id(8) ‖ seat(1) ‖ player(32) ‖ score(8) |
| Verdict | `QA-VERDICT|` ‖ app_id(8) ‖ challenge_id(8) ‖ mode(1) ‖ extra(32) ‖ sha256(signed scores digest)(32) |

`extra` = 32 zero bytes (mode 0), 24 zero bytes ‖ stage_idx(8) (mode 1),
or the 32-byte seed reveal (mode 2; contract checks `sha256(reveal) == seed_commitment`).
The digest is `sha256(concat[seat(1) ‖ addr(32) ‖ score(8)])` over **signed**
players in seat order: the oracle attests the exact outcome set on-chain.

## Flows & atomic groups

1. **CREATE** `[mbr pay → app, $GONNA stake axfer → app, app call]`
   Validates seats ∈ {1,4,8,12}; duels (1 seat) are always 24 h, tables
   choose 4/12/24 h; verifies the oracle signature on the creator score.
   MBR payment (0.35 ALGO) covers the two boxes.
2. **JOIN** `[$GONNA stake axfer → app, app call]` — fully atomic: any assert
   failure reverts the payment. Forbidden on full tables and during the last
   10 minutes before the deadline (`join cutoff`). Duplicates rejected.
3. **SUBMIT_SCORE** `[app call]` — before deadline, participants only,
   once each; oracle proof verified on-chain.
4. **RESOLVE** `[app call]` — permissionless when (a) table full **and**
   everyone signed (immediate, before deadline), or (b) deadline passed with
   ≥ 1 signed joiner. Verifies the oracle verdict, picks the winner
   (max score; mode 2 = committed-seed pick). Winner receives
   `pot − 5%`, treasury receives the fee. **Unsigned payers forfeit into the
   pot.** Perfect tie among top scores → everyone (including forfeiters) is
   refunded in full, zero fee (anti-dispute simplicity).
5. **CLAIM** `[app call]` — creator only, after deadline, zero joiners:
   full stake back, zero fee. **CLAIM_FOR**: same outcome, permissionless
   after deadline + 7 d (pays the creator, never the caller).
6. **EARLY_CLOSE** `[1 ALGO pay → treasury, app call]` — creator only,
   zero joiners, before deadline. Stake back; the 1 ALGO is anti-spam.
7. **CATASTROPHE_REFUND** `[app call]` — permissionless after deadline + 7 d
   if not resolved: every payer refunded in full, zero fee.
   **This is the liveness guarantee: funds can never be locked forever.**

## Constants

| Constant | Value | Notes |
|---|---|---|
| `FEE_BPS` | 500 | 5 % of the pot, only on decisive resolutions |
| `EARLY_CLOSE_FEE` | 1 000 000 µA | 1 ALGO to treasury |
| `JOIN_CUTOFF` | 600 s | no joins in `[deadline-600, deadline)` |
| `CATASTROPHE_WINDOW` | 604 800 s | 7 days |
| `DUEL_DURATION` | 86 400 s | duels are always 24 h |
| `CHALLENGE_MBR` | 350 000 µA | box MBR charged at CREATE (with margin) |
| `BOOTSTRAP_MIN` | 200 000 µA | ASA opt-in MBR + operating headroom |
| `ORACLE_SIG_SCHEME` | 1 | 1 = ed25519, 2 = Falcon-1024 (reserved) |

## Security

- **Checks–effects–interactions** everywhere: challenge state is terminal-set
  *before* any inner transaction is issued.
- Every outer payment/axfer is fully validated: type, sender, receiver,
  amount, asset id, `rekey_to == zero`, no close-out / clawback fields.
  The app call itself may not carry a rekey.
- **No admin keys**: the ARC-4 router exposes only the 10 public methods;
  compiled TEAL asserts `OnCompletion == NoOp`, so update/delete/opt-in/
  close-out are rejected. The app can never be rekeyed.
- Oracle messages embed app id + challenge id + seat: no cross-app,
  cross-challenge or cross-seat replay.
- All amounts in base units; `$GONNA` decimals never affect the math.
- Inner transactions use `fee = 0` (fee pooling: callers cover them).

### Ambiguities resolved (most fund-protective reading)

- *Tie + forfeiters*: perfect tie refunds **everyone**, including silent
  players — simplest anti-dispute rule (per spec decision).
- *Deadline with paid-but-unsigned joiners and no signed joiner*: resolution
  is impossible by design; funds wait for the 7-day catastrophe refund.
- *Box MBR* stays in the app account (storage rent); it is never player stake
  and can never be drained to anyone.

## Oracle signature scheme & `falcon_verify` status

**v1 (this contract): `ed25519verify_bare`.** Puya 5.10 targets AVM v11
(`#pragma version 11` in the compiled TEAL) and algopy 4.0 does **not** yet
expose `falcon_verify`; the opcode is scheduled with AVM v12 alongside
Algorand v5 mainnet Falcon-1024 PQ accounts.

**Upgrade path (documented, no code surgery beyond one subroutine):**
1. AVM v12 + algopy exposing `op.falcon_verify` ships.
2. Deploy **QuantumArena v2** (new app id; v1 is immutable by design):
   - store the 1793-byte Falcon-1024 oracle public key in `oracle_pub_key`,
   - replace the body of `_verify_oracle_sig` with `falcon_verify`,
   - set `ORACLE_SIG_SCHEME = 2`.
   No other change: message formats, flows and storage are scheme-agnostic.
3. The oracle dual-signs during migration; treasury is already a PQ account.

> Why not an updateable contract? Updateability requires an admin key, which
> contradicts the zero-admin-keys rule. A fresh deployment with the same
> code + `ORACLE_SIG_SCHEME=2` is the safe upgrade.

## PQ fee table (Algorand v5 resource-based fees)

Indicative, per the v5 resource-based fee model (fee ∝ txn size + opcode
budget consumed). Verify against current `algod` params at deploy time.

| Transaction | Size / budget | Approx. fee |
|---|---|---|
| ed25519-signed pay/axfer (joiners, legacy accounts) | ~250 B | 1 000 µA (min fee) |
| **Falcon-1024-signed pay/axfer** (treasury, PQ accounts) | ~1.6 KB (sig ≈ 1 330 B vs 64 B) | **~6–7× min fee** |
| App call without oracle verify | ~1 000 opcode budget | 1 000 µA |
| App call with `ed25519verify_bare` (CREATE / SUBMIT / RESOLVE) | +1 900 budget ⇒ +3 fee credits | ~4 000 µA |
| App call with `falcon_verify` (v2, expected AVM v12) | Falcon verify is heavier than ed25519; exact budget cost TBD by the v12 spec | expect ≥ ed25519 cost; use fee pooling |
| RESOLVE with N refund itxns (tie / catastrophe, up to 13) | +N inner txns | +1 000 µA per inner txn |

Group fee pooling applies everywhere: the caller attaches the total fee,
inner transactions carry `fee = 0`.

## Testnet deploy notes

1. Deploy with **extra_program_pages = 1** (approval ≈ 3.5 KB > 2 048 B page).
2. Fund the app address and call `bootstrap(pay ≥ 0.2 ALGO)` once — the app
   opts itself into $GONNA via inner axfer.
3. The **treasury account must be opted into $GONNA** to receive fees.
4. Each `create_challenge` locks 0.35 ALGO of box MBR (paid by the creator).
5. `$GONNA` ASA id is a deploy parameter; decimals are irrelevant to the
   contract (base units only).
6. Suggested deployer: Algokit / `algosdk` ARC-56 client generated from
   `artifacts/QuantumArena.arc56.json`.

## Test coverage (33/33 green)

Happy-path duel (both winner directions), 4-seat table filled → immediate
resolve before deadline, partial table resolved after deadline, forfeit math,
perfect tie (duel + table with forfeiter), claim, claim_for sweep, early
close (+ wrong fee, + with joiners), catastrophe refund (+ too-early),
join on full table, join in cutoff (boundary ±1 s), double join, wrong
asset/amount/rekey join, double resolve, unauthorized/early/joined claims,
bad score signature, non-participant submit, late submit, double submit,
bad creator proof, invalid seats/duration, low MBR, bad verdict signature,
random-resolved mode (incl. wrong reveal), app-call rekey protection.
