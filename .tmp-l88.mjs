import algosdk from 'algosdk';
const idx = new algosdk.Indexer('', 'https://mainnet-idx.4160.nodely.dev', 443);
const r = await idx.searchForTransactions().applicationID(3686311434).txType('appl').limit(80).do();
for (const t of r.transactions) {
  const args = (t.applicationTransaction?.applicationArgs||[]).map(a=>Buffer.from(a,'base64'));
  if (args.length < 2 || args[1].length !== 8) continue;
  const cid = Number(args[1].readBigUInt64BE());
  if (cid < 79 || cid > 88) continue;
  const inn = t.innerTxns||[];
  const gonna = inn.filter(x=>x.assetTransferTransaction).map(x=>`${Number(x.assetTransferTransaction.amount)/1e6}G->${x.assetTransferTransaction.receiver.slice(0,6)}`);
  const pays = inn.filter(x=>x.paymentTransaction).map(x=>`${Number(x.paymentTransaction.amount)/1e6}A->${x.paymentTransaction.receiver.slice(0,6)}`);
  console.log('cid',cid,'sel',args[0].toString('hex').slice(0,8),'txid',t.id,'|',gonna.join(' '),'|',pays.join(' '));
}
