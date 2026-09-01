import algosdk from 'algosdk';
import fs from 'fs';
const S = JSON.parse(fs.readFileSync('contracts/quantum-arena/deploy/mainnet.secrets.json','utf8'));
const c = new algosdk.Algodv2('', 'https://mainnet-api.4160.nodely.dev', 443);
for (let i=1;i<=12;i++){
  const k = 'QA_G' + String(i).padStart(2,'0');
  const a = algosdk.mnemonicToSecretKey(S[k].mnemonic);
  const info = await c.accountInformation(a.addr).do();
  const gonna = (info.assets||[]).find(x=>Number(x.assetId)===2582294183);
  console.log(k, (Number(info.amount)/1e6).toFixed(3), 'ALGO |', gonna? Number(gonna.amount)/1e6 : 'NO-OPT', 'GONNA | min', Number(info.minBalance)/1e6);
}
const d = algosdk.mnemonicToSecretKey(S.DEPLOYER.mnemonic);
const di = await c.accountInformation(d.addr).do();
const dg = (di.assets||[]).find(x=>Number(x.assetId)===2582294183);
console.log('DEPLOYER', (Number(di.amount)/1e6).toFixed(3), 'ALGO |', dg? Number(dg.amount)/1e6:'NO-OPT', 'GONNA');
