#!/usr/bin/env python3
"""Generate testnet accounts (DEPLOYER, TREASURY, ORACLE) and store secrets.

Writes deploy/testnet.secrets.json (gitignored). Idempotent: does not
overwrite an existing secrets file unless --force is passed.
"""
import json
import os
import sys

from algosdk import account, mnemonic

HERE = os.path.dirname(os.path.abspath(__file__))
SECRETS = os.path.join(HERE, "testnet.secrets.json")

ROLES = ["DEPLOYER", "TREASURY", "ORACLE"]


def main() -> None:
    force = "--force" in sys.argv
    if os.path.exists(SECRETS) and not force:
        data = json.load(open(SECRETS))
        print("secrets already exist:")
        for role in ROLES:
            print(f"  {role}: {data[role]['address']}")
        return

    data = {}
    for role in ROLES:
        sk, addr = account.generate_account()
        data[role] = {
            "address": addr,
            "mnemonic": mnemonic.from_private_key(sk),
        }

    tmp = SECRETS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, SECRETS)
    os.chmod(SECRETS, 0o600)
    print("wrote", SECRETS)
    for role in ROLES:
        print(f"  {role}: {data[role]['address']}")


if __name__ == "__main__":
    main()
