#!/usr/bin/env python3
"""QUANTUM ARENA — real on-chain smoke test on Algorand TESTNET.

Scenario 1: PLAYER_A creates a duel (stake 1 GONNA, oracle-signed score),
PLAYER_B joins and submits a higher oracle-signed score, RESOLVE pays
pot - 5% to B and the 5% fee to TREASURY.

Scenario 2: PLAYER_A creates a challenge nobody joins, then EARLY_CLOSE
pays 1 ALGO to TREASURY and refunds the stake to A.

Prints every tx id and asserts final balances to the microGONNA.

Requires deploy/testnet.json (app deployed) and funded accounts.
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import nacl.signing  # noqa: E402
from algosdk import abi, account, encoding, mnemonic, transaction  # noqa: E402
from algosdk.logic import get_application_address  # noqa: E402

STAKE = 1_000_000  # 1 GONNA (6 decimals)
DUEL_DURATION = 86_400
SEATS_DUEL = 1
MODE_FULL = 0
CHALLENGE_MBR = 350_000
EARLY_CLOSE_FEE = 1_000_000
FEE_BPS = 500

SCORE_DOMAIN = b"QA-SCORE|"
VERDICT_DOMAIN = b"QA-VERDICT|"
ZERO_32 = b"\x00" * 32


def score_msg(app_id: int, cid: int, seat: int, addr_bytes: bytes, score: int) -> bytes:
    return (
        SCORE_DOMAIN
        + app_id.to_bytes(8, "big")
        + cid.to_bytes(8, "big")
        + bytes([seat])
        + addr_bytes
        + score.to_bytes(8, "big")
    )


def verdict_msg(app_id, cid, mode, extra32, signed_entries):
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


TXN_TYPES = {"txn", "pay", "keyreg", "acfg", "axfer", "afrz", "appl"}


def app_args(sig: str, *enc_args) -> list:
    """[selector] + ABI-encoded non-transaction args (txn args are separate
    group transactions and never appear in app_args)."""
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
    """n NoOp calls to the opup budget app: +700 pooled opcode budget each
    (go-algorand v5 resource model: pooled budget = 700 * #app calls)."""
    opup = state["opup_app_id"]
    return [
        transaction.ApplicationNoOpTxn(
            sender=sender,
            sp=sp_fee(cl, 1000),
            index=opup,
            note=f"opup {os.urandom(4).hex()} {i}".encode(),  # unique txids
        )
        for i in range(n)
    ]


def send_group(cl, txns, keys):
    transaction.assign_group_id(txns)
    signed = [t.sign(k) for t, k in zip(txns, keys, strict=True)]
    txid = cl.send_transactions(signed)
    common.wait(cl, txid)
    return txid


def gonna_balance(cl, address, asa_id) -> int:
    for a in cl.account_info(address).get("assets", []):
        if a["asset-id"] == asa_id:
            return a["amount"]
    return 0


def next_cid(cl, app_id) -> int:
    import base64

    info = cl.application_info(app_id)
    for kv in info["params"]["global-state"]:
        if base64.b64decode(kv["key"]) == b"next_challenge_id":
            return kv["value"]["uint"]
    raise RuntimeError("next_challenge_id not found")


def ensure_player(cl, secrets, role, funder_sk, funder_addr, asa_id):
    """Create (once), fund and opt-in a player; returns (addr, sk)."""
    if role not in secrets:
        sk_, addr_ = account.generate_account()
        secrets[role] = {"address": addr_, "mnemonic": mnemonic.from_private_key(sk_)}
        with open(common.SECRETS, "w") as f:
            json.dump(secrets, f, indent=2)
    entry = secrets[role]
    addr_ = entry["address"]
    sk_ = mnemonic.to_private_key(entry["mnemonic"])
    try:
        info = cl.account_info(addr_)
        bal = info["amount"]
    except Exception:  # noqa: BLE001
        bal = 0
    if bal < 2_000_000:
        pay = transaction.PaymentTxn(
            sender=funder_addr, sp=sp_fee(cl, 1000), receiver=addr_, amt=3_000_000
        )
        txid = cl.send_transaction(pay.sign(funder_sk))
        common.wait(cl, txid)
        print(f"  funded {role} with 3 ALGO: {txid}")
    assets = [a["asset-id"] for a in cl.account_info(addr_).get("assets", [])]
    if asa_id not in assets:
        opt = transaction.AssetOptInTxn(sender=addr_, sp=sp_fee(cl, 1000), index=asa_id)
        txid = cl.send_transaction(opt.sign(sk_))
        common.wait(cl, txid)
        print(f"  {role} opt-in GONNA: {txid}")
    return addr_, sk_


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

    a_addr, a_sk = ensure_player(cl, secrets, "PLAYER_A", dep_sk, dep_addr, asa_id)
    b_addr, b_sk = ensure_player(cl, secrets, "PLAYER_B", dep_sk, dep_addr, asa_id)
    a_bytes, b_bytes = encoding.decode_address(a_addr), encoding.decode_address(b_addr)

    # distribute GONNA if needed
    for addr_, sk_ in ((a_addr, a_sk), (b_addr, b_sk)):
        if gonna_balance(cl, addr_, asa_id) < 10 * STAKE:
            ax = transaction.AssetTransferTxn(
                sender=dep_addr, sp=sp_fee(cl, 1000), receiver=addr_,
                amt=100 * STAKE, index=asa_id,
            )
            txid = cl.send_transaction(ax.sign(dep_sk))
            common.wait(cl, txid)
            print(f"  distributed 100 GONNA to {addr_[:10]}...: {txid}")

    def sign(msg: bytes) -> bytes:
        return signer.sign(msg).signature

    # ======================= SCENARIO 1: duel -> resolve ====================
    print("\n=== SCENARIO 1: duel, B wins, 5% fee to treasury ===")
    cid = next_cid(cl, app_id)
    print(f"challenge id: {cid}")

    a_score, b_score = 1000, 2000
    a_sig = sign(score_msg(app_id, cid, 0, a_bytes, a_score))

    snap_a_g = gonna_balance(cl, a_addr, asa_id)
    snap_b_g = gonna_balance(cl, b_addr, asa_id)
    snap_tre_g = gonna_balance(cl, tre_addr, asa_id)
    snap_tre_algo = cl.account_info(tre_addr)["amount"]
    print(f"pre : A={snap_a_g} B={snap_b_g} TRE={snap_tre_g} (microGONNA), TRE ALGO={snap_tre_algo}")

    # 1. CREATE (A)
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
    txid = send_group(cl, txns, [a_sk] * len(txns))
    print(f"CREATE cid={cid} group_tx={txid}")

    # 2. JOIN (B)
    ax = transaction.AssetTransferTxn(
        sender=b_addr, sp=sp_fee(cl, 1000), receiver=app_addr, amt=STAKE, index=asa_id
    )
    call = transaction.ApplicationNoOpTxn(
        sender=b_addr, sp=sp_fee(cl, 3000), index=app_id,
        app_args=app_args("join_challenge(axfer,uint64)uint64", cid),
        foreign_assets=[asa_id], boxes=boxes(app_id, cid),
    )
    txid = send_group(cl, [ax, call], [b_sk, b_sk])
    print(f"JOIN cid={cid} group_tx={txid}")

    # 3. SUBMIT SCORE (B, higher)
    b_sig = sign(score_msg(app_id, cid, 1, b_bytes, b_score))
    call = transaction.ApplicationNoOpTxn(
        sender=b_addr, sp=sp_fee(cl, 3000), index=app_id,
        app_args=app_args("submit_score(uint64,uint64,byte[])void", cid, b_score, b_sig),
        boxes=boxes(app_id, cid),
    )
    txns = [call] + opup_calls(cl, state, b_addr, 4)
    txid = send_group(cl, txns, [b_sk] * len(txns))
    print(f"SUBMIT cid={cid} B score={b_score} tx={txid}")

    # 4. RESOLVE (permissionless, called by DEPLOYER)
    vmsg = verdict_msg(
        app_id, cid, MODE_FULL, ZERO_32,
        [(0, a_bytes, a_score), (1, b_bytes, b_score)],
    )
    vsig = sign(vmsg)
    call = transaction.ApplicationNoOpTxn(
        sender=dep_addr, sp=sp_fee(cl, 6_000), index=app_id,
        app_args=app_args("resolve(uint64,uint64,byte[],byte[])byte[]", cid, 0, b"", vsig),
        accounts=[b_addr, tre_addr], foreign_assets=[asa_id], boxes=boxes(app_id, cid),
    )
    txns = [call] + opup_calls(cl, state, dep_addr, 4)
    txid = send_group(cl, txns, [dep_sk] * len(txns))
    print(f"RESOLVE cid={cid} tx={txid}")

    pot = 2 * STAKE
    fee = pot * FEE_BPS // 10_000
    payout = pot - fee
    a_g = gonna_balance(cl, a_addr, asa_id)
    b_g = gonna_balance(cl, b_addr, asa_id)
    tre_g = gonna_balance(cl, tre_addr, asa_id)
    print(f"post: A={a_g} B={b_g} TRE={tre_g} (microGONNA)")
    assert a_g == snap_a_g - STAKE, f"A balance wrong: {a_g} != {snap_a_g - STAKE}"
    assert b_g == snap_b_g - STAKE + payout, f"B balance wrong: {b_g} != {snap_b_g - STAKE + payout}"
    assert tre_g == snap_tre_g + fee, f"treasury balance wrong: {tre_g} != {snap_tre_g + fee}"
    print(f"OK: B received pot-5% = {payout} microGONNA, treasury fee = {fee}")

    # ================== SCENARIO 2: no join -> early_close ==================
    print("\n=== SCENARIO 2: create, no join, EARLY_CLOSE (1 ALGO to treasury) ===")
    cid2 = next_cid(cl, app_id)
    a_sig2 = sign(score_msg(app_id, cid2, 0, a_bytes, 500))

    snap_a_g = gonna_balance(cl, a_addr, asa_id)
    snap_a_algo = cl.account_info(a_addr)["amount"]
    snap_tre_algo = cl.account_info(tre_addr)["amount"]

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
            STAKE, SEATS_DUEL, DUEL_DURATION, MODE_FULL, ZERO_32, 500, a_sig2,
        ),
        foreign_assets=[asa_id], boxes=boxes(app_id, cid2),
    )
    txns = [pay, ax, call] + opup_calls(cl, state, a_addr, 4)
    txid = send_group(cl, txns, [a_sk] * len(txns))
    print(f"CREATE cid={cid2} group_tx={txid}")

    fee_pay = transaction.PaymentTxn(
        sender=a_addr, sp=sp_fee(cl, 1000), receiver=tre_addr, amt=EARLY_CLOSE_FEE
    )
    call = transaction.ApplicationNoOpTxn(
        sender=a_addr, sp=sp_fee(cl, 4000), index=app_id,
        app_args=app_args("early_close(pay,uint64)void", cid2),
        accounts=[tre_addr], foreign_assets=[asa_id], boxes=boxes(app_id, cid2),
    )
    txid = send_group(cl, [fee_pay, call], [a_sk, a_sk])
    print(f"EARLY_CLOSE cid={cid2} group_tx={txid}")

    a_g2 = gonna_balance(cl, a_addr, asa_id)
    a_algo2 = cl.account_info(a_addr)["amount"]
    tre_algo2 = cl.account_info(tre_addr)["amount"]
    print(f"post: A GONNA={a_g2} (refunded: {a_g2 == snap_a_g - STAKE + STAKE}), "
          f"A ALGO delta={a_algo2 - snap_a_algo}, TRE ALGO delta={tre_algo2 - snap_tre_algo}")
    assert a_g2 == snap_a_g, f"A GONNA not refunded: {a_g2} != {snap_a_g}"
    assert tre_algo2 - snap_tre_algo == EARLY_CLOSE_FEE, (
        f"treasury ALGO wrong: +{tre_algo2 - snap_tre_algo}"
    )
    print("OK: stake refunded to A, treasury received 1 ALGO early-close fee")

    print("\n=== SMOKE TEST PASSED — all balances reconcile to the microGONNA ===")


if __name__ == "__main__":
    main()
