#!/usr/bin/env python3
"""Create the $GONNA TESTNET ASA from DEPLOYER and opt in TREASURY.

  name: GONNA TESTNET, unit: GONNA, decimals: 6
  total: 100_000_000_000 * 10^6 base units
  manager/reserve/freeze/clawback: empty (immutable)

Idempotent: if testnet.json already has gonna_asa_id, it only ensures the
treasury opt-in.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
from algosdk import transaction  # noqa: E402

TOTAL = 100_000_000_000 * 10**6  # 100B GONNA with 6 decimals


def main() -> None:
    cl = common.client()
    state = common.load_state()
    deployer_sk = common.sk("DEPLOYER")
    deployer = common.addr("DEPLOYER")
    treasury_sk = common.sk("TREASURY")
    treasury = common.addr("TREASURY")

    asa_id = state.get("gonna_asa_id")
    if asa_id is None:
        sp = cl.suggested_params()
        txn = transaction.AssetConfigTxn(
            sender=deployer,
            sp=sp,
            total=TOTAL,
            decimals=6,
            default_frozen=False,
            unit_name="GONNA",
            asset_name="GONNA TESTNET",
            manager="",
            reserve="",
            freeze="",
            clawback="",
            strict_empty_address_check=False,  # immutable ASA: all admin addrs empty
        )
        txid = cl.send_transaction(txn.sign(deployer_sk))
        info = common.wait(cl, txid)
        asa_id = info["asset-index"]
        state["gonna_asa_id"] = asa_id
        state["gonna_create_txid"] = txid
        common.save_state(state)
        print(f"ASA created: id={asa_id} tx={txid}")
    else:
        print(f"ASA already created: id={asa_id}")

    # treasury opt-in (skip if already opted in)
    assets = cl.account_info(treasury).get("assets", [])
    if any(a["asset-id"] == asa_id for a in assets):
        print("treasury already opted in")
        return
    sp = cl.suggested_params()
    optin = transaction.AssetOptInTxn(sender=treasury, sp=sp, index=asa_id)
    txid = cl.send_transaction(optin.sign(treasury_sk))
    common.wait(cl, txid)
    print(f"treasury opt-in tx={txid}")
    state["treasury_optin_txid"] = txid
    common.save_state(state)


if __name__ == "__main__":
    main()
