"""QUANTUM ARENA - full behaviour suite.

Covers the 12 mandated scenarios plus security/negative paths.
All tests run in-process via algopy_testing (no localnet, no Docker).
"""

from __future__ import annotations

import hashlib

import pytest
from algopy import Account, Bytes, UInt64

from tests.conftest import (
    CHALLENGE_MBR,
    STAKE,
    T0,
    Env,
    pk,
    score_msg,
)

DAY = 24 * 3600
DUEL = DAY
FEE_BPS = 500
BPS = 10_000


def inner_axfers(env: Env):
    """Flatten the inner transactions of the last executed group."""
    return [t for grp in env.ctx.txn.last_group.itxn_groups for t in grp]


# ---------------------------------------------------------------------------
# 1. Happy path: duel (1 seat), fill -> early resolve, winner takes pot - fee
# ---------------------------------------------------------------------------


def test_duel_happy_path(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000)
    assert cid == 0
    meta = env.meta(cid)
    assert meta.creator.value == pk(env.creator)
    assert meta.status == 0  # OPEN
    assert meta.deadline == T0 + DUEL
    assert meta.paid_total == STAKE

    j = env.joiners[0]
    env.join(j, cid)
    meta = env.meta(cid)
    assert meta.seats_taken == 1
    assert meta.status == 1  # CLOSED (table full)
    assert meta.paid_total == 2 * STAKE

    env.submit(j, cid, seat=1, score=9000)

    # resolve BEFORE deadline: full table + all signed
    winner = env.resolve(cid, [(0, pk(env.creator), 5000), (1, pk(j), 9000)])
    assert winner.value == pk(j)

    meta = env.meta(cid)
    assert meta.status == 2  # RESOLVED
    assert meta.winner.value == pk(j)

    pot = 2 * STAKE
    fee = pot * FEE_BPS // BPS
    payout = pot - fee
    itxns = inner_axfers(env)
    assert len(itxns) == 2
    assert itxns[0].asset_amount == payout
    assert itxns[0].asset_receiver.bytes.value == pk(j)
    assert itxns[0].xfer_asset.id == env.gonna.id
    assert itxns[1].asset_amount == fee
    assert itxns[1].asset_receiver.bytes.value == pk(env.treasury)


def test_duel_creator_wins(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=9999)
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=100)
    winner = env.resolve(cid, [(0, pk(env.creator), 9999), (1, pk(j), 100)])
    assert winner.value == pk(env.creator)
    pot = 2 * STAKE
    itxns = inner_axfers(env)
    assert itxns[0].asset_amount == pot - pot * FEE_BPS // BPS
    assert itxns[0].asset_receiver.bytes.value == pk(env.creator)


# ---------------------------------------------------------------------------
# 2. Table of 4 filled -> early resolution right after the last signature
# ---------------------------------------------------------------------------


def test_table4_full_early_resolution(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600, creator_score=1000)
    players = env.joiners[:4]
    for who in players:
        env.join(who, cid)
    meta = env.meta(cid)
    assert meta.status == 1  # CLOSED, full
    assert meta.seats_taken == 4

    scores = [2000, 3000, 4000, 500]
    for seat, (who, sc) in enumerate(zip(players, scores), start=1):
        env.submit(who, cid, seat=seat, score=sc)

    # still well before the deadline
    assert env.ctx.ledger  # sanity
    signed = [(0, pk(env.creator), 1000)] + [
        (i + 1, pk(w), s) for i, (w, s) in enumerate(zip(players, scores))
    ]
    winner = env.resolve(cid, signed)
    assert winner.value == pk(players[2])  # 4000 is the max

    pot = 5 * STAKE
    fee = pot * FEE_BPS // BPS
    itxns = inner_axfers(env)
    assert itxns[0].asset_amount == pot - fee
    assert itxns[0].asset_receiver.bytes.value == pk(players[2])
    assert itxns[1].asset_amount == fee


# ---------------------------------------------------------------------------
# 3. Partial table resolved after deadline; 4. non-signer forfeits into pot
# ---------------------------------------------------------------------------


def test_partial_table_timeout_with_forfeit(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600, creator_score=7000)
    j1, j2 = env.joiners[0], env.joiners[1]
    env.join(j1, cid)
    env.join(j2, cid)

    # only joiner 1 submits a score; joiner 2 goes silent
    env.submit(j1, cid, seat=1, score=8000)

    # before deadline resolve is NOT possible (table not full)
    with pytest.raises(AssertionError, match="not resolvable yet"):
        env.resolve(cid, [(0, pk(env.creator), 7000), (1, pk(j1), 8000)])

    # after deadline, >= 1 signed joiner -> permissionless resolve
    env.set_time(T0 + 4 * 3600 + 1)
    winner = env.resolve(cid, [(0, pk(env.creator), 7000), (1, pk(j1), 8000)])
    assert winner.value == pk(j1)

    # j2 forfeits: pot includes ALL three stakes, winner takes pot - 5%
    pot = 3 * STAKE
    fee = pot * FEE_BPS // BPS
    itxns = inner_axfers(env)
    assert len(itxns) == 2
    assert itxns[0].asset_amount == pot - fee  # forfeit went into the pot
    assert itxns[0].asset_receiver.bytes.value == pk(j1)
    assert itxns[1].asset_amount == fee
    assert itxns[1].asset_receiver.bytes.value == pk(env.treasury)


def test_resolve_after_deadline_needs_signed_joiner(env: Env) -> None:
    """A joiner who paid but never signed cannot be resolved away early:
    the challenge must wait for the catastrophe window instead."""
    cid = env.create_challenge(seats=1, creator_score=7000)
    j = env.joiners[0]
    env.join(j, cid)
    # nobody submits a joiner score
    env.set_time(T0 + DUEL + 1)
    with pytest.raises(AssertionError, match="not resolvable yet"):
        env.resolve(cid, [(0, pk(env.creator), 7000)])


# ---------------------------------------------------------------------------
# 5. Perfect tie -> full refund to every payer, zero fee
# ---------------------------------------------------------------------------


def test_perfect_tie_full_refund(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=5000)  # perfect tie with the creator

    winner = env.resolve(cid, [(0, pk(env.creator), 5000), (1, pk(j), 5000)])
    assert winner.value == b""  # no winner

    meta = env.meta(cid)
    assert meta.status == 3  # REFUNDED

    itxns = inner_axfers(env)
    assert len(itxns) == 2  # two full refunds, no fee txn at all
    refunds = {t.asset_receiver.bytes.value: t.asset_amount for t in itxns}
    assert refunds[pk(env.creator)] == STAKE
    assert refunds[pk(j)] == STAKE


def test_tie_refunds_forfeiters_too(env: Env) -> None:
    """Anti-dispute rule: on a perfect tie even the silent player is
    refunded in full (zero fee for anyone)."""
    cid = env.create_challenge(seats=4, duration=4 * 3600, creator_score=5000)
    j1, j2 = env.joiners[0], env.joiners[1]
    env.join(j1, cid)
    env.join(j2, cid)
    env.submit(j1, cid, seat=1, score=5000)  # ties the creator
    # j2 never signs
    env.set_time(T0 + 4 * 3600 + 1)
    env.resolve(cid, [(0, pk(env.creator), 5000), (1, pk(j1), 5000)])

    itxns = inner_axfers(env)
    assert len(itxns) == 3  # everyone refunded, treasury sees nothing
    refunds = {t.asset_receiver.bytes.value: t.asset_amount for t in itxns}
    for who in (env.creator, j1, j2):
        assert refunds[pk(who)] == STAKE


# ---------------------------------------------------------------------------
# 6. Claim after deadline (creator, nobody joined)
# ---------------------------------------------------------------------------


def test_claim_after_deadline(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    env.set_time(T0 + 4 * 3600)
    env._as(env.creator, env.contract.claim, UInt64(cid))

    meta = env.meta(cid)
    assert meta.status == 3  # REFUNDED
    itxns = inner_axfers(env)
    assert len(itxns) == 1
    assert itxns[0].asset_amount == STAKE  # full stake, zero fee
    assert itxns[0].asset_receiver.bytes.value == pk(env.creator)


def test_claim_for_permissionless_sweep(env: Env) -> None:
    """Anyone can sweep an un-joined expired challenge after deadline+7d;
    funds always go to the CREATOR, never to the caller."""
    cid = env.create_challenge(seats=1)
    env.set_time(T0 + DUEL + 7 * DAY)
    env._as(env.outsider, env.contract.claim_for, UInt64(cid))

    meta = env.meta(cid)
    assert meta.status == 3
    itxns = inner_axfers(env)
    assert len(itxns) == 1
    assert itxns[0].asset_receiver.bytes.value == pk(env.creator)


# ---------------------------------------------------------------------------
# 7. Early close with 1 ALGO fee
# ---------------------------------------------------------------------------


def test_early_close(env: Env) -> None:
    cid = env.create_challenge(seats=8, duration=12 * 3600)
    fee_pay = env.ctx.any.txn.payment(
        sender=env.creator, receiver=env.treasury, amount=1_000_000
    )
    env._as(env.creator, env.contract.early_close, fee_pay, UInt64(cid))

    meta = env.meta(cid)
    assert meta.status == 3  # REFUNDED
    itxns = inner_axfers(env)
    assert len(itxns) == 1
    assert itxns[0].asset_amount == STAKE
    assert itxns[0].asset_receiver.bytes.value == pk(env.creator)


def test_early_close_wrong_fee_fails(env: Env) -> None:
    cid = env.create_challenge(seats=8, duration=12 * 3600)
    fee_pay = env.ctx.any.txn.payment(
        sender=env.creator, receiver=env.treasury, amount=999_999
    )
    with pytest.raises(AssertionError, match="fee must be 1 ALGO"):
        env._as(env.creator, env.contract.early_close, fee_pay, UInt64(cid))


def test_early_close_after_join_fails(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    env.join(env.joiners[0], cid)
    fee_pay = env.ctx.any.txn.payment(
        sender=env.creator, receiver=env.treasury, amount=1_000_000
    )
    with pytest.raises(AssertionError, match="challenge has joiners"):
        env._as(env.creator, env.contract.early_close, fee_pay, UInt64(cid))


# ---------------------------------------------------------------------------
# 8. Catastrophe refund: nobody resolves, deadline + 7 days -> all refunded
# ---------------------------------------------------------------------------


def test_catastrophe_refund(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    j1, j2 = env.joiners[0], env.joiners[1]
    env.join(j1, cid)
    env.join(j2, cid)
    env.submit(j1, cid, seat=1, score=100)  # even signed players get refunded

    # too early: before deadline + 7d
    env.set_time(T0 + 4 * 3600 + 7 * DAY - 10)
    with pytest.raises(AssertionError, match="catastrophe window not reached"):
        env._as(env.outsider, env.contract.catastrophe_refund, UInt64(cid))

    env.set_time(T0 + 4 * 3600 + 7 * DAY)
    env._as(env.outsider, env.contract.catastrophe_refund, UInt64(cid))

    meta = env.meta(cid)
    assert meta.status == 3
    itxns = inner_axfers(env)
    assert len(itxns) == 3  # creator + 2 joiners, zero fee
    refunds = {t.asset_receiver.bytes.value: t.asset_amount for t in itxns}
    for who in (env.creator, j1, j2):
        assert refunds[pk(who)] == STAKE


# ---------------------------------------------------------------------------
# 9./10. Join failures: full table, cutoff window, duplicates, wrong funding
# ---------------------------------------------------------------------------


def test_join_full_table_fails(env: Env) -> None:
    cid = env.create_challenge(seats=1)
    env.join(env.joiners[0], cid)
    with pytest.raises(AssertionError):  # status CLOSED -> "not open"
        env.join(env.joiners[1], cid)
    # funds of the second joiner never move: the whole group reverts


def test_join_cutoff_fails(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    # the last 10 minutes before the deadline are [deadline-600, deadline)
    env.set_time(T0 + 4 * 3600 - 599)
    with pytest.raises(AssertionError, match="join cutoff"):
        env.join(env.joiners[0], cid)
    # the boundary instant itself is already inside the forbidden window
    env.set_time(T0 + 4 * 3600 - 600)
    with pytest.raises(AssertionError, match="join cutoff"):
        env.join(env.joiners[0], cid)
    # one second earlier it is still allowed
    env.set_time(T0 + 4 * 3600 - 601)
    env.join(env.joiners[0], cid)


def test_double_join_fails(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    env.join(env.joiners[0], cid)
    with pytest.raises(AssertionError, match="already joined"):
        env.join(env.joiners[0], cid)


def test_join_wrong_asset_fails(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    fake = env.ctx.any.asset(total=10**15, decimals=6)
    bad_axfer = env.ctx.any.txn.asset_transfer(
        sender=env.joiners[0],
        xfer_asset=fake,
        asset_receiver=env.app_address,
        asset_amount=STAKE,
    )
    with pytest.raises(AssertionError, match="wrong asset"):
        env._as(env.joiners[0], env.contract.join_challenge, bad_axfer, UInt64(cid))


def test_join_wrong_amount_fails(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    with pytest.raises(AssertionError, match="stake amount mismatch"):
        env.join(env.joiners[0], cid, stake=STAKE - 1)


def test_join_rekey_forbidden(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    evil = env.ctx.any.txn.asset_transfer(
        sender=env.joiners[0],
        xfer_asset=env.gonna,
        asset_receiver=env.app_address,
        asset_amount=STAKE,
        rekey_to=env.joiners[1],
    )
    with pytest.raises(AssertionError, match="axfer rekey forbidden"):
        env._as(env.joiners[0], env.contract.join_challenge, evil, UInt64(cid))


# ---------------------------------------------------------------------------
# 11./12. Resolve / claim authorization failures
# ---------------------------------------------------------------------------


def test_double_resolve_fails(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=100)
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=200)
    signed = [(0, pk(env.creator), 100), (1, pk(j), 200)]
    env.resolve(cid, signed)
    with pytest.raises(AssertionError, match="not active"):
        env.resolve(cid, signed)


def test_claim_unauthorized_fails(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    env.set_time(T0 + 4 * 3600)
    # not the creator
    with pytest.raises(AssertionError, match="only creator"):
        env._as(env.outsider, env.contract.claim, UInt64(cid))


def test_claim_before_deadline_fails(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    with pytest.raises(AssertionError, match="deadline not reached"):
        env._as(env.creator, env.contract.claim, UInt64(cid))


def test_claim_with_joiners_fails(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    env.join(env.joiners[0], cid)
    env.set_time(T0 + 4 * 3600)
    with pytest.raises(AssertionError, match="challenge has joiners"):
        env._as(env.creator, env.contract.claim, UInt64(cid))


# ---------------------------------------------------------------------------
# Oracle proof security
# ---------------------------------------------------------------------------


def test_submit_score_bad_signature_fails(env: Env) -> None:
    cid = env.create_challenge(seats=1)
    j = env.joiners[0]
    env.join(j, cid)
    # signature over the WRONG score (oracle never signed 999999)
    sig = env.sign(score_msg(env.app_id, cid, 1, pk(j), 999_999))
    with pytest.raises(AssertionError, match="bad score proof"):
        env._as(j, env.contract.submit_score, UInt64(cid), UInt64(100), sig)


def test_submit_score_not_participant_fails(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    sig = env.sign(score_msg(env.app_id, cid, 1, pk(env.outsider), 100))
    with pytest.raises(AssertionError, match="not a participant"):
        env._as(env.outsider, env.contract.submit_score, UInt64(cid), UInt64(100), sig)


def test_submit_score_after_deadline_fails(env: Env) -> None:
    cid = env.create_challenge(seats=1)
    j = env.joiners[0]
    env.join(j, cid)
    env.set_time(T0 + DUEL)
    sig = env.sign(score_msg(env.app_id, cid, 1, pk(j), 100))
    with pytest.raises(AssertionError, match="deadline passed"):
        env._as(j, env.contract.submit_score, UInt64(cid), UInt64(100), sig)


def test_double_submit_fails(env: Env) -> None:
    cid = env.create_challenge(seats=1)
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=100)
    with pytest.raises(AssertionError, match="score already submitted"):
        env.submit(j, cid, seat=1, score=200)


def test_create_bad_creator_proof_fails(env: Env) -> None:
    cid = int(env.contract.next_challenge_id.value)
    sig = env.sign(score_msg(env.app_id, cid, 0, pk(env.creator), 1))  # wrong score
    with pytest.raises(AssertionError, match="bad creator score proof"):
        env._as(
            env.creator,
            env.contract.create_challenge,
            env.mbr_pay(env.creator),
            env.stake_axfer(env.creator, STAKE),
            UInt64(STAKE),
            UInt64(1),
            UInt64(DUEL),
            UInt64(0),
            Bytes(b"\x00" * 32),
            UInt64(5000),  # claims 5000, proof says 1
            sig,
        )


def test_create_invalid_seats_and_duration(env: Env) -> None:
    with pytest.raises(AssertionError, match="invalid seats"):
        env.create_challenge(seats=3)
    with pytest.raises(AssertionError, match="duel duration must be 24h"):
        env.create_challenge(seats=1, duration=4 * 3600)
    with pytest.raises(AssertionError, match="invalid duration"):
        env.create_challenge(seats=4, duration=6 * 3600)


def test_create_low_mbr_fails(env: Env) -> None:
    cid = int(env.contract.next_challenge_id.value)
    sig = env.sign(score_msg(env.app_id, cid, 0, pk(env.creator), 5000))
    with pytest.raises(AssertionError, match="mbr too small"):
        env._as(
            env.creator,
            env.contract.create_challenge,
            env.mbr_pay(env.creator, amount=CHALLENGE_MBR - 1),
            env.stake_axfer(env.creator, STAKE),
            UInt64(STAKE),
            UInt64(1),
            UInt64(DUEL),
            UInt64(0),
            Bytes(b"\x00" * 32),
            UInt64(5000),
            sig,
        )


def test_bad_verdict_signature_fails(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=100)
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=200)
    # verdict signed over a DIFFERENT digest (only creator's score)
    with pytest.raises(AssertionError, match="bad verdict"):
        env.resolve(cid, [(0, pk(env.creator), 100)])


# ---------------------------------------------------------------------------
# Random-resolved mode (oracle reveals a committed seed)
# ---------------------------------------------------------------------------


def test_random_resolved_mode(env: Env) -> None:
    seed = hashlib.sha256(b"quantum-rng-seed").digest()
    commitment = hashlib.sha256(seed).digest()
    cid = env.create_challenge(
        seats=1, creator_score=100, mode=2, seed=commitment
    )
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=200)

    # wrong reveal must fail
    with pytest.raises(AssertionError, match="bad seed reveal"):
        env.resolve(
            cid,
            [(0, pk(env.creator), 100), (1, pk(j), 200)],
            mode=2,
            seed_reveal=hashlib.sha256(b"wrong").digest(),
        )

    signed = [(0, pk(env.creator), 100), (1, pk(j), 200)]
    winner = env.resolve(cid, signed, mode=2, seed_reveal=seed)
    pick = int.from_bytes(seed[:8], "big") % 2
    expected = pk(env.creator) if pick == 0 else pk(j)
    assert winner.value == expected


# ---------------------------------------------------------------------------
# App-call rekey protection
# ---------------------------------------------------------------------------


def test_app_call_rekey_forbidden(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    with env.ctx.txn.create_group(
        active_txn_overrides={"sender": env.creator, "rekey_to": env.outsider}
    ):
        with pytest.raises(AssertionError, match="app call rekey forbidden"):
            env.contract.claim(UInt64(cid))
