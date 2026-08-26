import algosdk from 'algosdk';
import nacl from 'tweetnacl';
import { readFileSync } from 'fs';

const APP = 769767443, ASA = 769688287, OPUP = 769688641;
const algod = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', '');
const secrets = JSON.parse(readFileSync('/mnt/agents/output/app/contracts/quantum-arena/deploy/testnet.secrets.json','utf8'));
const oracle = algosdk.mnemonicToSecretKey(secrets.ORACLE.mnemonic);
const treasury = algosdk.mnemonicToSecretKey(secrets.TREASURY.mnemonic);
const appAddr = algosdk.getApplicationAddress(APP);
const signer = acct => algosdk.makeBasicAccountTransactionSigner(acct);

const appInfo = await algod.getApplicationByID(APP).do();
let cid = null;
for (const kv of appInfo.params.globalState)
  if (Buffer.from(kv.key,'base64').toString() === 'next_challenge_id') cid = kv.value.uint;
console.log('next_challenge_id =', cid);
const itob = v => { const b=Buffer.alloc(8); b.writeBigUInt64BE(BigInt(v)); return b; };
const boxKey = (p,c) => new Uint8Array(Buffer.concat([Buffer.from(p), itob(c)]));
const boxes = c => [{appIndex:0,name:boxKey('m',c)},{appIndex:0,name:boxKey('p',c)}];

const score = 1000n;
const msg = Buffer.concat([Buffer.from('QA-SCORE|'), itob(APP), itob(cid), Buffer.from([0]), treasury.addr.publicKey, itob(score)]);
const sig = nacl.sign.detached(new Uint8Array(msg), oracle.sk);

const sp = await algod.getTransactionParams().do();
const spf = f => ({ ...sp, fee: f, flatFee: true });
const tws = txn => ({ txn, signer: signer(treasury) });

// --- GROUP 1: create_challenge (duel, MODE_FULL) ---
const comp1 = new algosdk.AtomicTransactionComposer();
const mbrPay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: treasury.addr, receiver: appAddr, amount: 358200, suggestedParams: spf(1000) });
const stakeAxfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: treasury.addr, receiver: appAddr, assetIndex: ASA, amount: 1000000, suggestedParams: spf(1000) });
for (let i=0;i<3;i++) comp1.addTransaction(tws(algosdk.makeApplicationNoOpTxnFromObject({ sender: treasury.addr, appIndex: OPUP, note: Buffer.from('opup c'+Math.random()+i), suggestedParams: spf(1000) })));
const mCreate = new algosdk.ABIMethod({ name:'create_challenge', args:[{type:'pay'},{type:'axfer'},{type:'uint64'},{type:'uint64'},{type:'uint64'},{type:'uint64'},{type:'byte[]'},{type:'uint64'},{type:'byte[]'}], returns:{type:'uint64'} });
comp1.addMethodCall({ appID: APP, method: mCreate,
  methodArgs: [ tws(mbrPay), tws(stakeAxfer), 1000000n, 1n, 86400n, 0n, new Uint8Array(32), score, sig ],
  sender: treasury.addr, signer: signer(treasury), suggestedParams: spf(2000),
  boxes: boxes(cid), appForeignAssets: [ASA] });
const r1 = await comp1.execute(algod, 4);
console.log('CREATE OK txid=', r1.txIDs.at(-1), 'cid returned=', r1.methodResults.at(-1).returnValue?.toString());

// --- GROUP 2: early_close (exercises _refund_all: box deletes + refund loop) ---
const comp2 = new algosdk.AtomicTransactionComposer();
const feePay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: treasury.addr, receiver: treasury.addr, amount: 1000000, suggestedParams: spf(1000) });
const mClose = new algosdk.ABIMethod({ name:'early_close', args:[{type:'pay'},{type:'uint64'}], returns:{type:'void'} });
comp2.addMethodCall({ appID: APP, method: mClose, methodArgs: [ tws(feePay), BigInt(cid) ],
  sender: treasury.addr, signer: signer(treasury), suggestedParams: spf(4000),
  boxes: boxes(cid), appForeignAssets: [ASA] });
const r2 = await comp2.execute(algod, 4);
console.log('EARLY_CLOSE OK txid=', r2.txIDs[0]);
const rr = await algod.pendingTransactionInformation(r2.txIDs[0]).do();
console.log('inner txns:', (rr.innerTxns||[]).map(t => t.txn.txn.type + ':' + (t.txn.txn.aamt ?? t.txn.txn.amt)).join(', '));
for (const l of (rr.logs||[])) console.log('log', Buffer.from(l,'base64').toString('hex'));
// boxes gone?
try { await algod.getApplicationBoxByName(APP, boxKey('m',cid)).do(); console.log('meta box STILL EXISTS'); }
catch(e){ console.log('meta box deleted (getBoxByName 404)'); }
try { await algod.getApplicationBoxByName(APP, boxKey('p',cid)).do(); console.log('players box STILL EXISTS'); }
catch(e){ console.log('players box deleted (getBoxByName 404)'); }
