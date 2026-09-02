// v18.1 UNIT — wallet.ts soft session (Prince: "il mobile non deve mai
// disconnettersi"). Bundled with esbuild; heavy UI imports stubbed.
//   (a) remote WC 'disconnect' event -> identity KEPT (soft), no listener kick
//   (b) background heal re-pairs when the WC session is still alive
//   (c) explicit disconnect() -> full wipe (the ONLY logout)
//   (d) recoverSession() failure (mobile offline) -> identity KEPT, soft state
//   (e) recoverSession() success -> re-paired, soft cleared
//   (f) signTransactions on a soft-dead session silently re-pairs FIRST
//   (g) boot restore with an expired session -> soft state, address kept
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// ---- stub module for UI-heavy imports ----
writeFileSync('/tmp/repo/.tmp-wallet-stubs.mjs', `
export const isGonnaName = () => true;
export const loadSkinMap = async () => {};
export const skinForAsset = () => null;
export const maybeSovereign = () => {};
export const b64ToBytes = (s) => new Uint8Array(0);
export const bytesToB64 = () => '';
export const arenaUsesTestnetChain = () => false;
export const adoptTestnetAddress = () => {};
export const clearTestnetAddress = () => {};
`);

writeFileSync('/tmp/repo/.tmp-wallet-esbuild.mjs', `
import { build } from '/tmp/repo/node_modules/esbuild/lib/main.js';
const stub = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /\\/(skins|sovereign|b64)$/ }, () => ({ path: '/tmp/repo/.tmp-wallet-stubs.mjs' }));
    b.onResolve({ filter: /arena\\/(chainAdapter|testnetWallet)$/ }, () => ({ path: '/tmp/repo/.tmp-wallet-stubs.mjs' }));
  },
};
await build({
  entryPoints: ['/tmp/repo/src/game/wallet.ts'],
  bundle: true, format: 'esm', platform: 'node',
  outfile: '/tmp/repo/.tmp-wallet-v181.mjs',
  plugins: [stub], logLevel: 'silent',
  define: { 'import.meta.env.VITE_ARENA_NETWORK': 'undefined' },
});
`);
execFileSync('node', ['/tmp/repo/.tmp-wallet-esbuild.mjs'], { stdio: 'pipe' });

// ---- browser-ish shims ----
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};
globalThis.document = undefined;
globalThis.fetch = async () => { throw new Error('offline'); };


const wallet = await import('/tmp/repo/.tmp-wallet-v181.mjs');

let passed = 0, total = 0;
const fails = [];
function ok(cond, label) {
  total++;
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { fails.push(label); console.log('  FAIL ' + label); }
}
const ADDR = 'TESTWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fake Pera-ish lib with a controllable WC session
function mkLib(behavior) {
  const cbs = {};
  return {
    behavior,
    cbs,
    async connect() { this.behavior.alive = true; return [ADDR]; },
    async reconnectSession() { return this.behavior.alive ? [ADDR] : []; },
    async disconnect() { this.behavior.alive = false; },
    async signTransaction() { if (!this.behavior.alive) throw new Error("Cannot read properties of null (reading 'sendCustomRequest')"); return [new Uint8Array(8)]; },
    connector: { on: (ev, cb) => { cbs[ev] = cb; } },
  };
}

let kicked = 0;
wallet.onSessionEnded(() => kicked++);

// ---- (a)+(b): remote disconnect keeps identity, background heal re-pairs ----
{
  const lib = mkLib({ alive: true });
  wallet.__testSetLib('pera', lib);
  await wallet.connect('pera');
  ok(wallet.getWallet().address === ADDR, '(a) connected');
  lib.behavior.alive = true; // the wallet app "kills" it but the session resumes
  lib.cbs.disconnect(); // remote WC event
  await sleep(50); // background heal runs
  const w = wallet.getWallet();
  ok(w.address === ADDR, '(a) remote disconnect: identity KEPT (got ' + w.address + ')');
  ok(kicked === 0, '(a) engine NOT kicked to connect scene');
  ok(w.sessionDead === false, '(b) background heal re-paired silently');
}

// ---- (c): explicit disconnect wipes ----
{
  const lib = mkLib({ alive: true });
  wallet.__testSetLib('pera', lib);
  await wallet.connect('pera');
  await wallet.disconnect();
  const w = wallet.getWallet();
  ok(w.address === null && store.get('gonna.wallet') === undefined, '(c) explicit disconnect = full wipe');
  ok(kicked === 1, '(c) wipe notifies the engine (back to connect scene)');
}

// ---- (d): recoverSession failure keeps identity (mobile offline) ----
{
  const lib = mkLib({ alive: true });
  wallet.__testSetLib('pera', lib);
  await wallet.connect('pera');
  lib.behavior.alive = false; // wedged
  lib.connect = async () => { throw new Error('offline'); }; // re-pair impossible
  let threw = false;
  try { await wallet.recoverSession(); } catch { threw = true; }
  const w = wallet.getWallet();
  ok(threw, '(d) failed recovery throws (caller shows the error)');
  ok(w.address === ADDR && w.sessionDead === true, '(d) identity KEPT in soft state after failed recovery');
  ok(store.get('gonna.wallet') !== undefined, '(d) persisted session KEPT (all pages recognize the wallet)');
}

// ---- (e): recoverSession success clears soft ----
{
  const lib = mkLib({ alive: false });
  wallet.__testSetLib('pera', lib);
  await wallet.rePairWallet(); // soft -> connect: reconnect [] then fresh connect()
  const w = wallet.getWallet();
  ok(w.address === ADDR && w.sessionDead === false, '(e) re-pair from soft state works');
}

// ---- (f): sign on soft-dead silently re-pairs FIRST ----
{
  const lib = mkLib({ alive: false });
  wallet.__testSetLib('pera', lib);
  // force soft state: persisted session, dead WC
  store.set('gonna.wallet', JSON.stringify({ provider: 'pera', address: ADDR }));
  wallet.init();
  await sleep(80); // boot restore: reconnectSession [] -> soft
  let w = wallet.getWallet();
  ok(w.address === ADDR && w.sessionDead === true, '(g) boot with expired session = soft, address kept');
  lib.behavior.alive = true; // wallet app back online
  const sig = await wallet.signTransactions([[{ x: 1 }]]);
  ok(sig.length === 1, '(f) sign on soft-dead session healed + signed');
  ok(wallet.getWallet().sessionDead === false, '(f) soft flag cleared by the heal');
}

console.log('\n== ' + passed + '/' + total + ' PASS ==');
process.exit(fails.length ? 1 : 0);
