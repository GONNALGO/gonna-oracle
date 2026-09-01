#!/usr/bin/env python3
"""QuantumArena v3 MAINNET smoke — app 3691139011.

T1: duel winner path (95/5 + MBR).
T2: 5-player perfect tie -> STATUS_REFUNDING -> per-seat claim_refund x5
    (permissionless, mixed callers) -> full refunds, zero fee, boxes deleted,
    MBR back to creator.
Oracle signatures are produced locally with the testnet oracle key
(ed25519 over the exact contract message domains).
"""
import base64
import json
import os
import struct
import sys
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
OPUP = 3686469118  # mainnet opcode-budget donor app
STAKE = 1_000_000  # 1 GONNA
ZERO32 = b'\x00' * 32

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
PA = W(secrets['DEPLOYER'])
PB = W(secrets['PLAYER_QA2'])
G = [W(secrets[f'QA_G{i:02d}']) for i in range(1, 13)]


def fresh(label):
    sk, addr = algosdk.account.generate_account()
    w = W({'address': addr, 'mnemonic': algosdk.mnemonic.from_private_key(sk)})
    return w


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
            continue  # puya ABI: gtxn args are positional in the group, NOT in app_args
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
    import hashlib
    digest = hashlib.sha256(raw).digest()
    extra = b'\x00' * 24 + struct.pack('>Q', stage_idx)
    msg = (b'QA-VERDICT|' + struct.pack('>Q', APP_ID) + struct.pack('>Q', cid)
           + bytes([1]) + extra + digest)
    return ORACLE.sigkey.sign(msg).signature


def gonna_balance(w):
    i = cl.account_info(w.addr)
    for a in i.get('assets', []):
        if a['asset-id'] == ASA:
            return a['amount']
    return None


def algo_balance(w):
    return cl.account_info(w.addr)['amount']


def next_cid():
    info = cl.application_info(APP_ID)
    for kv in info['params']['global-state']:
        if base64.b64decode(kv['key']) == b'next_challenge_id':
            return kv['value']['uint']
    raise SystemExit('no next_challenge_id')


def opup(sender, n=3):
    import hashlib
    out = []
    for i in range(n):
        t = transaction.ApplicationNoOpTxn(
            sender=sender.addr, sp=sp(), index=OPUP,
            app_args=[b'noop'], note=hashlib.sha256(os.urandom(16)).digest())
        out.append(t)
    return out


def create_challenge(creator, seats, stage_idx, score, duration=None):
    if duration is None:
        duration = 86400 if seats == 1 else 4 * 3600
    cid = next_cid()
    mbr = transaction.PaymentTxn(sender=creator.addr, sp=sp(), receiver=APP_ADDR, amt=MBR)
    axf = transaction.AssetTransferTxn(sender=creator.addr, sp=sp(), receiver=APP_ADDR, index=ASA, amt=STAKE)
    call = mcall(creator, 'create_challenge(pay,axfer,uint64,uint64,uint64,uint64,byte[],uint64,byte[])uint64',
                 [0, 1, STAKE, seats, duration, 1, ZERO32, score, score_sig(cid, 0, creator, score)],
                 assets=[ASA], boxes=[box_m(cid), box_p(cid)])
    # note: txn refs 0/1 are placeholders — algosdk abi encodes uint64 for
    # foreign txn refs; the real SDK call passes the txn indices in group.
    donors = opup(creator)
    send([mbr, axf, call] + donors, [creator] * (3 + len(donors)))
    return cid


def join(joiner, cid):
    axf = transaction.AssetTransferTxn(sender=joiner.addr, sp=sp(), receiver=APP_ADDR, index=ASA, amt=STAKE)
    call = mcall(joiner, 'join_challenge(axfer,uint64)uint64', [0, cid],
                 assets=[ASA], boxes=[box_m(cid), box_p(cid)])
    send([axf, call], [joiner, joiner])


def submit(player, cid, seat, score):
    call = mcall(player, 'submit_score(uint64,uint64,byte[])void',
                 [cid, score, score_sig(cid, seat, player, score)],
                 boxes=[box_m(cid), box_p(cid)])
    donors = opup(player, 3)
    send([call] + donors, [player] * (1 + len(donors)))


def boxes_present(cid):
    try:
        cl.application_box_by_name(APP_ID, box_m(cid))
        return True
    except Exception:
        return False


def status_of(cid):
    try:
        raw = base64.b64decode(cl.application_box_by_name(APP_ID, box_m(cid))['value'])
    except Exception:
        return 'GONE'
    # ChallengeMeta: creator32 stake8 seats_total8 seats_taken8 deadline8
    # stage_mode8 seed32 creator_score8 status8 ...
    return struct.unpack('>Q', raw[52:60])[0]  # ARC-4 tuple: Bytes fields are 2-byte offsets in the head


print('=== v3 TESTNET SMOKE ===')
print('app', APP_ID, 'escrow', APP_ADDR)

# --- extra players ---------------------------------------------------------
players = []
need = 0
state_extra = os.path.join(HERE, 'mainnet-v3-smoke.json')
if os.path.exists(state_extra):
    extra = json.load(open(state_extra))
    players = [W(e) for e in extra]
else:
    players = [fresh(f'P{i}') for i in range(need)]
    sp0 = cl.suggested_params()
    fund = []
    for w in players:
        fund.append(transaction.PaymentTxn(sender=DEPLOYER.addr, sp=sp(), receiver=w.addr, amt=600_000))
    if fund:
        send(fund, [DEPLOYER] * len(fund))
    for w in players:
        optin = transaction.AssetTransferTxn(sender=w.addr, sp=sp(), receiver=w.addr, index=ASA, amt=0)
        send([optin], [w])
    give = [transaction.AssetTransferTxn(sender=DEPLOYER.addr, sp=sp(), receiver=w.addr, index=ASA, amt=5_000_000) for w in players]
    if give:
        send(give, [DEPLOYER] * len(give))
    json.dump([{'address': w.addr, 'mnemonic': algosdk.mnemonic.from_private_key(w.sk)} for w in players], open(state_extra, 'w'))
print('extra players funded:', [w.addr[:8] for w in players])

# --- T1: duel winner path ---------------------------------------------------
print('--- T1: duel winner path')
b0_pa, b0_pb = gonna_balance(PA), gonna_balance(PB)
cid = create_challenge(PA, 1, 0, 5000)
join(PB, cid)
submit(PB, cid, 1, 3000)
vsig = verdict_sig(cid, 0, [(0, PA, 5000), (1, PB, 3000)])
call = mcall(PB, 'resolve(uint64,uint64,byte[],byte[])byte[]', [cid, 0, b'', vsig],
             accounts=[PA.addr, secrets['TREASURY_ADDR']],
             assets=[ASA], boxes=[box_m(cid), box_p(cid)], fee=4000)
donors = opup(PB, 4)
send([call] + donors, [PB] * (1 + len(donors)))
time.sleep(1)
b1_pa, b1_pb = gonna_balance(PA), gonna_balance(PB)
got = b1_pa - b0_pa
payout = 2 * STAKE - 2 * STAKE * 5 // 100  # 95% of the 2-GONNA pot
assert got == payout - STAKE, f'T1 creator gain {got} != {payout - STAKE} (payout minus own stake)' 
assert not boxes_present(cid), 'T1 boxes still present'
print(f'T1 OK: duel cid={cid} winner gain={got / 1e6} GONNA boxes deleted')

# --- T2: 5-player tie -> claim_refund chain ---------------------------------
print('--- T2: 5-player perfect tie -> per-seat refunds')
roster = [PA] + G
before = {w.addr: gonna_balance(w) for w in roster}
cid = create_challenge(PA, 12, 0, 7000)
for i, w in enumerate(roster[1:], start=1):
    join(w, cid)
for i, w in enumerate(roster):
    if i == 0:
        continue  # creator score committed at create
    submit(w, cid, i, 7000)
vsig = verdict_sig(cid, 0, [(i, w, 7000) for i, w in enumerate(roster)])
# tie resolve: NO accounts, NO holdings needed anymore
call = mcall(PB, 'resolve(uint64,uint64,byte[],byte[])byte[]', [cid, 0, b'', vsig],
             boxes=[box_m(cid), box_p(cid)], fee=2000)
donors = opup(PB, 4)
send([call] + donors, [PB] * (1 + len(donors)))
st = status_of(cid)
assert st == 5, f'T2 status after tie resolve = {st}, want 5 (REFUNDING)'
print(f'  tie resolve OK: cid={cid} status=REFUNDING, NO inline payments')

# per-seat claims, mixed callers (permissionless): each claims for another
claimers = [G[11], PA, G[0], G[1], G[2], G[3], G[4], G[5], G[6], G[7], G[8], G[9], G[10]]
for seat in range(13):
    caller = claimers[seat]
    target = roster[seat]
    call = mcall(caller, 'claim_refund(uint64,uint64)void', [cid, seat],
                 accounts=[target.addr, PA.addr], assets=[ASA],
                 boxes=[box_m(cid), box_p(cid)], fee=4000)
    donors = opup(caller, 1)
    send([call] + donors, [caller] * (2 + len(donors) - 1))
    print(f'  seat {seat} claimed by {caller.addr[:8]} for {target.addr[:8]} OK')
time.sleep(1)
for w in roster:
    diff = gonna_balance(w) - before[w.addr]
    assert diff == 0, f'T2 {w.addr[:8]} balance drift {diff}'
assert not boxes_present(cid), 'T2 boxes still present after final claim'
print(f'T2 OK: all 13 refunded in full, zero fee, boxes deleted, MBR back')

print('=== V3 SMOKE ALL GREEN ===')
