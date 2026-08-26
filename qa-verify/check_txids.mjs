import algosdk from 'algosdk';
const idx = new algosdk.Indexer('', 'https://testnet-idx.algonode.cloud', '');
const ASA = 769688287n;
for (const txid of ['J4PTZ44VZC5IRQ63IIRL4Z5JBZVMSKPCTC3P53TXSOUXYTOU2PFA','ZFTTHHA2N6XBWMXSW65RFWTV5K7Q3MINZW7M7ACFHOWSM3LNPOFA']) {
  const t = await idx.lookupTransactionByID(txid).do();
  const tx = t.transaction;
  console.log('=== ', txid);
  console.log('round', tx.confirmedRound, 'sender', tx.sender, 'type', tx.txType);
  const ac = tx.applicationTransaction;
  if (ac) {
    console.log('app', ac.applicationId, 'args', (ac.applicationArgs||[]).map(a=>Buffer.from(a,'base64').toString('hex').slice(0,40)));
    console.log('boxes', JSON.stringify(ac.boxes));
  }
  const inner = tx.innerTxns || [];
  console.log('inner txns:', inner.length);
  for (const it of inner) {
    if (it.txType==='axfer') {
      const a = it.assetTransferTransaction;
      console.log('  axfer asset', a.assetId.toString(), 'amount', a.amount.toString(), '->', a.receiver);
    } else if (it.txType==='pay') {
      const p = it.paymentTransaction;
      console.log('  pay amount', p.amount.toString(), '->', p.receiver);
    } else console.log('  ', it.txType);
  }
  // logs (events)
  for (const l of (tx.logs||[])) console.log('  log', Buffer.from(l,'base64').toString('hex'));
}
