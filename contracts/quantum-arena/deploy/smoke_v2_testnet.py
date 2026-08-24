#!/usr/bin/env python3
"""QUANTUM ARENA v2 — real on-chain smoke test on Algorand TESTNET.

Scenario 1 (duel, seat clock setup): PLAYER_A creates a duel with an
oracle-signed score, PLAYER_B joins but stays UNSIGNED. We parse both boxes
and assert the v2 layout (meta 148B incl. mbr_paid; PlayerEntry with
seated_at). The claim_forfeit path itself unlocks only after SEAT_TTL (1h) —
the duel is left OPEN on testnet so QA can claim the forfeit live later.

Scenario 2 (permissionless spawn_rumble): PLAYER_B spawns a 4-seat rumble,
pays the 1 ALGO anti-spam fee to TREASURY; we assert the deadline is the
next 21:00 UTC (>=4h horizon) and the treasury received exactly 1 ALGO.
The rumble is left OPEN on testnet for later QA.

Prints every tx id. Exits non-zero on any failed assert.
"""
import hashlib  # noqa: F401  (kept for parity with v1 smoke helpers)
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import nacl.signing  # noqa: E402
from algosdk import abi, encoding, mnemonic, transaction  # noqa: E402
from algosdk.logic import get_application_address  # noqa: E402

STAKE = 1_000_000  # 1 GONNA (6 decimals)
DUEL_DURATION = 86_400
SEATS_DUEL = 1
SEATS_SMALL = 4
MODE_FULL = 0
CHALLENGE_MBR = 358_200  # v2 (real box MBR: 65_300 + 292_900)
RUMBLE_FEE = 1_000_000  # 1 ALGO anti-spam fee to treasury
RUMBLE_HOUR_UTC = 21
RUMBLE_MIN_HORIZON = 4 * 3600

SCORE_DOMAIN = b"QA-SCORE|"
ZERO_32 = b"\x00" * 32

TXN_TYPES = {"txn", "pay", "keyreg", "acfg", "axfer", "afrz", "appl"}


def score_msg(app_id: int, cid: int, seat: int, addr_bytes: bytes, score: int) -> bytes:
    return (
        SCORE_DOMAIN
        + app_id.to_bytes(8, "big")
        + cid.to_bytes(8, "big")
        + bytes([seat])
        + addr_bytes
        + score.to_bytes(8, "big")
    )


def app_args(sig: str, *enc_args) -> list:
    m = abi.Method.from_signature(sig)
    args = [m.get_selector()]
    types = [
        a.type
        for a in m.args
        if not (isinstance(a.type, str) and a.type in TXN_TYPES)
    ]
    assert len(types) == len(enc_args), f"{m.name}: expected {len(types)} args"
    for t, v in zip(types, enc_args):
        args.append(t.encode(v) if not isinstance(t, str) else abi.ABIType.from_string(t).encode(v))
    return args


def sp_fee(cl, fee: int):
    sp = cl.suggested_params()
    sp.flat_fee = True
    sp.fee = fee
    return sp


def boxes(app_id: int, cid: int):
    return [
        (app_id, b"m" + cid.to_bytes(8, "big")),
        (app_id, b"p" + cid.to_bytes(8, "big")),
    ]


def opup_calls(cl, state, sender: str, n: int):
    opup = state["opup_app_id"]
    return [
        transaction.ApplicationNoOpTxn(
            sender=sender,
            sp=sp_fee(cl, 1000),
            index=opup,
            note=f"opup {os.urandom(4).hex()} {i}".encode(),
        )
        for i in range(n)
    ]


def send_group(cl, txns, keys):
    transaction.assign_group_id(txns)
    signed = [t.sign(k) for t, k in zip(txns, keys, strict=True)]
    txid = cl.send_transactions(signed)
    common.wait(cl, txid)
    return txid


def read_box(cl, app_id: int, name: bytes) -> bytes:
    import base64

    res = cl.application_box_by_name(app_id, name)
    return base64.b64decode(res["value"])


def next_cid(cl, app_id) -> int:
    import base64

    info = cl.application_info(app_id)
    for kv in info["params"]["global-state"]:
        if base64.b64decode(kv["key"]) == b"next_challenge_id":
            return kv["value"]["uint"]
    raise RuntimeError("next_challenge_id not found")


def expected_rumble_deadline(now: int) -> int:
    day_start = now // 86_400 * 86_400
    cand = day_start + RUMBLE_HOUR_UTC * 3600
    if cand <= now:
        cand += 86_400
    if cand - now < RUMBLE_MIN_HORIZON:
        cand += 86_400
    return cand


def u64(b: bytes) -> int:
    return int.from_bytes(b, "big")


META_ABI = "(byte[],uint64,uint64,uint64,uint64,uint64,byte[],uint64,uint64,byte[],uint64,uint64)"


def parse_meta_v2(raw: bytes) -> dict:
    """v2 ChallengeMeta — standard ABI tuple decode; box value is 148B for a
    duel pre-resolve (winner empty): 78B heads + 34+34+2 tails."""
    assert len(raw) == 148, f"meta box must be 148B, got {len(raw)}"
    t = abi.ABIType.from_string(META_ABI)
    v = t.decode(raw)
    keys = (
        "creator", "stake", "seats_total", "seats_taken", "deadline",
        "stage_mode", "seed", "creator_score", "status", "winner",
        "paid_total", "mbr_paid",
    )
    def norm(x):
        if isinstance(x, (bytes, bytearray, list)):
            return bytes(x)
        return int(x)

    return {k: norm(x) for k, x in zip(keys, v)}


def parse_players_v2(raw: bytes) -> list:
    """v2 PlayerEntry: (byte[] addr, uint64 score, bool signed, uint64 seated_at).
    A tuple with dynamic members is itself dynamic, so the array encodes as
    u16 count + u16 per-element offsets + element tuples — i.e. EXACTLY the
    standard ABI decoding of '(byte[],uint64,bool,uint64)[]' (53B/entry for a
    32-byte addr; the 55B in CHALLENGE_MBR is the reserved worst-case stride).
    """
    t = abi.ABIType.from_string("(byte[],uint64,bool,uint64)[]")
    v = t.decode(raw)
    return [
        {"addr": bytes(addr), "score": int(score), "signed": bool(sgn), "seated_at": int(seated)}
        for addr, score, sgn, seated in v
    ]  # py-algorand-sdk decodes byte[] as a list of ints — bytes() handles it


def main() -> None:
    cl = common.client()
    state = common.load_state()
    app_id = state["app_id"]
    asa_id = state["gonna_asa_id"]
    app_addr = get_application_address(app_id)

    secrets = common.load_secrets()
    dep_sk, dep_addr = common.sk("DEPLOYER"), common.addr("DEPLOYER")
    tre_addr = common.addr("TREASURY")
    oracle_sk64 = mnemonic.to_private_key(secrets["ORACLE"]["mnemonic"])
    if isinstance(oracle_sk64, str):
        import base64 as _b64

        oracle_sk64 = _b64.b64decode(oracle_sk64)
    signer = nacl.signing.SigningKey(oracle_sk64[:32])
    assert signer.verify_key.encode() == encoding.decode_address(common.addr("ORACLE"))

    a_addr, a_sk = common.addr("PLAYER_A"), common.sk("PLAYER_A")
    b_addr, b_sk = common.addr("PLAYER_B"), common.sk("PLAYER_B")
    a_bytes, b_bytes = encoding.decode_address(a_addr), encoding.decode_address(b_addr)

    # top up players from DEPLOYER if they ran dry (ALGO for fees/MBR)
    for role, addr_, in (("PLAYER_A", a_addr), ("PLAYER_B", b_addr)):
        bal = cl.account_info(addr_)["amount"]
        if bal < 1_000_000:
            pay = transaction.PaymentTxn(
                sender=dep_addr, sp=sp_fee(cl, 1000), receiver=addr_, amt=2_000_000
            )
            txid = cl.send_transaction(pay.sign(dep_sk))
            common.wait(cl, txid)
            print(f"  topped up {role} +2 ALGO: {txid}")

    def sign(msg: bytes) -> bytes:
        return signer.sign(msg).signature

    # ============ SCENARIO 1: duel create + unsigned join + box parse =======
    print("\n=== SCENARIO 1: duel (A signed, B joined UNSIGNED) — v2 box layout ===")
    cid = next_cid(cl, app_id)
    print(f"challenge id: {cid}")
    a_score = 1000
    a_sig = sign(score_msg(app_id, cid, 0, a_bytes, a_score))

    pay = transaction.PaymentTxn(
        sender=a_addr, sp=sp_fee(cl, 1000), receiver=app_addr, amt=CHALLENGE_MBR
    )
    ax = transaction.AssetTransferTxn(
        sender=a_addr, sp=sp_fee(cl, 1000), receiver=app_addr, amt=STAKE, index=asa_id
    )
    call = transaction.ApplicationNoOpTxn(
        sender=a_addr, sp=sp_fee(cl, 3000), index=app_id,
        app_args=app_args(
            "create_challenge(pay,axfer,uint64,uint64,uint64,uint64,byte[],uint64,byte[])uint64",
            STAKE, SEATS_DUEL, DUEL_DURATION, MODE_FULL, ZERO_32, a_score, a_sig,
        ),
        foreign_assets=[asa_id], boxes=boxes(app_id, cid),
    )
    txns = [pay, ax, call] + opup_calls(cl, state, a_addr, 4)
    txid_create = send_group(cl, txns, [a_sk] * len(txns))
    print(f"CREATE cid={cid} group_tx={txid_create}")

    ax = transaction.AssetTransferTxn(
        sender=b_addr, sp=sp_fee(cl, 1000), receiver=app_addr, amt=STAKE, index=asa_id
    )
    call = transaction.ApplicationNoOpTxn(
        sender=b_addr, sp=sp_fee(cl, 3000), index=app_id,
        app_args=app_args("join_challenge(axfer,uint64)uint64", cid),
        foreign_assets=[asa_id], boxes=boxes(app_id, cid),
    )
    txid_join = send_group(cl, [ax, call], [b_sk, b_sk])
    print(f"JOIN cid={cid} group_tx={txid_join} (B stays UNSIGNED)")

    # --- parse v2 boxes ----------------------------------------------------
    meta_raw = read_box(cl, app_id, b"m" + cid.to_bytes(8, "big"))
    players_raw = read_box(cl, app_id, b"p" + cid.to_bytes(8, "big"))
    print(f"box sizes: meta={len(meta_raw)}B players={len(players_raw)}B")
    meta = parse_meta_v2(meta_raw)
    roster = parse_players_v2(players_raw)

    assert meta["creator"] == a_bytes, "meta creator mismatch"
    assert meta["stake"] == STAKE, f"stake {meta['stake']}"
    assert meta["seats_total"] == SEATS_DUEL, f"seats_total {meta['seats_total']}"
    assert meta["seats_taken"] == 1, f"seats_taken {meta['seats_taken']}"
    # duel with both seats filled => STATUS_CLOSED (1, "table full") — still
    # ACTIVE for the seat clock (claim_forfeit allows OPEN or CLOSED)
    assert meta["status"] == 1, f"status {meta['status']} (want CLOSED/full=1)"
    assert meta["creator_score"] == a_score, f"creator_score {meta['creator_score']}"
    assert meta["mbr_paid"] == CHALLENGE_MBR, f"mbr_paid {meta['mbr_paid']}"
    assert meta["paid_total"] == 2 * STAKE, f"paid_total {meta['paid_total']}"
    assert meta["winner"] == b"", "winner must be empty pre-resolve"
    now = int(time.time())
    assert abs(meta["deadline"] - (now + DUEL_DURATION)) < 600, f"deadline {meta['deadline']}"

    assert len(roster) == 2, f"roster {len(roster)}"
    assert roster[0]["addr"] == a_bytes and roster[0]["signed"] and roster[0]["score"] == a_score
    assert roster[1]["addr"] == b_bytes and not roster[1]["signed"] and roster[1]["score"] == 0
    for i, e in enumerate(roster):
        assert abs(e["seated_at"] - now) < 600, f"seat{i} seated_at {e['seated_at']}"
    print(f"OK meta: 148B parsed, mbr_paid={meta['mbr_paid']} status=CLOSED(full) seats 1/1")
    print(f"OK players: seat0 A signed score={a_score}, seat1 B UNSIGNED, "
          f"seated_at={roster[1]['seated_at']} (~now), ABI entry stride "
          f"{(len(players_raw) - 2 - 2 * len(roster)) // len(roster)}B")
    print(f"NOTE: claim_forfeit(cid={cid}, seat=1) unlocks at "
          f"{roster[1]['seated_at'] + 3600} (seated_at + 1h) — left OPEN for QA")

    # ============ SCENARIO 2: permissionless spawn_rumble ===================
    print("\n=== SCENARIO 2: spawn_rumble (permissionless, 1 ALGO fee to treasury) ===")
    cid2 = next_cid(cl, app_id)
    print(f"challenge id: {cid2}")
    tre_algo_pre = cl.account_info(tre_addr)["amount"]

    pay = transaction.PaymentTxn(
        sender=b_addr, sp=sp_fee(cl, 1000), receiver=app_addr, amt=CHALLENGE_MBR
    )
    ax = transaction.AssetTransferTxn(
        sender=b_addr, sp=sp_fee(cl, 1000), receiver=app_addr, amt=STAKE, index=asa_id
    )
    fee = transaction.PaymentTxn(
        sender=b_addr, sp=sp_fee(cl, 1000), receiver=tre_addr, amt=RUMBLE_FEE
    )
    call = transaction.ApplicationNoOpTxn(
        sender=b_addr, sp=sp_fee(cl, 2000), index=app_id,
        app_args=app_args(
            "spawn_rumble(pay,axfer,pay,uint64,uint64,uint64,byte[])uint64",
            STAKE, SEATS_SMALL, MODE_FULL, ZERO_32,
        ),
        foreign_assets=[asa_id], boxes=boxes(app_id, cid2),
    )
    txid_rumble = send_group(cl, [pay, ax, fee, call], [b_sk] * 4)
    print(f"SPAWN_RUMBLE cid={cid2} group_tx={txid_rumble}")

    meta2 = parse_meta_v2(read_box(cl, app_id, b"m" + cid2.to_bytes(8, "big")))
    roster2 = parse_players_v2(read_box(cl, app_id, b"p" + cid2.to_bytes(8, "big")))
    now = int(time.time())
    want_deadline = expected_rumble_deadline(now)
    assert meta2["deadline"] == want_deadline, (
        f"rumble deadline {meta2['deadline']} != next 21:00 UTC {want_deadline}"
    )
    assert meta2["deadline"] - now >= RUMBLE_MIN_HORIZON, "rumble horizon < 4h"
    assert meta2["seats_total"] == SEATS_SMALL and meta2["status"] == 0
    assert meta2["creator_score"] == 0, "rumble creator must enter UNSIGNED"
    assert meta2["mbr_paid"] == CHALLENGE_MBR
    assert len(roster2) == 1 and roster2[0]["addr"] == b_bytes and not roster2[0]["signed"]
    tre_algo_post = cl.account_info(tre_addr)["amount"]
    assert tre_algo_post - tre_algo_pre == RUMBLE_FEE, (
        f"treasury ALGO delta {tre_algo_post - tre_algo_pre} != {RUMBLE_FEE}"
    )
    import datetime

    dl = datetime.datetime.fromtimestamp(meta2["deadline"], datetime.UTC)
    print(f"OK rumble: deadline={meta2['deadline']} ({dl.isoformat()} = next 21:00 UTC), "
          f"treasury +{RUMBLE_FEE / 1e6} ALGO, creator UNSIGNED seat0")
    print("Rumble left OPEN on testnet for later QA.")

    state.setdefault("smoke_v2", {})
    state["smoke_v2"].update(
        {
            "duel_create_cid": cid,
            "duel_create_txid": txid_create,
            "duel_join_txid": txid_join,
            "duel_forfeit_claimable_after": roster[1]["seated_at"] + 3600,
            "rumble_cid": cid2,
            "rumble_spawn_txid": txid_rumble,
            "rumble_deadline": meta2["deadline"],
        }
    )
    common.save_state(state)

    print("\n=== SMOKE v2 PASSED — v2 box layout verified, rumble self-spawned ===")


if __name__ == "__main__":
    main()
