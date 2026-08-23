"""QUANTUM ARENA v2 — SPEC-v2 behaviour suite.

The 10 mandated test groups:
  1. forfeit joiner (95/5, own stake back, box deleted, MBR back, status=4)
  2. forfeit creator — MUST FAIL (v1 sealed commit: the creator is always
     oracle-signed at create, so the `not target.signed` guard protects them)
  3. seat-clock boundary: t == seated_at + 3600 fails, t + 3601 succeeds
  4. double claim / non-opponent / unsigned-caller claims fail
  5. claim_forfeit on rumbles fails (rumbles stay deadline-based)
  6. early_close: box deleted, MBR refunded, 1 ALGO to treasury, stake back
  7. resolve (and claim/catastrophe): box deleted + MBR refunded
  8. spawn_rumble: permissionless, deadline = next 21:00 UTC (4h rule),
     1 ALGO fee, creator seated with stake
  9. regression: the whole v1 suite (tests/test_quantum_arena.py) stays green
 10. adversarial: rekey, inner-tx confusion, fee rounding (stake=1),
     claim during JOIN_CUTOFF, race forfeit-vs-submit
"""

from __future__ import annotations

import pytest
from algopy import Bytes, UInt64

from tests.conftest import (
    CHALLENGE_MBR,
    EARLY_CLOSE_FEE,
    SEAT_TTL,
    STAKE,
    T0,
    Env,
    inner_axfers,
    inner_payments,
    pk,
)

DAY = 24 * 3600
DUEL = DAY
FEE_BPS = 500
BPS = 10_000

DAY_START = T0 - (T0 % DAY)  # T0 is 14:13:20 UTC
NEXT_21 = DAY_START + 21 * 3600  # same-day 21:00 UTC (6h47m after T0)


def axfers(env: Env):
    return inner_axfers(env.ctx)


def payments(env: Env):
    return inner_payments(env.ctx)


# ---------------------------------------------------------------------------
# Group 1 — Forfeit joiner: creator (signed) claims the silent joiner's seat
# ---------------------------------------------------------------------------


def test_forfeit_joiner(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000)  # creator signed
    j = env.joiners[0]
    env.set_time(T0 + 100)
    env.join(j, cid)  # joiner seated at T0+100, unsigned

    env.set_time(T0 + 100 + SEAT_TTL + 1)
    env.claim_forfeit(env.creator, cid, seat=1)

    # boxes deleted, MBR back to the payer (creator)
    assert env.boxes_exist(cid) == (False, False)

    fee = STAKE * FEE_BPS // BPS  # 5% of the forfeited stake
    ax = axfers(env)
    assert len(ax) == 3
    # caller's own signed stake, back in full
    assert ax[0].asset_amount == STAKE
    assert ax[0].asset_receiver.bytes.value == pk(env.creator)
    # 95% of the forfeited stake to the opponent
    assert ax[1].asset_amount == STAKE - fee
    assert ax[1].asset_receiver.bytes.value == pk(env.creator)
    # 5% to the treasury
    assert ax[2].asset_amount == fee
    assert ax[2].asset_receiver.bytes.value == pk(env.treasury)

    pays = payments(env)
    assert len(pays) == 1
    assert pays[0].amount == CHALLENGE_MBR
    assert pays[0].receiver.bytes.value == pk(env.creator)


def test_forfeit_joiner_creator_clock_distinct(env: Env) -> None:
    """The joiner's clock runs from the JOIN, not from the create."""
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.set_time(T0 + 2000)  # creator clock already past TTL, irrelevant
    env.join(j, cid)  # joiner clock starts now
    env.set_time(T0 + 2000 + SEAT_TTL)  # exactly TTL: not yet (strict >)
    with pytest.raises(AssertionError, match="seat clock not expired"):
        env.claim_forfeit(env.creator, cid, seat=1)
    env.set_time(T0 + 2000 + SEAT_TTL + 1)
    env.claim_forfeit(env.creator, cid, seat=1)
    assert env.boxes_exist(cid) == (False, False)


# ---------------------------------------------------------------------------
# Group 2 — Forfeit creator: MUST FAIL.
# SPEC note: the mandated scenario "creator does not sign within 1h of the
# create" is unreachable, because v1 (preserved intact) requires the
# creator's score to be oracle-signed AT create — the creator always has a
# signed score and the `not target.signed` guard protects their stake.
# This is the conservative, funds-safest reading of SPEC v2-A.
# ---------------------------------------------------------------------------


def test_forfeit_creator_impossible_creator_always_signed(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=9000)  # joiner signed
    env.set_time(T0 + SEAT_TTL + 1)  # creator's clock (from create) expired
    with pytest.raises(AssertionError, match="target has a signed score"):
        env.claim_forfeit(j, cid, seat=0)
    # the challenge is untouched and still resolvable on the v1 path
    assert env.boxes_exist(cid) == (True, True)


# ---------------------------------------------------------------------------
# Group 3 — Boundary: exact TTL fails, TTL + 1 succeeds
# ---------------------------------------------------------------------------


def test_forfeit_boundary_exact_ttl_fails(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)  # seated at T0
    env.set_time(T0 + SEAT_TTL)  # strict > required
    with pytest.raises(AssertionError, match="seat clock not expired"):
        env.claim_forfeit(env.creator, cid, seat=1)
    env.set_time(T0 + SEAT_TTL + 1)
    env.claim_forfeit(env.creator, cid, seat=1)
    assert env.boxes_exist(cid) == (False, False)


# ---------------------------------------------------------------------------
# Group 4 — Double claim / non-opponent / unsigned caller
# ---------------------------------------------------------------------------


def test_double_forfeit_claim_fails(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)
    env.set_time(T0 + SEAT_TTL + 1)
    env.claim_forfeit(env.creator, cid, seat=1)
    # the boxes are gone: any second claim hits "challenge not found"
    with pytest.raises(AssertionError, match="challenge not found"):
        env.claim_forfeit(env.creator, cid, seat=1)


def test_forfeit_claim_by_non_opponent_fails(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)
    env.set_time(T0 + SEAT_TTL + 1)
    # an outsider is not the opponent
    with pytest.raises(AssertionError, match="only the opponent can claim"):
        env.claim_forfeit(env.outsider, cid, seat=1)
    # the target cannot claim their own seat either
    with pytest.raises(AssertionError, match="only the opponent can claim"):
        env.claim_forfeit(j, cid, seat=1)


def test_forfeit_claim_without_signed_score_fails(env: Env) -> None:
    """If neither side has a usable signed score the claim is impossible:
    the unsigned caller fails the caller-signed gate (the v1 early_close /
    catastrophe paths apply instead)."""
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)  # joiner never signs
    env.set_time(T0 + SEAT_TTL + 1)
    # the unsigned joiner cannot claim the creator's seat
    with pytest.raises(AssertionError, match="caller must have a signed score"):
        env.claim_forfeit(j, cid, seat=0)


# ---------------------------------------------------------------------------
# Group 5 — claim_forfeit is duel-only; rumbles stay deadline-based
# ---------------------------------------------------------------------------


def test_forfeit_claim_on_rumble_fails(env: Env) -> None:
    cid = env.spawn_rumble(who=env.outsider, seats=4)
    j = env.joiners[0]
    env.join(j, cid)  # silent joiner
    env.set_time(T0 + SEAT_TTL + 1)
    with pytest.raises(AssertionError, match="forfeit claims are duel-only"):
        env.claim_forfeit(env.outsider, cid, seat=1)
    # same guard on a v1-created rumble
    cid2 = env.create_challenge(seats=4, duration=4 * 3600)
    env.join(j, cid2)
    env.set_time(T0 + SEAT_TTL + 1)
    with pytest.raises(AssertionError, match="forfeit claims are duel-only"):
        env.claim_forfeit(env.creator, cid2, seat=1)


def test_forfeit_claim_seat_validation(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000)
    # no joiner yet: the opponent seat is empty
    with pytest.raises(AssertionError, match="opponent seat empty"):
        env.claim_forfeit(env.creator, cid, seat=1)
    env.join(env.joiners[0], cid)
    env.set_time(T0 + SEAT_TTL + 1)
    with pytest.raises(AssertionError, match="invalid seat"):
        env.claim_forfeit(env.creator, cid, seat=2)


# ---------------------------------------------------------------------------
# Group 6 — early_close: box deleted, MBR back, 1 ALGO to treasury, stake back
# ---------------------------------------------------------------------------


def test_early_close_v2_box_delete_and_mbr_refund(env: Env) -> None:
    cid = env.create_challenge(seats=8, duration=12 * 3600)
    env.early_close(env.creator, cid)

    assert env.boxes_exist(cid) == (False, False)
    ax = axfers(env)
    assert len(ax) == 1
    assert ax[0].asset_amount == STAKE  # full stake back, zero fee
    assert ax[0].asset_receiver.bytes.value == pk(env.creator)
    pays = payments(env)
    assert len(pays) == 1
    assert pays[0].amount == CHALLENGE_MBR  # exact MBR recorded at create
    assert pays[0].receiver.bytes.value == pk(env.creator)

    # the challenge is gone for good
    with pytest.raises(AssertionError, match="challenge not found"):
        env.early_close(env.creator, cid)


def test_early_close_requires_fee_to_treasury(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    # fee paid to the wrong receiver is rejected
    bad = env.ctx.any.txn.payment(
        sender=env.creator, receiver=env.outsider, amount=EARLY_CLOSE_FEE
    )
    with pytest.raises(AssertionError, match="fee receiver"):
        env._as(env.creator, env.contract.early_close, bad, UInt64(cid))
    # and a missing/short fee keeps v1 behaviour
    with pytest.raises(AssertionError, match="fee must be 1 ALGO"):
        env.early_close(env.creator, cid, fee=EARLY_CLOSE_FEE - 1)


# ---------------------------------------------------------------------------
# Group 7 — resolve / claim / catastrophe: boxes deleted + MBR refunded
# ---------------------------------------------------------------------------


def test_resolve_deletes_boxes_and_refunds_mbr(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=9000)
    env.resolve(cid, [(0, pk(env.creator), 5000), (1, pk(j), 9000)])

    assert env.boxes_exist(cid) == (False, False)
    pot = 2 * STAKE
    fee = pot * FEE_BPS // BPS
    ax = axfers(env)
    assert len(ax) == 2  # payout + treasury fee, as v1
    assert ax[0].asset_amount == pot - fee
    assert ax[1].asset_amount == fee
    pays = payments(env)
    assert len(pays) == 1
    assert pays[0].amount == CHALLENGE_MBR
    assert pays[0].receiver.bytes.value == pk(env.creator)


def test_claim_and_catastrophe_refund_mbr(env: Env) -> None:
    # claim (creator, after deadline, nobody joined)
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    env.set_time(T0 + 4 * 3600)
    env._as(env.creator, env.contract.claim, UInt64(cid))
    assert env.boxes_exist(cid) == (False, False)
    pays = payments(env)
    assert len(pays) == 1
    assert pays[0].amount == CHALLENGE_MBR
    assert pays[0].receiver.bytes.value == pk(env.creator)

    # catastrophe (permissionless, deadline + 7d) — MBR to the CREATOR,
    # never to the caller
    env.set_time(T0)
    cid = env.create_challenge(seats=1, creator_score=100)
    j = env.joiners[0]
    env.join(j, cid)
    env.set_time(T0 + DUEL + 7 * DAY)
    env._as(env.outsider, env.contract.catastrophe_refund, UInt64(cid))
    assert env.boxes_exist(cid) == (False, False)
    pays = payments(env)
    assert len(pays) == 1
    assert pays[0].amount == CHALLENGE_MBR
    assert pays[0].receiver.bytes.value == pk(env.creator)
    ax = axfers(env)
    assert len(ax) == 2  # both stakes refunded, zero fee


# ---------------------------------------------------------------------------
# Group 8 — spawn_rumble: permissionless, deadline, fee, seated creator
# ---------------------------------------------------------------------------


def test_spawn_rumble_permissionless(env: Env) -> None:
    cid = env.spawn_rumble(who=env.outsider, seats=8)
    assert cid == 0
    meta = env.meta(cid)
    assert meta.creator.value == pk(env.outsider)
    assert meta.seats_total == 8
    assert meta.status == 0  # OPEN
    assert meta.deadline == NEXT_21  # >= 4h away from T0: same-day 21:00 UTC
    assert meta.paid_total == STAKE
    assert meta.mbr_paid == CHALLENGE_MBR
    assert meta.creator_score == 0  # no oracle gate at spawn

    roster = env.roster(cid)
    assert roster.length == 1
    assert roster[0].addr.value == pk(env.outsider)
    assert not roster[0].signed  # unsigned at spawn, may submit later
    assert roster[0].score == 0
    assert roster[0].seated_at == T0


def test_spawn_rumble_deadline_rules(env: Env) -> None:
    # case >= 4h remaining: deadline = same-day 21:00 UTC
    assert NEXT_21 - T0 >= 4 * 3600
    cid = env.spawn_rumble(seats=4)
    assert env.meta(cid).deadline == NEXT_21

    # boundary: exactly 4h remaining still counts as >= 4h
    env.set_time(NEXT_21 - 4 * 3600)
    cid = env.spawn_rumble(seats=4)
    assert env.meta(cid).deadline == NEXT_21

    # case < 4h remaining: deadline pushed to the next day's 21:00 UTC
    env.set_time(NEXT_21 - 4 * 3600 + 1)
    cid = env.spawn_rumble(seats=4)
    assert env.meta(cid).deadline == NEXT_21 + DAY

    # just after 21:00 UTC: the "next" 21:00 is tomorrow's
    env.set_time(NEXT_21 + 1)
    cid = env.spawn_rumble(seats=4)
    assert env.meta(cid).deadline == NEXT_21 + DAY


def test_spawn_rumble_validation(env: Env) -> None:
    # duels are not spawnable (they stay on create_challenge)
    with pytest.raises(AssertionError, match="invalid seats"):
        env.spawn_rumble(seats=1)
    with pytest.raises(AssertionError, match="invalid seats"):
        env.spawn_rumble(seats=3)
    for ok in (4, 8, 12):
        env.spawn_rumble(seats=ok)
    # zero stake
    with pytest.raises(AssertionError, match="stake must be positive"):
        env.spawn_rumble(seats=4, stake=0)
    # anti-spam fee: wrong amount / wrong receiver
    with pytest.raises(AssertionError, match="fee must be 1 ALGO"):
        env._as(
            env.creator,
            env.contract.spawn_rumble,
            env.mbr_pay(env.creator),
            env.stake_axfer(env.creator, STAKE),
            env.fee_pay(env.creator, EARLY_CLOSE_FEE - 1),
            UInt64(STAKE),
            UInt64(4),
            UInt64(0),
            Bytes(b"\x00" * 32),
        )
    bad = env.ctx.any.txn.payment(
        sender=env.creator, receiver=env.outsider, amount=EARLY_CLOSE_FEE
    )
    with pytest.raises(AssertionError, match="fee receiver"):
        env._as(
            env.creator,
            env.contract.spawn_rumble,
            env.mbr_pay(env.creator),
            env.stake_axfer(env.creator, STAKE),
            bad,
            UInt64(STAKE),
            UInt64(4),
            UInt64(0),
            Bytes(b"\x00" * 32),
        )
    # MBR below the recomputed v2 value
    with pytest.raises(AssertionError, match="mbr too small"):
        env._as(
            env.creator,
            env.contract.spawn_rumble,
            env.mbr_pay(env.creator, CHALLENGE_MBR - 1),
            env.stake_axfer(env.creator, STAKE),
            env.fee_pay(env.creator),
            UInt64(STAKE),
            UInt64(4),
            UInt64(0),
            Bytes(b"\x00" * 32),
        )


def test_spawned_rumble_full_v1_lifecycle(env: Env) -> None:
    """A self-spawned rumble follows ALL v1 rumble rules: joins with stake,
    JOIN_CUTOFF, permissionless resolve at deadline with >=1 signed joiner,
    forfeit-in-pot of the non-signers (the unsigned creator included),
    winner-takes-all -5%, box delete + MBR refund."""
    cid = env.spawn_rumble(who=env.outsider, seats=4)
    j1, j2 = env.joiners[0], env.joiners[1]
    env.join(j1, cid)
    env.join(j2, cid)
    # the spawned creator can still submit an oracle-signed score later
    env.submit(env.outsider, cid, seat=0, score=100)
    env.submit(j1, cid, seat=1, score=8000)
    # j2 never signs

    # not resolvable before the deadline (table not full)
    with pytest.raises(AssertionError, match="not resolvable yet"):
        env.resolve(cid, [(0, pk(env.outsider), 100), (1, pk(j1), 8000)])

    deadline = int(env.meta(cid).deadline.value)
    env.set_time(deadline)
    winner = env.resolve(cid, [(0, pk(env.outsider), 100), (1, pk(j1), 8000)])
    assert winner.value == pk(j1)

    pot = 3 * STAKE  # j2's stake forfeits into the pot
    fee = pot * FEE_BPS // BPS
    ax = axfers(env)
    assert ax[0].asset_amount == pot - fee
    assert ax[0].asset_receiver.bytes.value == pk(j1)
    assert ax[1].asset_amount == fee
    assert ax[1].asset_receiver.bytes.value == pk(env.treasury)
    pays = payments(env)
    assert pays[0].amount == CHALLENGE_MBR
    assert pays[0].receiver.bytes.value == pk(env.outsider)  # MBR to the payer
    assert env.boxes_exist(cid) == (False, False)


# ---------------------------------------------------------------------------
# Group 9 — regression: see tests/test_quantum_arena.py (33 v1 tests green)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Group 10 — adversarial
# ---------------------------------------------------------------------------


def test_forfeit_app_call_rekey_forbidden(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000)
    env.join(env.joiners[0], cid)
    env.set_time(T0 + SEAT_TTL + 1)
    with env.ctx.txn.create_group(
        active_txn_overrides={"sender": env.creator, "rekey_to": env.outsider}
    ):
        with pytest.raises(AssertionError, match="app call rekey forbidden"):
            env.contract.claim_forfeit(UInt64(cid), UInt64(1))


def test_spawn_rumble_rekey_forbidden(env: Env) -> None:
    evil_mbr = env.ctx.any.txn.payment(
        sender=env.creator,
        receiver=env.app_address,
        amount=CHALLENGE_MBR,
        rekey_to=env.outsider,
    )
    with pytest.raises(AssertionError, match="payment rekey forbidden"):
        env._as(
            env.creator,
            env.contract.spawn_rumble,
            evil_mbr,
            env.stake_axfer(env.creator, STAKE),
            env.fee_pay(env.creator),
            UInt64(STAKE),
            UInt64(4),
            UInt64(0),
            Bytes(b"\x00" * 32),
        )
    evil_fee = env.ctx.any.txn.payment(
        sender=env.creator,
        receiver=env.treasury,
        amount=EARLY_CLOSE_FEE,
        rekey_to=env.outsider,
    )
    with pytest.raises(AssertionError, match="payment rekey forbidden"):
        env._as(
            env.creator,
            env.contract.spawn_rumble,
            env.mbr_pay(env.creator),
            env.stake_axfer(env.creator, STAKE),
            evil_fee,
            UInt64(STAKE),
            UInt64(4),
            UInt64(0),
            Bytes(b"\x00" * 32),
        )


def test_forfeit_fee_rounding_stake_1_micro(env: Env) -> None:
    """stake = 1 base unit: 5% rounds down to 0, no fee txn is emitted and
    the whole pot goes to the claimant (no dust created, nothing locked)."""
    cid = env.create_challenge(seats=1, creator_score=5000, stake=1)
    j = env.joiners[0]
    env.join(j, cid, stake=1)
    env.set_time(T0 + SEAT_TTL + 1)
    env.claim_forfeit(env.creator, cid, seat=1)

    ax = axfers(env)
    assert len(ax) == 2  # own stake + forfeited stake, NO treasury txn
    assert ax[0].asset_amount == 1
    assert ax[1].asset_amount == 1  # 1 - (1*5//100) = 1
    assert ax[1].asset_receiver.bytes.value == pk(env.creator)
    pays = payments(env)
    assert len(pays) == 1
    assert pays[0].amount == CHALLENGE_MBR


def test_forfeit_claim_during_join_cutoff(env: Env) -> None:
    """The seat clock is independent of JOIN_CUTOFF: a claim is valid even
    in the last 10 minutes before the duel deadline."""
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)
    env.set_time(T0 + DUEL - 300)  # inside the cutoff, clock long expired
    env.claim_forfeit(env.creator, cid, seat=1)
    assert env.boxes_exist(cid) == (False, False)


def test_race_submit_beats_forfeit(env: Env) -> None:
    """Same logical block, submit first: the forfeit claim must fail."""
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)
    env.set_time(T0 + SEAT_TTL + 1)
    env.submit(j, cid, seat=1, score=9000)  # joiner signs just in time
    with pytest.raises(AssertionError, match="target has a signed score"):
        env.claim_forfeit(env.creator, cid, seat=1)


def test_race_forfeit_beats_submit(env: Env) -> None:
    """Same logical block, claim first: the challenge is gone, the late
    submit finds nothing (and its group reverts atomically)."""
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)
    env.set_time(T0 + SEAT_TTL + 1)
    env.claim_forfeit(env.creator, cid, seat=1)
    with pytest.raises(AssertionError, match="challenge not found"):
        env.submit(j, cid, seat=1, score=9000)


def test_closed_challenge_rejects_every_method(env: Env) -> None:
    """Inner-tx confusion guard: after ANY close path the boxes are gone,
    so no method can touch the escrowed funds twice."""
    cid = env.create_challenge(seats=1, creator_score=100)
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=200)
    env.resolve(cid, [(0, pk(env.creator), 100), (1, pk(j), 200)])
    with pytest.raises(AssertionError, match="challenge not found"):
        env.claim_forfeit(env.creator, cid, seat=1)
    with pytest.raises(AssertionError, match="challenge not found"):
        env.early_close(env.creator, cid)
    with pytest.raises(AssertionError, match="challenge not found"):
        env._as(env.outsider, env.contract.catastrophe_refund, UInt64(cid))
    with pytest.raises(AssertionError, match="challenge not found"):
        env.join(env.joiners[1], cid)
