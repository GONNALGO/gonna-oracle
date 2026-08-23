"""Security-review regression tests (FIX-1..FIX-4).

FIX-1 (HIGH) — ASA de-opt fund-lock: no close path may fail because of
    receiver state. Every $GONNA payout checks the receiver's holding;
    non-opted receivers are redirected to the treasury.
FIX-2 (MEDIUM) — CHALLENGE_MBR uses the real on-chain box formula
    2500 + 400*(key+value) per box -> 358_200 µALGO worst case.
FIX-3 (LOW) — fee math is overflow-safe for any uint64 pot/stake, with
    identical floor(stake*5/100) rounding semantics.
FIX-4 (LOW) — create has assert_no_rekey; bootstrap asserts the treasury
    holds $GONNA before the app accepts challenges.
"""

from __future__ import annotations

import pytest
from algopy import Bytes, UInt64

from contracts.quantum_arena.contract import QuantumArena
from tests.conftest import (
    CHALLENGE_MBR,
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

# 2**63 - 1: the duel pot (2 stakes) still fits uint64, but pot * FEE_BPS
# (and stake * FEE_BPS) overflow uint64 — the pre-FIX-3 panic boundary.
HUGE = 2**63 - 1


def axfers(env: Env):
    return inner_axfers(env.ctx)


def payments(env: Env):
    return inner_payments(env.ctx)


# ---------------------------------------------------------------------------
# FIX-1 — skip-if-not-opted on every close path
# ---------------------------------------------------------------------------


def test_fix1_resolve_winner_deopted_redirects_to_treasury(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=100)
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=200)
    env.opt_out(j)  # winner closed the opt-in after signing

    winner = env.resolve(cid, [(0, pk(env.creator), 100), (1, pk(j), 200)])
    assert winner.value == pk(j)  # winner selection unaffected

    pot = 2 * STAKE
    fee = pot * FEE_BPS // BPS
    ax = axfers(env)
    assert len(ax) == 2
    # payout redirected: unpayable balance goes to the treasury
    assert ax[0].asset_amount == pot - fee
    assert ax[0].asset_receiver.bytes.value == pk(env.treasury)
    assert ax[1].asset_amount == fee
    assert ax[1].asset_receiver.bytes.value == pk(env.treasury)
    # close still completes: boxes gone, MBR back to the creator
    assert env.boxes_exist(cid) == (False, False)
    assert payments(env)[0].receiver.bytes.value == pk(env.creator)


def test_fix1_tie_refund_deopted_player_goes_to_treasury(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=5000)
    env.opt_out(j)

    env.resolve(cid, [(0, pk(env.creator), 5000), (1, pk(j), 5000)])
    ax = axfers(env)
    assert len(ax) == 2
    refunds = {t.asset_receiver.bytes.value: t.asset_amount for t in ax}
    assert refunds[pk(env.creator)] == STAKE  # opted: normal refund
    assert refunds[pk(env.treasury)] == STAKE  # de-opted: redirected


def test_fix1_claim_creator_deopted(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    env.set_time(T0 + 4 * 3600)
    env.opt_out(env.creator)
    env._as(env.creator, env.contract.claim, UInt64(cid))

    ax = axfers(env)
    assert len(ax) == 1
    assert ax[0].asset_amount == STAKE
    assert ax[0].asset_receiver.bytes.value == pk(env.treasury)
    # the ALGO MBR refund is opt-in-independent: still to the creator
    pays = payments(env)
    assert pays[0].amount == CHALLENGE_MBR
    assert pays[0].receiver.bytes.value == pk(env.creator)
    assert env.boxes_exist(cid) == (False, False)


def test_fix1_claim_for_sweep_creator_deopted_pays_treasury(env: Env) -> None:
    cid = env.create_challenge(seats=1)
    env.set_time(T0 + DUEL + 7 * DAY)
    env.opt_out(env.creator)
    env._as(env.outsider, env.contract.claim_for, UInt64(cid))

    ax = axfers(env)
    assert len(ax) == 1
    assert ax[0].asset_receiver.bytes.value == pk(env.treasury)
    # the caller never receives anything
    assert ax[0].asset_receiver.bytes.value != pk(env.outsider)


def test_fix1_early_close_creator_deopted(env: Env) -> None:
    cid = env.create_challenge(seats=8, duration=12 * 3600)
    env.opt_out(env.creator)
    env.early_close(env.creator, cid)

    ax = axfers(env)
    assert len(ax) == 1
    assert ax[0].asset_receiver.bytes.value == pk(env.treasury)
    assert payments(env)[0].receiver.bytes.value == pk(env.creator)


def test_fix1_catastrophe_mixed_opt_states(env: Env) -> None:
    cid = env.create_challenge(seats=4, duration=4 * 3600)
    j1, j2 = env.joiners[0], env.joiners[1]
    env.join(j1, cid)
    env.join(j2, cid)
    env.set_time(T0 + 4 * 3600 + 7 * DAY)
    env.opt_out(j2)  # griefer de-opts to try to lock the pot

    env._as(env.outsider, env.contract.catastrophe_refund, UInt64(cid))
    ax = axfers(env)
    assert len(ax) == 3  # close path does NOT fail
    refunds = {t.asset_receiver.bytes.value: t.asset_amount for t in ax}
    assert refunds[pk(env.creator)] == STAKE
    assert refunds[pk(j1)] == STAKE
    assert refunds[pk(env.treasury)] == STAKE  # j2's refund redirected
    assert env.boxes_exist(cid) == (False, False)


def test_fix1_claim_forfeit_caller_deopted(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)
    env.set_time(T0 + SEAT_TTL + 1)
    env.opt_out(env.creator)  # claimant closed their own opt-in

    env.claim_forfeit(env.creator, cid, seat=1)
    fee = STAKE * FEE_BPS // BPS
    ax = axfers(env)
    assert len(ax) == 3
    # own stake + 95% share both redirected to the treasury
    assert ax[0].asset_amount == STAKE
    assert ax[0].asset_receiver.bytes.value == pk(env.treasury)
    assert ax[1].asset_amount == STAKE - fee
    assert ax[1].asset_receiver.bytes.value == pk(env.treasury)
    assert ax[2].asset_amount == fee
    assert ax[2].asset_receiver.bytes.value == pk(env.treasury)
    # MBR (ALGO) still reaches the box payer
    assert payments(env)[0].receiver.bytes.value == pk(env.creator)
    assert env.boxes_exist(cid) == (False, False)


def test_fix1_opted_receivers_unaffected(env: Env) -> None:
    """Sanity: with everyone opted in, flows are exactly as v2 intended."""
    cid = env.create_challenge(seats=1, creator_score=100)
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=200)
    env.resolve(cid, [(0, pk(env.creator), 100), (1, pk(j), 200)])
    ax = axfers(env)
    assert ax[0].asset_receiver.bytes.value == pk(j)  # no redirect


# ---------------------------------------------------------------------------
# FIX-2 — CHALLENGE_MBR exact value (2500 + 400*(key+value) per box)
# ---------------------------------------------------------------------------


def test_fix2_challenge_mbr_matches_real_formula(env: Env) -> None:
    # worst case measured on ledger boxes: meta 148B, players 717B, keys 9B
    meta_mbr = 2500 + 400 * (9 + 148)
    players_mbr = 2500 + 400 * (9 + 717)
    assert CHALLENGE_MBR == 358_200 == meta_mbr + players_mbr

    cid = env.create_challenge(seats=12, duration=DUEL)
    assert int(env.meta(cid).mbr_paid.value) == CHALLENGE_MBR
    # actual box sizes in the ledger still fit the charged MBR
    mkey = b"m" + cid.to_bytes(8, "big")
    pkey = b"p" + cid.to_bytes(8, "big")
    for i in range(12):
        env.join(env.joiners[i], cid)
    mval = env.ctx.ledger.get_box(env.app_id, mkey)
    pval = env.ctx.ledger.get_box(env.app_id, pkey)
    assert len(mval) == 148 and len(pval) == 717
    needed = 2500 + 400 * (len(mkey) + len(mval))
    needed += 2500 + 400 * (len(pkey) + len(pval))
    assert needed == CHALLENGE_MBR

    # and the exact amount is refunded on close (full roster catastrophe)
    env.set_time(T0 + DUEL + 7 * DAY)
    env._as(env.outsider, env.contract.catastrophe_refund, UInt64(cid))
    assert payments(env)[0].amount == CHALLENGE_MBR
    assert env.boxes_exist(cid) == (False, False)


def test_fix2_exact_mbr_accepted_below_rejected(env: Env) -> None:
    env.create_challenge(seats=1)  # exact CHALLENGE_MBR works
    cid = int(env.contract.next_challenge_id.value)
    from tests.conftest import score_msg

    sig = env.sign(score_msg(env.app_id, cid, 0, pk(env.creator), 5000))
    with pytest.raises(AssertionError, match="mbr too small"):
        env._as(
            env.creator,
            env.contract.create_challenge,
            env.mbr_pay(env.creator, CHALLENGE_MBR - 1),
            env.stake_axfer(env.creator, STAKE),
            UInt64(STAKE),
            UInt64(1),
            UInt64(DUEL),
            UInt64(0),
            Bytes(b"\x00" * 32),
            UInt64(5000),
            sig,
        )


# ---------------------------------------------------------------------------
# FIX-3 — overflow-safe fee math at the previous panic boundary
# ---------------------------------------------------------------------------


def test_fix3_resolve_huge_pot_no_overflow(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=100, stake=HUGE)
    j = env.joiners[0]
    env.join(j, cid, stake=HUGE)
    env.submit(j, cid, seat=1, score=200)

    pot = 2 * HUGE  # 2**64 - 2, fits; pot * 500 would overflow uint64
    fee = pot * FEE_BPS // BPS  # Python big-int reference, exact semantics
    env.resolve(cid, [(0, pk(env.creator), 100), (1, pk(j), 200)])

    ax = axfers(env)
    assert ax[0].asset_amount == pot - fee
    assert ax[0].asset_receiver.bytes.value == pk(j)
    assert ax[1].asset_amount == fee
    assert ax[1].asset_receiver.bytes.value == pk(env.treasury)
    assert env.boxes_exist(cid) == (False, False)


def test_fix3_forfeit_huge_stake_no_overflow(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000, stake=HUGE)
    j = env.joiners[0]
    env.join(j, cid, stake=HUGE)
    env.set_time(T0 + SEAT_TTL + 1)
    env.claim_forfeit(env.creator, cid, seat=1)

    fee = HUGE * FEE_BPS // BPS  # stake * 500 would overflow uint64
    ax = axfers(env)
    assert ax[0].asset_amount == HUGE
    assert ax[1].asset_amount == HUGE - fee
    assert ax[2].asset_amount == fee
    assert ax[2].asset_receiver.bytes.value == pk(env.treasury)


def test_fix3_fee_identity_at_boundaries(env: Env) -> None:
    """floor semantics identical to amount*FEE_BPS//BPS_BASE around the
    overflow boundary and around the BPS_BASE quantum."""
    from contracts.quantum_arena.contract import protocol_fee

    for amount in (0, 1, 19, 20, 21, 199, 200, 9_999, 10_000, 10_001, HUGE, 2**64 - 1):
        expected = amount * FEE_BPS // BPS
        assert int(protocol_fee(UInt64(amount))) == expected


# ---------------------------------------------------------------------------
# FIX-4 — create rekey guard + treasury opt-in liveness gate at bootstrap
# ---------------------------------------------------------------------------


def test_fix4_create_rekey_forbidden(env: Env) -> None:
    c = QuantumArena()
    with env.ctx.txn.create_group(active_txn_overrides={"rekey_to": env.outsider}):
        with pytest.raises(AssertionError, match="app call rekey forbidden"):
            c.create(
                treasury=Bytes(pk(env.treasury)),
                oracle_pub_key=Bytes(env.oracle_pk),
                gonna=env.gonna,
            )


def test_fix4_bootstrap_requires_opted_treasury(env: Env) -> None:
    import algosdk.logic
    from algopy import Account

    fresh_treasury = env.ctx.any.account()  # never opted into $GONNA
    c = QuantumArena()
    c.create(
        treasury=Bytes(pk(fresh_treasury)),
        oracle_pub_key=Bytes(env.oracle_pk),
        gonna=env.gonna,
    )
    fresh_app_addr = Account(
        algosdk.logic.get_application_address(int(c.__app_id__))
    )
    funding = env.ctx.any.txn.payment(
        sender=env.creator, receiver=fresh_app_addr, amount=10**7
    )
    with pytest.raises(AssertionError, match="treasury not opted into"):
        env._as(env.creator, c.bootstrap, funding)

    # once the treasury opts in, bootstrap succeeds
    env.ctx.ledger.update_asset_holdings(env.gonna, fresh_treasury, balance=0)
    env._as(env.creator, c.bootstrap, funding)
    assert c.bootstrapped.value
