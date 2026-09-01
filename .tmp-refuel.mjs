import algosdk from 'algosdk';
import fs from 'fs';
const S = JSON.parse(fs.readFileSync('contracts/quantum-arena/deploy/mainnet.secrets.json','utf8'));
const c = new algosdk.Algodv2('', 'https://mainnet-api.4160.nodely.dev', 443);
const dep = algosdk.mnemonicToSecretKey(S.DEPLOYER.mnemonic);
const sp = await c.getTransactionParams().do();
const txns = [];
for (let i=1;i<=12;i++){
  const k='QA_G'+String(i).padStart(2,'0');
  const a = algosdk.mnemonicToSecretKey(S[k].mnemonic);
  const info = await c.accountInformation(a.addr).do();
  const g = (info.assets||[]).find(x=>Number(x.assetId)===2582294183);
  const bal = g ? Number(g.amount) : 0;
  const need = 1000000 - bal;
  if (need > 0) txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({sender:dep.addr, receiver:a.addr, assetIndex:2582294183, amount:need, suggestedParams:sp}));
}
if (!txns.length) { console.log('all funded'); process.exit(0); }
algosdk.assignGroupID(txns);
const signed = txns.map(t=>t.signTxn(dep.sk));
const res = await c.sendRawTransaction(signed).do();
console.log('sent', txns.length, 'axfers txid', res.txid);
await algosdk.waitForConfirmation(c, res.txid, 8);
console.log('CONFIRMED');
