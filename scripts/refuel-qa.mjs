// top up every QA_G wallet to 2 GONNA from DEPLOYER (winners recycle)
import { readFileSync } from 'node:fs';
const algosdk = (await import('algosdk')).default ?? (await import('algosdk'));
const ROOT = new URL('..', import.meta.url).pathname;
const secrets = JSON.parse(readFileSync(ROOT + '/contracts/quantum-arena/deploy/mainnet.secrets.json', 'utf8'));
const dep = algosdk.mnemonicToSecretKey(secrets.DEPLOYER.mnemonic);
const algod = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', '');
const GONNA = 2582294183;
const TARGET = 2_000_000;
const txns = [];
for (let i = 1; i <= 12; i++) {
  const role = 'QA_G' + String(i).padStart(2, '0');
  const a = secrets[role].addr;
  const info = await algod.accountAssetInformation(a, GONNA).do().catch(() => null);
  const bal = Number(info?.assetHolding?.amount ?? 0);
  const top = TARGET - bal;
  console.log(role, 'bal', bal / 1e6, 'topup', top / 1e6);
  if (top > 0) txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: dep.addr, receiver: a, assetIndex: GONNA, amount: top, suggestedParams: await algod.getTransactionParams().do() }));
}
if (txns.length) {
  algosdk.assignGroupID(txns);
  const signed = txns.map((t) => t.signTxn(dep.sk));
  const r = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, r.txid, 10);
  console.log('refuel txid=' + r.txid);
} else console.log('all topped up already');
