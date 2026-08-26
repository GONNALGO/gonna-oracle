import algosdk from 'algosdk';
const APP = 769767443;
const algod = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', '');

// current chain time
const st={lastRound:0};
const blk=null;


const key = (p, cid) => Buffer.concat([Buffer.from(p), (()=>{const b=Buffer.alloc(8); b.writeBigUInt64BE(BigInt(cid)); return b;})()]);
const pv = Buffer.from((await algod.getApplicationBoxByName(APP, key('p',56)).do()).value);
const n = pv.readUInt16BE(0);
console.log('players:', n);
const offs = [];
for (let i=0;i<n-1;i++) offs.push(pv.readUInt16BE(2+2*i));
// entries start right after header; compute all entry boundaries
const headerLen = 2 + 2*(n-1);
// offsets are absolute from position 0? first entry at headerLen
offs.push(pv.length); // end sentinel
let start = headerLen;
for (let i=0;i<n;i++){
  const end = i<n-1 ? null : pv.length;
  // entry: uint16 addrOff, then static part, addr at addrOff
  const addrOff = pv.readUInt16BE(start);
  const score = pv.readBigUInt64BE(start+2);
  // try signed at start+10 and seated_at at start+11
  const signedA = pv[start+10];
  const seatedA = pv.readBigUInt64BE(start+11);
  const addrLen = pv.readUInt16BE(start+addrOff);
  const addr = algosdk.encodeAddress(pv.subarray(start+addrOff+2, start+addrOff+2+addrLen));
  console.log(`seat ${i}: score=${score} signedByte@+10=0x${signedA.toString(16)} seated_at=${seatedA} (${new Date(Number(seatedA)*1000).toISOString()}) addr=${addr} addrLen=${addrLen}`);
  start = start + (i<n-1 ? (pv.readUInt16BE(2+2*(i+1)) - pv.readUInt16BE(2+2*i)) : (pv.length - start));
}
const mv = Buffer.from((await algod.getApplicationBoxByName(APP, key('m',56)).do()).value);
console.log('meta: stake', mv.readBigUInt64BE(2).toString(), 'seats_total', mv.readBigUInt64BE(10).toString(), 'seats_taken', mv.readBigUInt64BE(18).toString(), 'deadline', mv.readBigUInt64BE(26).toString(), new Date(Number(mv.readBigUInt64BE(26))*1000).toISOString(), 'stage_mode', mv.readBigUInt64BE(34).toString(), 'status@50', mv.readBigUInt64BE(50).toString(), 'paid_total', mv.readBigUInt64BE(62).toString(), 'mbr', mv.readBigUInt64BE(70).toString());
