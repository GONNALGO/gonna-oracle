#!/usr/bin/env python3
"""Deploy a minimal "opup" budget app (Explicit OpUp pattern).

go-algorand v5 (testnet 2026) prices opcode budget per app call in the
group: pooled budget = 700 * (#app calls), surplus fees no longer buy
budget. ed25519verify_bare costs 1900, so oracle-verifying calls need
extra app calls in the group. This app approves any NoOp call and exists
solely to donate 700 budget per call.
"""
import base64
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
from algosdk import transaction  # noqa: E402

APPROVAL = "#pragma version 11\nint 1"
CLEAR = "#pragma version 11\nint 1"


def main() -> None:
    cl = common.client()
    state = common.load_state()
    if "opup_app_id" in state:
        print("opup app already deployed:", state["opup_app_id"])
        return
    deployer_sk = common.sk("DEPLOYER")
    deployer = common.addr("DEPLOYER")
    approval = base64.b64decode(cl.compile(APPROVAL)["result"])
    clear = base64.b64decode(cl.compile(CLEAR)["result"])
    sp = cl.suggested_params()
    txn = transaction.ApplicationCreateTxn(
        sender=deployer,
        sp=sp,
        on_complete=transaction.OnComplete.NoOpOC,
        approval_program=approval,
        clear_program=clear,
        global_schema=transaction.StateSchema(0, 0),
        local_schema=transaction.StateSchema(0, 0),
    )
    txid = cl.send_transaction(txn.sign(deployer_sk))
    info = common.wait(cl, txid)
    app_id = info["application-index"]
    state["opup_app_id"] = app_id
    state["opup_deploy_txid"] = txid
    common.save_state(state)
    print(f"opup app deployed: {app_id} tx={txid}")


if __name__ == "__main__":
    main()
