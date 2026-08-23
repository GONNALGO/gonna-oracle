"""Shared fixtures and helpers for QUANTUM ARENA tests."""

from __future__ import annotations

# --- testing-lib compatibility shim ---------------------------------------
# algorand-python-testing 1.1.0 requires Array(values) while the Puya stubs
# (and therefore compilable contract code) allow Array[T]() + .append().
# Give the testing implementation the same optional-default constructor.
import _algopy_testing.primitives.array as _arr_mod

_orig_array_new = _arr_mod.Array.__new__
_orig_array_init = _arr_mod.Array.__init__


def _array_new(cls, values=()):
    return _orig_array_new(cls, values)


def _array_init(self, values=()):
    _orig_array_init(self, values)


_arr_mod.Array.__new__ = _array_new
_arr_mod.Array.__init__ = _array_init
# ---------------------------------------------------------------------------


import hashlib

import algosdk.logic
import nacl.signing
import pytest
from algopy import Account, Bytes, UInt64
from algopy_testing import AlgopyTestContext, algopy_testing_context

from contracts.quantum_arena.contract import QuantumArena

# deterministic oracle key for tests
ORACLE_SEED = bytes(range(32))

STAKE = 1_000_000  # 1 $GONNA with 6 decimals
DECIMALS = 6
# v2 box MBR (both boxes, worst-case 13 players):
#   meta 2500 + 2500*(9+148) = 395_000
#   players 2500 + 2500*(9+717) = 1_817_500
CHALLENGE_MBR = 2_212_500
EARLY_CLOSE_FEE = 1_000_000  # 1 ALGO anti-spam fee
SEAT_TTL = 3600
T0 = 1_790_000_000  # fixed "now" for deterministic tests

SCORE_DOMAIN = b"QA-SCORE|"
VERDICT_DOMAIN = b"QA-VERDICT|"


def pk(account: Account) -> bytes:
    """Raw 32-byte public key of a test account."""
    return account.bytes.value


def inner_txns(ctx: AlgopyTestContext):
    """Flatten the inner transactions of the last executed group."""
    return [t for grp in ctx.txn.last_group.itxn_groups for t in grp]


def inner_axfers(ctx: AlgopyTestContext):
    """Inner asset transfers only (v2 close paths also emit ALGO payments)."""
    from algopy import TransactionType

    return [t for t in inner_txns(ctx) if t.type == TransactionType.AssetTransfer]


def inner_payments(ctx: AlgopyTestContext):
    """Inner ALGO payments only (v2: MBR refunds to the box payer)."""
    from algopy import TransactionType

    return [t for t in inner_txns(ctx) if t.type == TransactionType.Payment]


def score_msg(app_id: int, cid: int, seat: int, addr: bytes, score: int) -> bytes:
    return (
        SCORE_DOMAIN
        + app_id.to_bytes(8, "big")
        + cid.to_bytes(8, "big")
        + bytes([seat])
        + addr
        + score.to_bytes(8, "big")
    )


def verdict_msg(
    app_id: int, cid: int, mode: int, extra32: bytes, signed_entries: list[tuple[int, bytes, int]]
) -> bytes:
    """signed_entries: [(seat, addr, score)] in seat order."""
    digest = hashlib.sha256(
        b"".join(bytes([s]) + a + sc.to_bytes(8, "big") for s, a, sc in signed_entries)
    ).digest()
    return (
        VERDICT_DOMAIN
        + app_id.to_bytes(8, "big")
        + cid.to_bytes(8, "big")
        + bytes([mode])
        + extra32
        + digest
    )


class Env:
    def __init__(self, ctx: AlgopyTestContext):
        self.ctx = ctx
        self.oracle_sk = nacl.signing.SigningKey(ORACLE_SEED)
        self.oracle_pk = self.oracle_sk.verify_key.encode()
        self.treasury = ctx.any.account()
        self.creator = ctx.any.account()
        self.joiners = [ctx.any.account() for _ in range(12)]
        self.outsider = ctx.any.account()
        self.gonna = ctx.any.asset(total=10**15, decimals=DECIMALS)

        self.contract = QuantumArena()
        self.app_id = int(self.contract.__app_id__)
        self.app_address = Account(algosdk.logic.get_application_address(self.app_id))

        ctx.ledger.patch_global_fields(latest_timestamp=T0)
        self.contract.create(
            treasury=Bytes(pk(self.treasury)),
            oracle_pub_key=Bytes(self.oracle_pk),
            gonna=self.gonna,
        )
        funding = ctx.any.txn.payment(
            sender=self.creator, receiver=self.app_address, amount=10**7
        )
        self._as(self.creator, self.contract.bootstrap, funding)

    # -- helpers ------------------------------------------------------------

    def sign(self, msg: bytes) -> Bytes:
        return Bytes(self.oracle_sk.sign(msg).signature)

    def _as(self, sender: Account, fn, *args):
        """Call a contract method with `sender` as the app-call sender."""
        with self.ctx.txn.create_group(active_txn_overrides={"sender": sender}):
            return fn(*args)

    def mbr_pay(self, sender: Account, amount: int = CHALLENGE_MBR):
        return self.ctx.any.txn.payment(
            sender=sender, receiver=self.app_address, amount=amount
        )

    def stake_axfer(self, sender: Account, amount: int):
        return self.ctx.any.txn.asset_transfer(
            sender=sender,
            xfer_asset=self.gonna,
            asset_receiver=self.app_address,
            asset_amount=amount,
        )

    def create_challenge(
        self,
        seats: int = 1,
        duration: int = 24 * 3600,
        mode: int = 0,
        seed: bytes = b"\x00" * 32,
        creator_score: int = 5000,
        stake: int = STAKE,
    ) -> int:
        cid = int(self.contract.next_challenge_id.value)
        sig = self.sign(score_msg(self.app_id, cid, 0, pk(self.creator), creator_score))
        return int(
            self._as(
                self.creator,
                self.contract.create_challenge,
                self.mbr_pay(self.creator),
                self.stake_axfer(self.creator, stake),
                UInt64(stake),
                UInt64(seats),
                UInt64(duration),
                UInt64(mode),
                Bytes(seed),
                UInt64(creator_score),
                sig,
            )
        )

    def fee_pay(self, sender: Account, amount: int = EARLY_CLOSE_FEE):
        """1 ALGO anti-spam fee payment to the treasury."""
        return self.ctx.any.txn.payment(
            sender=sender, receiver=self.treasury, amount=amount
        )

    def spawn_rumble(
        self,
        who: Account | None = None,
        seats: int = 4,
        stake: int = STAKE,
        mode: int = 0,
        seed: bytes = b"\x00" * 32,
    ) -> int:
        """Permissionless rumble self-spawn (v2-C)."""
        who = who or self.creator
        return int(
            self._as(
                who,
                self.contract.spawn_rumble,
                self.mbr_pay(who),
                self.stake_axfer(who, stake),
                self.fee_pay(who),
                UInt64(stake),
                UInt64(seats),
                UInt64(mode),
                Bytes(seed),
            )
        )

    def claim_forfeit(self, who: Account, cid: int, seat: int) -> None:
        self._as(who, self.contract.claim_forfeit, UInt64(cid), UInt64(seat))

    def early_close(self, who: Account, cid: int, fee: int = EARLY_CLOSE_FEE) -> None:
        self._as(who, self.contract.early_close, self.fee_pay(who, fee), UInt64(cid))

    def boxes_exist(self, cid: int) -> tuple[bool, bool]:
        """(meta box exists, players box exists)."""
        return (
            UInt64(cid) in self.contract.challenges,
            UInt64(cid) in self.contract.players,
        )

    def join(self, who: Account, cid: int, stake: int = STAKE) -> None:
        self._as(who, self.contract.join_challenge, self.stake_axfer(who, stake), UInt64(cid))

    def submit(self, who: Account, cid: int, seat: int, score: int) -> None:
        sig = self.sign(score_msg(self.app_id, cid, seat, pk(who), score))
        self._as(who, self.contract.submit_score, UInt64(cid), UInt64(score), sig)

    def resolve(
        self,
        cid: int,
        signed_entries: list[tuple[int, bytes, int]],
        caller: Account | None = None,
        mode: int = 0,
        stage_idx: int = 0,
        seed_reveal: bytes = b"",
    ):
        if mode == 0:
            extra = b"\x00" * 32
        elif mode == 1:
            extra = b"\x00" * 24 + stage_idx.to_bytes(8, "big")
        else:
            extra = seed_reveal
        sig = self.sign(verdict_msg(self.app_id, cid, mode, extra, signed_entries))
        return self._as(
            caller or self.outsider,
            self.contract.resolve,
            UInt64(cid),
            UInt64(stage_idx),
            Bytes(seed_reveal),
            sig,
        )

    def set_time(self, ts: int) -> None:
        self.ctx.ledger.patch_global_fields(latest_timestamp=ts)

    def meta(self, cid: int):
        return self.contract.challenges[UInt64(cid)]

    def roster(self, cid: int):
        return self.contract.players[UInt64(cid)]


@pytest.fixture()
def env() -> Env:
    with algopy_testing_context() as ctx:
        yield Env(ctx)
