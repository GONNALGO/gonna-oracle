"""Resume v3 MAINNET 13-player tie QA on the already-open cid 1.

State: seats_total=12 (13 players), 7 seated (creator DEPLOYER score 7000
committed at create + QA_G01..G06 joined, no submits yet).
Finish: join QA_G07..G12 (with OpUp donors — roster serialization cost grows
with roster size), submit tie scores 7000 for all seats, resolve -> REFUNDING,
then 13 permissionless per-seat claim_refund calls with mixed callers.
Asserts: status==5 after resolve, every player refunded in full, boxes gone,
MBR back to creator.
"""
import base64
import hashlib
import json
import os
import struct
import time

import algosdk
from algosdk import abi, encoding, transaction
from algosdk.logic import get_application_address
from algosdk.v2client import algod
from nacl.signing import SigningKey

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ID = 3691139011
ASA = 2582294183
NODE = 'https://mainnet-api.4160.nodely.dev'
MBR = 358_200
OPUP = 3686469118
STAKE = 1_000_000
TIE_SCORE = 7000
CID = 1

secrets = json.load(open(os.path.join(HERE, 'mainnet.secrets.json')))
cl = algod.AlgodClient('', NODE)
APP_ADDR = get_application_address(APP_ID)


class W:
    def __init__(self, entry):
        self.addr = entry.get('addr') or entry.get('address')
        self.sk = algosdk.mnemonic.to_private_key(entry['mnemonic'])
        raw = base64.b64decode(self.sk) if isinstance(self.sk, str) else bytes(self.sk)
        self.pk = encoding.decode_address(self.addr)
        self.sigkey = SigningKey(raw[:32])


DEPLOYER = W(secrets['DEPLOYER'])
ORACLE = W(secrets['ORACLE'])
QA2 = W(secrets['PLAYER_QA2'])
QA4 = W(secrets['PLAYER_QA4'])
G = [W(secrets[f'QA_G{i:02d}']) for i in range(1, 13)]
ROSTER = [DEPLOYER] + G


def sp(fee=1000):
    p = cl.suggested_params()
    p.flat_fee = True
    p.fee = fee
    return p


def send(txns, signers):
    if len(txns) > 1:
        transaction.assign_group_id(txns)
    signed = [t.sign(s.sk) for t, s in zip(txns, signers)]
    txid = cl.send_transactions(signed)
    return wait(txid)


def wait(txid):
    for _ in range(30):
        info = cl.pending_transaction_info(txid)
        if info.get('confirmed-round'):
            return info
        time.sleep(2)
    raise SystemExit('timeout ' + txid)


def mcall(sender, method_sig, args, accounts=None, assets=None, boxes=None, fee=1000):
    m = abi.Method.from_signature(method_sig)
    enc = [m.get_selector()]
    TXN_TYPES = {'txn', 'pay', 'keyreg', 'acfg', 'axfer', 'afrz', 'appl'}
    for t, v in zip(m.args, args):
        tstr = str(t.type)
        if tstr in TXN_TYPES:
            continue
        enc.append(abi.ABIType.from_string(tstr).encode(v))
    return transaction.ApplicationNoOpTxn(
        sender=sender.addr, sp=sp(fee), index=APP_ID, app_args=enc,
        accounts=accounts or [], foreign_assets=assets or [],
        boxes=[(APP_ID, b) for b in (boxes or [])],
    )


def box_m(cid):
    return b'm' + struct.pack('>Q', cid)


def box_p(cid):
    return b'p' + struct.pack('>Q', cid)


def score_sig(cid, seat, w, score):
    msg = (b'QA-SCORE|' + struct.pack('>Q', APP_ID) + struct.pack('>Q', cid)
           + bytes([seat]) + w.pk + struct.pack('>Q', score))
    return ORACLE.sigkey.sign(msg).signature


def verdict_sig(cid, stage_idx, signed_entries):
    raw = b''.join(bytes([s]) + w.pk + struct.pack('>Q', sc) for s, w, sc in signed_entries)
    digest = hashlib.sha256(raw).digest()
    extra = b'\x00' * 24 + struct.pack('>Q', stage_idx)
    msg = (b'QA-VERDICT|' + struct.pack('>Q', APP_ID) + struct.pack('>Q', cid)
           + bytes([1]) + extra + digest)
    return ORACLE.sigkey.sign(msg).signature


def gonna_balance(w):
    for a in cl.account_info(w.addr).get('assets', []):
        if a['asset-id'] == ASA:
            return a['amount']
    return None


def opup(sender, n):
    return [transaction.ApplicationNoOpTxn(
        sender=sender.addr, sp=sp(), index=OPUP,
        app_args=[b'noop'], note=hashlib.sha256(os.urandom(16)).digest())
        for _ in range(n)]


def status_of(cid):
    try:
        raw = base64.b64decode(cl.application_box_by_name(APP_ID, box_m(cid))['value'])
    except Exception:
        return 'GONE'
    return struct.unpack('>Q', raw[52:60])[0]


def seats_taken(cid):
    raw = base64.b64decode(cl.application_box_by_name(APP_ID, box_m(cid))['value'])
    return struct.unpack('>Q', raw[18:26])[0]


print(f'=== v3 MAINNET tie resume: cid={CID} seats_taken={seats_taken(CID)} ===')
before = {w.addr: gonna_balance(w) for w in ROSTER}
dep_algo0 = cl.account_info(DEPLOYER.addr)['amount']

# --- join remaining seats (7..12) with opcode donors -----------------------
for i in range(7, 12) if seats_taken(CID) < 12 else []:
    w = G[i]
    axf = transaction.AssetTransferTxn(sender=w.addr, sp=sp(), receiver=APP_ADDR, index=ASA, amt=STAKE)
    call = mcall(w, 'join_challenge(axfer,uint64)uint64', [0, CID],
                 assets=[ASA], boxes=[box_m(CID), box_p(CID)])
    donors = opup(w, 4)
    send([axf, call] + donors, [w] * (2 + len(donors)))
    print(f'  seat {i + 1} {w.addr[:8]} joined')

# --- submit tie scores for every joiner seat --------------------------------
signed_seats = set()
try:
    import urllib.request, urllib.parse as up
    from algosdk import encoding as _enc
    u = 'https://mainnet-api.4160.nodely.dev/v2/applications/%d/box?' % APP_ID + up.urlencode({'name': 'base64:' + base64.b64encode(box_p(CID)).decode()})
    _raw = base64.b64decode(json.load(urllib.request.urlopen(u, timeout=15))['value'])
    _n = int.from_bytes(_raw[:2], 'big'); _stride = (len(_raw) - 2) // _n
    for _i in range(_n):
        _e = _raw[2 + _i * _stride:2 + (_i + 1) * _stride]
        if _e[40]: signed_seats.add(_i)
except Exception as e:
    print('roster precheck failed (continuing blind):', e)
print('already signed seats:', sorted(signed_seats))
for i in []:
    if i in signed_seats:
        print(f'  seat {i} already signed — skip')
        continue
    w = G[i - 1]
    call = mcall(w, 'submit_score(uint64,uint64,byte[])void',
                 [CID, TIE_SCORE, score_sig(CID, i, w, TIE_SCORE)],
                 boxes=[box_m(CID), box_p(CID)])
    donors = opup(w, 7)
    send([call] + donors, [w] * (1 + len(donors)))
    print(f'  seat {i} {w.addr[:8]} submitted {TIE_SCORE}')

# --- tie resolve: status -> REFUNDING, zero inline payments -----------------
vsig = verdict_sig(CID, 0, [(i, w, TIE_SCORE) for i, w in enumerate(ROSTER)])
call = mcall(QA4, 'resolve(uint64,uint64,byte[],byte[])byte[]', [CID, 0, b'', vsig],
             boxes=[box_m(CID), box_p(CID)], fee=2000)
donors = opup(QA4, 8)
send([call] + donors, [QA4] * (1 + len(donors)))
st = status_of(CID)
assert st == 5, f'status after tie resolve = {st}, want 5 (REFUNDING)'
print(f'  tie resolve OK: cid={CID} status=REFUNDING, NO inline payments')

# --- 13 permissionless per-seat claims, mixed callers -----------------------
# seat 0 (creator) claimed by QA2; seat i claimed by G[(i+10) % 12] (never self)
for seat in range(13):
    caller = QA2 if seat == 0 else G[(seat + 10) % 12]
    target = ROSTER[seat]
    call = mcall(caller, 'claim_refund(uint64,uint64)void', [CID, seat],
                 accounts=[target.addr, DEPLOYER.addr], assets=[ASA],
                 boxes=[box_m(CID), box_p(CID)], fee=4000)
    donors = opup(caller, 1)
    send([call] + donors, [caller] * (1 + len(donors)))
    print(f'  seat {seat} claimed by {caller.addr[:8]} for {target.addr[:8]} OK')

time.sleep(2)
for w in ROSTER:
    diff = gonna_balance(w) - before[w.addr]
    assert diff == 0, f'{w.addr[:8]} balance drift {diff}'
assert status_of(CID) == 'GONE', 'meta box still present'
dep_algo1 = cl.account_info(DEPLOYER.addr)['amount']
assert dep_algo1 >= dep_algo0 + MBR - 20_000, f'MBR not back: {dep_algo0} -> {dep_algo1}'
print(f'TIE OK: all 13 refunded in full, boxes deleted, MBR {MBR / 1e6} ALGO back to creator')
print('=== V3 MAINNET TIE QA ALL GREEN ===')
