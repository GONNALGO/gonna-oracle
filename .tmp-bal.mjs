import * as algosdkNS from 'algosdk';
const algosdk = algosdkNS.default ?? algosdkNS;
import { readFileSync } from 'node:fs';
const s = JSON.parse(readFileSync('contracts/quantum-arena/deploy/mainnet.secrets.json','utf8'));
const idx = new algosdk.IndexerClient('', 'https://mainnet-idx.algonode.cloud', '');
for (const r of ['DEPLOYER','PLAYER_QA2','PLAYER_QA3','PLAYER_QA4','ORACLE']) {
  const a = algosdk.mnemonicToSecretKey(s[r].mnemonic).addr.toString();
  try {
    const acct = await idx.lookupAccountByID(a).do();
    const h = (acct.account.assets||[]).find(x=>x['asset-id']===2582294183);
    console.log(r, a.slice(0,10), 'ALGO', acct.account.amount/1e6, 'GONNA', (h?h.amount:0)/1e6);
  } catch(e){ console.log(r, a.slice(0,10), 'ERR', e.message); }
}
