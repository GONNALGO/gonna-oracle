#!/usr/bin/env python3
"""QuantumArena v2.1 — MAINNET deploy (M-2). RUN ONLY AFTER FUNDING + GO.

Same approval/clear bytecode as the dogfooded testnet v2.1 (pinned sha256,
verified at build time — a drifted artifact aborts before anything is sent):

  approval 1a632904825f2df0cdb773217a324c0f90d0f6908a7d18685868042ad3eb4a77
  clear    ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7

Parameters (M-1 frozen):
  network   mainnet (algonode public endpoints, env-overridable)
  ASA GONNA 2582294183 (decimals 6, freeze/clawback sealed to zero-address)
  treasury  GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU
            (Principe wallet — address only, we NEVER hold its key)
  oracle    ORACLE mainnet keypair from deploy/mainnet.secrets.json
  deployer  DEPLOYER mainnet keypair from deploy/mainnet.secrets.json

What it does (idempotent, safe to re-run):
  1. verify artifact bytecode hashes (abort on drift)
  2. verify treasury sanity: opt-in to the GONNA ASA (the app's treasury
     liveness gate requires it) — read-only check
  3. application create (extra_pages=2) + ARC-4 create(treasury, oracle, gonna)
  4. bootstrap group [pay 1 ALGO to escrow, bootstrap() call] — the app opts
     ITSELF into the GONNA ASA inside bootstrap (this IS the app ASA opt-in)
  5. post-checks: global state (treasury/oracle/asa/bootstrapped) + escrow
     opted into the ASA; writes deploy/mainnet.json

DRY-RUN (--dry-run or DRY_RUN=1): builds every transaction and prints a full
summary WITHOUT sending anything — works with UNFUNDED accounts (suggested
params are still fetched from the network; no balance is required to build).

Secrets: deploy/mainnet.secrets.json (0600, gitignored) — NEVER printed.
Usage:
  python3 deploy_mainnet.py --dry-run   # build + print, send nothing
  python3 deploy_mainnet.py             # full mainnet deploy (after GO)
"""
import base64
import hashlib
import json
import os
import sys

from algosdk import abi, encoding, mnemonic, transaction
from algosdk.logic import get_application_address
from algosdk.v2client import algod

HERE = os.path.dirname(os.path.abspath(__file__))
SECRETS = os.path.join(HERE, "mainnet.secrets.json")
STATE = os.path.join(HERE, "mainnet.json")
ARTIFACTS = os.path.join(HERE, "..", "contracts", "quantum_arena", "artifacts")

ALGOD_URL = os.environ.get("ALGOD_URL", "https://mainnet-api.algonode.cloud")
ALGOD_TOKEN = os.environ.get("ALGOD_TOKEN", "")

GONNA_ASA_ID = 2582294183
TREASURY_ADDR = os.environ.get(
    "TREASURY_ADDR", "GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU"
)
BOOTSTRAP_FUNDING = 1_000_000  # 1 ALGO (contract min 0.2; keeps MBR headroom)

EXPECT_APPROVAL_SHA256 = os.environ.get(
    "EXPECT_APPROVAL_SHA256",
    "1a632904825f2df0cdb773217a324c0f90d0f6908a7d18685868042ad3eb4a77",
)
EXPECT_CLEAR_SHA256 = os.environ.get(
    "EXPECT_CLEAR_SHA256",
    "ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7",
)


def client() -> algod.AlgodClient:
    return algod.AlgodClient(ALGOD_TOKEN, ALGOD_URL)


def secrets() -> dict:
    return json.load(open(SECRETS))


def sk(role: str) -> str:
    return mnemonic.to_private_key(secrets()[role]["mnemonic"])


def addr(role: str) -> str:
    return secrets()[role]["addr"]


def load_state() -> dict:
    return json.load(open(STATE)) if os.path.exists(STATE) else {}


def save_state(state: dict) -> None:
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, STATE)


def wait(cl: algod.AlgodClient, txid: str, rounds: int = 16) -> dict:
    sp = cl.suggested_params()
    last = sp.first
    for _ in range(rounds):
        info = cl.pending_transaction_info(txid)
        if info.get("confirmed-round"):
            return info
        last += 1
        cl.status_after_block(last)
    raise TimeoutError(f"txn {txid} not confirmed after {rounds} rounds")


def compile_teal(cl: algod.AlgodClient, name: str) -> bytes:
    with open(os.path.join(ARTIFACTS, name)) as f:
        teal = f.read()
    res = cl.compile(teal)
    return base64.b64decode(res["result"])


def treasury_holds_gonna(cl: algod.AlgodClient) -> bool:
    info = cl.account_info(TREASURY_ADDR)
    return any(a.get("asset-id") == GONNA_ASA_ID for a in info.get("assets", []))


def main() -> None:
    dry = "--dry-run" in sys.argv or os.environ.get("DRY_RUN") == "1"
    cl = client()
    state = load_state()
    print("=== QuantumArena v2.1 MAINNET deploy (M-2) ===")
    print(f"algod      : {ALGOD_URL}")
    print(f"ASA GONNA  : {GONNA_ASA_ID}")
    print(f"treasury   : {TREASURY_ADDR}")
    print(f"deployer   : {addr('DEPLOYER')}")
    print(f"oracle     : {addr('ORACLE')}")

    # 1) artifact pin
    approval = compile_teal(cl, "QuantumArena.approval.teal")
    clear = compile_teal(cl, "QuantumArena.clear.teal")
    ah = hashlib.sha256(approval).hexdigest()
    ch = hashlib.sha256(clear).hexdigest()
    print(f"approval   : {len(approval)} bytes sha256={ah}")
    print(f"clear      : {len(clear)} bytes sha256={ch}")
    if ah != EXPECT_APPROVAL_SHA256 or ch != EXPECT_CLEAR_SHA256:
        raise SystemExit("ABORT: artifact bytecode drifted from the pinned v2.1 hashes")

    # 2) treasury sanity (read-only)
    if not treasury_holds_gonna(cl):
        raise SystemExit("ABORT: treasury is not opted into the GONNA ASA (liveness gate would fail)")
    print("treasury holds GONNA ASA: ok")

    # 3) create
    if "app_id" in state:
        app_id = state["app_id"]
        print(f"app already deployed: {app_id} (idempotent skip)")
    else:
        sp = cl.suggested_params()
        sp.flat_fee = True
        sp.fee = 2_000
        m = abi.Method.from_signature("create(byte[],byte[],uint64)void")
        app_args = [
            m.get_selector(),
            abi.ABIType.from_string("byte[]").encode(encoding.decode_address(TREASURY_ADDR)),
            abi.ABIType.from_string("byte[]").encode(encoding.decode_address(addr("ORACLE"))),
            abi.ABIType.from_string("uint64").encode(GONNA_ASA_ID),
        ]
        create_txn = transaction.ApplicationCreateTxn(
            sender=addr("DEPLOYER"),
            sp=sp,
            on_complete=transaction.OnComplete.NoOpOC,
            approval_program=approval,
            clear_program=clear,
            global_schema=transaction.StateSchema(4, 2),
            local_schema=transaction.StateSchema(0, 0),
            app_args=app_args,
            extra_pages=2,
        )
        print(f"create txn : {create_txn.get_txid()}")
        if dry:
            print("DRY RUN — create NOT sent.")
            return
        txid = cl.send_transaction(create_txn.sign(sk("DEPLOYER")))
        info = wait(cl, txid)
        app_id = info["application-index"]
        state["app_id"] = app_id
        state["deploy_txid"] = txid
        state["app_address"] = str(get_application_address(app_id))
        save_state(state)
        print(f"DEPLOYED app_id={app_id} tx={txid}")

    app_addr = get_application_address(app_id)

    # 4) bootstrap = the app's own GONNA ASA opt-in (inner axfer asset 0 to self)
    app_info = cl.application_info(app_id)
    gstate = {
        base64.b64decode(kv["key"]).decode(): kv["value"]
        for kv in app_info["params"]["global-state"]
    }
    if gstate.get("bootstrapped", {}).get("uint", 0):
        print("already bootstrapped (ASA opt-in done)")
    else:
        sp = cl.suggested_params()
        pay = transaction.PaymentTxn(sender=addr("DEPLOYER"), sp=sp, receiver=app_addr, amt=BOOTSTRAP_FUNDING)
        sp2 = cl.suggested_params()
        sp2.flat_fee = True
        sp2.fee = 3_000
        m = abi.Method.from_signature("bootstrap(pay)void")
        call = transaction.ApplicationNoOpTxn(
            sender=addr("DEPLOYER"),
            sp=sp2,
            index=app_id,
            app_args=[m.get_selector()],
            accounts=[TREASURY_ADDR],
            foreign_assets=[GONNA_ASA_ID],
        )
        transaction.assign_group_id([pay, call])
        print(f"bootstrap  : pay {BOOTSTRAP_FUNDING} microA -> escrow + bootstrap() (app opts into ASA {GONNA_ASA_ID})")
        if dry:
            print("DRY RUN — bootstrap NOT sent.")
            return
        txid = cl.send_transactions([pay.sign(sk("DEPLOYER")), call.sign(sk("DEPLOYER"))])
        wait(cl, txid)
        state["bootstrap_txid"] = txid
        save_state(state)
        print(f"BOOTSTRAPPED tx={txid}")

    # 5) post-checks
    app_info = cl.application_info(app_id)
    gstate = {
        base64.b64decode(kv["key"]).decode(): kv["value"]
        for kv in app_info["params"]["global-state"]
    }
    gs_treasury = encoding.encode_address(base64.b64decode(gstate["treasury"]["bytes"]))
    gs_oracle = encoding.encode_address(base64.b64decode(gstate["oracle_pub_key"]["bytes"]))
    gs_asa = gstate["gonna_asset_id"]["uint"]
    escrow_assets = cl.account_info(app_addr).get("assets", [])
    escrow_opted = any(a.get("asset-id") == GONNA_ASA_ID for a in escrow_assets)
    print(f"post-check : treasury={'OK' if gs_treasury == TREASURY_ADDR else 'MISMATCH'} "
          f"oracle={'OK' if gs_oracle == addr('ORACLE') else 'MISMATCH'} "
          f"asa={'OK' if gs_asa == GONNA_ASA_ID else 'MISMATCH'} "
          f"escrow_opted_gonna={'OK' if escrow_opted else 'MISSING'}")
    if not (gs_treasury == TREASURY_ADDR and gs_oracle == addr("ORACLE") and gs_asa == GONNA_ASA_ID and escrow_opted):
        raise SystemExit("ABORT: post-deploy state mismatch — investigate before announcing")
    print(f"\nMAINNET app_id: {app_id}")
    print(f"MAINNET escrow: {app_addr}")
    print("NEXT: oracle env (NETWORK=mainnet, ARENA_APP_ID, GONNA_ASA_ID, TREASURY_ADDR, ALLOW_LEGACY_GIL=0), replay bundles, smoke.")


if __name__ == "__main__":
    main()
