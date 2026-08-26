// src/game/arena/arenaKit.ts
var ARENA_NETWORK = import.meta.env?.VITE_ARENA_NETWORK === "mainnet" ? "mainnet" : "testnet";
var IS_MAINNET = ARENA_NETWORK === "mainnet";
var TESTNET_CFG = {
  appId: 769907387,
  // ARENA APP v2.1
  legacyAppId: 769688298,
  // QuantumArena v1 (superseded)
  gonnaAsa: 769688287,
  opUpAppId: 769688641,
  treasuryAddr: "4OQ3LJ3JW67JEY55TMHLGZG3MWWLTVFZERGY67LBJEJLOGEUUX2PYHQGGM",
  oracleAddr: "COI33V32HHFEGZFVGBZHD2A67TSQ4JHHTS5CE37VNLGIQHOHCP4FI4KNFA",
  algodUrl: "https://testnet-api.algonode.cloud",
  oracleBaseUrl: "https://gonna-arena-oracle-testnet.onrender.com"
};
var MAINNET_CFG = {
  // M-2 mainnet deploy (scripts/mainnet-deploy-report.md): app 3686311434,
  // escrow 3XEQEDORZHI…47UM (app address, derived — never hardcoded below).
  appId: 3686311434,
  legacyAppId: 0,
  // no legacy on mainnet
  gonnaAsa: 2582294183,
  // REAL mainnet $GONNA (same id as src/game/wallet.ts)
  // M-4: NO OpUp donor app on mainnet — contract.py never references it
  // (it is a CLIENT-side pooled-budget booster, not a contract dependency)
  // and the mainnet bootstrap did only the GONNA opt-in. opupTxns() omits
  // the donor calls when this is 0. If a create/join/close group ever hits
  // the opcode budget on mainnet, deploy the donor (deploy/opup.ts) and
  // fill this id — documented in the M-4 report.
  opUpAppId: 0,
  treasuryAddr: "GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU",
  oracleAddr: "3UVNPC3IOM42HZS5HZJPVH6LBBJOJFF2WHQ4K5SDYJKKWFAJ36SKXILG4Y",
  algodUrl: "https://mainnet-api.algonode.cloud",
  oracleBaseUrl: "https://gonna-arena-oracle-testnet.onrender.com"
  // same Render service; flipped env-side to mainnet
};
var NET = IS_MAINNET ? MAINNET_CFG : TESTNET_CFG;
function netLsKey(base) {
  return base + "." + ARENA_NETWORK;
}

// src/game/arena/testnetKit.ts
var ARENA_APP_ID = NET.appId;
var LEGACY_ARENA_APP_ID = NET.legacyAppId;
var GONNA_ASA = NET.gonnaAsa;
var GONNA_ASA_TESTNET = NET.gonnaAsa;
var OPUP_APP_ID = NET.opUpAppId;
var TREASURY_ADDR = NET.treasuryAddr;
var ORACLE_ADDR = NET.oracleAddr;
var ALGOD_URL = NET.algodUrl;
var ALGOD_TESTNET = NET.algodUrl;
var STAGE_NOTE_PREFIX = "gonna:v2:stage:";
function stageNote(stageIdx) {
  return new TextEncoder().encode(STAGE_NOTE_PREFIX + stageIdx);
}
function parseStageNote(note) {
  const m = /^gonna:v2:stage:(\d)$/.exec(new TextDecoder().decode(note));
  if (!m) return null;
  const k = Number(m[1]);
  return k >= 0 && k <= 6 ? k : null;
}
var SCORE_DOMAIN = new TextEncoder().encode("QA-SCORE|");
var VERDICT_DOMAIN = new TextEncoder().encode("QA-VERDICT|");
var TESTNET_FEES = {
  create: 1e3 + 1e3 + 3e3 + 4 * 1e3,
  // pay + axfer + call + 4 opup
  join: 1e3 + 3e3,
  // axfer + call
  submit: 3e3 + 4 * 1e3,
  // call + 4 opup
  resolve: 1e3 * (1 + 3) + 4 * 1e3,
  // NON-TIE call (1 outer + 3 inner) + 4 opup; ties scale with the roster — buildResolveGroup computes it dynamically
  claim: 1e3 + 2 * 1e3,
  // call + 2 inner (stake axfer + MBR payback) — v15.3.2 BUG-1: was 2000, chain rejects it
  close: 1e3 + 4e3,
  // pay + call (2 inner covered by the call's 4000)
  forfeit: 5e3
  // call + 4 inner (2 axfer winner + fee axfer + MBR payback)
};
var sdkP = null;
function sdk() {
  if (!sdkP) sdkP = import("algosdk");
  return sdkP;
}
async function algodClient() {
  const a = await sdk();
  return new a.Algodv2("", ALGOD_URL, "");
}
async function nextChallengeId() {
  const algod = await algodClient();
  const app = await algod.getApplicationByID(ARENA_APP_ID).do();
  for (const kv of app.params.globalState ?? []) {
    if (new TextDecoder().decode(kv.key) === "next_challenge_id") return Number(kv.value.uint ?? 0);
  }
  return 0;
}
async function methodSelector(a, sig) {
  const parts = sig.split(")");
  const argTypes = parts[0].slice(parts[0].indexOf("(") + 1).split(",").filter(Boolean);
  const m = new a.ABIMethod({
    name: sig.slice(0, sig.indexOf("(")),
    args: argTypes.map((t, i) => ({ type: t, name: "a" + i })),
    returns: { type: parts[1] || "void" }
  });
  return m.getSelector();
}
var TX_KEY = netLsKey("gonna.arena.txids");
var RES_KEY = netLsKey("gonna.arena.resolved");
var CLOSE_TX_KEY = netLsKey("gonna.arena.closetx");
var INDEXER_TESTNET = "https://testnet-idx.algonode.cloud";
function b64ToBytes(s) {
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
}
var STAGE_KEY = "gonna.arena.stages";
var STAGE_MEM_MAX = 500;
function readStageCache() {
  try {
    const j = JSON.parse(window.localStorage.getItem(STAGE_KEY) ?? "{}");
    return { fromCid: typeof j.fromCid === "number" ? j.fromCid : 0, stages: j.stages && typeof j.stages === "object" ? j.stages : {} };
  } catch {
    return { fromCid: 0, stages: {} };
  }
}
function writeStageCache(c) {
  try {
    const keys = Object.keys(c.stages);
    if (keys.length > STAGE_MEM_MAX) {
      const sorted = keys.sort((x, y) => Number(x) - Number(y));
      for (const k of sorted.slice(0, keys.length - STAGE_MEM_MAX)) delete c.stages[k];
    }
    window.localStorage.setItem(STAGE_KEY, JSON.stringify(c));
  } catch {
  }
}
function applyStageScan(cache, hits) {
  const sorted = [...hits].sort((x, y) => x.round - y.round || x.offset - y.offset);
  const stages = { ...cache.stages };
  let cid = cache.fromCid;
  for (const h of sorted) {
    if (h.stage !== null) stages[String(cid)] = h.stage;
    cid++;
  }
  return { fromCid: cid, stages };
}
var CREATE_SIG = "create_challenge(pay,axfer,uint64,uint64,uint64,uint64,byte[],uint64,byte[])uint64";
var SPAWN_SIG = "spawn_rumble(pay,axfer,pay,uint64,uint64,uint64,byte[])uint64";
var stageMemo = null;
async function fetchArenaCreateStages(opts = {}) {
  if (!opts.force && stageMemo && Date.now() - stageMemo.at < 3e4) return stageMemo.stages;
  const cache = readStageCache();
  const total = opts.total ?? await nextChallengeId();
  let out = cache;
  const need = Math.max(0, total - cache.fromCid);
  if (need > 0) {
    const a = await sdk();
    const selCreate = await methodSelector(a, CREATE_SIG);
    const selSpawn = await methodSelector(a, SPAWN_SIG);
    const eq = (b, s) => b.length === s.length && b.every((v, i) => v === s[i]);
    const hits = [];
    let skipped = cache.fromCid;
    let token = null;
    const maxPages = opts.maxPages ?? 10;
    for (let page = 0; page < maxPages && hits.length < need; page++) {
      const url = INDEXER_TESTNET + "/v2/transactions?application-id=" + ARENA_APP_ID + "&tx-type=appl&limit=100" + (token ? "&next=" + encodeURIComponent(token) : "");
      const r = await fetch(url);
      if (!r.ok) throw new Error("indexer http " + r.status);
      const j = await r.json();
      for (const t of j.transactions ?? []) {
        if (typeof t["confirmed-round"] !== "number") continue;
        const args = t["application-transaction"]?.["application-args"];
        if (!args || args.length === 0) continue;
        const first = b64ToBytes(args[0]);
        if (!eq(first, selCreate) && !eq(first, selSpawn)) continue;
        if (skipped > 0) {
          skipped--;
          continue;
        }
        hits.push({
          round: t["confirmed-round"],
          offset: t["intra-round-offset"] ?? 0,
          stage: typeof t.note === "string" ? parseStageNote(b64ToBytes(t.note)) : null
        });
        if (hits.length >= need) break;
      }
      token = j["next-token"] ?? null;
      if (!token) break;
    }
    if (cache.fromCid + hits.length === total) {
      out = applyStageScan(cache, hits);
      writeStageCache(out);
    }
  }
  stageMemo = { at: Date.now(), stages: out.stages };
  return out.stages;
}
export {
  STAGE_NOTE_PREFIX,
  applyStageScan,
  fetchArenaCreateStages,
  parseStageNote,
  readStageCache,
  stageNote
};
