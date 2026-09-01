#!/usr/bin/env python3
"""QuantumArena v3 (per-seat refund claims) — deploy wrapper.

Usage:
  python3 deploy/deploy_v3.py --network testnet [--dry-run]
  python3 deploy/deploy_v3.py --network mainnet [--dry-run]

What it does (idempotent):
  1. loads deploy/<network>.secrets.json (never printed) and deploy/<network>.json
     for gonna_asa_id / treasury_addr / oracle_addr / deployer_addr
  2. creates the app from contracts/quantum_arena_v3/artifacts (QuantumArenaV3),
     ARC-4 create(treasury, oracle_pub_key, gonna) on-creation
  3. bootstrap(pay 1 ALGO): app self-opts into $GONNA
  4. writes deploy/<network>-v3.json with app_id / app_address / txids

v2.1 apps are NOT touched: legacy open cards keep resolving on the old app.
"""
import argparse
import base64
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from algosdk import abi, encoding, transaction  # noqa: E402
from algosdk.v2client import algod  # noqa: E402
from algosdk.logic import get_application_address  # noqa: E402

ARTIFACTS = os.path.join(HERE, "..", "contracts", "quantum_arena_v3", "artifacts")
BOOTSTRAP_FUNDING = 1_000_000

NODES = {
    "testnet": "https://testnet-api.4160.nodely.dev",
    "mainnet": "https://mainnet-api.4160.nodely.dev",
}


def load_json(path):
    with open(path) as f:
        return json.load(f)


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def wait(cl, txid, rounds=10):
    import time

    for _ in range(rounds * 3):
        try:
            info = cl.pending_transaction_info(txid)
            if info.get("confirmed-round"):
                return info
        except Exception:
            pass
        time.sleep(2)
    raise SystemExit(f"timeout waiting for {txid}")


def compile_teal(cl, name):
    with open(os.path.join(ARTIFACTS, name)) as f:
        teal = f.read()
    res = cl.compile(teal)
    return base64.b64decode(res["result"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--network", required=True, choices=["testnet", "mainnet"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    net = args.network

    secrets = load_json(os.path.join(HERE, f"{net}.secrets.json"))
    base = load_json(os.path.join(HERE, f"{net}.json"))
    state_path = os.path.join(HERE, f"{net}-v3.json")
    state = load_json(state_path) if os.path.exists(state_path) else {}

    asa_id = base.get("gonna_asa_id")
    if asa_id is None:
        raise SystemExit(f"gonna_asa_id missing in {net}.json")

    dep_entry = secrets["DEPLOYER"]
    import algosdk

    deployer_acc = algosdk.mnemonic.to_private_key(dep_entry["mnemonic"])
    deployer = dep_entry.get("addr") or dep_entry.get("address")
    treasury_addr = base.get("treasury_addr") or secrets.get("TREASURY", {}).get("addr")
    oracle_addr = base.get("oracle_addr") or secrets.get("ORACLE", {}).get("addr")
    if not treasury_addr or not oracle_addr:
        raise SystemExit("treasury/oracle addr missing")

    cl = algod.AlgodClient("", NODES[net])
    print(f"=== QuantumArena v3 deploy on {net} ===")
    print(f"deployer   : {deployer}")
    print(f"treasury   : {treasury_addr}")
    print(f"oracle     : {oracle_addr}")
    print(f"gonna asa  : {asa_id}")
    if args.dry_run:
        print("DRY RUN — nothing written, nothing sent.")
        return

    if "app_id" in state:
        app_id = state["app_id"]
        print(f"app already deployed: {app_id}")
    else:
        approval = compile_teal(cl, "QuantumArenaV3.approval.teal")
        clear = compile_teal(cl, "QuantumArenaV3.clear.teal")
        print(f"approval bytes: {len(approval)}, clear bytes: {len(clear)}")

        sp = cl.suggested_params()
        sp.flat_fee = True
        sp.fee = 2_000

        method = abi.Method.from_signature("create(byte[],byte[],uint64)void")
        app_args = [method.get_selector()]
        app_args.append(abi.ABIType.from_string("byte[]").encode(encoding.decode_address(treasury_addr)))
        app_args.append(abi.ABIType.from_string("byte[]").encode(encoding.decode_address(oracle_addr)))
        app_args.append(abi.ABIType.from_string("uint64").encode(asa_id))

        txn = transaction.ApplicationCreateTxn(
            sender=deployer,
            sp=sp,
            on_complete=transaction.OnComplete.NoOpOC,
            approval_program=approval,
            clear_program=clear,
            global_schema=transaction.StateSchema(4, 2),
            local_schema=transaction.StateSchema(0, 0),
            app_args=app_args,
            extra_pages=2,
        )
        txid = cl.send_transaction(txn.sign(deployer_acc))
        info = wait(cl, txid)
        app_id = info["application-index"]
        state.update(
            network=net,
            app_id=app_id,
            deploy_txid=txid,
            app_address=get_application_address(app_id),
            gonna_asa_id=asa_id,
            treasury_addr=treasury_addr,
            oracle_addr=oracle_addr,
            deployer_addr=deployer,
            contract="QuantumArenaV3",
        )
        save_json(state_path, state)
        print(f"DEPLOYED app_id={app_id} tx={txid}")

    app_addr = get_application_address(app_id)
    app_info = cl.application_info(app_id)
    gstate = {
        base64.b64decode(kv["key"]).decode(): kv["value"]
        for kv in app_info["params"]["global-state"]
    }
    if gstate.get("bootstrapped", {}).get("uint", 0):
        print("already bootstrapped")
    else:
        sp = cl.suggested_params()
        pay = transaction.PaymentTxn(sender=deployer, sp=sp, receiver=app_addr, amt=BOOTSTRAP_FUNDING)
        sp2 = cl.suggested_params()
        sp2.flat_fee = True
        sp2.fee = 3_000
        m = abi.Method.from_signature("bootstrap(pay)void")
        call = transaction.ApplicationNoOpTxn(
            sender=deployer,
            sp=sp2,
            index=app_id,
            app_args=[m.get_selector()],
            accounts=[treasury_addr],
            foreign_assets=[asa_id],
        )
        transaction.assign_group_id([pay, call])
        txid = cl.send_transactions([pay.sign(deployer_acc), call.sign(deployer_acc)])
        wait(cl, txid)
        print(f"BOOTSTRAP tx={txid}")
        state["bootstrap_txid"] = txid
        save_json(state_path, state)

    print(f"app escrow: {app_addr}")
    print(f"state written: {state_path}")


if __name__ == "__main__":
    main()
