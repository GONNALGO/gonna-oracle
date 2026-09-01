// generate 12 QA wallets: fund 0.35 ALGO -> each opts in GONNA -> 2 GONNA each.
// ORDER IS LAW: ALGO first (covers min balance + optin MBR + fees), opt-in
// from the wallet itself, GONNA last (receiver must already hold the ASA).
import { readFileSync, writeFileSync } from 'node:fs';
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));
const ROOT = new URL('..', import.meta.url).pathname;
const SP = ROOT + '/contracts/quantum-arena/deploy/mainnet.secrets.json';
const secrets = JSON.parse(readFileSync(SP, 'utf8'));
const qa2 = algosdk.mnemonicToSecretKey(secrets.PLAYER_QA2.mnemonic);
const algod = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', '');
const GONNA = 2582294183;

const wallets = [];
for (let i = 1; i <= 12; i++) {
  const role = 'QA_G' + String(i).padStart(2, '0');
  if (secrets[role]) {
    wallets.push({ role, acct: algosdk.mnemonicToSecretKey(secrets[role].mnemonic) });
    continue; // idempotent re-run
  }
  const acct = algosdk.generateAccount();
  secrets[role] = { addr: acct.addr.toString(), mnemonic: algosdk.secretKeyToMnemonic(acct.sk) };
  wallets.push({ role, acct });
}
const sp = () => algod.getTransactionParams().do();

async function sendSigned(txns, signers) {
  algosdk.assignGroupID(txns);
  const signed = txns.map((t, i) => t.signTxn(signers[i].sk));
  const r = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, r.txid, 10);
  return r.txid;
}

// 1) ALGO funding (one group of 12 pays from QA2)
const pays = [];
for (const w of wallets) pays.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: qa2.addr, receiver: w.acct.addr, amount: 350_000, suggestedParams: await sp() }));
console.log('ALGO fund txid=' + await sendSigned(pays, wallets.map(() => qa2)));

// 2) opt-in GONNA from each wallet (12 single txns)
for (const w of wallets) {
  const t = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: w.acct.addr, receiver: w.acct.addr, assetIndex: GONNA, amount: 0, suggestedParams: await sp() });
  const r = await algod.sendRawTransaction(t.signTxn(w.acct.sk)).do();
  await algosdk.waitForConfirmation(algod, r.txid, 10);
  console.log(w.role, w.acct.addr.toString().slice(0, 10), 'opted-in');
}

// 3) GONNA stake money (one group of 12 axfers from QA2)
const ax = [];
for (const w of wallets) ax.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: qa2.addr, receiver: w.acct.addr, assetIndex: GONNA, amount: 2_000_000, suggestedParams: await sp() }));
console.log('GONNA fund txid=' + await sendSigned(ax, wallets.map(() => qa2)));

writeFileSync(SP, JSON.stringify(secrets, null, 2));
console.log('secrets saved (gitignored)');
