#!/usr/bin/env python3
"""Shared helpers for testnet deploy scripts."""
import json
import os

from algosdk import mnemonic
from algosdk.v2client import algod

HERE = os.path.dirname(os.path.abspath(__file__))
SECRETS = os.path.join(HERE, "testnet.secrets.json")
STATE = os.path.join(HERE, "testnet.json")

ALGOD_URL = "https://testnet-api.algonode.cloud"
ALGOD_TOKEN = ""


def client() -> algod.AlgodClient:
    return algod.AlgodClient(ALGOD_TOKEN, ALGOD_URL)


def load_secrets() -> dict:
    return json.load(open(SECRETS))


def sk(role_or_entry) -> str:
    """Return the private key for a role name or a secrets entry dict."""
    entry = load_secrets()[role_or_entry] if isinstance(role_or_entry, str) else role_or_entry
    return mnemonic.to_private_key(entry["mnemonic"])


def addr(role_or_entry) -> str:
    entry = load_secrets()[role_or_entry] if isinstance(role_or_entry, str) else role_or_entry
    return entry["address"]


def load_state() -> dict:
    if os.path.exists(STATE):
        return json.load(open(STATE))
    return {}


def save_state(state: dict) -> None:
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, STATE)


def wait(cl: algod.AlgodClient, txid: str, rounds: int = 12) -> dict:
    """Wait for confirmation, returning the pending txn info."""
    sp = cl.suggested_params()
    last = sp.first
    for _ in range(rounds):
        info = cl.pending_transaction_info(txid)
        if info.get("confirmed-round"):
            return info
        last += 1
        cl.status_after_block(last)
    raise TimeoutError(f"txn {txid} not confirmed after {rounds} rounds")


def balance(cl: algod.AlgodClient, address: str) -> int:
    return cl.account_info(address)["amount"]
