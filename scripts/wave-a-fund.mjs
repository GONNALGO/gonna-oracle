// wave-a-fund.mjs — top up QA wallets (ALGO) from DEPLOYER for Wave A.
const { default: algosdk } = await import('algosdk');
import { readFileSync } from 'node:fs';
const sec = JSON.parse(readFileSync(new URL('../contracts/quantum-arena/deploy/testnet.secrets.json', import.meta.url), 'utf8'));
const algod = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', '');
const dep = algosdk.mnemonicToSecretKey(sec.DEPLOYER.mnemonic);
const TARGETS = { PLAYER_A: 2_000_000, PLAYER_B: 2_000_000, ORACLE: 1_000_000, TREASURY: 1_000_000 };
for (const [role, target] of Object.entries(TARGETS)) {
  const a = algosdk.mnemonicToSecretKey(sec[role].mnemonic).addr;
  const bal = Number((await algod.accountInformation(a).do()).amount);
  if (bal >= target) { console.log(`${role}: ${bal / 1e6} ALGO — ok`); continue; }
  const need = target - bal;
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: dep.addr, receiver: a, amount: need, suggestedParams: sp });
  const { txid } = await algod.sendRawTransaction(txn.signTxn(dep.sk)).do();
  await algosdk.waitForConfirmation(algod, txid, 4);
  console.log(`${role}: topped up +${need / 1e6} ALGO (txid ${txid})`);
}
console.log('DEPLOYER ALGO left:', Number((await algod.accountInformation(dep.addr).do()).amount) / 1e6);
