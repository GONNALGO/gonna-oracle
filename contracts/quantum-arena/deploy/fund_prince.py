#!/usr/bin/env python3
"""Fund the Prince's testnet wallet: 2 ALGO + 1_000 GONNA (from DEPLOYER).

The GONNA axfer requires the receiver to be opted in to ASA 769688287;
if not, exits with a clear message (Prince must add the asset in Pera).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
from algosdk import error, transaction  # noqa: E402

PRINCE = "GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU"
ALGO_AMOUNT = 2_000_000
GONNA_AMOUNT = 1_000 * 10**6  # 1000 GONNA, 6 decimals


def main() -> None:
    cl = common.client()
    state = common.load_state()
    asa_id = state["gonna_asa_id"]
    dep_sk, dep = common.sk("DEPLOYER"), common.addr("DEPLOYER")

    # 1) 2 ALGO (skip if already funded — idempotent rerun after opt-in)
    try:
        bal = cl.account_info(PRINCE)["amount"]
    except Exception:  # noqa: BLE001
        bal = 0
    if bal >= 1_500_000:
        print(f"ALGO already present ({bal / 1e6:.3f}), skipping pay")
    else:
        sp = cl.suggested_params()
        pay = transaction.PaymentTxn(sender=dep, sp=sp, receiver=PRINCE, amt=ALGO_AMOUNT)
        txid = cl.send_transaction(pay.sign(dep_sk))
        common.wait(cl, txid)
        print(f"ALGO pay tx={txid}")

    # 2) 1_000 GONNA (requires opt-in on receiver)
    sp = cl.suggested_params()
    ax = transaction.AssetTransferTxn(
        sender=dep, sp=sp, receiver=PRINCE, amt=GONNA_AMOUNT, index=asa_id
    )
    try:
        txid2 = cl.send_transaction(ax.sign(dep_sk))
        common.wait(cl, txid2)
        print(f"GONNA axfer tx={txid2}")
    except error.AlgodHTTPError as e:
        print(f"GONNA axfer FAILED: {e}")
        print("RECEIVER_NOT_OPTED_IN — il Prince deve aggiungere l'ASA "
              f"{asa_id} (GONNA TESTNET) in Pera, poi rilancia questo script.")
        sys.exit(2)

    # final balances
    info = cl.account_info(PRINCE)
    gonna = next(
        (a["amount"] for a in info.get("assets", []) if a["asset-id"] == asa_id), 0
    )
    print(f"PRINCE balances: ALGO={info['amount'] / 1e6:.6f} "
          f"GONNA={gonna / 1e6:.6f}")


if __name__ == "__main__":
    main()
