// airdrop-principe.mjs — one-shot: 10,000 GONNA from DEPLOYER to the Principe's testnet addr.
// Prints ONLY addresses/txid/balances — never keys.
const { default: algosdk } = await import('algosdk');
import { readFileSync } from 'node:fs';

const ASA = 769688287;
const TO = 'GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU';
const AMOUNT = 10_000n * 1_000_000n; // 10,000 GONNA, 6 decimals
const sec = JSON.parse(readFileSync(new URL('../contracts/quantum-arena/deploy/testnet.secrets.json', import.meta.url), 'utf8'));
const algod = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', '');
const indexer = new algosdk.Indexer('', 'https://testnet-idx.algonode.cloud', '');
const deployer = algosdk.mnemonicToSecretKey(sec.DEPLOYER.mnemonic);

const balOf = async (addr) => {
  const r = await indexer.lookupAccountAssets(addr).assetId(ASA).do().catch(() => ({ assets: [] }));
  return r.assets?.[0]?.amount ?? null;
};

// 1) opt-in check on the recipient
const preTo = await balOf(TO);
if (preTo === null) {
  console.log(`RECIPIENT NOT OPTED-IN to ASA ${ASA}: ${TO} — STOP (Principe must opt in)`);
  process.exit(3);
}
const preDep = await balOf(deployer.addr.toString());
console.log(`pre : recipient=${preTo} deployer=${preDep}`);
if (BigInt(preDep) < AMOUNT) {
  console.log('DEPLOYER balance insufficient — STOP');
  process.exit(4);
}

// 2) axfer
const sp = await algod.getTransactionParams().do();
const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
  sender: deployer.addr, receiver: TO, amount: AMOUNT, assetIndex: ASA, suggestedParams: sp,
});
const { txid } = await algod.sendRawTransaction(txn.signTxn(deployer.sk)).do();
await algosdk.waitForConfirmation(algod, txid, 4);
console.log(`txid: ${txid}`);

// 3) verify
const postTo = await balOf(TO);
const postDep = await balOf(deployer.addr.toString());
console.log(`post: recipient=${postTo} deployer=${postDep}`);
console.log(`delta recipient: ${BigInt(postTo) - BigInt(preTo)} base units (expected ${AMOUNT})`);
