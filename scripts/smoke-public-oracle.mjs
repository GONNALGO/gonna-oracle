// smoke-public-oracle.mjs — live smoke against the PUBLIC Render oracle.
// (a) honest stage run -> /v1/sign-score 200 + locally-verified signature
// (b) inflated score  -> refused (REPLAY MISMATCH)
// (c) CORS: https://gonna.bond allowed, https://evil.example not allowed
// Usage: ORACLE_BASE=https://gonna-arena-oracle-testnet.onrender.com node scripts/smoke-public-oracle.mjs
const { default: algosdk } = await import('algosdk');

const ORACLE = (process.env.ORACLE_BASE ?? 'https://gonna-arena-oracle-testnet.onrender.com').replace(/\/$/, '');
const BUILD = 'v002d77d0';
const replay = await import('../oracle-server/replay/replay.mjs');
const eng = await replay.loadBundle(BUILD);

const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'];
function brawlStream(n, phase = 0) {
  const m = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    let v = 8;
    const q = (f + phase) % 90;
    if (q >= 30 && q < 60) v = 0;
    if (q === 34 || q === 42 || q === 68) v |= 16;
    if (q === 58) v |= 32;
    if (q === 70) v |= 64;
    m[f] = v;
  }
  return m;
}
function playHonest(stageIdx, seedLabel, phase) {
  const game = replay.bootGame(eng);
  replay.startStageRun(game, stageIdx, seedLabel);
  const stream = brawlStream(7200, phase);
  const down = game.input.down, pressed = game.input.pressed;
  for (let f = 0; f < stream.length && game.inputLogMasks; f++) {
    const m = stream[f];
    for (let b = 0; b < 8; b++) {
      const v = ((m >> b) & 1) === 1;
      if (v && !down[BTNS[b]]) pressed[BTNS[b]] = true;
      down[BTNS[b]] = v;
    }
    game.step();
  }
  const sealed = game.arena?.sealedRun;
  return {
    score: game.score,
    inputLogB64: sealed?.inputLogB64 ?? eng.encodeInputLogB64(Uint8Array.from(game.inputLogMasks.subarray(0, game.inputLogFrames))),
    build: BUILD,
  };
}

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ok', msg); } else { fail++; console.log('  FAIL', msg); } };

console.log(`oracle: ${ORACLE}`);
const health = await (await fetch(`${ORACLE}/v1/health`)).json();
ok(health.ok === true && health.appId === 769907387, `health ok appId=${health.appId} oracle=${health.oracleAddr?.slice(0, 10)}…`);

// (a) honest run -> signature
const run = playHonest(1, 'SMOKE-PUB-1', 5);
console.log(`  honest run: stage 1 score=${run.score}`);
const signer = algosdk.generateAccount();
const res = await fetch(`${ORACLE}/v1/sign-score`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    cid: 999001, seat: 0, addr: signer.addr.toString(), score: run.score,
    stageMode: 'stage', stageIdx: 1, inputLogB64: run.inputLogB64, build: run.build, refId: `smoke-${Date.now()}`,
  }),
});
ok(res.status === 200, `(a) sign-score honest -> ${res.status}`);
if (res.status === 200) {
  const j = await res.json();
  const msg = new Uint8Array(Buffer.from(j.msgB64, 'base64'));
  const sig = new Uint8Array(Buffer.from(j.sigB64, 'base64'));
  ok(algosdk.verifyBytes(msg, sig, health.oracleAddr), '(a) signature verifies against oracle pubkey');
}

// (b) inflated -> mismatch
const res2 = await fetch(`${ORACLE}/v1/sign-score`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    cid: 999002, seat: 0, addr: signer.addr.toString(), score: run.score + 5000,
    stageMode: 'stage', stageIdx: 1, inputLogB64: run.inputLogB64, build: run.build, refId: `smoke2-${Date.now()}`,
  }),
});
const j2 = await res2.json().catch(() => ({}));
ok(res2.status !== 200 && /MISMATCH/i.test(JSON.stringify(j2)), `(b) inflated -> ${res2.status} ${j2.error ?? ''}`);

// (c) CORS
const pre1 = await fetch(`${ORACLE}/v1/sign-score`, {
  method: 'OPTIONS',
  headers: { Origin: 'https://gonna.bond', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
});
const allow1 = pre1.headers.get('access-control-allow-origin');
ok(pre1.status < 400 && (allow1 === 'https://gonna.bond' || allow1 === '*'), `(c) gonna.bond preflight -> allow-origin: ${allow1}`);
const pre2 = await fetch(`${ORACLE}/v1/sign-score`, {
  method: 'OPTIONS',
  headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
});
const allow2 = pre2.headers.get('access-control-allow-origin');
ok(allow2 !== 'https://evil.example' && allow2 !== '*', `(c) evil.example preflight -> allow-origin: ${allow2 ?? '(none)'}`);

console.log(`\nSMOKE: ${pass} pass ${fail} fail`);
process.exit(fail ? 1 : 0);
