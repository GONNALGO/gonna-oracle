// test stub: delegates every call to globalThis.__KIT hooks
const H = () => globalThis.__KIT || {};
export const ARENA_APP_ID = 769907387;
export const LEGACY_ARENA_APP_ID = 769688298;
export const GONNA_ASA_TESTNET = 769688287;
export const OPUP_APP_ID = 769688641;
export const TREASURY_ADDR = 'TREASURYSTUB';
export const ORACLE_ADDR = 'ORACLESTUB';
export const ALGOD_TESTNET = 'https://example.invalid';
export const INDEXER_TESTNET = 'https://example.invalid';
export const SEAT_TTL_SECS = 3600;
export const ARENA_VERSION = 2;
export const GONNA_DECIMALS = 6;
export const TESTNET_FEES = new Proxy({}, { get: () => 1000 });
export const CONTINUE_FEE_MICRO = 5000000;
export const SIGN_TIMEOUT_MS = 90000;
export const SIGN_TIMEOUT_MSG = 'TIMEOUT';
export const SIGN_NUDGE_MS = 12000;
export const SIGN_CANCEL_MSG = 'CANCELLED';
export class SignCancelled extends Error {}
export const sdk = () => H().sdk();
export const algodClient = () => H().algodClient();
export const scoreMsg = (...a) => H().scoreMsg(...a);
export const verdictMsg = (...a) => H().verdictMsg(...a);
export const nextChallengeId = () => H().nextChallengeId();
export const contractVersion = () => H().contractVersion();
export const readMeta = (cid) => H().readMeta(cid);
export const readPlayers = (cid) => H().readPlayers(cid);
export const scanChallengeIds = () => H().scanChallengeIds();
export const buildCreateGroup = (o) => H().buildCreateGroup(o);
export const buildJoinGroup = (o) => H().buildJoinGroup(o);
export const buildSubmitGroup = (o) => H().buildSubmitGroup(o);
export const buildResolveGroup = (o) => H().buildResolveGroup(o);
export const buildClaimGroup = (o) => H().buildClaimGroup(o);
export const buildEarlyCloseGroup = (o) => H().buildEarlyCloseGroup(o);
export const buildClaimForfeitGroup = (o) => H().buildClaimForfeitGroup(o);
export const buildContinuePayment = (o) => H().buildContinuePayment(o);
export const continueNote = () => 'note';
export const verifyContinuePayment = () => Promise.resolve(true);
export const withTimeout = (p) => p;
export const isCidRaceReject = (e) => { const m = String((e && e.message) ?? e); return /status 400/i.test(m) && /logic eval error/i.test(m); };
export const isSignCancel = () => false;
export const isWedgeError = () => false;
export const setSignRecoverHook = () => undefined;
export const activeSignOp = () => null;
export const signSendManaged = (sign, buildTxns, opts = {}) => {
  let autoLeft = opts.autoRetries ?? 0;
  const attempt = async () => {
    try {
      const txns = await buildTxns(); // rebuild RE-READS nextChallengeId (the guard lives in chainAdapter.build)
      const signed = await sign(txns);
      const send = opts.send ?? ((s) => H().postToAlgod(s));
      return await send(signed);
    } catch (e) {
      if (autoLeft > 0 && opts.rebuildOnRetry && isCidRaceReject(e)) { autoLeft--; return attempt(); }
      throw e;
    }
  };
  return { done: attempt(), retry() {}, cancel() {} };
};
export const signSend = (...a) => H().signSend(...a);
export const recordTxid = (...a) => H().recordTxid && H().recordTxid(...a);
export const getTxid = () => null;
export const recordCloseTxid = (...a) => H().recordCloseTxid && H().recordCloseTxid(...a);
export const getCloseTxid = () => null;
export const pickCloseTxid = () => null;
export const resolveCloseTxid = () => null;
export const explorerTxUrlFor = (n, t) => 'https://example.invalid/' + n + '/' + t;
export const recordResolveAt = (...a) => H().recordResolveAt && H().recordResolveAt(...a);
export const getResolveAt = () => null;
export const explorerTxUrl = (t) => 'https://example.invalid/' + t;
export const fetchArenaCloseEvents = (...a) => H().fetchArenaCloseEvents(...a);
export const fetchArenaCreateStages = (...a) => (H().fetchArenaCreateStages ? H().fetchArenaCreateStages(...a) : Promise.resolve({}));
export const rememberCard = (m) => H().rememberCard && H().rememberCard(m);
export const rememberedCard = (cid) => H().rememberedCard(cid);
export const rememberedCards = () => (H().rememberedCards ? H().rememberedCards() : []);
