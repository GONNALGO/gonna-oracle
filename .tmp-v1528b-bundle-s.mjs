// .tmp-v1528b-kitstub.ts
var H = () => globalThis.__KIT;
var GONNA_ASA_TESTNET = 769688287;
var SEAT_TTL_SECS = 3600;
var ARENA_VERSION = 2;
var TESTNET_FEES = new Proxy({}, { get: () => 1e3 });
var sdk = () => H().sdk();
var algodClient = () => H().algodClient();
var scoreMsg = (...a) => H().scoreMsg(...a);
var verdictMsg = (...a) => H().verdictMsg(...a);
var nextChallengeId = () => H().nextChallengeId();
var contractVersion = () => H().contractVersion();
var readMeta = (cid) => H().readMeta(cid);
var readPlayers = (cid) => H().readPlayers(cid);
var scanChallengeIds = () => H().scanChallengeIds();
var buildCreateGroup = (o) => H().buildCreateGroup(o);
var buildJoinGroup = (o) => H().buildJoinGroup(o);
var buildSubmitGroup = (o) => H().buildSubmitGroup(o);
var buildResolveGroup = (o) => H().buildResolveGroup(o);
var buildClaimGroup = (o) => H().buildClaimGroup(o);
var buildEarlyCloseGroup = (o) => H().buildEarlyCloseGroup(o);
var buildClaimForfeitGroup = (o) => H().buildClaimForfeitGroup(o);
var signSendManaged = (...a) => H().signSendManaged(...a);
var signSend = (...a) => H().signSend(...a);
var recordTxid = (...a) => H().recordTxid && H().recordTxid(...a);
var recordResolveAt = (...a) => H().recordResolveAt && H().recordResolveAt(...a);
var getResolveAt = () => null;
var fetchArenaCloseEvents = (...a) => H().fetchArenaCloseEvents(...a);
var fetchArenaCreateStages = (...a) => H().fetchArenaCreateStages ? H().fetchArenaCreateStages(...a) : Promise.resolve({});
var rememberCard = (m) => H().rememberCard && H().rememberCard(m);
var rememberedCard = (cid) => H().rememberedCard(cid);
var rememberedCards = () => H().rememberedCards ? H().rememberedCards() : [];

// .tmp-v1528b-oraclestub.ts
var hasDevOracle = () => true;
var devOracleSign = async () => new Uint8Array(64);
var devOracleSignScore = async () => new Uint8Array(64);

// .tmp-v1528b-qastub.ts
var qaScore = () => 4200;

// src/game/arena/chainAdapter.ts
function fmtStake(n) {
  if (!Number.isFinite(n)) return "\u2014";
  if (n >= 1e12) return trim1(n / 1e12) + "T";
  if (n >= 1e9) return trim1(n / 1e9) + "B";
  if (n >= 1e6) return trim1(n / 1e6) + "M";
  if (n >= 1e3) return trim1(n / 1e3) + "K";
  return String(n);
}
function trim1(v) {
  const s = (Math.floor(v * 10) / 10).toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}
function fmtGonna(n) {
  if (!Number.isFinite(n)) return "0";
  return Math.floor(Math.max(0, n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function stageIdxFromCid(cid) {
  return cid % 7;
}
var inStageRange = (v) => typeof v === "number" && v >= 0 && v <= 6;
function pickCardStage(cid, stageMode, opts = {}) {
  if (stageMode === "full") return { stageIdx: null, verified: true, source: "full" };
  if (inStageRange(opts.note)) return { stageIdx: opts.note, verified: true, source: "note" };
  if (opts.memory && inStageRange(opts.memory.stageIdx) && opts.memory.stageVerified !== false) {
    return { stageIdx: opts.memory.stageIdx, verified: true, source: "memory" };
  }
  if (inStageRange(opts.link)) return { stageIdx: opts.link, verified: false, source: "link" };
  return { stageIdx: stageIdxFromCid(cid), verified: false, source: "fallback" };
}
var linkStageHint = null;
function setLinkStageHint(cid, stage) {
  linkStageHint = inStageRange(stage) ? { cid, stage } : null;
}
function getLinkStageHint(cid) {
  return linkStageHint && linkStageHint.cid === cid ? linkStageHint.stage : null;
}
var CID_MOVED_MSG = "THE PIT MOVED WHILE YOU PLAYED - RE-SEAL YOUR RUN";
var CidMovedError = class extends Error {
  code = "CID_MOVED";
  runCid;
  // the id the sealed run was played for
  actualCid;
  // the id the chain would create under now
  constructor(runCid, actualCid) {
    super(CID_MOVED_MSG);
    this.name = "CidMovedError";
    this.runCid = runCid;
    this.actualCid = actualCid;
  }
};
function netPayoutFromPot(potGonna) {
  const potMicro = Math.round(potGonna * 1e6);
  const feeMicro = Math.floor(potMicro * 500 / 1e4);
  return { pot: potMicro / 1e6, fee: feeMicro / 1e6, payout: (potMicro - feeMicro) / 1e6 };
}
function accumulateLegacy(hist, address) {
  let wins = 0;
  let losses = 0;
  let won = 0;
  let lost = 0;
  let net = 0;
  let bestWin = 0;
  for (const h of hist) {
    if (!h.players.some((p) => p.address === address)) continue;
    if (!h.winner) continue;
    const isWin = h.winner === address;
    if (isWin) wins++;
    else losses++;
    if (!Number.isFinite(h.stake)) continue;
    const paid = h.stake;
    let received = 0;
    if (isWin) {
      const payout = Number.isFinite(h.payout) ? h.payout : netPayoutFromPot(Number.isFinite(h.pot) && h.pot > 0 ? h.pot : h.stake * h.players.length).payout;
      received = h.forfeited ? h.stake + payout : payout;
      won += received;
      if (received > bestWin) bestWin = received;
    } else {
      lost += paid;
    }
    net += received - paid;
  }
  return { wins, losses, won, lost, net, bestWin };
}
var SEAT_TTL_MS = 3600 * 1e3;
function providerRef() {
  return window.__arenaIdProvider ?? null;
}
function sameAddr(a, addr) {
  return a.length === addr.length && a.every((v, i) => v === addr[i]);
}
function asBytes(v) {
  return v instanceof Uint8Array ? v : Uint8Array.from(v);
}
function shortAddr(addr) {
  return addr.slice(0, 6) + ".." + addr.slice(-4);
}
var TestnetArenaAdapter = class {
  mode = "testnet";
  async id() {
    const me = providerRef() ? await providerRef()() : null;
    if (!me) throw new Error("CONNECT WALLET FIRST (TESTNET)");
    return me;
  }
  async toChallenge(cid, meta, players) {
    const a = await sdk();
    const enc = (pk) => a.encodeAddress(asBytes(pk));
    const encOpt = (pk) => pk.length === 32 ? enc(pk) : "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
    const nowSec = Math.floor(Date.now() / 1e3);
    const seatsTaken = Number(meta.seatsTaken);
    const seatsTotal = Number(meta.seatsTotal) + 1;
    const statusCode = Number(meta.status);
    const expired = (statusCode === 0 || statusCode === 1) && Number(meta.deadline) <= nowSec;
    const status = statusCode === 3 || statusCode === 4 ? "closed" : statusCode === 2 ? "resolved" : expired ? "expired" : statusCode === 1 || seatsTaken >= seatsTotal ? "full" : "open";
    const creator = encOpt(meta.creator);
    const stageMode = Number(meta.stageMode) === 0 ? "full" : Number(meta.stageMode) === 1 ? "single" : "random";
    const stageRes = await this.cardStage(cid, stageMode);
    return {
      id: cid,
      creator,
      creatorName: shortAddr(creator),
      creatorType: "ed25519",
      // Falcon lands on mainnet — testnet accounts are classic
      visibility: "public",
      // v5 contract has no private flag on-chain
      format: Number(meta.seatsTotal) <= 1 ? "duel" : "open",
      seatsTotal,
      durationSecs: 0,
      // not stored on-chain; deadline is the truth
      stageMode,
      // v15.2.8 (owner decree): v2 ChallengeMeta has NO stage field — the
      // DESCENT level is the CREATOR's pick, committed in the create note.
      // Resolution order: note > card memory > link hint > cid%7 (UNVERIFIED).
      stageIdx: stageRes.stageIdx,
      stageVerified: stageRes.verified,
      stake: Number(meta.stake) / 1e6,
      // base units -> $GONNA display units
      createdAt: Number(meta.deadline) * 1e3 - 12 * 36e5,
      deadline: Number(meta.deadline) * 1e3,
      status,
      players: players.map((p) => ({
        address: encOpt(p.addr),
        name: shortAddr(encOpt(p.addr)),
        score: Number(p.score),
        fighter: { skin: "gonna", assetId: null, name: "GONNA" },
        accountType: "ed25519",
        signed: p.signed,
        // v2 seat clock
        seatedAt: Number(p.seatedAt) * 1e3
      })),
      winner: statusCode === 2 && meta.winner.length === 32 ? enc(meta.winner) : null,
      // v15.2.7 (BUG-1): seats_taken counts JOINER seats only — the contract
      // pays stake x roster length (creator is seat 0), so the players box
      // length IS the pot truth (proven on-chain: cid 21, 5 x 1 GONNA -> pot 5)
      pot: Number(meta.stake) * players.length / 1e6,
      forfeited: statusCode === 4
    };
  }
  async requireOracle() {
    if (!hasDevOracle()) throw new Error("ORACLE OFFLINE - testnet dev oracle key not injected");
  }
  // v15.2.8: the committed level for a single-mode card — (a) on-chain note
  // via the indexer scan, (b) this browser's card memory, (c) the deep-link
  // ?st= hint (v15.2.8b: fills the stage, verified FALSE — caller-controlled),
  // (d) cid%7 fallback (verified: false). Indexer hiccups never blank a card:
  // the memory/link tiers still resolve.
  async cardStage(cid, stageMode) {
    let notes = null;
    try {
      notes = await fetchArenaCreateStages();
    } catch {
      console.debug("[arena] stage-note scan unreachable \u2014 falling back to card memory / link hint");
    }
    const mem = rememberedCard(cid);
    return pickCardStage(cid, stageMode, {
      note: notes ? notes[String(cid)] ?? null : null,
      memory: mem ? { stageIdx: mem.stageIdx, stageVerified: mem.stageVerified } : null,
      link: getLinkStageHint(cid)
    });
  }
  async createChallenge(cfg, _creator) {
    const me = await this.id();
    await this.requireOracle();
    const a = await sdk();
    if (cfg.stageMode === "random") throw new Error("RANDOM RUNS ON MAINNET - TESTNET IS FULL/SINGLE ONLY");
    const stakeBase = Math.round(cfg.stake * 1e6);
    {
      const algod = await algodClient();
      const acct = await algod.accountInformation(me.address).do();
      const gonna = (acct.assets ?? []).find((x) => Number(x.assetId) === GONNA_ASA_TESTNET);
      if (!gonna) throw new Error("OPT INTO $GONNA FIRST - ASA " + GONNA_ASA_TESTNET + " (TESTNET)");
      if (Number(gonna.amount) < stakeBase) {
        throw new Error("NOT ENOUGH GONNA - NEED " + fmtGonna(stakeBase / 1e6) + ", WALLET HAS " + fmtGonna(Number(gonna.amount) / 1e6));
      }
      const spendable = Number(acct.amount) - Number(acct.minBalance ?? 0);
      if (spendable < 358200 + 1e4) throw new Error("NEED ~0.37 ALGO FOR THE CARD MBR + FEES");
    }
    const score = cfg.sealedScore ?? qaScore();
    const myPk = a.decodeAddress(me.address).publicKey;
    let builtCid = -1;
    const build = async () => {
      const cid = await nextChallengeId();
      if (cfg.runCid !== void 0 && cid !== cfg.runCid) throw new CidMovedError(cfg.runCid, cid);
      const sig = await devOracleSignScore(scoreMsg(cid, 0, myPk, score));
      builtCid = cid;
      return buildCreateGroup({
        creator: me.address,
        cid,
        stakeBase,
        seats: cfg.format === "duel" ? 1 : cfg.seatsTotal,
        // contract rule: duels are ALWAYS 24h; tables pick 4h/12h/24h
        durationSecs: cfg.format === "duel" ? 86400 : cfg.durationSecs,
        stageMode: cfg.stageMode === "full" ? 0 : 1,
        creatorScore: score,
        creatorScoreSig: sig,
        // v15.2.8: the creator's CHOSEN level rides the app-call NOTE —
        // creator-signed, immutable, readable by every participant
        stageIdx: cfg.stageMode === "single" ? cfg.stageIdx : null
      });
    };
    const txid = await signSendManaged(me.sign, build, {
      label: "SIGN & STAKE",
      rebuildOnRetry: true,
      autoRetries: 2
      // up to 3 sends total on the cid-race 400 (was attempt<3)
    }).done;
    recordTxid(builtCid, txid);
    const ch0 = await this.getChallenge(builtCid);
    if (!ch0) throw new Error("created on-chain but box unreadable");
    const committed = cfg.stageMode === "single" && cfg.stageIdx !== null ? cfg.stageIdx : null;
    rememberCard({
      cid: builtCid,
      creator: me.address,
      stake: cfg.stake,
      seatsTotal: ch0.seatsTotal,
      stageMode: cfg.stageMode,
      stageIdx: committed,
      stageVerified: cfg.stageMode === "full" ? true : committed !== null,
      deadline: ch0.deadline,
      players: ch0.players.map((p) => ({ address: p.address, score: p.score, signed: !!p.signed })),
      closedKind: null,
      winner: null,
      payout: 0,
      fee: 0,
      closedAt: null
    });
    return committed !== null ? { ...ch0, stageIdx: committed, stageVerified: true } : ch0;
  }
  async join(id, _player) {
    const me = await this.id();
    const meta = await readMeta(id);
    if (!meta) throw new Error("card not found on chain");
    const txns = await buildJoinGroup({ joiner: me.address, cid: id, stakeBase: Number(meta.stake) });
    recordTxid(id, await signSend(me.sign, txns, { label: "ACCEPT & STAKE" }));
    const ch = await this.getChallenge(id);
    if (!ch) throw new Error("joined but box unreadable");
    return ch;
  }
  async submitScore(id, address, score, opts) {
    const me = await this.id();
    await this.requireOracle();
    const a = await sdk();
    const players = await readPlayers(id);
    const myPk = a.decodeAddress(address).publicKey;
    const seat = players.findIndex((p) => sameAddr(p.addr, myPk));
    if (seat < 0) throw new Error("not seated at this table");
    const sig = await devOracleSignScore(
      scoreMsg(id, seat, myPk, score),
      opts?.continueRefId ? { refId: opts.continueRefId, addr: address } : void 0
    );
    const txns = await buildSubmitGroup({ player: me.address, cid: id, score, sig });
    recordTxid(id, await signSend(me.sign, txns, { label: "SIGN SCORE" }));
    const ch = await this.getChallenge(id);
    if (!ch) throw new Error("submitted but box unreadable");
    return ch;
  }
  async resolve(id) {
    const me = await this.id();
    await this.requireOracle();
    const a = await sdk();
    const meta = await readMeta(id);
    if (!meta) throw new Error("card not found on chain");
    const players = await readPlayers(id);
    const entries = players.map((p, i) => ({ seat: i, addr: asBytes(p.addr), score: Number(p.score), signed: p.signed })).filter((p) => p.signed);
    if (entries.length === 0) throw new Error("no signed scores yet");
    const chosenStage = Number(meta.stageMode) === 1 ? (await this.cardStage(id, "single")).stageIdx : 0;
    let extra = new Uint8Array(32);
    if (Number(meta.stageMode) === 1) {
      extra = new Uint8Array(32);
      new DataView(extra.buffer).setBigUint64(24, BigInt(chosenStage), false);
    }
    const vsig = await devOracleSign(await verdictMsg(id, Number(meta.stageMode), extra, entries));
    let best = entries[0];
    for (const e of entries) if (e.score > best.score) best = e;
    const tie = entries.filter((e) => e.score === best.score).length > 1;
    const winnerAddr = tie ? null : a.encodeAddress(best.addr);
    const before = await this.toChallenge(id, meta, players);
    const txns = await buildResolveGroup({
      caller: me.address,
      cid: id,
      stageIdx: chosenStage,
      // v15.2.8: the committed pick for MODE_STAGE_IDX (0 for FULL)
      seedReveal: new Uint8Array(0),
      // MODE_FULL: empty reveal
      verdictSig: vsig,
      winner: a.encodeAddress(best.addr)
      // tie: contract ignores it, refunds all
    });
    recordTxid(id, await signSend(me.sign, txns, { label: "RESOLVE" }));
    recordResolveAt(id, Date.now());
    const potMicro = Number(meta.stake) * players.length;
    const feeMicro = tie ? 0 : Math.floor(potMicro * 0.05);
    rememberCard({
      cid: id,
      creator: before.creator,
      stake: before.stake,
      seatsTotal: before.seatsTotal,
      stageMode: before.stageMode,
      // v15.2.8: never persist an UNVERIFIED fallback guess as memory truth
      stageIdx: before.stageVerified === false ? null : before.stageIdx,
      stageVerified: before.stageVerified !== false,
      deadline: before.deadline,
      players: before.players.map((p) => ({ address: p.address, score: p.score, signed: !!p.signed })),
      closedKind: tie ? "refunded" : "resolved",
      winner: winnerAddr,
      payout: (potMicro - feeMicro) / 1e6,
      fee: feeMicro / 1e6,
      closedAt: Date.now()
    });
    const ch = await this.getChallenge(id);
    if (ch && ch.status === "resolved") return ch;
    return { ...before, status: tie ? "closed" : "resolved", winner: winnerAddr };
  }
  // v15.2.4 audit: claim() is a TERMINAL close path on v2 (deletes both
  // boxes, ChallengeRefunded reason 1). It never re-read the box after the
  // send, so there is no false-error bug here — it only needs the card
  // memory write so the deep-link/history survive the box deletion.
  async claim(id, _address) {
    const me = await this.id();
    const before = await this.getChallenge(id);
    const txns = await buildClaimGroup({ caller: me.address, cid: id });
    const txid = await signSend(me.sign, txns, { label: "CLAIM" });
    recordTxid(id, txid);
    if (before) this.rememberClosed(before, "refunded", null, 0, 0);
    return { payout: 0, txid };
  }
  // v2: CLAIM FORFEIT — the viewer is the SIGNED duel opponent, the other
  // seat is UNSIGNED and its seat clock (seated_at + 1h) has lapsed. The
  // contract deletes both boxes: the card is gone from the board after this.
  async claimForfeit(id, _address) {
    const me = await this.id();
    const a = await sdk();
    const before = await this.getChallenge(id);
    const players = await readPlayers(id);
    const myPk = a.decodeAddress(me.address).publicKey;
    const mySeat = players.findIndex((p) => sameAddr(asBytes(p.addr), myPk));
    if (mySeat < 0) throw new Error("not seated at this table");
    if (!players[mySeat].signed) throw new Error("SIGN YOUR OWN SCORE FIRST");
    const target = 1 - mySeat;
    if (!players[target]) throw new Error("opponent seat is empty");
    if (players[target].signed) throw new Error("opponent already signed - no forfeit");
    const expiresAt = Number(players[target].seatedAt) + SEAT_TTL_SECS;
    if (Math.floor(Date.now() / 1e3) <= expiresAt) {
      throw new Error("SEAT CLOCK STILL RUNNING - FORFEIT AT " + new Date(expiresAt * 1e3).toISOString().slice(11, 16) + " UTC");
    }
    const txns = await buildClaimForfeitGroup({ caller: me.address, cid: id, seat: target });
    const txid = await signSend(me.sign, txns, { label: "CLAIM FORFEIT" });
    recordTxid(id, txid);
    recordResolveAt(id, Date.now());
    if (before) {
      const feeMicro = Math.floor(Number(before.stake * 1e6) * 0.05);
      this.rememberClosed(before, "forfeited", me.address, (before.stake * 1e6 - feeMicro) / 1e6, feeMicro / 1e6);
    }
    return { payout: 0, txid };
  }
  async earlyClose(id, _address) {
    const me = await this.id();
    const before = await this.getChallenge(id);
    const txns = await buildEarlyCloseGroup({ caller: me.address, cid: id });
    recordTxid(id, await signSend(me.sign, txns, { label: "EARLY CLOSE" }));
    const ch = await this.getChallenge(id);
    if (ch && ch.status !== "closed") return ch;
    if (before) {
      this.rememberClosed(before, "refunded", null, 0, 0);
      return { ...before, status: "closed" };
    }
    throw new Error("closed on-chain");
  }
  async getChallenge(id, opts) {
    const [meta, players] = await Promise.all([readMeta(id), readPlayers(id)]);
    if (meta) return this.toChallenge(id, meta, players);
    const mem = rememberedCard(id);
    let ev = null;
    const waits = opts?.deepLink ? [0, 2e3, 4e3] : [0];
    for (let i = 0; i < waits.length && !ev; i++) {
      if (waits[i] > 0) await new Promise((r) => setTimeout(r, waits[i]));
      try {
        const events = await this.closeEvents(true);
        ev = events.filter((e) => e.cid === id).sort((x, y) => y.round - x.round)[0] ?? null;
      } catch {
      }
    }
    if (ev) return this.terminalChallenge(id, ev.kind, ev, mem);
    if (mem && mem.closedKind) return this.terminalChallenge(id, mem.closedKind, null, mem);
    if (opts?.deepLink) return this.terminalChallenge(id, "resolved", null, null);
    return null;
  }
  // terminal card reconstructed from a close event and/or card memory.
  // kind 'resolved' with NO winner = perfect tie -> everyone refunded
  // (v14.4 convention: refunded cards render 'closed').
  terminalChallenge(id, kind, ev, mem) {
    const winner = (kind !== "refunded" ? ev?.winner ?? null : null) ?? mem?.winner ?? null;
    const unknown = !ev && !mem;
    const settled = kind === "resolved" && (winner !== null || unknown);
    const potMicro = ev ? ev.payout + ev.fee : mem ? Math.round((mem.payout + mem.fee) * 1e6) : 0;
    const at = ev?.at ?? mem?.closedAt ?? Date.now();
    const players = mem && mem.players.length > 0 ? mem.players.map((p) => ({
      address: p.address,
      name: shortAddr(p.address),
      score: p.score,
      fighter: { skin: "gonna", assetId: null, name: "GONNA" },
      accountType: "ed25519",
      signed: p.signed
    })) : winner ? [{ address: winner, name: shortAddr(winner), score: 0, fighter: { skin: "gonna", assetId: null, name: "GONNA" }, accountType: "ed25519" }] : [];
    const creator = mem?.creator ?? winner ?? "";
    const tStage = pickCardStage(id, mem?.stageMode ?? "full", {
      memory: mem ? { stageIdx: mem.stageIdx, stageVerified: mem.stageVerified } : null,
      link: getLinkStageHint(id)
    });
    return {
      id,
      creator,
      creatorName: creator ? shortAddr(creator) : "???",
      creatorType: "ed25519",
      visibility: "public",
      format: mem && mem.seatsTotal > 2 ? "open" : "duel",
      // event-only: duels are the live format
      seatsTotal: mem?.seatsTotal ?? 2,
      durationSecs: 0,
      stageMode: mem?.stageMode ?? "full",
      stageIdx: tStage.stageIdx,
      stageVerified: tStage.verified,
      // v15.2.7 (BUG-3a): the stake comes from card memory ONLY — the chain
      // event names pot/winner/fee, never the per-seat stake. No memory =
      // stake UNKNOWN (NaN -> fmtStake renders '-'), never pot/2 (that was a
      // duel-only guess, wrong for tables — inventing numbers is banned).
      stake: mem?.stake ?? NaN,
      createdAt: at - 36e5,
      // unknown — the settle time is the real record
      deadline: mem?.deadline ?? at,
      status: settled ? "resolved" : "closed",
      players,
      winner,
      pot: potMicro / 1e6 || (mem ? mem.stake * Math.max(1, mem.players.length) : 0),
      forfeited: kind === "forfeited"
    };
  }
  // event-log cache: the indexer answers once per 30s per session at most
  // (board refreshes and deep-links share it); failures fall back to the
  // last good answer so an indexer hiccup never blanks the HISTORY.
  eventsCache = null;
  async closeEvents(force = false) {
    if (!force && this.eventsCache && Date.now() - this.eventsCache.at < 3e4) return this.eventsCache.events;
    try {
      const events = await fetchArenaCloseEvents();
      this.eventsCache = { at: Date.now(), events };
      return events;
    } catch {
      console.debug("[arena] indexer unreachable \u2014 HISTORY falls back to live boxes + card memory");
      return this.eventsCache?.events ?? [];
    }
  }
  // card memory write for a close path this browser just confirmed
  rememberClosed(c, kind, winner, payout, fee) {
    rememberCard({
      cid: c.id,
      creator: c.creator,
      stake: c.stake,
      seatsTotal: c.seatsTotal,
      stageMode: c.stageMode,
      stageIdx: c.stageVerified === false ? null : c.stageIdx,
      // v15.2.8: guesses never become memory truth
      stageVerified: c.stageVerified !== false,
      deadline: c.deadline,
      players: c.players.map((p) => ({ address: p.address, score: p.score, signed: !!p.signed })),
      closedKind: kind,
      winner,
      payout,
      fee,
      closedAt: Date.now()
    });
  }
  // v15: the on-chain counter = the id the next create will get (DESCENT seed)
  async peekNextId() {
    try {
      return await nextChallengeId();
    } catch {
      return null;
    }
  }
  versionChecked = false;
  // v2: the VERSION global pins the box layout — warn loudly (visible in
  // console) if the app we point at is not the v2 contract this build parses
  async ensureVersion() {
    if (this.versionChecked) return;
    this.versionChecked = true;
    try {
      const v = await contractVersion();
      if (v !== ARENA_VERSION) console.debug("[arena] WARNING: contract VERSION=" + v + ", this build parses v" + ARENA_VERSION + " boxes");
    } catch {
      console.debug("[arena] VERSION read failed (network hiccup) \u2014 continuing");
    }
  }
  async scan() {
    await this.ensureVersion();
    const ids = await scanChallengeIds();
    const all = await Promise.all(ids.map((cid) => this.getChallenge(cid).catch(() => null)));
    const live = all.filter((c) => c !== null);
    for (const c of live) {
      rememberCard({
        cid: c.id,
        creator: c.creator,
        stake: c.stake,
        seatsTotal: c.seatsTotal,
        stageMode: c.stageMode,
        stageIdx: c.stageVerified === false ? null : c.stageIdx,
        // v15.2.8: never bank a fallback guess
        stageVerified: c.stageVerified !== false,
        deadline: c.deadline,
        players: c.players.map((p) => ({ address: p.address, score: p.score, signed: !!p.signed })),
        closedKind: null,
        winner: c.winner,
        payout: 0,
        fee: 0,
        closedAt: null
      });
    }
    return live;
  }
  async listOpenChallenges() {
    return (await this.scan()).filter((c) => c.status === "open" || c.status === "full" || c.status === "expired");
  }
  async myChallenges(address) {
    return (await this.scan()).filter((c) => c.creator === address || c.players.some((p) => p.address === address));
  }
  // v15.2.4 (BUG-3): v2 terminal transitions DELETE both boxes, so HISTORY
  // = live settled boxes (none on v2, kept for safety) UNION the v2 event log
  // (ChallengeResolved / ChallengeForfeited — the permanent on-chain record)
  // UNION this browser's card memory (covers indexer lag and offline).
  // Pure REFUNDED events (claim / early-close / catastrophe / tie leg) are
  // NOT battles — no entry (a tie still shows via its ChallengeResolved).
  // The LEGACY app (769688298) emits NO events: its history stays whatever
  // this browser remembers — documented in the header of testnetKit.ts.
  async listHistory() {
    const byId = /* @__PURE__ */ new Map();
    const settled = await this.scan().then((all) => all.filter((c) => c.status === "resolved" || c.status === "claimed")).catch(() => []);
    for (const c of settled) {
      byId.set(c.id, {
        id: c.id,
        stake: c.stake,
        pot: c.pot,
        format: c.format,
        stageMode: c.stageMode,
        stageIdx: c.stageIdx,
        stageVerified: c.stageVerified !== false,
        seats: c.seatsTotal,
        winner: c.winner ?? "",
        winnerName: c.winner ? shortAddr(c.winner) : "???",
        players: c.players.map((p) => ({ address: p.address, name: p.name, score: p.score })),
        // no on-chain timestamp: if WE resolved it the real time is remembered
        // locally (recordResolveAt); else the deadline is the closest truth,
        // clamped to now so a card resolved early never shows "1M AGO" from a
        // FUTURE deadline
        resolvedAt: getResolveAt(c.id) ?? Math.min(c.deadline, Date.now()),
        claimed: c.status === "claimed",
        forfeited: c.forfeited
        // v15.2.9: forfeit closes pay the own stake back on top
      });
    }
    for (const ev of await this.closeEvents()) {
      if (ev.kind === "refunded") continue;
      const mem = rememberedCard(ev.cid);
      byId.set(ev.cid, {
        id: ev.cid,
        // v15.2.9: the stake comes from card memory ONLY — the chain event
        // names pot/winner/fee, never the per-seat stake. No memory = stake
        // UNKNOWN (NaN): legacyStats still counts the W/L but SKIPS the money
        // math. The old (payout+fee)/2 duel guess invented 2.5-GONNA seats on
        // 5-seat tables — inventing numbers is banned.
        stake: mem?.stake ?? NaN,
        // GROSS pot (fee inside): a resolve pays payout+fee = stake x roster
        // exactly. A forfeit event only names the FORFEITED seat (payout+fee
        // = ONE stake) — the gross pot needs the memory roster, else unknown.
        pot: ev.kind === "forfeited" ? mem ? mem.stake * Math.max(1, mem.players.length) : NaN : (ev.payout + ev.fee) / 1e6,
        payout: ev.payout / 1e6,
        // EXACT net payout (forfeit: the winner SHARE — his own stake came back on top)
        fee: ev.fee / 1e6,
        forfeited: ev.kind === "forfeited",
        format: mem && mem.seatsTotal > 2 ? "open" : "duel",
        stageMode: mem?.stageMode ?? "full",
        stageIdx: pickCardStage(ev.cid, mem?.stageMode ?? "full", { memory: mem ? { stageIdx: mem.stageIdx, stageVerified: mem.stageVerified } : null, link: getLinkStageHint(ev.cid) }).stageIdx,
        stageVerified: pickCardStage(ev.cid, mem?.stageMode ?? "full", { memory: mem ? { stageIdx: mem.stageIdx, stageVerified: mem.stageVerified } : null, link: getLinkStageHint(ev.cid) }).verified,
        seats: mem?.seatsTotal ?? 2,
        winner: ev.winner ?? "",
        winnerName: ev.winner ? shortAddr(ev.winner) : "TIE - ALL REFUNDED",
        players: mem && mem.players.length > 0 ? mem.players.map((p) => ({ address: p.address, name: shortAddr(p.address), score: p.score })) : ev.winner ? [{ address: ev.winner, name: shortAddr(ev.winner), score: 0 }] : [],
        // the indexer round-time IS the real settle timestamp — better than
        // the local record and available on every browser, not just ours
        resolvedAt: ev.at || (getResolveAt(ev.cid) ?? Date.now()),
        claimed: true
        // testnet pays INSIDE resolve/forfeit — a settled match is a PAID match
      });
    }
    for (const mem of rememberedCards()) {
      if (!mem.closedKind || mem.closedKind === "refunded" || byId.has(mem.cid)) continue;
      byId.set(mem.cid, {
        id: mem.cid,
        stake: mem.stake,
        // GROSS pot: a forfeit memory's payout+fee is only the forfeited seat
        // (ONE stake) — the gross pot is stake x roster like every close
        pot: mem.closedKind === "forfeited" ? mem.stake * Math.max(1, mem.players.length) : mem.payout + mem.fee || mem.stake * Math.max(1, mem.players.length),
        payout: mem.payout > 0 ? mem.payout : void 0,
        // exact net payout remembered at the close
        fee: mem.fee > 0 ? mem.fee : void 0,
        forfeited: mem.closedKind === "forfeited",
        format: mem.seatsTotal > 2 ? "open" : "duel",
        stageMode: mem.stageMode,
        stageIdx: pickCardStage(mem.cid, mem.stageMode, { memory: { stageIdx: mem.stageIdx, stageVerified: mem.stageVerified }, link: getLinkStageHint(mem.cid) }).stageIdx,
        stageVerified: pickCardStage(mem.cid, mem.stageMode, { memory: { stageIdx: mem.stageIdx, stageVerified: mem.stageVerified }, link: getLinkStageHint(mem.cid) }).verified,
        seats: mem.seatsTotal,
        winner: mem.winner ?? "",
        winnerName: mem.winner ? shortAddr(mem.winner) : "???",
        players: mem.players.map((p) => ({ address: p.address, name: shortAddr(p.address), score: p.score })),
        resolvedAt: mem.closedAt ?? getResolveAt(mem.cid) ?? mem.deadline,
        claimed: true
      });
    }
    return [...byId.values()].sort((x, y) => y.resolvedAt - x.resolvedAt);
  }
  async legacyStats(address) {
    const hist = await this.listHistory();
    const { wins, losses, won, lost, net, bestWin } = accumulateLegacy(hist, address);
    const mine = await this.myChallenges(address);
    const open = mine.filter((c) => c.status === "open" || c.status === "full" || c.status === "expired").length;
    const played = wins + losses;
    return { played, wins, losses, open, winRate: played > 0 ? Math.round(wins / played * 100) : 0, won, lost, net, bestWin };
  }
};

// src/game/font.ts
var GLYPH_ROWS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
  ",": ["00000", "00000", "00000", "00000", "00110", "00110", "01100"],
  ":": ["00000", "00110", "00110", "00000", "00110", "00110", "00000"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "\u2014": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  // v15.2.7: em dash = honest UNKNOWN value (terminal card stake)
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "/": ["00001", "00001", "00010", "00100", "01000", "10000", "10000"],
  ">": ["10000", "01000", "00100", "00010", "00100", "01000", "10000"],
  "<": ["00001", "00010", "00100", "01000", "00100", "00010", "00001"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  // v10: SIGN & STAKE
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"]
};
var GLYPHS = /* @__PURE__ */ new Map();
for (const ch of Object.keys(GLYPH_ROWS)) {
  const rows = GLYPH_ROWS[ch];
  const pts = [];
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 5; x++) {
      if (rows[y].charCodeAt(x) === 49) pts.push(x, y);
    }
  }
  GLYPHS.set(ch, new Uint8Array(pts));
}

// src/game/arena/shareCard.ts
var STAGE_NAMES = ["GHETTO GONNA", "PUMP HARBOR", "WALL STREET", "CONSENSUS", "THE HOUSE", "LAUNCHPAD", "THRONE ROOM"];
function stageLine(ch) {
  if (ch.stageMode === "full") return "FULL RUN - ALL 7 STAGES";
  const base = "STAGE " + ((ch.stageIdx ?? 0) + 1) + " - " + STAGE_NAMES[ch.stageIdx ?? 0];
  return ch.stageVerified === false ? base + " (UNVERIFIED)" : base;
}
function shareText(ch) {
  const stage = ch.stageMode === "full" ? "FULL RUN. ALL 7 STAGES." : stageLine(ch) + ".";
  return "I JUST STAKED " + fmtStake(ch.stake) + " $GONNA ON MY OWN FIGHT. " + stage + " THINK YOU CAN TAKE IT? \u{1F98E}\u269B\uFE0F $GONNA #GONNAFIGHT #ALGORAND #QUANTUMFIGHT @GONNALGO";
}
export {
  TestnetArenaAdapter,
  getLinkStageHint,
  pickCardStage,
  setLinkStageHint,
  shareText,
  stageLine
};
