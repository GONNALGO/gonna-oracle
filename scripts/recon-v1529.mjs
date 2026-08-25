// GONNAFIGHT v15.2.9 — PHASE 1 RECON (READ-ONLY, no signing, no sends).
// Reproduces the EXACT MY LEGACY numbers for wallet UUFN4L…ICNM from live
// testnet chain data (app 769767443), rebuilding the SAME merged history the
// frontend builds (fetchArenaCloseEvents + card-memory semantics of
// chainAdapter.listHistory) and running the CURRENT legacyStats math over it.
//
// Reconstruction (the v2 contract DELETES both boxes on settle, so the roster
// and stake of a settled card live only in the indexer history):
//   - every appl txn on the app, ascending: create_challenge / spawn_rumble
//     calls map SEQUENTIALLY to cids (kit.fetchArenaCreateStages fact);
//     join_challenge names its cid in app-args[1].
//   - $GONNA axfers INTO the app address, matched by group id -> per-cid stake.
//   - roster per cid: creator (seat 0) + joiners in round order.
// Run: node scripts/recon-v1529.mjs   (from /mnt/agents/output/app)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT_OUT = path.join(ROOT, '.tmp-kit-recon.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/testnetKit.ts', '--bundle', '--format=esm', '--platform=node',
  `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  `--outfile=${KIT_OUT}`], { cwd: ROOT, stdio: 'pipe' });
const kit = await import(KIT_OUT);
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));

const IDX = kit.INDEXER_TESTNET;
const APP = kit.ARENA_APP_ID;
const APP_ADDR = algosdk.getApplicationAddress(APP).toString();
const GONNA = kit.GONNA_ASA_TESTNET;
const PREFIX = 'UUFN4L';
const SUFFIX = 'ICNM';

function methodSelHex(signature) {
  // parse 'name(arg1,arg2,...)ret' and let algosdk hash the canonical signature
  const open = signature.indexOf('(');
  const close = signature.lastIndexOf(')');
  const m = new algosdk.ABIMethod({
    name: signature.slice(0, open),
    args: signature
      .slice(open + 1, close)
      .split(',')
      .filter((s) => s.length > 0)
      .map((t) => ({ type: t })),
    returns: { type: signature.slice(close + 1) },
  });
  return Buffer.from(m.getSelector()).toString('hex');
}
const SEL_CREATE = methodSelHex('create_challenge(pay,axfer,uint64,uint64,uint64,uint64,byte[],uint64,byte[])uint64');
const SEL_RUMBLE = methodSelHex('spawn_rumble(pay,axfer,pay,uint64,uint64,uint64,byte[])uint64');
const SEL_JOIN = methodSelHex('join_challenge(axfer,uint64)uint64');

const hex4 = (b64) => Buffer.from(b64, 'base64').subarray(0, 4).toString('hex');
const u64At = (buf, off) => Number(buf.readBigUInt64BE(off));

async function* allTxns(query) {
  let next = null;
  for (let page = 0; page < 60; page++) {
    const url = IDX + '/v2/transactions?' + query + (next ? '&next=' + encodeURIComponent(next) : '');
    const r = await fetch(url);
    if (!r.ok) throw new Error('indexer http ' + r.status + ' for ' + query);
    const j = await r.json();
    for (const t of j.transactions ?? []) yield t;
    next = j['next-token'] ?? null;
    if (!next) return;
  }
}

// ---- 1) every appl txn on the app (ascending) -------------------------------
const appl = [];
for await (const t of allTxns('application-id=' + APP + '&tx-type=appl&limit=100')) appl.push(t);
appl.sort((x, y) => x['confirmed-round'] - y['confirmed-round'] || (x['intra-round-offset'] ?? 0) - (y['intra-round-offset'] ?? 0));
console.log('appl txns on app ' + APP + ': ' + appl.length);

// ---- 2) $GONNA axfers into the app address, keyed by group ------------------
const stakeByGroup = new Map(); // group b64 -> {sender, amount}
for await (const t of allTxns('address=' + APP_ADDR + '&tx-type=axfer&limit=100')) {
  const ax = t['asset-transfer-transaction'];
  if (!ax || Number(ax['asset-id']) !== GONNA) continue;
  if (ax.receiver !== APP_ADDR || !t.group) continue;
  stakeByGroup.set(t.group, { sender: t.sender, amount: Number(ax.amount) });
}
console.log('inbound $GONNA stake axfers: ' + stakeByGroup.size);

// ---- 3) walk the appl log: cids, rosters, stakes, events --------------------
const ZERO = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
const cards = new Map(); // cid -> {creator, stake, seatsArg, joiners:[], events:[]}
let createish = 0;
const cidOfCreate = new Map(); // txid -> cid
for (const t of appl) {
  const args = t['application-transaction']?.['application-args'] ?? [];
  if (args.length === 0) continue;
  const s = hex4(args[0]);
  const isCreate = s === SEL_CREATE || s === SEL_RUMBLE;
  if (isCreate) {
    const cid = createish++;
    cidOfCreate.set(t.id, cid);
    const g = t.group ? stakeByGroup.get(t.group) : null;
    cards.set(cid, {
      cid,
      creator: t.sender,
      stakeMicro: g && g.sender === t.sender ? g.amount : null,
      seatsArg: args.length > 2 ? u64At(Buffer.from(args[2], 'base64'), 0) : null, // JOINER seats
      joiners: [],
      events: [],
      createdRound: t['confirmed-round'],
    });
    continue;
  }
  if (s === SEL_JOIN && args.length > 1) {
    const cid = u64At(Buffer.from(args[1], 'base64'), 0);
    const c = cards.get(cid);
    const g = t.group ? stakeByGroup.get(t.group) : null;
    if (c) {
      c.joiners.push(t.sender);
      if (c.stakeMicro === null && g) c.stakeMicro = g.amount;
    } else {
      cards.set(cid, { cid, creator: null, stakeMicro: g ? g.amount : null, seatsArg: null, joiners: [t.sender], events: [], createdRound: null });
    }
  }
  // events
  for (const log of t.logs ?? []) {
    const b = Buffer.from(log, 'base64');
    if (b.length < 12) continue;
    const selHex = b.subarray(0, 4).toString('hex');
    const at = (t['round-time'] ?? 0) * 1000;
    if (selHex === 'ae488dc6' || selHex === '24d3dd8b') {
      if (b.length < 60) continue;
      const winnerRaw = algosdk.encodeAddress(Uint8Array.from(b.subarray(12, 44)));
      const cid = u64At(b, 4);
      const ev = {
        cid,
        kind: selHex === 'ae488dc6' ? 'resolved' : 'forfeited',
        winner: winnerRaw === ZERO ? null : winnerRaw,
        payoutMicro: u64At(b, 44),
        feeMicro: u64At(b, 52),
        txid: t.id,
        round: t['confirmed-round'],
        at,
      };
      if (!cards.has(cid)) cards.set(cid, { cid, creator: null, stakeMicro: null, seatsArg: null, joiners: [], events: [], createdRound: null });
      cards.get(cid).events.push(ev);
    } else if (selHex === '0bfda53a') {
      if (b.length < 20) continue;
      const cid = u64At(b, 4);
      if (!cards.has(cid)) cards.set(cid, { cid, creator: null, stakeMicro: null, seatsArg: null, joiners: [], events: [], createdRound: null });
      cards.get(cid).events.push({ cid, kind: 'refunded', winner: null, payoutMicro: 0, feeMicro: 0, reason: u64At(b, 12), txid: t.id, round: t['confirmed-round'], at });
    }
  }
}
console.log('cards reconstructed: ' + cards.size + ' (create-ish calls: ' + createish + ')');

// ---- 4) find UUFN4L…ICNM -----------------------------------------------------
const involved = new Set();
for (const c of cards.values()) {
  for (const a of [c.creator, ...c.joiners, ...c.events.map((e) => e.winner)]) {
    if (a && a.startsWith(PREFIX) && a.endsWith(SUFFIX)) involved.add(a);
  }
}
for (const t of appl) {
  const a = t.sender;
  if (a.startsWith(PREFIX) && a.endsWith(SUFFIX)) involved.add(a);
}
if (involved.size === 0) {
  console.log('NO address matching ' + PREFIX + '…' + SUFFIX + ' found in app history');
  process.exit(1);
}
const HIM = [...involved][0];
console.log('\nTARGET WALLET: ' + HIM);

// ---- 5) live boxes (his still-open card lives here) --------------------------
const liveIds = await kit.scanChallengeIds();
const live = [];
for (const cid of liveIds) {
  const meta = await kit.readMeta(cid).catch(() => null);
  if (!meta) continue;
  const players = await kit.readPlayers(cid).catch(() => []);
  const roster = players.map((p) => algosdk.encodeAddress(Uint8Array.from(p.addr)));
  live.push({ cid, stakeMicro: Number(meta.stake), seats: Number(meta.seatsTotal ?? meta.seats), roster });
}
const hisLive = live.filter((c) => c.roster.includes(HIM));
console.log('\nLIVE boxes: ' + live.length + ' — his open cards: ' + JSON.stringify(hisLive.map((c) => ({ cid: c.cid, stake: c.stakeMicro / 1e6, seats: c.roster.length }))));

// ---- 6) the merged history EXACTLY as chainAdapter.listHistory builds it -----
// Variant A: the owner's browser — card memory present for the cards he played
//   (scan() remembers every live card it sees: stake + roster), events pair
//   with it. Variant B: a FRESH browser — events alone (stake = pot/2 duel
//   guess, roster = winner only). Both run the CURRENT legacyStats math.
const shortAddr = (a) => a.slice(0, 6) + '…' + a.slice(-4);
function buildHistory(withMemory) {
  const byId = new Map();
  for (const c of cards.values()) {
    for (const ev of c.events) {
      if (ev.kind === 'refunded') continue; // frontend: pure refunds are not battles
      const roster = [c.creator, ...c.joiners].filter(Boolean);
      const mem = withMemory && c.stakeMicro !== null && roster.length > 0
        ? { stake: c.stakeMicro / 1e6, seatsTotal: (c.seatsArg ?? roster.length - 1) + 1, players: roster }
        : null;
      byId.set(ev.cid, {
        id: ev.cid,
        source: mem ? 'event+memory' : 'event',
        stake: mem?.stake ?? (ev.payoutMicro + ev.feeMicro) / 1e6 / 2, // chainAdapter.ts:1403 — the pot/2 invention
        pot: (ev.payoutMicro + ev.feeMicro) / 1e6, // GROSS pot (payout+fee) — chainAdapter.ts:1404
        payout: ev.payoutMicro / 1e6,
        fee: ev.feeMicro / 1e6,
        kind: ev.kind,
        winner: ev.winner,
        players: mem ? mem.players : ev.winner ? [ev.winner] : [],
        seats: mem?.seatsTotal ?? 2,
      });
    }
  }
  return [...byId.values()].sort((x, y) => y.id - x.id);
}

// CURRENT legacyStats (chainAdapter.ts:1447-1472) verbatim
function splitPot(stake, pot, seatsTaken) {
  const pool = Math.max(pot, stake * Math.max(0, seatsTaken));
  const fee = pool * 0.05;
  return { pool, fee, takes: pool - fee };
}
function legacyStatsCurrent(hist, address) {
  let wins = 0, losses = 0, won = 0, lost = 0, bestWin = 0;
  for (const h of hist) {
    if (!h.players.some((p) => p === address)) continue;
    if (!h.winner) continue;
    if (h.winner === address) {
      wins++;
      const takes = splitPot(h.stake, h.pot, h.players.length).takes;
      won += takes;
      if (takes > bestWin) bestWin = takes;
    } else {
      losses++;
      lost += h.stake;
    }
  }
  const played = wins + losses;
  return { played, wins, losses, winRate: played > 0 ? Math.round((wins / played) * 100) : 0, won, lost, net: won - lost, bestWin };
}

for (const variant of ['A(event+memory, owner browser)', 'B(event-only, fresh browser)']) {
  const hist = buildHistory(variant.startsWith('A'));
  const mine = hist.filter((h) => h.players.includes(HIM));
  console.log('\n================ VARIANT ' + variant + ' ================');
  for (const h of mine) {
    console.log(JSON.stringify({
      id: h.id, source: h.source, kind: h.kind, stake: h.stake, pot: h.pot, payout: h.payout, fee: h.fee,
      winner: h.winner ? shortAddr(h.winner) : null, 'players.length': h.players.length,
    }));
    if (variant.startsWith('A')) console.log('  players: ' + JSON.stringify(h.players));
  }
  console.log('legacyStats(CURRENT): ' + JSON.stringify(legacyStatsCurrent(hist, HIM)));
}

// ---- 7) the ON-CHAIN TRUTH per the owner decree -------------------------------
console.log('\n================ ON-CHAIN TRUTH (signed P&L) ================');
{
  const hist = buildHistory(true);
  let paid = 0, received = 0, wonNet = 0, lost = 0, bestWin = 0, wins = 0, losses = 0;
  for (const h of hist) {
    if (!h.players.includes(HIM)) continue;
    if (!h.winner) continue; // tie/refund: not a W/L
    const stake = h.stake; // memory stake = the truth here
    paid += stake;
    if (h.winner === HIM) {
      wins++;
      // forfeit: the contract ALSO returns the caller's own stake in full
      const recv = h.kind === 'forfeited' ? stake + h.payout : h.payout;
      received += recv;
      wonNet += recv;
      if (recv > bestWin) bestWin = recv;
      console.log('cid ' + h.id + ' (' + h.kind + '): paid ' + stake + ', received ' + recv + ' -> leg net +' + (recv - stake));
    } else {
      losses++;
      lost += stake;
      console.log('cid ' + h.id + ' (' + h.kind + '): paid ' + stake + ', received 0 -> leg net -' + stake);
    }
  }
  console.log(JSON.stringify({ played: wins + losses, wins, losses, won: wonNet, lost, net: received - paid, bestWin }));
}
console.log('\nRECON DONE (read-only).');
