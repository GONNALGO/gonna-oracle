#!/usr/bin/env python3
"""Fund testnet accounts via the AlgoKit TestNet Dispenser API.

The legacy anonymous dispenser (dispenser.testnet.aws.algodev.network) was
retired in Feb 2026 and now redirects to Lora's login-gated faucet. The
current API requires a JWT from the Auth0 device flow (same flow as
`algokit dispenser login --ci`).

Usage:
  python3 deploy/fund.py --start-device-flow   # prints activation URL + code
  python3 deploy/fund.py --poll                # poll until a human authorizes
  python3 deploy/fund.py <ADDRESS> [microALGO] # fund address (default 10 ALGO)
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEVICE_FILE = os.path.join(HERE, ".device_flow.json")
TOKEN_FILE = os.path.join(HERE, ".dispenser_token.json")

AUTH0 = "https://dispenser-prod.eu.auth0.com"
CLIENT_ID = "BOZkxGUiiWkaAXZebCQ20MTIYuQSqqpI"  # algokit CI client
AUDIENCE = "api-prod-dispenser-ci"
API = "https://api.dispenser.algorandfoundation.tools"

UA = {"User-Agent": "algokit-cli/python deploy-script", "Content-Type": "application/json"}


def _post(url: str, payload: dict, headers: dict | None = None, timeout: int = 30):
    req = urllib.request.Request(
        url,
        method="POST",
        data=json.dumps(payload).encode(),
        headers={**UA, **(headers or {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:  # noqa: BLE001
            return e.code, {}


def start_device_flow() -> dict:
    status, data = _post(
        f"{AUTH0}/oauth/device/code",
        {"client_id": CLIENT_ID, "scope": "openid profile email offline_access", "audience": AUDIENCE},
    )
    if status != 200:
        raise SystemExit(f"device flow start failed: {status} {data}")
    with open(DEVICE_FILE, "w") as f:
        json.dump(data, f, indent=2)
    print("Human action required:")
    print("  1. open ", data["verification_uri_complete"])
    print("  2. confirm code", data["user_code"], "and log in (GitHub/Google)")
    print(f"  expires in {data['expires_in']}s")
    return data


def poll_token() -> str:
    data = json.load(open(DEVICE_FILE))
    interval = data.get("interval", 5)
    deadline = time.time() + data.get("expires_in", 900)
    while time.time() < deadline:
        status, tok = _post(
            f"{AUTH0}/oauth/token",
            {
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": data["device_code"],
                "client_id": CLIENT_ID,
            },
        )
        if status == 200 and "access_token" in tok:
            with open(TOKEN_FILE, "w") as f:
                json.dump(tok, f, indent=2)
            os.chmod(TOKEN_FILE, 0o600)
            print("authorized — token saved to", TOKEN_FILE)
            return tok["access_token"]
        err = tok.get("error")
        if err == "authorization_pending":
            print("waiting for human authorization...")
        elif err == "slow_down":
            interval += 5
        else:
            print("device flow error:", tok)
        time.sleep(interval)
    raise SystemExit("device code expired — run --start-device-flow again")


def get_token() -> str:
    if os.path.exists(TOKEN_FILE):
        return json.load(open(TOKEN_FILE))["access_token"]
    env = os.environ.get("ALGOKIT_DISPENSER_ACCESS_TOKEN")
    if env:
        return env
    raise SystemExit("no dispenser token: run --poll or set ALGOKIT_DISPENSER_ACCESS_TOKEN")


def fund(address: str, amount: int = 10_000_000) -> dict:
    token = get_token()
    status, data = _post(
        f"{API}/fund/0",
        {"receiver": address, "amount": amount},
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    print(f"fund {address[:12]}... amount={amount}: HTTP {status} {data}")
    if status != 200:
        raise SystemExit(f"funding failed: {status} {data}")
    return data


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] == "--start-device-flow":
        start_device_flow()
    elif args[0] == "--poll":
        poll_token()
    else:
        fund(args[0], int(args[1]) if len(args) > 1 else 10_000_000)
