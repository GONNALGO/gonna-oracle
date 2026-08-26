# tests/test_tie_fix_v21.py — C-FIX (v2.1) regression for the resolve TIE bug.
#
# THE BUG (live: testnet app 769767443, cid 56): resolve's tie branch deleted
# both boxes and THEN iterated `roster` — but Puya 5.10.0 keeps a box-backed
# arc4 array LAZY (per-element box_extract, approval TEAL 3083-3100 after the
# box_del at 3039/3044), so the refund loop read the players box after it was
# deleted and the pool killed the call ("no such box"). A perfect top-score
# tie on a full+signed card bricked the pot.
#
# WHY THE EXISTING 72-TEST SUITE NEVER CAUGHT IT (documented false
# confidence): algorand-python-testing executes PYTHON semantics on an
# in-memory mock — `.copy()` is a real copy, delete-then-read works, so
# test_perfect_tie_full_refund / test_tie_refunds_forfeiters_too passed even
# with the bug. The defect lives in the COMPILED TEAL, not in the Python
# source semantics. The regression gate that would have caught it is the
# STATIC TEAL CHECK below (CFG reachability on the compiled approval
# program): no box read may be reachable from a box_del within a subroutine
# unless the box is re-created first. It FAILS on the pre-fix compile and
# PASSES post-fix (proven via git stash of the fix).
#
# The functional tests here run on the same mock as the rest of the suite:
# they cannot see the codegen bug, but they lock the tie-branch SEMANTICS
# (full refunds, zero fee, both events in order, MBR back, boxes gone) so
# the fix cannot drift, and they cover the 5-seat tie the old suite lacked.

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest
from algopy import UInt64

from tests.conftest import (
    CHALLENGE_MBR,
    STAKE,
    Env,
    inner_axfers,
    inner_payments,
    pk,
)

FEE_BPS = 500
BPS = 10_000

HERE = Path(__file__).resolve().parent
QA_ROOT = HERE.parent
CONTRACT = QA_ROOT / "contracts" / "quantum_arena" / "contract.py"

# ARC4 event selector prefixes emitted by resolve (sha512/256 of the event
# signature, first 4 bytes) — pinned from the deployed event logs:
SEL_RESOLVED = bytes.fromhex("ae488dc6")  # ChallengeResolved(uint64,address,uint64,uint64)
SEL_REFUNDED = bytes.fromhex("0bfda53a")  # ChallengeRefunded(uint64,uint64)


def resolve_logs(env: Env) -> list[bytes]:
    """Raw app-call logs of the last executed group (event emission order)."""
    active = env.ctx.txn.last_group.active_txn
    logs = active.fields.get("logs") or []
    return [bytes(l) for l in logs]


def selectors(logs: list[bytes]) -> list[bytes]:
    return [l[:4] for l in logs if len(l) >= 4]


# ---------------------------------------------------------------------------
# 1. FUNCTIONAL: 5-seat perfect tie (the roster size the old suite lacked)
# ---------------------------------------------------------------------------


def test_resolve_five_seat_perfect_tie_full_refund(env: Env) -> None:
    """5 players, identical top score: every stake refunded, zero fee,
    MBR back to the creator, both boxes deleted."""
    cid = env.create_challenge(seats=4, creator_score=7777)
    players = [env.creator, *env.joiners[:4]]
    for seat, j in enumerate(env.joiners[:4], start=1):
        env.join(j, cid)
        env.submit(j, cid, seat=seat, score=7777)

    winner = env.resolve(cid, [(s, pk(p), 7777) for s, p in enumerate(players)])
    assert winner.value == b""  # zero address -> tie

    assert env.boxes_exist(cid) == (False, False)
    ax = inner_axfers(env.ctx)
    assert len(ax) == 5  # five full refunds, NO treasury fee leg
    refunds = {t.asset_receiver.bytes.value: t.asset_amount for t in ax}
    for p in players:
        assert refunds[pk(p)] == STAKE
    pays = inner_payments(env.ctx)
    assert len(pays) == 1
    assert pays[0].amount == CHALLENGE_MBR
    assert pays[0].receiver.bytes.value == pk(env.creator)

    # events: ChallengeResolved(zero winner, 0, 0) THEN ChallengeRefunded(3)
    sels = selectors(resolve_logs(env))
    assert SEL_RESOLVED in sels and SEL_REFUNDED in sels
    assert sels.index(SEL_RESOLVED) < sels.index(SEL_REFUNDED)


def test_resolve_duel_tie_event_order_and_zero_fee(env: Env) -> None:
    """Duel tie (cid-56 shape): both refunded in full, event order pinned."""
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=5000)

    winner = env.resolve(cid, [(0, pk(env.creator), 5000), (1, pk(j), 5000)])
    assert winner.value == b""

    ax = inner_axfers(env.ctx)
    assert len(ax) == 2
    refunds = {t.asset_receiver.bytes.value: t.asset_amount for t in ax}
    assert refunds[pk(env.creator)] == STAKE
    assert refunds[pk(j)] == STAKE
    sels = selectors(resolve_logs(env))
    assert sels.index(SEL_RESOLVED) < sels.index(SEL_REFUNDED)


# ---------------------------------------------------------------------------
# 2. FUNCTIONAL: non-tie win path MUST be unchanged by the fix
# ---------------------------------------------------------------------------


def test_resolve_non_tie_win_path_unchanged(env: Env) -> None:
    """95/5 legs, MBR refund, box cleanup, single ChallengeResolved event."""
    cid = env.create_challenge(seats=4, creator_score=9000)
    scores = [9000, 4000, 7000, 100, 2500]
    players = [env.creator, *env.joiners[:4]]
    for seat, j in enumerate(env.joiners[:4], start=1):
        env.join(j, cid)
        env.submit(j, cid, seat=seat, score=scores[seat])

    winner = env.resolve(cid, [(s, pk(p), scores[s]) for s, p in enumerate(players)])
    assert winner.value == pk(env.creator)

    assert env.boxes_exist(cid) == (False, False)
    pot = 5 * STAKE
    fee = pot * FEE_BPS // BPS
    ax = inner_axfers(env.ctx)
    assert len(ax) == 2  # winner payout + treasury fee
    assert ax[0].asset_amount == pot - fee
    assert ax[0].asset_receiver.bytes.value == pk(env.creator)
    assert ax[1].asset_amount == fee
    pays = inner_payments(env.ctx)
    assert len(pays) == 1 and pays[0].amount == CHALLENGE_MBR
    # exactly one event, ChallengeResolved with the winner (no refund event)
    sels = selectors(resolve_logs(env))
    assert SEL_RESOLVED in sels and SEL_REFUNDED not in sels


def test_resolve_non_tie_duel_unchanged(env: Env) -> None:
    cid = env.create_challenge(seats=1, creator_score=5000)
    j = env.joiners[0]
    env.join(j, cid)
    env.submit(j, cid, seat=1, score=9000)
    winner = env.resolve(cid, [(0, pk(env.creator), 5000), (1, pk(j), 9000)])
    assert winner.value == pk(j)
    pot = 2 * STAKE
    fee = pot * FEE_BPS // BPS
    ax = inner_axfers(env.ctx)
    assert len(ax) == 2
    assert ax[0].asset_amount == pot - fee
    assert ax[0].asset_receiver.bytes.value == pk(j)


# ---------------------------------------------------------------------------
# 3. STATIC TEAL GATE — the check that would have caught the bug.
#    Compiles the contract with the pinned toolchain (puya 5.10.0, same as
#    the deployed artifact) and proves, on the CONTROL-FLOW GRAPH of every
#    subroutine, that no box read (box_extract/box_get/box_len) is reachable
#    from a box_del unless the box is re-created (box_put/box_create) first.
#    This is exactly the condition the pool enforces at runtime
#    ("no such box"): the pre-fix resolve tie loop violates it.
# ---------------------------------------------------------------------------

BRANCH_OPS = {"b", "bz", "bnz", "return", "retsub", "err"}
BOX_DEL = "box_del"
BOX_CREATE = {"box_put", "box_create"}
BOX_READ = {"box_extract", "box_get", "box_len"}


def _compile_teal(tmp_path: Path) -> str:
    puyapy = shutil.which("puyapy")
    if not puyapy:
        venv_bin = Path.home() / ".venv-contract" / "bin" / "puyapy"
        puyapy = str(venv_bin) if venv_bin.exists() else None
    if not puyapy:
        pytest.skip("puyapy compiler not available")
    out = tmp_path / "artifacts"
    r = subprocess.run(
        [puyapy, str(CONTRACT.relative_to(QA_ROOT)), "--out-dir", str(out)],
        cwd=QA_ROOT,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if r.returncode != 0:
        pytest.fail(f"puya compile failed: {r.stderr[-800:]}")
    return (out / "QuantumArena.approval.teal").read_text()


def _subroutines(teal: str) -> dict[str, list[str]]:
    """name -> stripped lines (top-level label .. retsub inclusive)."""
    subs: dict[str, list[str]] = {}
    name, cur = "<prelude>", []
    for raw in teal.splitlines():
        s = raw.strip()
        m = re.match(r"^([A-Za-z_][\w.]*):$", s)
        if m and "@" not in s:
            if cur:
                subs[name] = cur
            name, cur = m.group(1), []
        else:
            cur.append(s)
            if s == "retsub":
                subs[name] = cur
                name, cur = "<tail>", []
    if cur:
        subs[name] = cur
    return subs


def _box_read_after_delete_violations(lines: list[str]) -> list[str]:
    """CFG reachability inside one subroutine: box reads reachable from a
    box_del without an intervening box_put/box_create on that path."""
    # basic blocks
    labels: dict[str, int] = {}
    blocks: list[list[str]] = []
    cur: list[str] = []
    block_label: list[str | None] = []

    def flush():
        nonlocal cur
        if cur:
            blocks.append(cur)
            cur = []

    cur_label: str | None = None
    for s in lines:
        if not s or s.startswith("//"):
            continue
        m = re.match(r"^([A-Za-z_][\w.@]*):$", s)
        if m:
            flush()
            cur_label = m.group(1)
            labels[cur_label] = len(blocks)
            block_label.append(cur_label) if False else None
            continue
        cur.append(s)
        op = s.split()[0]
        if op in {"b", "bz", "bnz", "callsub", "return", "retsub", "err"} and not s.startswith("callsub"):
            flush()
        elif s.startswith("callsub"):
            flush()
    flush()

    # edges
    def target_of(s: str) -> str | None:
        parts = s.split()
        if parts[0] in {"b", "bz", "bnz"} and len(parts) >= 2:
            return parts[1].split(" ")[0]
        return None

    edges: list[list[int]] = [[] for _ in blocks]
    block_has = []
    for i, blk in enumerate(blocks):
        last = blk[-1]
        op = last.split()[0]
        tgt = target_of(last)
        if op in {"bz", "bnz"}:
            edges[i].append(i + 1)
            if tgt in labels:
                edges[i].append(labels[tgt])
        elif op == "b":
            if tgt in labels:
                edges[i].append(labels[tgt])
        elif op in {"return", "retsub", "err"}:
            pass
        else:
            if i + 1 < len(blocks):
                edges[i].append(i + 1)

    # per-block op summary
    def ops_of(blk: list[str]) -> list[str]:
        return [s.split()[0] for s in blk]

    violations: list[str] = []
    # BFS state: (block, deleted?) — deleted set when passing a box_del,
    # cleared when passing box_put/box_create (box re-created on that path)
    for start in range(len(blocks)):
        seen = set()
        stack = [(start, False)]
        while stack:
            bi, deleted = stack.pop()
            if (bi, deleted) in seen:
                continue
            seen.add((bi, deleted))
            for op in ops_of(blocks[bi]):
                if deleted and op in BOX_READ:
                    violations.append(f"block {bi}: {op} after box_del")
                if op == BOX_DEL:
                    deleted = True
                elif op in BOX_CREATE:
                    deleted = False
            for nb in edges[bi]:
                stack.append((nb, deleted))
    return violations


def test_teal_no_box_read_reachable_after_box_delete(tmp_path: Path) -> None:
    """THE regression gate. Pre-fix: resolve violates (tie loop reads the
    deleted players box). Post-fix: zero violations in every subroutine."""
    teal = _compile_teal(tmp_path)
    subs = _subroutines(teal)
    bad: dict[str, list[str]] = {}
    for name, lines in subs.items():
        v = _box_read_after_delete_violations(lines)
        if v:
            bad[name] = v
    assert not bad, f"box reads reachable after box_del (pool would reject 'no such box'): {bad}"


def test_teal_tie_branch_delegates_to_refund_all(tmp_path: Path) -> None:
    """The fixed tie branch emits ChallengeResolved FIRST (event order
    [ChallengeResolved, ChallengeRefunded] preserved) and then calls the
    by-value _refund_all subroutine (materialized roster)."""
    teal = _compile_teal(tmp_path)
    subs = _subroutines(teal)
    body = "\n".join(subs["resolve"])
    emit_pos = body.find("method \"ChallengeResolved(uint64,address,uint64,uint64)\"")
    call_pos = body.find("callsub _refund_all")
    assert emit_pos != -1, "resolve no longer emits ChallengeResolved"
    assert call_pos != -1, "tie branch does not delegate to _refund_all"
    assert emit_pos < call_pos, "event order changed: ChallengeResolved must precede the refund path"
