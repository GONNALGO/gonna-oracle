#!/usr/bin/env python3
"""QuantumArena v3 TESTNET — 13-player DESCENT tables, winner path.

Runs TWO full 13-player tables on the v3 testnet app 770816020
(identical bytecode to mainnet app 3691139011):
  T-A: stage_idx=2 (DESCENT lvl 3)
  T-B: stage_idx=4 (DESCENT lvl 5)
Each: create (13 seats) -> 12 joins -> 12 submits -> oracle verdict ->
resolve -> verify legs (winner 95% / treasury 5% / MBR 0.3582 back /
boxes deleted). Then all QA wallets are drained back.

Roster: PA (creator), PB, the 3 existing smoke wallets, 8 fresh wallets.
"""
import base64
import hashlib
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
APP_ID = 770816020
ASA = 769688287
NODE = 'https://testnet-api.4160.nodely.dev'
MBR = 358_200
OPUP = 769688641
STAKE = 1_000_000  # 1 GONNA per seat
ZERO32 = b'\x00' * 32
STATE = os.path.join(HERE, 'testnet-v3-13p.json')

secrets = json.load(open(os.path.join(HERE, 'testnet.secrets.json')))
TREASURY = json.load(open(os.path.join(HERE, 'testnet.json')))['treasury_addr']
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
PA = W(secrets['PLAYER_A'])
PB = W(secrets['PLAYER_B'])
TRES = W(secrets['TREASURY'])
SMOKE = [W(e) for e in json.load(open(os.path.join(HERE, 'testnet-v3-smoke.json')))]


def sp(fee=1000):
    p = cl.suggested_params()
    p.flat_fee = True
    p.fee = fee
    return p


def send(txns, signers):
    if len(txns) > 1:
        transaction.assign_group_id(txns)
    signed = [t.sign(s.sk) for t, s in zip(txns, signers)]
    return wait(cl.send_transactions(signed))


def wait(txid):
    for _ in range(40):
        info = cl.pending_transaction_info(txid)
        if info.get('confirmed-round'):
            return info
        time.sleep(2)
    raise SystemExit('timeout ' + txid)


def mcall(sender, sig_, args, accounts=None, assets=None, boxes=None, fee=1000):
    m = abi.Method.from_signature(sig_)
    enc = [m.get_selector()]
    for t, v in zip(m.args, args):
        tstr = str(t.type)
        if tstr in {'txn', 'pay', 'keyreg', 'acfg', 'axfer', 'afrz', 'appl'}:
            continue
        enc.append(abi.ABIType.from_string(tstr).encode(v))
    return transaction.ApplicationNoOpTxn(
        sender=sender.addr, sp=sp(fee), index=APP_ID, app_args=enc,
        accounts=accounts or [], foreign_assets=assets or [],
        boxes=[(APP_ID, b) for b in (boxes or [])])


def box_m(cid):
    return b'm' + struct.pack('>Q', cid)


def box_p(cid):
    return b'p' + struct.pack('>Q', cid)


def score_sig(cid, seat, w, score):
    msg = (b'QA-SCORE|' + struct.pack('>Q', APP_ID) + struct.pack('>Q', cid)
           + bytes([seat]) + w.pk + struct.pack('>Q', score))
    return ORACLE.sigkey.sign(msg).signature


def verdict_sig(cid, stage_idx, entries):
    raw = b''.join(bytes([s]) + w.pk + struct.pack('>Q', sc) for s, w, sc in entries)
    digest = hashlib.sha256(raw).digest()
    extra = b'\x00' * 24 + struct.pack('>Q', stage_idx)
    msg = (b'QA-VERDICT|' + struct.pack('>Q', APP_ID) + struct.pack('>Q', cid)
           + bytes([1]) + extra + digest)
    return ORACLE.sigkey.sign(msg).signature


def gonna(w):
    for a in cl.account_info(w.addr).get('assets', []):
        if a['asset-id'] == ASA:
            return a['amount']
    return None


def algo(w):
    return cl.account_info(w.addr)['amount']


def free_algo(w):
    i = cl.account_info(w.addr)
    return i['amount'] - i['min-balance']


def next_cid():
    for kv in cl.application_info(APP_ID)['params']['global-state']:
        if base64.b64decode(kv['key']) == b'next_challenge_id':
            return kv['value']['uint']
    raise SystemExit('no next_challenge_id')


def opup(sender, n=3):
    return [transaction.ApplicationNoOpTxn(
        sender=sender.addr, sp=sp(), index=OPUP,
        app_args=[b'noop'], note=hashlib.sha256(os.urandom(16)).digest())
        for _ in range(n)]


def create_challenge(creator, seats, stage_idx, score):
    cid = next_cid()
    mbr = transaction.PaymentTxn(sender=creator.addr, sp=sp(), receiver=APP_ADDR, amt=MBR)
    axf = transaction.AssetTransferTxn(sender=creator.addr, sp=sp(), receiver=APP_ADDR, index=ASA, amt=STAKE)
    call = mcall(creator, 'create_challenge(pay,axfer,uint64,uint64,uint64,uint64,byte[],uint64,byte[])uint64',
                 [0, 1, STAKE, seats, 4 * 3600, 1, ZERO32, score, score_sig(cid, 0, creator, score)],
                 assets=[ASA], boxes=[box_m(cid), box_p(cid)])
    donors = opup(creator, 3)
    send([mbr, axf, call] + donors, [creator] * (3 + len(donors)))
    return cid


def join(joiner, cid, donors_n=4):
    axf = transaction.AssetTransferTxn(sender=joiner.addr, sp=sp(), receiver=APP_ADDR, index=ASA, amt=STAKE)
    call = mcall(joiner, 'join_challenge(axfer,uint64)uint64', [0, cid],
                 assets=[ASA], boxes=[box_m(cid), box_p(cid)])
    donors = opup(joiner, donors_n)
    send([axf, call] + donors, [joiner] * (2 + len(donors)))


def submit(player, cid, seat, score, donors_n=6):
    call = mcall(player, 'submit_score(uint64,uint64,byte[])void',
                 [cid, score, score_sig(cid, seat, player, score)],
                 boxes=[box_m(cid), box_p(cid)])
    donors = opup(player, donors_n)
    send([call] + donors, [player] * (1 + len(donors)))


def resolve(caller, cid, stage_idx, entries, winner):
    vsig = verdict_sig(cid, stage_idx, entries)
    accts = []
    for a in (winner.addr, PA.addr, TREASURY):
        if a not in accts:
            accts.append(a)
    call = mcall(caller, 'resolve(uint64,uint64,byte[],byte[])byte[]',
                 [cid, stage_idx, b'', vsig],
                 accounts=accts, assets=[ASA],
                 boxes=[box_m(cid), box_p(cid)], fee=4000)
    donors = opup(caller, 6 + (len(entries) + 1) // 2)
    send([call] + donors, [caller] * (1 + len(donors)))


def boxes_present(cid):
    try:
        cl.application_box_by_name(APP_ID, box_m(cid))
        return True
    except Exception:
        return False


print('=== v3 TESTNET: 13-player DESCENT lvl3 + lvl5, winner path ===')
print('app', APP_ID, 'escrow', APP_ADDR)

# --- roster ---------------------------------------------------------------
fresh_state = []
if os.path.exists(STATE):
    fresh_state = [W(e) for e in json.load(open(STATE))]
    print('reusing 8 fresh wallets')
else:
    newb = []
    for i in range(8):
        sk, addr = algosdk.account.generate_account()
        newb.append(W({'address': addr, 'mnemonic': algosdk.mnemonic.from_private_key(sk)}))
    # fund: 0.2 min + optin fee + 2 tables' fees ~ 0.215 each
    funders = [PA, PB, DEPLOYER, TRES]
    fund_amt = 215_000
    pays, signers = [], []
    planned = {f.addr: free_algo(f) for f in funders}
    for i, w in enumerate(newb):
        cands = [f for f in funders if planned[f.addr] > fund_amt + 30_000]
        if not cands:
            raise SystemExit(f'no funder with enough free ALGO for wallet {i}: {planned}')
        f = max(cands, key=lambda x: planned[x.addr])
        planned[f.addr] -= fund_amt + 1000
        pays.append(transaction.PaymentTxn(sender=f.addr, sp=sp(), receiver=w.addr, amt=fund_amt))
        signers.append(f)
    send(pays, signers)
    for w in newb:
        send([transaction.AssetTransferTxn(sender=w.addr, sp=sp(), receiver=w.addr, index=ASA, amt=0)], [w])
    gives = [transaction.AssetTransferTxn(sender=DEPLOYER.addr, sp=sp(), receiver=w.addr, index=ASA, amt=3_000_000)
             for w in newb]
    send(gives, [DEPLOYER] * len(gives))
    json.dump([{'address': w.addr, 'mnemonic': algosdk.mnemonic.from_private_key(w.sk)} for w in newb], open(STATE, 'w'))
    fresh_state = newb
    print('8 fresh wallets funded + GONNA topped up')

roster = [PA, PB] + SMOKE + fresh_state
assert len(roster) == 13
for w in roster:
    g = gonna(w)
    assert g is not None and g >= STAKE, f'{w.addr[:8]} needs >=1 GONNA, has {g}'
print('roster:', [w.addr[:8] for w in roster])

# distinct realistic scores per stage (unique winner = seat 6)
def scores_for(stage):
    base = 4200 if stage == 2 else 6100
    sc = [base + i * 250 for i in range(13)]
    sc[6] = base + 3300  # clear winner
    return sc

for stage_idx, label in [(2, 'DESCENT lvl 3'), (4, 'DESCENT lvl 5')]:
    if os.environ.get('ONLY_STAGE') and stage_idx != int(os.environ['ONLY_STAGE']):
        continue
    print(f'--- {label}: 13 players, stake 1 GONNA each (pot 13 GONNA)')
    sc = scores_for(stage_idx)
    winner = roster[sc.index(max(sc))]
    b_tre0 = cl.account_info(TREASURY)
    tre0 = next((a['amount'] for a in b_tre0.get('assets', []) if a['asset-id'] == ASA), 0)
    w0 = gonna(winner)
    pa0 = algo(PA)
    resume = int(os.environ.get('RESUME_CID', '-1'))
    if stage_idx == int(os.environ.get('RESUME_STAGE', '2')) and resume >= 0:
        cid = resume
        taken = int(os.environ.get('RESUME_TAKEN', '1'))
        print(f'  RESUME cid={cid} (taken={taken})')
    else:
        cid = create_challenge(PA, 12, stage_idx, sc[0])
        taken = 1
        print(f'  cid={cid} created')
    for i, w in enumerate(roster[taken:], start=taken):
        join(w, cid)
    print(f'  joins OK ({13 - taken} new)')
    if os.environ.get('RESUME_SKIP_TO_RESOLVE') == '1' and resume == cid:
        print('  (skip to resolve)')
    else:
        sub_from = int(os.environ.get('RESUME_SUBMIT_FROM', '1')) if resume == cid else 1
        for i, w in enumerate(roster):
            if i < sub_from:
                continue
            submit(w, cid, i, sc[i])
        print('  submits OK')
    entries = [(i, w, sc[i]) for i, w in enumerate(roster)]
    resolve(PB, cid, stage_idx, entries, winner)
    time.sleep(1)
    pot = 13 * STAKE
    rake = pot * 5 // 100
    payout = pot - rake
    tre1 = next((a['amount'] for a in cl.account_info(TREASURY).get('assets', []) if a['asset-id'] == ASA), 0)
    w_gain = gonna(winner) - w0
    pa_gain = algo(PA) - pa0
    assert tre1 - tre0 == rake, f'treasury rake {tre1 - tre0} != {rake}'
    assert not boxes_present(cid), 'boxes still present'
    # winner gain = payout minus own stake (he re-gets stake inside payout)
    exp = payout - STAKE if winner is PA else payout
    # PA paid MBR+creates; if winner==PA his GONNA gain = payout - STAKE
    assert w_gain == exp, f'winner gain {w_gain} != {exp}'
    print(f'  RESOLVED: winner {winner.addr[:8]} +{w_gain / 1e6} GONNA | treasury +{rake / 1e6} | MBR back to PA (algo delta {pa_gain / 1e6}) | boxes deleted')

print('=== 13P LVL3 + LVL5: ALL GREEN ===')
