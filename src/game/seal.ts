// v9.1 — SEAL: save a finished run on-chain. 0-ALGO payment from the
// connected wallet to the SEAL treasury, carrying the record in the note:
//   GONNAFIGHT|1|<score>|<stage 1-6>|<win 0|1>|<continues>|<assetId or 0>|<skin>|<msg>
// algosdk is a HEAVY new dependency: it is dynamic-imported inside seal()
// (and nowhere else) so it rides the lazy wallet chunks, never the entry one.
import * as wallet from './wallet';

const ALGOD = 'https://mainnet-api.algonode.cloud';
export const MSG_MAX = 32;

// on-chain messages are ASCII-only, restricted to the pixel font charset
// (uppercase A-Z, digits, arcade punctuation — see font.ts GLYPH_ROWS).
// '|' and newlines are NOT in the charset, so they can never break the format.
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !?.,:$-'/<>%()+*=_";

// live-input cleaning: charset + length (no trim — the player may still be
// typing a multi-word message)
export function cleanMsg(s: string): string {
  let out = '';
  for (const ch of s.toUpperCase()) {
    if (CHARSET.indexOf(ch) >= 0) out += ch;
    if (out.length >= MSG_MAX) break;
  }
  return out;
}

// full sanitize for the note: clean + trim
export function sanitizeMsg(s: string): string {
  return cleanMsg(s).trim();
}

export interface SealRecord {
  score: number;
  stage: number; // 1-6
  win: 0 | 1;
  continues: number;
  assetId: number | null; // null -> 0 (free default GONNA)
  skin: string;
  msg: string;
}

export function buildNote(r: SealRecord): string {
  const msg = sanitizeMsg(r.msg);
  return (
    'GONNAFIGHT|1|' +
    Math.max(0, Math.floor(r.score)) + '|' +
    Math.min(6, Math.max(1, Math.floor(r.stage))) + '|' +
    (r.win ? 1 : 0) + '|' +
    Math.max(0, Math.floor(r.continues)) + '|' +
    (r.assetId ?? 0) + '|' +
    r.skin.toLowerCase() + '|' +
    msg
  );
}

export type SealStatus = 'sealed' | 'pending';
export interface SealOutcome {
  note: string;
  txid: string;
  status: SealStatus;
}

// CI debug hook (window.__gonna.lastSeal mirrors this)
export interface SealDebug extends SealOutcome {
  at: number;
}
export const sealDebug: { last: SealDebug | null } = { last: null };

// poll algod until the tx confirms (~20s budget, then CONFIRM PENDING)
async function pollPending(txid: string): Promise<SealStatus> {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const r = await fetch(ALGOD + '/v2/transactions/pending/' + encodeURIComponent(txid));
      if (r.ok) {
        const j = (await r.json()) as { 'confirmed-round'?: number; 'pool-error'?: string };
        if (j['pool-error']) throw new Error('the network rejected the seal');
        if ((j['confirmed-round'] ?? 0) > 0) return 'sealed';
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'the network rejected the seal') throw e;
      // transient network error: keep polling within the budget
    }
  }
  return 'pending';
}

async function postSigned(blob: Uint8Array): Promise<string> {
  const r = await fetch(ALGOD + '/v2/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-binary' },
    body: blob as unknown as BodyInit,
  });
  if (!r.ok) throw new Error('algod rejected the seal (http ' + r.status + ')');
  const j = (await r.json()) as { txId?: string; txid?: string };
  const txid = j.txId ?? j.txid;
  if (!txid) throw new Error('algod gave no txid back');
  return txid;
}

export async function seal(rec: SealRecord): Promise<SealOutcome> {
  const address = wallet.getWallet().address;
  if (!address) throw new Error('connect a wallet to seal');
  const note = buildNote(rec);
  const noteBytes = new TextEncoder().encode(note);

  let txid: string;
  let status: SealStatus;
  if (wallet.isMock()) {
    // CI mock: fake signed bytes, real HTTP flow (page.route intercepts algod)
    const fake = new Uint8Array(noteBytes.length + 7);
    fake.set(new TextEncoder().encode('MOCKSIG'), 0);
    fake.set(noteBytes, 7);
    txid = await postSigned(fake);
    status = await pollPending(txid);
  } else {
    // real wallet: algosdk builds the 0-ALGO payment, the wallet signs it
    const algosdk = await import('algosdk');
    const algod = new algosdk.Algodv2('', ALGOD, '');
    const params = await algod.getTransactionParams().do();
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: address,
      receiver: wallet.SEAL_TREASURY,
      amount: 0,
      note: noteBytes,
      suggestedParams: params,
    });
    let signed: Uint8Array[];
    try {
      signed = await wallet.signTransactions([
        [{ txn, signers: [address], message: 'Seal your GONNA FIGHT record on-chain' }],
      ]);
    } catch {
      throw new Error('signing cancelled in the wallet');
    }
    if (!signed || signed.length === 0 || !signed[0] || signed[0].length === 0) {
      throw new Error('signing cancelled in the wallet');
    }
    try {
      const res = (await algod.sendRawTransaction(signed).do()) as { txid?: string };
      txid = res.txid ?? txn.txID();
    } catch {
      throw new Error('algod rejected the seal');
    }
    try {
      status = await pollPending(txid);
    } catch {
      throw new Error('the network rejected the seal');
    }
  }
  const out: SealOutcome = { note, txid, status };
  sealDebug.last = { ...out, at: Date.now() };
  return out;
}
