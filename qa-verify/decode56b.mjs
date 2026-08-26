import algosdk from 'algosdk';
const APP = 769767443;
const algod = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', '');
const key = (p, cid) => Buffer.concat([Buffer.from(p), (()=>{const b=Buffer.alloc(8); b.writeBigUInt64BE(BigInt(cid)); return b;})()]);
const pv = Buffer.from((await algod.getApplicationBoxByName(APP, key('p',56)).do()).value);
const n = pv.readUInt16BE(0);
const hdr = 2 + 2*n;
const starts = [hdr];
for (let i=1;i<n;i++) starts.push(2+pv.readUInt16BE(2+2*i));
starts.push(pv.length);
console.log('players:', n, 'hdr', hdr, 'starts', starts);
for (let i=0;i<n;i++){
  const s = starts[i], e = starts[i+1];
  const entry = pv.subarray(s,e);
  const addrOff = entry.readUInt16BE(0);
  const score = entry.readBigUInt64BE(2);
  const signed = entry[10];
  const seated = entry.readBigUInt64BE(11);
  const alen = entry.readUInt16BE(addrOff);
  const addr = algosdk.encodeAddress(entry.subarray(addrOff+2, addrOff+2+alen));
  console.log(`seat ${i}: score=${score} signed=0x${signed.toString(16)} seated=${seated} (${new Date(Number(seated)*1000).toISOString()}) addr=${addr}`);
}
const mv = Buffer.from((await algod.getApplicationBoxByName(APP, key('m',56)).do()).value);
const u = o => mv.readBigUInt64BE(o);
console.log('meta: stake',u(2).toString(),'seats_total',u(10).toString(),'seats_taken',u(18).toString(),'deadline',u(26).toString(),new Date(Number(u(26))*1000).toISOString(),'stage_mode',u(34).toString(),'creator_score',u(42).toString(),'status',u(50).toString(),'paid_total',u(62).toString(),'mbr',u(70).toString());
console.log('dynoff@0', mv.readUInt16BE(0), 'creator', algosdk.encodeAddress(mv.subarray(80,112)));
