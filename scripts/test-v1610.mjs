// GONNA FIGHT v16.1.0 — M2-2 CLIENT: GIL v2 + seeded FULL RUN campaign.
//   [0] source guards (recorder da play, v=2, runSeed wiring)
//   [1] CODEC v2: encode emits v2, decode accepts v1+v2, cap 300k in decode
//   [2] RECORDER DA PLAY: intro frames never recorded; recorder masks are
//       byte-identical to the fed stream; the SEALED log (v2, 'RUN-<cid>')
//       replays headless to the EXACT same score (recorder-vs-harness)
//   [3] TWIN-RUN campaign seedata: same seed+input -> identical simHash+score,
//       different seed -> different run (test-v15-descent pattern -> campaign)
//   [4] CROSS-STAGE twin: stage 1 -> 2 transition mid-run (clear/intro scenes
//       consume NO log frames; scene-aware driver mirrors the replay contract)
//   [5] NEGATIVES: v0/v3 rejected, v1 legacy decodes, frames>cap rejected,
//       non-arena play records nothing, rng outside arenaRun stays mathRng
// Uses the M2-0 harness (oracle-server/replay/) — read-only, nothing patched.
// Run: node scripts/test-v1610.mjs   (ESBUILD_BINARY_PATH=/tmp/esbin/esbuild)
import { readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, total = 0;
const fails = [];
function ok(cond, label) {
  total++;
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { fails.push(label); console.log('  FAIL ' + label); }
}

// ================= [0] SOURCE ==============================================
console.log('\n[0] SOURCE: recorder da play, GIL v=2, seeded campaign wiring');
{
  const eng = readFileSync(join(ROOT, 'src/game/engine.ts'), 'utf8');
  const ui = readFileSync(join(ROOT, 'src/game/arena/arenaUI.ts'), 'utf8');
  const il = readFileSync(join(ROOT, 'src/game/arena/inputLog.ts'), 'utf8');
  ok(eng.includes("if (this.arenaRun && this.inputLogMasks && this.scene === 'play') {"), 'recorder gated on scene===play (intro NEVER in the buffer)');
  ok(eng.includes('v: 2,'), 'engine emits the log header with v=2');
  ok(eng.includes("seedLabel = this.descent ? this.descent.seedLabel : (this.arenaRunSeedLabel ?? 'UNSEEDED')"), 'sealed seedLabel = REAL run seed (UNSEEDED only as fallback)');
  ok(eng.includes("this.arenaRunRng = stageMode === 'full' && opts?.runSeed ? makeRngFromLabel(opts.runSeed) : null;"), 'full-mode arena run seeds ONE campaign stream');
  ok(eng.includes('this.rng = this.arenaRunRng ?? mathRng;'), 'loadStage: seeded stream ONLY inside arenaRun');
  ok(eng.includes('this.arenaRunRng = null; // the seeded campaign stream dies with the run'), 'seeded stream cleared at finishArenaRun');
  ok(eng.includes('debugFullRun(seedLabel: string): void'), 'CI/replay entry: debugFullRun (exact arena full-mode boot)');
  ok(ui.includes("return this.nextIdHint !== null ? 'RUN-' + this.nextIdHint : 'DRAFT-' + this.sealDraftId;"), 'arenaUI runSeedTag: RUN-<cid> (creator, DRAFT fallback)');
  ok(ui.includes("runSeed: 'RUN-' + c.id,"), 'arenaUI joiner runSeed: RUN-<card id>');
  ok(il.includes('export const INPUT_LOG_VERSION = 2;'), 'codec: INPUT_LOG_VERSION = 2');
  ok(il.includes('export const INPUT_LOG_MIN_VERSION = 1;'), 'codec: decode floor v1 (backward compat)');
}

// ================= [1] CODEC v2 ============================================
console.log('\n[1] CODEC: v2 roundtrip, v1 legacy decode, cap enforced');
const BUNDLE_IL = join(ROOT, '.tmp-v1610-inputlog.mjs');
execFileSync('npx', ['esbuild', 'src/game/arena/inputLog.ts', '--bundle', '--format=esm', '--platform=node', `--outfile=${BUNDLE_IL}`], { cwd: ROOT, stdio: 'pipe' });
const il = await import(BUNDLE_IL);
{
  ok(il.INPUT_LOG_VERSION === 2 && il.INPUT_LOG_CAP === 300000, 'VERSION=2, CAP=300000');
  const masks = new Uint8Array(5000);
  let x = 0x9e3779b9;
  for (let i = 0; i < masks.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; masks[i] = x & 255; }
  const log = { v: 2, build: 'v1610test', seedLabel: 'RUN-4242', frames: masks.length, truncated: false, masks };
  const enc = il.encodeInputLog(log);
  ok(enc[3] === 2, 'encode ALWAYS emits version byte 2');
  const back = il.decodeInputLog(enc);
  ok(back.v === 2 && back.build === log.build && back.seedLabel === 'RUN-4242' && back.frames === 5000 && !back.truncated, 'v2 roundtrip: header identical');
  ok(back.masks.length === 5000 && back.masks.every((v, i) => v === masks[i]), 'v2 roundtrip: mask bytes identical');
  // v1 legacy: same layout, version byte 1 -> decodes (server treats as legacy)
  const legacy = enc.slice();
  legacy[3] = 1;
  const back1 = il.decodeInputLog(legacy);
  ok(back1.v === 1 && back1.frames === 5000 && back1.seedLabel === 'RUN-4242', 'decode ACCEPTS v1 (backward compat, SPEC-m2 §2)');
  // version rejection
  const throws = (b) => { try { il.decodeInputLog(b); return false; } catch { return true; } };
  const v0 = enc.slice(); v0[3] = 0;
  const v3 = enc.slice(); v3[3] = 3;
  ok(throws(v0) && throws(v3), 'v0 and v3 rejected as unsupported');
  // cap enforced in DECODE: header claims 300001 frames
  const over = enc.slice();
  new DataView(over.buffer).setUint32(over.length - 4 - 5000, 300001, false);
  ok(throws(over), 'decode rejects frames > 300000 (cap enforced in decode)');
  // encode cap + honest truncation still intact
  const big = new Uint8Array(il.INPUT_LOG_CAP + 100).fill(0xaa);
  const decBig = il.decodeInputLog(il.encodeInputLog({ v: 2, build: 'DEV', seedLabel: 'PIT-1', frames: big.length, truncated: false, masks: big }));
  ok(decBig.frames === il.INPUT_LOG_CAP && decBig.truncated === true, 'over-cap encode: honest cut + truncated flag');
}

// ================= harness (M2-0 spike, read-only) =========================
const replay = await import(join(ROOT, 'oracle-server/replay/replay.mjs'));
const eng = await replay.loadEngine();
const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'];

// scripted brawl: walk right, punch/kick rhythm, hop piles (60fps masks)
function brawlMasks(n, phase = 0) {
  const m = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    let v = 8; // right held
    const q = (f + phase) % 90;
    if (q >= 30 && q < 60) v = 0; // release window
    if (q === 34 || q === 42 || q === 68) v |= 16; // punch
    if (q === 58) v |= 32; // kick
    if (q === 70) v |= 64; // jump
    m[f] = v;
  }
  return m;
}

// suicide run: march right (hopping obstacles), never swing — the wave mob
// does the rest. THE DESCENT kills the idle-ish fighter reliably.
function deathMasks(n) {
  const m = new Uint8Array(n);
  for (let f = 0; f < n; f++) { m[f] = 8; if (f % 90 === 70) m[f] = 8 | 64; }
  return m;
}

// scene-aware driver for FULL campaign replays (mirrors the SPEC-m2 §5/§6
// replay contract: log frames are PLAY-scene frames ONLY — intro consumes no
// mask (debugSim-equivalent skip), the clear tally auto-advances on START
// the instant the bonus lands, exactly like a player mashing START).
function replayCampaign(game, masks, { god = false, killEvery = 0 } = {}) {
  const down = game.input.down;
  const pressed = game.input.pressed;
  const hashes = [];
  let i = 0, steps = 0;
  while (i < masks.length) {
    if (++steps > masks.length * 4 + 20000) throw new Error('driver stuck in non-play scene');
    const sc = game.scene;
    if (sc === 'intro') { game.step(); continue; } // faithful 151-frame title card (D-E2E)
    if (sc === 'clear' || sc === 'victory') { game.input.pressed.start = true; game.step(); continue; }
    if (sc !== 'play') { game.step(); continue; }
    const m = masks[i++];
    for (let b = 0; b < 8; b++) {
      const v = ((m >> b) & 1) === 1;
      if (v && !down[BTNS[b]]) pressed[BTNS[b]] = true;
      down[BTNS[b]] = v;
    }
    if (god) {
      game.player.hp = game.player.maxHp;
      if (game.player.state === 'dead') { game.player.state = 'getup'; game.player.t = 0; }
    }
    if (killEvery > 0 && i % killEvery === 0) game.debugKillEnemies();
    game.step();
    if (i % 60 === 0) hashes.push(game.simHash());
  }
  return { hashes, score: game.score, playFrames: i, steps, stageIdx: game.stageIdx };
}

// ================= [2] RECORDER DA PLAY ====================================
console.log('\n[2] RECORDER: intro never recorded, sealed v2 log replays to the same score');
{
  const g = replay.bootGame(eng);
  g.debugFullRun('RUN-4242');
  ok(g.scene === 'intro' && g.arenaRunSeedLabel === 'RUN-4242', 'debugFullRun boots the arena full-mode path with RUN-4242');
  ok(g.rng !== null && g.arenaRunRng !== null, 'seeded campaign stream installed');
  for (let f = 0; f < 100; f++) g.step(); // intro title card (auto-advances at 150)
  ok(g.inputLogFrames === 0 && g.scene === 'intro', '100 intro frames stepped: ZERO recorded (record-da-play)');
  const masks = brawlMasks(1800);
  const live = replay.replayMasks(g, masks, { god: true });
  ok(g.inputLogFrames === masks.length, 'every PLAY frame recorded exactly once (' + g.inputLogFrames + '/' + masks.length + ')');
  const rec = g.inputLogMasks.subarray(0, g.inputLogFrames);
  ok(rec.every((v, i) => v === masks[i]), 'recorded masks byte-identical to the fed stream');
  // harness equivalence: fresh game, same seed, replay the RECORDED stream
  const g2 = replay.bootGame(eng);
  g2.debugFullRun('RUN-4242');
  const rep = replay.replayMasks(g2, rec, { god: true });
  ok(rep.score === live.score && rep.hashes.join() === live.hashes.join(), 'recorded log replays to identical simHash+score (' + live.score + ')');

  // sealed header (full run): finishArenaRun emits v2 + the REAL RUN-<cid>
  const f = replay.bootGame(eng);
  f.debugFullRun('RUN-4242');
  replay.replayMasks(f, brawlMasks(600), { god: true });
  f.finishArenaRun();
  const sealedF = f.arena.sealedRun;
  ok(!!sealedF && sealedF.seedLabel === 'RUN-4242', 'sealed FULL RUN carries the REAL seedLabel RUN-4242');
  const decF = il.decodeInputLogB64(sealedF.inputLogB64);
  ok(decF.v === 2 && decF.frames === 600 && decF.build === sealedF.build, 'sealed full-run log: v=2, 600 play frames, build pinned');

  // death path (stage run): idle in THE DESCENT -> mobbed -> sealed v2 + PIT-<cid>
  const d = replay.bootGame(eng);
  d.startArenaRun('stage', 2, { seedTag: 'PIT-9001' });
  replay.replayMasks(d, deathMasks(30000));
  ok(d.scene === 'arena', 'idle descent run dies and seals to the ARENA (scene=' + d.scene + ')');
  const sealed = d.arena.sealedRun;
  ok(!!sealed && sealed.seedLabel === 'PIT-9001', 'sealed stage run carries the REAL seedLabel PIT-9001');
  const dec = il.decodeInputLogB64(sealed.inputLogB64);
  ok(dec.v === 2 && dec.frames === sealed.frames && dec.frames > 0, 'sealed log header: v=2, frames=' + dec.frames);
  const d2 = replay.bootGame(eng);
  d2.startArenaRun('stage', 2, { seedTag: 'PIT-9001' });
  replay.replayMasks(d2, dec.masks);
  ok(d2.score === d.score && d2.scene === 'arena', 'sealed death run replays to the EXACT same score (' + d.score + ')');
}

// ================= [3] TWIN-RUN campaign seedata ===========================
console.log('\n[3] TWIN-RUN: seeded FULL RUN determinism (campaign, god brawl)');
{
  const masks = brawlMasks(3600);
  const a = replay.bootGame(eng);
  a.debugFullRun('RUN-7001');
  const ra = replay.replayMasks(a, masks, { god: true });
  const b = replay.bootGame(eng);
  b.debugFullRun('RUN-7001');
  const rb = replay.replayMasks(b, masks, { god: true });
  const c = replay.bootGame(eng);
  c.debugFullRun('RUN-7002');
  const rc = replay.replayMasks(c, masks, { god: true });
  ok(ra.hashes.join() === rb.hashes.join() && ra.score === rb.score, 'RUN-7001 x2: identical 60 hashes + score (' + ra.score + ')');
  ok(ra.hashes.join() !== rc.hashes.join(), 'RUN-7001 vs RUN-7002: different seed -> different campaign');
  ok(ra.score > 0, 'seeded campaign produces an honest score');
}

// ================= [4] CROSS-STAGE twin ====================================
console.log('\n[4] CROSS-STAGE: stage transition mid-run (clear/intro consume no log frames)');
{
  const masks = brawlMasks(24000);
  const a = replay.bootGame(eng);
  a.debugFullRun('RUN-31337');
  const ra = replayCampaign(a, masks, { god: true, killEvery: 240 });
  ok(ra.stageIdx >= 1, 'the run CROSSED a stage boundary (stageIdx=' + ra.stageIdx + ', play=' + ra.playFrames + ', steps=' + ra.steps + ')');
  ok(ra.playFrames === masks.length, 'log-frame alignment preserved across the transition (no mask eaten by clear/intro)');
  const b = replay.bootGame(eng);
  b.debugFullRun('RUN-31337');
  const rb = replayCampaign(b, masks, { god: true, killEvery: 240 });
  ok(ra.hashes.join() === rb.hashes.join() && ra.score === rb.score && ra.stageIdx === rb.stageIdx, 'cross-stage twin: identical hashes+score+stage (' + ra.score + ')');
}

// ================= [5] NEGATIVES / isolation ===============================
console.log('\n[5] NEGATIVES: legacy decode, cap, non-arena isolation');
{
  // non-arena play records NOTHING
  const p = replay.bootGame(eng);
  p.debugDescent(2, 'PIT-42');
  ok(p.descent.seedLabel === 'PIT-42', 'descent.seedLabel keeps the exact PIT-<cid> form');
  replay.replayMasks(p, brawlMasks(600), { god: true });
  ok(p.inputLogFrames === 0 && p.inputLogMasks === null, 'practice descent: recorder stays OFF (no arenaRun)');
  // rng isolation: outside arenaRun no seeded stream is installed
  const m1 = replay.bootGame(eng);
  m1.startNewGame();
  ok(m1.arenaRunRng === null, 'non-arena startNewGame: no seeded stream installed (mathRng path intact)');
  // seedLabel mismatch: a PIT-9001 brawl log replayed under PIT-9999 diverges
  const d = replay.bootGame(eng);
  d.startArenaRun('stage', 2, { seedTag: 'PIT-9001' });
  const good = replay.replayMasks(d, brawlMasks(1800), { god: true });
  const wrong = replay.bootGame(eng);
  wrong.startArenaRun('stage', 2, { seedTag: 'PIT-9999' });
  const bad = replay.replayMasks(wrong, brawlMasks(1800), { god: true });
  ok(good.hashes.join() !== bad.hashes.join() || good.score !== bad.score, 'wrong seed replays to a DIFFERENT outcome (seed binding is real)');
}

rmSync(BUNDLE_IL, { force: true });
// loadEngine temp artifacts (harness convention: generated, never committed)
rmSync(join(ROOT, 'oracle-server/replay/.tmp-replay-entry.ts'), { force: true });
rmSync(join(ROOT, 'oracle-server/replay/.tmp-engine-bundle.mjs'), { force: true });

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
