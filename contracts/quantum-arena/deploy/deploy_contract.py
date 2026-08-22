#!/usr/bin/env python3
"""Deploy QuantumArena to Algorand TESTNET and bootstrap it.

  - application create from compiled TEAL artifacts, extra_program_pages=1
  - ARC-4 create(treasury, oracle_pub_key, gonna) on-creation call
  - bootstrap(pay >= 0.2 ALGO): app opts itself into the $GONNA ASA
  - prints app id + app escrow address, writes deploy/testnet.json

Idempotent: if testnet.json already has app_id, skips creation.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
from algosdk import abi, encoding, transaction  # noqa: E402
from algosdk.logic import get_application_address  # noqa: E402

ARTIFACTS = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "contracts",
    "quantum_arena",
    "artifacts",
)
BOOTSTRAP_FUNDING = 1_000_000  # 1 ALGO (min 0.2)


def compile_teal(cl, name: str) -> bytes:
    import base64

    with open(os.path.join(ARTIFACTS, name)) as f:
        teal = f.read()
    res = cl.compile(teal)
    return base64.b64decode(res["result"])


def main() -> None:
    cl = common.client()
    state = common.load_state()
    deployer_sk = common.sk("DEPLOYER")
    deployer = common.addr("DEPLOYER")

    asa_id = state.get("gonna_asa_id")
    if asa_id is None:
        raise SystemExit("gonna_asa_id missing — run create_asa.py first")

    if "app_id" in state:
        app_id = state["app_id"]
        print(f"app already deployed: {app_id}")
    else:
        approval = compile_teal(cl, "QuantumArena.approval.teal")
        clear = compile_teal(cl, "QuantumArena.clear.teal")
        print(f"approval bytes: {len(approval)}, clear bytes: {len(clear)}")

        sp = cl.suggested_params()
        sp.flat_fee = True
        sp.fee = 2_000

        treasury_pk = encoding.decode_address(common.addr("TREASURY"))
        oracle_pk = encoding.decode_address(common.addr("ORACLE"))

        sig = "create(byte[],byte[],uint64)void"
        method = abi.Method.from_signature(sig)
        app_args = [method.get_selector()]
        app_args.append(abi.ABIType.from_string("byte[]").encode(treasury_pk))
        app_args.append(abi.ABIType.from_string("byte[]").encode(oracle_pk))
        app_args.append(abi.ABIType.from_string("uint64").encode(asa_id))

        txn = transaction.ApplicationCreateTxn(
            sender=deployer,
            sp=sp,
            on_complete=transaction.OnComplete.NoOpOC,
            approval_program=approval,
            clear_program=clear,
            global_schema=transaction.StateSchema(3, 2),
            local_schema=transaction.StateSchema(0, 0),
            app_args=app_args,
            extra_pages=1,
        )
        txid = cl.send_transaction(txn.sign(deployer_sk))
        info = common.wait(cl, txid)
        app_id = info["application-index"]
        state["app_id"] = app_id
        state["deploy_txid"] = txid
        state["app_address"] = get_application_address(app_id)
        common.save_state(state)
        print(f"DEPLOYED app_id={app_id} tx={txid}")

    app_addr = get_application_address(app_id)

    # --- bootstrap ----------------------------------------------------------
    app_info = cl.application_info(app_id)
    gstate = {
        __import__("base64").b64decode(kv["key"]).decode(): kv["value"]
        for kv in app_info["params"]["global-state"]
    }
    if gstate.get("bootstrapped", {}).get("uint", 0):
        print("already bootstrapped")
    else:
        sp = cl.suggested_params()
        pay = transaction.PaymentTxn(
            sender=deployer, sp=sp, receiver=app_addr, amt=BOOTSTRAP_FUNDING
        )
        sp2 = cl.suggested_params()
        sp2.flat_fee = True
        sp2.fee = 3_000  # app call + inner axfer (fee pooling)
        m = abi.Method.from_signature("bootstrap(pay)void")
        call = transaction.ApplicationNoOpTxn(
            sender=deployer,
            sp=sp2,
            index=app_id,
            app_args=[m.get_selector()],
            foreign_assets=[asa_id],
        )
        transaction.assign_group_id([pay, call])
        stx1 = pay.sign(deployer_sk)
        stx2 = call.sign(deployer_sk)
        txid = cl.send_transactions([stx1, stx2])
        common.wait(cl, txid)
        print(f"BOOTSTRAP tx={txid} (group {stx2.transaction.group})")
        state["bootstrap_txid"] = txid
        common.save_state(state)

    # --- verify on-chain ----------------------------------------------------
    app_info = cl.application_info(app_id)
    gstate = {
        __import__("base64").b64decode(kv["key"]).decode(): kv["value"]
        for kv in app_info["params"]["global-state"]
    }
    print("== on-chain verification ==")
    print("app_id:", app_id)
    print("app_address:", app_addr)
    print("creator:", app_info["params"]["creator"])
    for k, v in gstate.items():
        if v["type"] == 2:
            import base64

            raw = base64.b64decode(v["bytes"])
            try:
                shown = encoding.encode_address(raw) if len(raw) == 32 else raw.hex()
            except Exception:  # noqa: BLE001
                shown = raw.hex()
            print(f"  {k}: bytes {shown}")
        else:
            print(f"  {k}: uint {v['uint']}")
    acct = cl.account_info(app_addr)
    print("app ALGO balance:", acct["amount"])
    print("app assets:", [a["asset-id"] for a in acct.get("assets", [])])


if __name__ == "__main__":
    main()
