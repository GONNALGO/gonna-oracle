import algosdk from 'algosdk';
import fs from 'fs';
const S = JSON.parse(fs.readFileSync('contracts/quantum-arena/deploy/mainnet.secrets.json','utf8'));
const c = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', '');
const addr = k => S[k].addr || S[k].address;
const sk = k => S[k].sk ? Uint8Array.from(Buffer.from(S[k].sk,'base64')) : algosdk.mnemonicToSecretKey(S[k].mnemonic).sk;
const keys = ['DEPLOYER','ORACLE','PLAYER_QA2','PLAYER_QA3','PLAYER_QA4',...Array.from({length:12},(_,i)=>'QA_G'+String(i+1).padStart(2,'0'))].filter(k=>S[k]);
const dep = addr('DEPLOYER');
const sp = await c.getTransactionParams().do();
const pairs=[];
for (const k of keys){
  if(k==='DEPLOYER') continue;
  const a = await c.accountInformation(addr(k)).do();
  const free = Number(a.amount)-Number(a.minBalance);
  const keep = k.startsWith('QA_G') ? 16_000 : 12_000;
  const send = free - keep - 1000;
  if (send > 2000) pairs.push([k, BigInt(send)]);
}
const txns = pairs.map(([k,amt])=>algosdk.makePaymentTxnWithSuggestedParamsFromObject({sender:addr(k),receiver:dep,amount:amt,suggestedParams:sp}));
algosdk.assignGroupID(txns);
const signed = txns.map((t,i)=>t.signTxn(sk(pairs[i][0])));
const { txid } = await c.sendRawTransaction(signed).do();
await algosdk.waitForConfirmation(c, txid, 4);
const a = await c.accountInformation(dep).do();
console.log('scraped', pairs.length, 'wallets; DEPLOYER', Number(a.amount)/1e6, 'free', (Number(a.amount)-Number(a.minBalance))/1e6, 'txid', txid);
