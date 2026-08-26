import algosdk from 'algosdk';
import nacl from 'tweetnacl';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const APP = 769767443;
const CID = 56n;
const algod = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', '');
const secrets = JSON.parse(readFileSync('/mnt/agents/output/app/contracts/quantum-arena/deploy/testnet.secrets.json','utf8'));
const oracle = algosdk.mnemonicToSecretKey(secrets.ORACLE.mnemonic);
const deployer = algosdk.mnemonicToSecretKey(secrets.DEPLOYER.mnemonic);
console.log('oracle addr ok:', oracle.addr.toString() === secrets.ORACLE.address);

const key = (p, cid) => new Uint8Array(Buffer.concat([Buffer.from(p), (()=>{const b=Buffer.alloc(8); b.writeBigUInt64BE(BigInt(cid)); return b;})()]));

// read players box
const pv = Buffer.from((await algod.getApplicationBoxByName(APP, key('p',Number(CID))).do()).value);
const n = pv.readUInt16BE(0);
const hdr = 2 + 2*n;
const starts = [hdr];
for (let i=1;i<n;i++) starts.push(2+pv.readUInt16BE(2+2*i));
starts.push(pv.length);
const entries = [];
for (let i=0;i<n;i++){
  const e = pv.subarray(starts[i], starts[i+1]);
  const addrOff = e.readUInt16BE(0);
  const score = e.readBigUInt64BE(2);
  const signed = e[10];
  const alen = e.readUInt16BE(addrOff);
  entries.push({ score, signed, addr: e.subarray(addrOff+2, addrOff+2+alen) });
}
// digest in seat order, signed only
const parts = [];
for (let i=0;i<n;i++) if (entries[i].signed) {
  parts.push(Buffer.from([i]), Buffer.from(entries[i].addr), (()=>{const b=Buffer.alloc(8); b.writeBigUInt64BE(entries[i].score); return b;})());
}
const digest = createHash('sha256').update(Buffer.concat(parts)).digest();
const itob = v => { const b=Buffer.alloc(8); b.writeBigUInt64BE(BigInt(v)); return b; };
const verdictMsg = Buffer.concat([Buffer.from('QA-VERDICT|'), itob(APP), itob(CID), Buffer.from([0]), Buffer.alloc(32), digest]);
const sig = nacl.sign.detached(new Uint8Array(verdictMsg), oracle.sk);

const m = new algosdk.ABIMethod({ name:'resolve', args:[{type:'uint64'},{type:'uint64'},{type:'byte[]'},{type:'byte[]'}], returns:{type:'byte[]'} });
const sp = await algod.getTransactionParams().do();
const comp = new algosdk.AtomicTransactionComposer();
// 4 NoOp calls to opup budget app: +700 pooled opcode budget each
const OPUP = 769688641;
for (let i=0;i<4;i++) {
  comp.addTransaction({ txn: algosdk.makeApplicationNoOpTxnFromObject({
    sender: deployer.addr, appIndex: OPUP, suggestedParams: { ...sp, fee: 1000, flatFee: true },
    note: Buffer.from(`opup repro ${Math.random()} ${i}`),
  }), signer: algosdk.makeBasicAccountTransactionSigner(deployer) });
}
comp.addMethodCall({
  appID: APP, method: m, methodArgs: [CID, 0n, new Uint8Array(0), sig],
  sender: deployer.addr, signer: algosdk.makeBasicAccountTransactionSigner(deployer),
  suggestedParams: { ...sp, fee: 9000, flatFee: true },
  boxes: [ { appIndex: 0, name: key('m',Number(CID)) }, { appIndex: 0, name: key('p',Number(CID)) } ],
});
const group = comp.buildGroup();

// 1) SIMULATE
const simOk = await (async () => {
  try {
    const simReq = new algosdk.modelsv2.SimulateRequest({
      txnGroups: [ new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns: group.map(t => algosdk.decodeSignedTransaction(algosdk.signTransaction(t.txn, deployer.sk).blob)) }) ],
      allowUnnamedResources: true,
    });
    const r = await algod.simulateTransactions(simReq).do();
    const g = r.txnGroups[0];
    console.log('SIMULATE: failureMessage=', g.failureMessage || 'NONE', 'failedAt=', g.failedAt);
    return !g.failureMessage;
  } catch(e){ console.log('SIMULATE threw:', e.message?.slice(0,300)); return null; }
})();
console.log('simulate passed?', simOk);

// 2) REAL SUBMIT
try {
  const res = await comp.execute(algod, 4);
  console.log('REAL SUBMIT: SUCCESS txid=', res.txIDs[0]);
} catch(e){
  console.log('REAL SUBMIT FAILED:', String(e.message || e).slice(0, 500));
}
