"""
QUANTUM ARENA - skill-based challenge escrow for GONNA FIGHT on Algorand.

The contract escrows $GONNA (ASA) stakes for skill challenges. An external
oracle ("the quantum referee") attests player scores and final verdicts.
Scores and verdicts are verified on-chain.

Oracle signature scheme v1: ed25519 (`ed25519verify_bare`).
Upgrade path: Algorand v5 / AVM v12 exposes `falcon_verify` for Falcon-1024
post-quantum signatures. Once algopy/Puya expose the opcode, a v2 deployment
only needs to swap `_verify_oracle_sig` (single subroutine) and store a
Falcon-1024 public key (1793 bytes) instead of the ed25519 key (32 bytes).
See README.md, constant ORACLE_SIG_SCHEME.

Safety invariants (non negotiable):
  * checks-effects pattern: all state is updated BEFORE any inner txn is sent
  * every outer payment/axfer is fully validated (type, amount, asset, parties,
    rekey_to == zero address, no close-out fields)
  * no admin keys: the app cannot be updated, deleted or rekeyed
  * player funds can never be locked forever: CATASTROPHE_REFUND is
    permissionless after deadline + 7 days
"""

from algopy import (
    ARC4Contract,
    Account,
    Array,
    Asset,
    BoxMap,
    Bytes,
    Global,
    GlobalState,
    Struct,
    Txn,
    UInt64,
    arc4,
    gtxn,
    itxn,
    op,
    subroutine,
    urange,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Oracle signature schemes
ORACLE_SIG_SCHEME_ED25519 = 1  # v1 (this contract)
ORACLE_SIG_SCHEME_FALCON1024 = 2  # v2 reserved (AVM v12 falcon_verify)
ORACLE_SIG_SCHEME = ORACLE_SIG_SCHEME_ED25519  # active scheme

# Contract version (v2: seat clock + claim_forfeit, MBR refunds on every
# close path, permissionless spawn_rumble, box growth). Also stored in
# global state at create time.
VERSION = 2

# Economics (all amounts in base units)
FEE_BPS = 500  # 5% protocol fee on resolved pots and forfeit claims
BPS_BASE = 10_000
EARLY_CLOSE_FEE = 1_000_000  # 1 ALGO, in microAlgos

# Timing (seconds)
DUEL_DURATION = 24 * 3600  # duels are always 24h
JOIN_CUTOFF = 600  # no joins in the last 10 min before deadline
CATASTROPHE_WINDOW = 7 * 24 * 3600  # 7 days after deadline
SEAT_TTL = 3600  # duel seat clock: forfeit claimable after 1h of silence
RUMBLE_HOUR_UTC = 21  # self-spawned rumbles resolve at the next 21:00 UTC
RUMBLE_MIN_HORIZON = 4 * 3600  # ...guaranteeing at least 4h to participate

# Seats = number of JOINER seats; the creator always occupies seat 0.
SEATS_DUEL = 1
SEATS_SMALL = 4
SEATS_MEDIUM = 8
SEATS_LARGE = 12
DURATION_4H = 4 * 3600
DURATION_12H = 12 * 3600
DURATION_24H = 24 * 3600

# Challenge lifecycle status
STATUS_OPEN = 0
STATUS_CLOSED = 1  # table full, no more joins
STATUS_RESOLVED = 2  # terminal, payouts executed
STATUS_REFUNDED = 3  # terminal, stakes returned
STATUS_FORFEIT = 4  # terminal, duel seat forfeited (v2)

# Stage modes
MODE_FULL = 0  # highest total score wins
MODE_STAGE_IDX = 1  # verdict binds a stage index
MODE_RANDOM_RESOLVED = 2  # oracle reveals committed seed

# Box minimum-balance requirement charged at CREATE (microAlgos), v2.
# Real on-chain box MBR = 2500 + 400 * (key_len + value_len) per box
# (2500 flat per box + 400 per byte of key+value).
#   meta box "m":    key 9, value 148              -> 2500 + 400*157 =  65_300
#   players box "p": key 9, value 2 + 13*55 = 717  -> 2500 + 400*726 = 292_900
# (players box sized for the worst case: MAX_PLAYERS = 13 entries of
# 55 bytes each; v2 entries grew by 8 bytes for seated_at, meta by 8
# bytes for mbr_paid). The exact amount paid is recorded in the box
# (mbr_paid) and returned in full on EVERY close path.
CHALLENGE_MBR = 358_200
# Minimum ALGO the app account must receive at bootstrap (asset opt-in MBR
# 0.1 ALGO + headroom for inner txn fees via fee pooling is paid by callers).
BOOTSTRAP_MIN = 200_000

MAX_PLAYERS = 13  # 12 seats + creator

ZERO_32 = b"\x00" * 32
ZERO_24 = b"\x00" * 24

# Domain separators for oracle-signed messages (replay protection across
# apps and challenge ids is provided by embedding app id + challenge id).
SCORE_DOMAIN = b"QA-SCORE|"
VERDICT_DOMAIN = b"QA-VERDICT|"


# ---------------------------------------------------------------------------
# Storage types
# ---------------------------------------------------------------------------


class ChallengeMeta(Struct):
    """Fixed-size per-challenge state. One box per challenge (key: id)."""

    creator: Bytes  # 32-byte public key of the creator
    stake: UInt64  # per-player stake in $GONNA base units
    seats_total: UInt64  # joiner seats: 1, 4, 8 or 12
    seats_taken: UInt64  # joiner seats filled
    deadline: UInt64  # unix timestamp
    stage_mode: UInt64  # MODE_*
    seed_commitment: Bytes  # 32 bytes, sha256(reveal) for MODE_RANDOM_RESOLVED
    creator_score: UInt64  # oracle-signed at creation (0 for self-spawned rumbles)
    status: UInt64  # STATUS_*
    winner: Bytes  # 32-byte winner pk, zero until resolved (zero => tie)
    paid_total: UInt64  # total $GONNA actually escrowed for this challenge
    mbr_paid: UInt64  # exact ALGO MBR paid at create, refunded on close (v2)


class PlayerEntry(Struct):
    """One participant. Presence in the array implies the stake was paid."""

    addr: Bytes  # 32-byte public key
    score: UInt64  # oracle-signed score (0 until submitted)
    signed: bool  # True once the oracle-signed score proof is accepted
    seated_at: UInt64  # seat timestamp: create for seat 0, join otherwise (v2)


class ChallengeCreated(arc4.Struct):
    challenge_id: arc4.UInt64
    creator: arc4.Address
    stake: arc4.UInt64
    seats_total: arc4.UInt64
    deadline: arc4.UInt64


class ChallengeJoined(arc4.Struct):
    challenge_id: arc4.UInt64
    player: arc4.Address
    seats_taken: arc4.UInt64


class ScoreSubmitted(arc4.Struct):
    challenge_id: arc4.UInt64
    player: arc4.Address
    seat: arc4.UInt64
    score: arc4.UInt64


class ChallengeResolved(arc4.Struct):
    challenge_id: arc4.UInt64
    winner: arc4.Address  # zero address on perfect tie
    payout: arc4.UInt64
    fee: arc4.UInt64


class ChallengeRefunded(arc4.Struct):
    challenge_id: arc4.UInt64
    reason: arc4.UInt64  # 1 claim, 2 early-close, 3 tie, 4 catastrophe


class ChallengeForfeited(arc4.Struct):
    challenge_id: arc4.UInt64
    winner: arc4.Address  # the opponent who claimed the forfeit
    payout: arc4.UInt64  # winner's share of the forfeited stake (95%)
    fee: arc4.UInt64  # treasury share of the forfeited stake (5%)


# ---------------------------------------------------------------------------
# Subroutines
# ---------------------------------------------------------------------------


@subroutine
def assert_no_rekey_app_call() -> None:
    # The app-call itself must not rekey the caller's account.
    assert Txn.rekey_to == Global.zero_address, "app call rekey forbidden"


@subroutine
def assert_clean_payment(pay: gtxn.PaymentTransaction) -> None:
    assert pay.rekey_to == Global.zero_address, "payment rekey forbidden"
    assert pay.close_remainder_to == Global.zero_address, "payment close-out forbidden"


@subroutine
def assert_clean_axfer(axfer: gtxn.AssetTransferTransaction) -> None:
    assert axfer.rekey_to == Global.zero_address, "axfer rekey forbidden"
    assert axfer.asset_close_to == Global.zero_address, "axfer close-out forbidden"
    assert axfer.asset_sender == Global.zero_address, "clawback axfer forbidden"


@subroutine
def seat_byte(seat: UInt64) -> Bytes:
    # seats <= 12 so a single big-endian byte is enough
    return arc4.UInt8(seat).bytes


@subroutine
def build_score_msg(app_id: UInt64, cid: UInt64, seat: UInt64, addr: Bytes, score: UInt64) -> Bytes:
    return (
        Bytes(SCORE_DOMAIN)
        + op.itob(app_id)
        + op.itob(cid)
        + seat_byte(seat)
        + addr
        + op.itob(score)
    )


@subroutine
def protocol_fee(amount: UInt64) -> UInt64:
    """Exact floor(amount * FEE_BPS / BPS_BASE), overflow-safe for any uint64.

    amount * FEE_BPS overflows uint64 for amount >= 2**64 / 500 (~3.7e16).
    With amount = q*BPS_BASE + r the identity
    floor(a*f/b) == q*f + floor(r*f/b) holds exactly (same rounding), and
    every intermediate stays below 2**64 (q*f <= (2**64-1)/20, r*f < 5e6).
    """
    return (amount // BPS_BASE) * FEE_BPS + (amount % BPS_BASE) * FEE_BPS // BPS_BASE


@subroutine
def next_rumble_deadline(now: UInt64) -> UInt64:
    """Next 21:00 UTC; if it is less than 4h away, take the following day's.

    Guarantees every self-spawned rumble a minimum participation window of
    RUMBLE_MIN_HORIZON (well above JOIN_CUTOFF).
    """
    day_start = now // UInt64(86_400) * UInt64(86_400)
    candidate = day_start + UInt64(RUMBLE_HOUR_UTC * 3600)
    if candidate <= now:
        candidate += UInt64(86_400)
    if candidate - now < UInt64(RUMBLE_MIN_HORIZON):
        candidate += UInt64(86_400)
    return candidate


# ---------------------------------------------------------------------------
# Contract
# ---------------------------------------------------------------------------


class QuantumArena(ARC4Contract):
    """QUANTUM ARENA escrow. One app instance escrows unlimited challenges."""

    def __init__(self) -> None:
        # Deploy-time configuration (immutable: no update methods exist).
        self.treasury = GlobalState(Bytes)  # 32-byte pk (Falcon-1024 account)
        self.oracle_pub_key = GlobalState(Bytes)  # ed25519 pk in v1
        self.gonna_asset_id = GlobalState(UInt64)
        self.bootstrapped = GlobalState(bool)
        self.next_challenge_id = GlobalState(UInt64)
        self.version = GlobalState(UInt64)  # VERSION, immutable after create
        # Per-challenge boxes.
        self.challenges = BoxMap(UInt64, ChallengeMeta, key_prefix=b"m")
        self.players = BoxMap(UInt64, Array[PlayerEntry], key_prefix=b"p")

    # -- deploy -------------------------------------------------------------

    @arc4.abimethod(create="require")
    def create(self, treasury: Bytes, oracle_pub_key: Bytes, gonna: Asset) -> None:
        """Deploy. `treasury` should be a Falcon-1024 (PQ) account address."""
        assert_no_rekey_app_call()
        assert treasury.length == 32, "invalid treasury"
        assert oracle_pub_key.length == 32, "v1 oracle key must be ed25519 (32 bytes)"
        self.treasury.value = treasury
        self.oracle_pub_key.value = oracle_pub_key
        self.gonna_asset_id.value = gonna.id
        self.bootstrapped.value = False
        self.next_challenge_id.value = UInt64(0)
        self.version.value = UInt64(VERSION)

    @arc4.abimethod
    def bootstrap(self, funding: gtxn.PaymentTransaction) -> None:
        """One-time ASA opt-in of the app account.

        funding: ALGO payment to the app address covering the $GONNA opt-in
        MBR plus operating headroom.
        """
        assert_no_rekey_app_call()
        assert not self.bootstrapped.value, "already bootstrapped"
        assert_clean_payment(funding)
        assert funding.sender == Txn.sender, "funding sender mismatch"
        assert funding.receiver == Global.current_application_address, "funding receiver"
        assert funding.amount >= BOOTSTRAP_MIN, "funding too small"

        # Liveness gate: the treasury collects protocol fees and receives
        # redirected unpayable balances; if it is not opted into $GONNA
        # those axfers would fail on-chain. Verified once, here.
        treasury_balance, treasury_opted = op.AssetHoldingGet.asset_balance(
            Account(self.treasury.value), Asset(self.gonna_asset_id.value)
        )
        assert treasury_opted, "treasury not opted into $GONNA"

        self.bootstrapped.value = True
        itxn.AssetTransfer(
            xfer_asset=Asset(self.gonna_asset_id.value),
            asset_amount=UInt64(0),
            asset_receiver=Global.current_application_address,
            fee=UInt64(0),  # fee pooling: covered by the outer group
        ).submit()

    # -- challenge lifecycle ------------------------------------------------

    @arc4.abimethod
    def create_challenge(
        self,
        mbr_payment: gtxn.PaymentTransaction,
        stake_payment: gtxn.AssetTransferTransaction,
        stake: UInt64,
        seats_total: UInt64,
        duration_secs: UInt64,
        stage_mode: UInt64,
        seed_commitment: Bytes,
        creator_score: UInt64,
        creator_score_sig: Bytes,
    ) -> UInt64:
        """Open a challenge. Group: [mbr pay, $GONNA stake axfer, app call].

        The creator's score is committed sealed, already signed by the oracle.
        """
        assert_no_rekey_app_call()
        assert self.bootstrapped.value, "app not bootstrapped"

        # --- parameter validation
        assert stake > 0, "stake must be positive"
        assert (
            seats_total == SEATS_DUEL
            or seats_total == SEATS_SMALL
            or seats_total == SEATS_MEDIUM
            or seats_total == SEATS_LARGE
        ), "invalid seats"
        if seats_total == SEATS_DUEL:
            # duels are always 24h
            assert duration_secs == DUEL_DURATION, "duel duration must be 24h"
        else:
            assert (
                duration_secs == DURATION_4H
                or duration_secs == DURATION_12H
                or duration_secs == DURATION_24H
            ), "invalid duration"
        assert stage_mode <= MODE_RANDOM_RESOLVED, "invalid stage mode"
        assert seed_commitment.length == 32, "seed commitment must be 32 bytes"

        # --- atomic funding validation (checks before effects)
        assert_clean_payment(mbr_payment)
        assert mbr_payment.sender == Txn.sender, "mbr sender mismatch"
        assert mbr_payment.receiver == Global.current_application_address, "mbr receiver"
        assert mbr_payment.amount >= CHALLENGE_MBR, "mbr too small"

        assert_clean_axfer(stake_payment)
        assert stake_payment.sender == Txn.sender, "stake sender mismatch"
        assert stake_payment.xfer_asset.id == self.gonna_asset_id.value, "wrong asset"
        assert stake_payment.asset_amount == stake, "stake amount mismatch"
        assert (
            stake_payment.asset_receiver == Global.current_application_address
        ), "stake receiver"

        cid = self.next_challenge_id.value

        # --- oracle proof of the creator score
        assert self._verify_oracle_sig(
            build_score_msg(
                Global.current_application_id.id,
                cid,
                UInt64(0),
                Txn.sender.bytes,
                creator_score,
            ),
            creator_score_sig,
        ), "bad creator score proof"

        # --- effects (state first, no inner txns in this method)
        deadline = Global.latest_timestamp + duration_secs
        self.challenges[cid] = ChallengeMeta(
            creator=Txn.sender.bytes,
            stake=stake,
            seats_total=seats_total,
            seats_taken=UInt64(0),
            deadline=deadline,
            stage_mode=stage_mode,
            seed_commitment=seed_commitment,
            creator_score=creator_score,
            status=UInt64(STATUS_OPEN),
            winner=Bytes(b""),
            paid_total=stake,
            mbr_paid=mbr_payment.amount,
        ).copy()
        roster = Array[PlayerEntry]()
        roster.append(
            PlayerEntry(
                addr=Txn.sender.bytes,
                score=creator_score,
                signed=True,
                seated_at=Global.latest_timestamp,
            )
        )
        self.players[cid] = roster.copy()

        self.next_challenge_id.value = cid + 1

        arc4.emit(
            ChallengeCreated(
                challenge_id=arc4.UInt64(cid),
                creator=arc4.Address(Txn.sender.bytes),
                stake=arc4.UInt64(stake),
                seats_total=arc4.UInt64(seats_total),
                deadline=arc4.UInt64(deadline),
            )
        )
        return cid

    @arc4.abimethod
    def spawn_rumble(
        self,
        mbr_payment: gtxn.PaymentTransaction,
        stake_payment: gtxn.AssetTransferTransaction,
        fee_payment: gtxn.PaymentTransaction,
        stake: UInt64,
        seats_total: UInt64,
        stage_mode: UInt64,
        seed_commitment: Bytes,
    ) -> UInt64:
        """Permissionless rumble self-spawn. Anyone can call this.

        Group: [mbr pay, $GONNA stake axfer, 1 ALGO fee pay, app call].
        The caller becomes the creator (seat 0) and enters UNSIGNED (no
        oracle gate): they may submit a signed score later like any other
        player, otherwise they forfeit into the pot at resolve. Deadline is
        automatic: the next 21:00 UTC, pushed one day forward if less than
        4h away. From there ALL v1 rumble rules apply unchanged.
        """
        assert_no_rekey_app_call()
        assert self.bootstrapped.value, "app not bootstrapped"

        # --- parameter validation (duels stay on create_challenge)
        assert stake > 0, "stake must be positive"
        assert (
            seats_total == SEATS_SMALL
            or seats_total == SEATS_MEDIUM
            or seats_total == SEATS_LARGE
        ), "invalid seats"
        assert stage_mode <= MODE_RANDOM_RESOLVED, "invalid stage mode"
        assert seed_commitment.length == 32, "seed commitment must be 32 bytes"

        # --- atomic funding validation (checks before effects)
        assert_clean_payment(mbr_payment)
        assert mbr_payment.sender == Txn.sender, "mbr sender mismatch"
        assert mbr_payment.receiver == Global.current_application_address, "mbr receiver"
        assert mbr_payment.amount >= CHALLENGE_MBR, "mbr too small"

        assert_clean_axfer(stake_payment)
        assert stake_payment.sender == Txn.sender, "stake sender mismatch"
        assert stake_payment.xfer_asset.id == self.gonna_asset_id.value, "wrong asset"
        assert stake_payment.asset_amount == stake, "stake amount mismatch"
        assert (
            stake_payment.asset_receiver == Global.current_application_address
        ), "stake receiver"

        # anti-spam fee, same convention as early_close
        assert_clean_payment(fee_payment)
        assert fee_payment.sender == Txn.sender, "fee sender mismatch"
        assert fee_payment.receiver.bytes == self.treasury.value, "fee receiver"
        assert fee_payment.amount == EARLY_CLOSE_FEE, "fee must be 1 ALGO"

        cid = self.next_challenge_id.value

        # --- effects (state first, no inner txns in this method)
        deadline = next_rumble_deadline(Global.latest_timestamp)
        self.challenges[cid] = ChallengeMeta(
            creator=Txn.sender.bytes,
            stake=stake,
            seats_total=seats_total,
            seats_taken=UInt64(0),
            deadline=deadline,
            stage_mode=stage_mode,
            seed_commitment=seed_commitment,
            creator_score=UInt64(0),  # unsigned at spawn, no oracle gate
            status=UInt64(STATUS_OPEN),
            winner=Bytes(b""),
            paid_total=stake,
            mbr_paid=mbr_payment.amount,
        ).copy()
        roster = Array[PlayerEntry]()
        roster.append(
            PlayerEntry(
                addr=Txn.sender.bytes,
                score=UInt64(0),
                signed=False,
                seated_at=Global.latest_timestamp,
            )
        )
        self.players[cid] = roster.copy()

        self.next_challenge_id.value = cid + 1

        arc4.emit(
            ChallengeCreated(
                challenge_id=arc4.UInt64(cid),
                creator=arc4.Address(Txn.sender.bytes),
                stake=arc4.UInt64(stake),
                seats_total=arc4.UInt64(seats_total),
                deadline=arc4.UInt64(deadline),
            )
        )
        return cid

    @arc4.abimethod
    def join_challenge(
        self, stake_payment: gtxn.AssetTransferTransaction, challenge_id: UInt64
    ) -> UInt64:
        """Join an open challenge. ATOMIC: the stake axfer is in the same
        group, so any assert failure here reverts the payment too."""
        assert_no_rekey_app_call()

        assert challenge_id in self.challenges, "challenge not found"
        meta = self.challenges[challenge_id].copy()
        assert meta.status == STATUS_OPEN, "not open"
        assert meta.seats_taken < meta.seats_total, "table full"
        assert Global.latest_timestamp < meta.deadline - JOIN_CUTOFF, "join cutoff"

        assert challenge_id in self.players, "roster missing"
        roster = self.players[challenge_id].copy()

        # no duplicate participants
        for i in urange(roster.length):
            assert roster[i].addr != Txn.sender.bytes, "already joined"

        # --- atomic funding validation
        assert_clean_axfer(stake_payment)
        assert stake_payment.sender == Txn.sender, "stake sender mismatch"
        assert stake_payment.xfer_asset.id == self.gonna_asset_id.value, "wrong asset"
        assert stake_payment.asset_amount == meta.stake, "stake amount mismatch"
        assert (
            stake_payment.asset_receiver == Global.current_application_address
        ), "stake receiver"

        # --- effects
        roster.append(
            PlayerEntry(
                addr=Txn.sender.bytes,
                score=UInt64(0),
                signed=False,
                seated_at=Global.latest_timestamp,
            )
        )
        meta.seats_taken += 1
        meta.paid_total += meta.stake
        if meta.seats_taken == meta.seats_total:
            meta.status = UInt64(STATUS_CLOSED)  # table full: no more joins
        self.players[challenge_id] = roster.copy()
        self.challenges[challenge_id] = meta.copy()

        arc4.emit(
            ChallengeJoined(
                challenge_id=arc4.UInt64(challenge_id),
                player=arc4.Address(Txn.sender.bytes),
                seats_taken=arc4.UInt64(meta.seats_taken),
            )
        )
        return meta.seats_taken

    @arc4.abimethod
    def submit_score(self, challenge_id: UInt64, score: UInt64, sig: Bytes) -> None:
        """Submit an oracle-signed score before the deadline."""
        assert_no_rekey_app_call()

        assert challenge_id in self.challenges, "challenge not found"
        meta = self.challenges[challenge_id].copy()
        assert meta.status == STATUS_OPEN or meta.status == STATUS_CLOSED, "not active"
        assert Global.latest_timestamp < meta.deadline, "deadline passed"

        assert challenge_id in self.players, "roster missing"
        roster = self.players[challenge_id].copy()

        seat = UInt64(0)
        found = False
        for i in urange(roster.length):
            entry = roster[i].copy()
            if entry.addr == Txn.sender.bytes:
                assert not entry.signed, "score already submitted"
                seat = i
                # oracle proof binds app, challenge, seat, player and score
                assert self._verify_oracle_sig(
                    build_score_msg(
                        Global.current_application_id.id,
                        challenge_id,
                        seat,
                        Txn.sender.bytes,
                        score,
                    ),
                    sig,
                ), "bad score proof"
                entry.score = score
                entry.signed = True
                roster[i] = entry.copy()
                found = True
        assert found, "not a participant"

        self.players[challenge_id] = roster.copy()

        arc4.emit(
            ScoreSubmitted(
                challenge_id=arc4.UInt64(challenge_id),
                player=arc4.Address(Txn.sender.bytes),
                seat=arc4.UInt64(seat),
                score=arc4.UInt64(score),
            )
        )

    @arc4.abimethod
    def resolve(
        self,
        challenge_id: UInt64,
        stage_idx: UInt64,
        seed_reveal: Bytes,
        verdict_sig: Bytes,
    ) -> Bytes:
        """Resolve a challenge. Permissionless.

        Allowed when (a) the table is full and everyone signed (immediate,
        before deadline), or (b) the deadline passed and at least one joiner
        signed. Unsigned players forfeit their stake into the pot.
        Perfect tie among top scores -> everyone is refunded, zero fee.
        """
        assert_no_rekey_app_call()

        assert challenge_id in self.challenges, "challenge not found"
        meta = self.challenges[challenge_id].copy()
        assert meta.status == STATUS_OPEN or meta.status == STATUS_CLOSED, "not active"

        assert challenge_id in self.players, "roster missing"
        roster = self.players[challenge_id].copy()

        n = roster.length
        assert n >= 1, "empty roster"

        # --- eligibility
        filled = meta.seats_taken == meta.seats_total
        all_signed = True
        signed_joiners = UInt64(0)
        for i in urange(n):
            entry = roster[i].copy()
            if entry.signed:
                if i > 0:
                    signed_joiners += 1
            else:
                all_signed = False
        now = Global.latest_timestamp
        allowed = (filled and all_signed) or (now >= meta.deadline and signed_joiners >= 1)
        assert allowed, "not resolvable yet"

        # --- digest of signed scores, in seat order
        digest_input = Bytes()
        n_signed = UInt64(0)
        for i in urange(n):
            entry = roster[i].copy()
            if entry.signed:
                digest_input += seat_byte(i) + entry.addr + op.itob(entry.score)
                n_signed += 1
        digest = op.sha256(digest_input)

        # --- stage-mode specific verdict payload (exactly 32 bytes)
        extra = Bytes()
        if meta.stage_mode == MODE_FULL:
            assert stage_idx == 0, "unexpected stage idx"
            assert seed_reveal.length == 0, "unexpected seed reveal"
            extra = Bytes(ZERO_32)
        elif meta.stage_mode == MODE_STAGE_IDX:
            assert seed_reveal.length == 0, "unexpected seed reveal"
            extra = Bytes(ZERO_24) + op.itob(stage_idx)
        else:  # MODE_RANDOM_RESOLVED
            assert seed_reveal.length == 32, "seed reveal must be 32 bytes"
            assert op.sha256(seed_reveal) == meta.seed_commitment, "bad seed reveal"
            extra = seed_reveal

        # --- oracle verdict over the whole outcome set
        verdict_msg = (
            Bytes(VERDICT_DOMAIN)
            + op.itob(Global.current_application_id.id)
            + op.itob(challenge_id)
            + arc4.UInt8(meta.stage_mode).bytes
            + extra
            + digest
        )
        assert self._verify_oracle_sig(verdict_msg, verdict_sig), "bad verdict"

        # --- winner selection
        winner = Bytes()
        tie = False
        if meta.stage_mode == MODE_RANDOM_RESOLVED:
            # deterministic pick among signed players, oracle-committed seed
            pick = op.extract_uint64(seed_reveal, 0) % n_signed
            seen = UInt64(0)
            for i in urange(n):
                entry = roster[i].copy()
                if entry.signed:
                    if seen == pick:
                        winner = entry.addr
                    seen += 1
        else:
            best = UInt64(0)
            best_count = UInt64(0)
            for i in urange(n):
                entry = roster[i].copy()
                if entry.signed:
                    if best_count == 0 or entry.score > best:
                        best = entry.score
                        best_count = UInt64(1)
                        winner = entry.addr
                    elif entry.score == best:
                        best_count += 1
            tie = best_count > 1

        # --- effects BEFORE any inner transaction (checks-effects)
        # v2: terminal state transition deletes BOTH boxes; the exact MBR
        # paid at create goes back to the payer (creator). The terminal
        # status (RESOLVED / REFUNDED-on-tie) is observable via the emitted
        # events — no storage is left behind, no MBR stays locked.
        pot = meta.paid_total
        mbr_paid = meta.mbr_paid
        creator = Account(meta.creator)
        del self.challenges[challenge_id]
        del self.players[challenge_id]

        # --- interactions
        if tie:
            # perfect tie: every payer gets the full stake back, zero fee,
            # forfeits are refunded too (simplest anti-dispute rule).
            for i in urange(n):
                entry = roster[i].copy()
                self._pay_gonna(entry.addr, meta.stake)
            itxn.Payment(
                receiver=creator,
                amount=mbr_paid,
                fee=UInt64(0),
            ).submit()
            arc4.emit(
                ChallengeResolved(
                    challenge_id=arc4.UInt64(challenge_id),
                    winner=arc4.Address(),  # zero address signals a tie
                    payout=arc4.UInt64(0),
                    fee=arc4.UInt64(0),
                )
            )
            arc4.emit(
                ChallengeRefunded(challenge_id=arc4.UInt64(challenge_id), reason=arc4.UInt64(3))
            )
            return Bytes(b"")
        else:
            fee = protocol_fee(pot)
            payout = pot - fee
            self._pay_gonna(winner, payout)
            if fee > 0:
                itxn.AssetTransfer(
                    xfer_asset=Asset(self.gonna_asset_id.value),
                    asset_amount=fee,
                    asset_receiver=Account(self.treasury.value),
                    fee=UInt64(0),
                ).submit()
            itxn.Payment(
                receiver=creator,
                amount=mbr_paid,
                fee=UInt64(0),
            ).submit()
            arc4.emit(
                ChallengeResolved(
                    challenge_id=arc4.UInt64(challenge_id),
                    winner=arc4.Address(winner),
                    payout=arc4.UInt64(payout),
                    fee=arc4.UInt64(fee),
                )
            )
            return winner

    @arc4.abimethod
    def claim(self, challenge_id: UInt64) -> None:
        """Creator reclaims the stake of a challenge nobody joined.

        Only after the deadline, only if zero joiners, zero fee.
        """
        assert_no_rekey_app_call()
        assert challenge_id in self.challenges, "challenge not found"
        meta = self.challenges[challenge_id].copy()
        assert meta.status == STATUS_OPEN or meta.status == STATUS_CLOSED, "not refundable"
        assert challenge_id in self.players, "roster missing"
        roster = self.players[challenge_id].copy()
        assert meta.seats_taken == 0, "challenge has joiners"
        assert Global.latest_timestamp >= meta.deadline, "deadline not reached"
        assert Txn.sender.bytes == meta.creator, "only creator"
        self._refund_all(challenge_id, meta, roster, arc4.UInt64(1))

    @arc4.abimethod
    def claim_for(self, challenge_id: UInt64) -> None:
        """Permissionless sweep of an un-joined, expired challenge.

        Pays the CREATOR (never the caller). Available after deadline + 7d.
        """
        assert_no_rekey_app_call()
        assert challenge_id in self.challenges, "challenge not found"
        meta = self.challenges[challenge_id].copy()
        assert meta.status == STATUS_OPEN or meta.status == STATUS_CLOSED, "not refundable"
        assert challenge_id in self.players, "roster missing"
        roster = self.players[challenge_id].copy()
        assert meta.seats_taken == 0, "challenge has joiners"
        assert (
            Global.latest_timestamp >= meta.deadline + CATASTROPHE_WINDOW
        ), "sweep window not reached"
        self._refund_all(challenge_id, meta, roster, arc4.UInt64(1))

    @arc4.abimethod
    def claim_forfeit(self, challenge_id: UInt64, seat: UInt64) -> None:
        """Duel-only seat clock: claim the stake of a silent opponent (v2).

        The target seat must be occupied and UNSIGNED, and its clock
        (seated_at + SEAT_TTL) must have expired — strict >. The caller
        must be the opponent (the other seat) and must hold a signed score
        on this challenge. Effect: the forfeited stake goes 95% to the
        caller, 5% to the treasury (same rounding as resolve); the caller's
        own signed stake is returned in full. Both boxes are deleted and
        the exact MBR paid at create goes back to the payer (creator).
        If NEITHER side has signed, this path is unavailable (the caller
        cannot be signed) and the v1 paths (early_close / catastrophe)
        apply instead.
        """
        assert_no_rekey_app_call()
        assert challenge_id in self.challenges, "challenge not found"
        meta = self.challenges[challenge_id].copy()
        assert meta.status == STATUS_OPEN or meta.status == STATUS_CLOSED, "not active"
        assert meta.seats_total == SEATS_DUEL, "forfeit claims are duel-only"
        assert challenge_id in self.players, "roster missing"
        roster = self.players[challenge_id].copy()
        assert meta.seats_taken == 1, "opponent seat empty"
        assert seat <= 1, "invalid seat"

        target = roster[seat].copy()
        caller = roster[1 - seat].copy()  # a duel has exactly seats 0 and 1
        assert caller.addr == Txn.sender.bytes, "only the opponent can claim"
        assert caller.signed, "caller must have a signed score"
        assert not target.signed, "target has a signed score"
        assert (
            Global.latest_timestamp > target.seated_at + SEAT_TTL
        ), "seat clock not expired"

        # --- effects BEFORE any inner transaction (checks-effects)
        fee = protocol_fee(meta.stake)  # 5% of the forfeited stake
        winner_share = meta.stake - fee
        own_stake = meta.stake
        mbr_paid = meta.mbr_paid
        winner_addr = caller.addr
        creator = Account(meta.creator)
        # single claim possible: the challenge is gone after this
        del self.challenges[challenge_id]
        del self.players[challenge_id]

        # --- interactions
        self._pay_gonna(winner_addr, own_stake)  # caller's own stake, in full
        self._pay_gonna(winner_addr, winner_share)  # 95% of the forfeited stake
        if fee > 0:
            itxn.AssetTransfer(
                xfer_asset=Asset(self.gonna_asset_id.value),
                asset_amount=fee,
                asset_receiver=Account(self.treasury.value),
                fee=UInt64(0),
            ).submit()
        itxn.Payment(  # exact MBR paid at create, back to the payer
            receiver=creator,
            amount=mbr_paid,
            fee=UInt64(0),
        ).submit()

        arc4.emit(
            ChallengeForfeited(
                challenge_id=arc4.UInt64(challenge_id),
                winner=arc4.Address(winner_addr),
                payout=arc4.UInt64(winner_share),
                fee=arc4.UInt64(fee),
            )
        )

    @arc4.abimethod
    def early_close(
        self, fee_payment: gtxn.PaymentTransaction, challenge_id: UInt64
    ) -> None:
        """Creator closes an un-joined challenge before the deadline.

        Costs 1 ALGO paid to the treasury (anti-spam), stake is returned.
        """
        assert_no_rekey_app_call()
        assert challenge_id in self.challenges, "challenge not found"
        meta = self.challenges[challenge_id].copy()
        assert meta.status == STATUS_OPEN or meta.status == STATUS_CLOSED, "not refundable"
        assert challenge_id in self.players, "roster missing"
        roster = self.players[challenge_id].copy()
        assert meta.seats_taken == 0, "challenge has joiners"
        assert Global.latest_timestamp < meta.deadline, "too late for early close"
        assert Txn.sender.bytes == meta.creator, "only creator"

        assert_clean_payment(fee_payment)
        assert fee_payment.sender == Txn.sender, "fee sender mismatch"
        assert fee_payment.receiver.bytes == self.treasury.value, "fee receiver"
        assert fee_payment.amount == EARLY_CLOSE_FEE, "fee must be 1 ALGO"

        self._refund_all(challenge_id, meta, roster, arc4.UInt64(2))

    @arc4.abimethod
    def catastrophe_refund(self, challenge_id: UInt64) -> None:
        """Permissionless total refund after deadline + 7 days.

        Ultimate liveness guarantee: FUNDS CAN NEVER BE LOCKED FOREVER.
        Every payer is refunded in full, zero fee, forfeits included.
        """
        assert_no_rekey_app_call()
        assert challenge_id in self.challenges, "challenge not found"
        meta = self.challenges[challenge_id].copy()
        assert meta.status == STATUS_OPEN or meta.status == STATUS_CLOSED, "not refundable"
        assert challenge_id in self.players, "roster missing"
        roster = self.players[challenge_id].copy()
        assert (
            Global.latest_timestamp >= meta.deadline + CATASTROPHE_WINDOW
        ), "catastrophe window not reached"
        self._refund_all(challenge_id, meta, roster, arc4.UInt64(4))

    # -- internal helpers ---------------------------------------------------

    @subroutine
    def _verify_oracle_sig(self, msg: Bytes, sig: Bytes) -> bool:
        """Single point of oracle verification.

        v1: ed25519 via ed25519verify_bare (ORACLE_SIG_SCHEME = 1).
        v2 (planned): Falcon-1024 via `falcon_verify` (AVM v12) - swap ONLY
        this subroutine and store the 1793-byte Falcon public key.
        """
        return op.ed25519verify_bare(msg, sig, self.oracle_pub_key.value)

    @subroutine
    def _gonna_dest(self, addr: Bytes) -> Bytes:
        """Where a $GONNA payment to `addr` can actually land (FIX-1).

        On-chain, an axfer to an account that closed its ASA opt-in fails
        the WHOLE group — that would lock the escrow forever on any close
        path. If `addr` does not currently hold $GONNA, the amount is
        redirected to the treasury instead (documented behavior: unpayable
        balances go to the treasury). No close path can ever fail because
        of receiver state.
        """
        holding_balance, opted = op.AssetHoldingGet.asset_balance(
            Account(addr), Asset(self.gonna_asset_id.value)
        )
        if opted:
            return addr
        return self.treasury.value

    @subroutine
    def _pay_gonna(self, addr: Bytes, amount: UInt64) -> None:
        """Send `amount` of $GONNA to `addr`, or to the treasury if `addr`
        is not opted in (see _gonna_dest)."""
        itxn.AssetTransfer(
            xfer_asset=Asset(self.gonna_asset_id.value),
            asset_amount=amount,
            asset_receiver=Account(self._gonna_dest(addr)),
            fee=UInt64(0),
        ).submit()

    @subroutine
    def _refund_all(
        self,
        challenge_id: UInt64,
        meta: ChallengeMeta,
        roster: Array[PlayerEntry],
        reason: arc4.UInt64,
    ) -> None:
        """Refund every payer in full, zero fee. State first, then itxns.

        v2: the terminal REFUNDED transition deletes BOTH boxes and the
        exact MBR paid at create (mbr_paid) goes back to the payer
        (creator) — no funds stay locked.
        """
        # --- effects
        creator = Account(meta.creator)
        mbr_paid = meta.mbr_paid
        del self.challenges[challenge_id]
        del self.players[challenge_id]

        # --- interactions
        for i in urange(roster.length):
            entry = roster[i].copy()
            self._pay_gonna(entry.addr, meta.stake)
        itxn.Payment(
            receiver=creator,
            amount=mbr_paid,
            fee=UInt64(0),
        ).submit()

        arc4.emit(ChallengeRefunded(challenge_id=arc4.UInt64(challenge_id), reason=reason))
