import algosdk from 'algosdk';

const APP = 769767443n;
const ASA = 769688287n;
const idx = new algosdk.Indexer('', 'https://testnet-idx.algonode.cloud', '');
const algod = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', '');

const addr = algosdk.getApplicationAddress(Number(APP));
console.log('APP ADDRESS:', addr.toString());

const acct = await algod.accountInformation(addr).do();
console.log('APP ALGO balance:', acct.amount, 'min-balance:', acct.minBalance);
const holding = (acct.assets||[]).find(a => BigInt(a.assetId) === ASA);
console.log('APP GONNA holding:', holding ? holding.amount : 'NOT OPTED IN');

// list boxes
const boxes = await algod.getApplicationBoxes(Number(APP)).do();
console.log('BOX COUNT:', boxes.boxes.length);
const names = boxes.boxes.map(b => Buffer.from(b.name).toString('hex'));
// find cid56 boxes: prefix 'm'/'p' + itob(56)
const key = (p, cid) => Buffer.concat([Buffer.from(p), (()=>{const b=Buffer.alloc(8); b.writeBigUInt64BE(BigInt(cid)); return b;})()]);
const m56 = key('m',56), p56 = key('p',56);
console.log('has m56:', names.includes(m56.toString('hex')), 'has p56:', names.includes(p56.toString('hex')));
// list all box ids present
const cids = new Set();
for (const b of boxes.boxes) {
  const n = Buffer.from(b.name);
  if (n.length === 9) cids.add(n[0] + ':' + Number(n.readBigUInt64BE(1)));
}
console.log('BOXES BY CID:', [...cids].sort().join(' '));

async function box(name) {
  try { const r = await algod.getApplicationBoxByName(Number(APP), name).do(); return Buffer.from(r.value); }
  catch(e){ return null; }
}
const mv = await box(m56);
if (mv) {
  console.log('META56 len', mv.length, 'hex', mv.toString('hex'));
  // known offsets from TEAL: stake@2, paid_total@62, mbr_paid@70, creator@78
  console.log('stake@2 =', mv.readBigUInt64BE(2).toString());
  console.log('paid_total@62 =', mv.readBigUInt64BE(62).toString());
  console.log('mbr_paid@70 =', mv.readBigUInt64BE(70).toString());
  console.log('creator@78 =', algosdk.encodeAddress(mv.subarray(78,110)));
  // scan for plausible unix timestamps (2025-2026)
  for (let off=0; off+8<=mv.length; off++) {
    const v = mv.readBigUInt64BE(off);
    if (v > 1760000000n && v < 1820000000n) console.log('plausible timestamp@'+off, v.toString(), new Date(Number(v)*1000).toISOString());
  }
}
const pv = await box(p56);
if (pv) {
  console.log('PLAYERS56 len', pv.length, 'n =', pv.readUInt16BE(0));
  const n = pv.readUInt16BE(0);
  for (let i=0;i<n;i++){
    // PlayerEntry: addr 32 (dynamic?) — dump raw chunk
    console.log('entry', i, pv.subarray(2+i*55, 2+(i+1)*55).toString('hex'));
  }
}
// status scan: small uints 0..4
if (mv) for (let off=0; off+8<=mv.length; off++) {
  const v = mv.readBigUInt64BE(off);
  if (v <= 13n) console.log('small uint@'+off, v.toString());
}
