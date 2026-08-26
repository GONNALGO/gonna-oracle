#!/usr/bin/env python3
"""QuantumArena v2.1 (C-FIX tie) — TESTNET deploy wrapper. RUN ONLY AFTER GO.

What it does (idempotent, safe to re-run):
  1. backs up deploy/testnet.json -> testnet.json.bak-v2 (once)
  2. removes the v2 app keys (app_id/app_address/bootstrap_txid) from a COPY
     of the state, so the stock deploy_contract.py performs a FRESH create
  3. runs the stock deploy flow: application create from the COMMITTED
     artifacts (contracts/quantum_arena/artifacts/, puya 5.10.0 output),
     ARC-4 create(treasury, oracle_pub_key, gonna), bootstrap funding
  4. prints the new app id + escrow address and leaves them in testnet.json

Keys: SAME DEPLOYER/TREASURY/ORACLE from deploy/testnet.secrets.json
(gitignored — NEVER printed; this script only reads them via common.sk).

NOT run by the C-FIX mission. Post-deploy client flips are owned by the
lead (see DEPLOY-v2.1.md §flip-list).

Usage:
  python3 deploy/deploy_v21.py            # full deploy (after GO)
  python3 deploy/deploy_v21.py --dry-run  # print what WOULD happen
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

STATE = common.STATE
BACKUP = STATE + ".bak-v2"
APP_KEYS = ("app_id", "app_address", "bootstrap_txid", "deploy_txid", "smoke_v2")


def main() -> None:
    dry = "--dry-run" in sys.argv
    state = common.load_state()
    new_state = {k: v for k, v in state.items() if k not in APP_KEYS}
    print("=== QuantumArena v2.1 deploy (C-FIX tie) ===")
    print(f"state file : {STATE}")
    print(f"backup     : {BACKUP} {'(exists)' if os.path.exists(BACKUP) else '(will be created)'}")
    print(f"removing   : {[k for k in APP_KEYS if k in state]}")
    print(f"keeping    : gonna_asa_id={new_state.get('gonna_asa_id')} opup_app_id={new_state.get('opup_app_id')}")
    # addresses come from testnet.json (secrets only needed at real deploy time)
    print(f"deployer   : {state.get('deployer_addr')}")
    print(f"treasury   : {state.get('treasury_addr')}")
    print(f"oracle     : {state.get('oracle_addr')}")
    if dry:
        print("DRY RUN — nothing written, nothing sent.")
        return
    if "app_id" not in state and os.path.exists(BACKUP):
        print("looks already deployed (no v2 keys in state); run deploy_contract.py to verify")
    if not os.path.exists(BACKUP):
        shutil.copyfile(STATE, BACKUP)
        print("backup written")
    common.save_state(new_state)
    # stock flow: creates + bootstraps from committed artifacts, writes app_id
    r = subprocess.run([sys.executable, os.path.join(HERE, "deploy_contract.py")], check=False)
    if r.returncode != 0:
        print("deploy_contract.py FAILED — restoring backup")
        shutil.copyfile(BACKUP, STATE)
        raise SystemExit(1)
    final = common.load_state()
    print(f"\nNEW v2.1 app_id: {final.get('app_id')}")
    print(f"NEW v2.1 escrow: {final.get('app_address')}")
    print("NEXT (lead): apply DEPLOY-v2.1.md flip-list (testnetKit ARENA_APP_ID, oracle env, bundles, tests)")


if __name__ == "__main__":
    main()
