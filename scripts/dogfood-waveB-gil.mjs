// gil.mjs — Wave B helpers: GIL v2 codec + scene-aware replay driver on the
// PINNED bundles (read-only from the shared repo). Mirrors oracle verify.ts /
// replayer.ts semantics exactly, so local scores == oracle replay scores.
export const REPO = '/mnt/agents/output/app';

const enc = new TextEncoder();
export function gilEncode({ v = 2, build, seedLabel, frames, truncated = false }, masks) {
  const b = enc.encode(build);
  const s = enc.encode(seedLabel);
  const out = new Uint8Array(3 + 1 + 1 + 2 + b.length + 2 + s.length + 4 + frames);
  const dv = new DataView(out.buffer);
  out.set([0x47, 0x49, 0x4c, v, truncated ? 1 : 0], 0);
  dv.setUint16(5, b.length, false);
  out.set(b, 7);
  const p2 = 7 + b.length;
  dv.setUint16(p2, s.length, false);
  out.set(s, p2 + 2);
  const p3 = p2 + 2 + s.length;
  dv.setUint32(p3, frames, false);
  out.set(masks.subarray(0, frames), p3 + 4);
  return out;
}
export const b64e = (u8) => Buffer.from(u8).toString('base64');
export const b64d = (s) => new Uint8Array(Buffer.from(s, 'base64'));

const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'];

// brawl tape: walk right, punch/kick rhythm, hop (same shape as smoke script)
export function brawlStream(n, phase = 0) {
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

// scene-aware driver — verbatim semantics of oracle replayer.replayCampaign
export function replayCampaign(game, masks) {
  const down = game.input.down;
  const pressed = game.input.pressed;
  let i = 0, steps = 0;
  while (i < masks.length) {
    if (++steps > masks.length * 4 + 20000) throw new Error('driver stuck');
    const sc = game.scene;
    if (sc === 'intro') { game.step(); continue; }
    if (sc === 'clear' || sc === 'victory') { game.input.pressed.start = true; game.step(); continue; }
    if (sc !== 'play') { game.step(); continue; }
    const m = masks[i++];
    for (let b = 0; b < 8; b++) {
      const v = ((m >> b) & 1) === 1;
      if (v && !down[BTNS[b]]) pressed[BTNS[b]] = true;
      down[BTNS[b]] = v;
    }
    game.step();
  }
  return { score: game.score, playFrames: i, stageIdx: game.stageIdx };
}

let stubsPromise = null;
export async function loadBundle(ver) {
  const st = await (stubsPromise ??= import(REPO + '/oracle-server/replay/stubs.mjs'));
  st.installBrowserStubs();
  globalThis.__GONNA_VER = ver;
  return import(REPO + '/oracle-server/replay-bundles/engine-' + ver + '.mjs');
}

export function bootStageRun(eng, stageIdx, seedLabel) {
  const st = globalThis.__wavebStubs;
  const canvas = st.makeCanvas();
  const g = new eng.Game(canvas.getContext('2d'), eng.buildArt(), new Map());
  g.startArenaRun('stage', stageIdx, { seedTag: seedLabel });
  return g;
}

export async function initStubs() {
  const st = await import(REPO + '/oracle-server/replay/stubs.mjs');
  globalThis.__wavebStubs = st;
  return st;
}

// honest run factory: drives the tape like the ORACLE driver would (intro
// stepped, tally auto-start), cuts at DEATH — the engine recorder dies with
// the run (inputLogMasks -> null at finishArenaRun), so the log ends exactly
// at the death frame, matching what a real client would seal.
export function playHonest(eng, stageIdx, seedLabel, frames = 7200, phase = 5) {
  const g = bootStageRun(eng, stageIdx, seedLabel);
  const tape = brawlStream(frames, phase);
  const down = g.input.down;
  const pressed = g.input.pressed;
  let fed = 0, steps = 0;
  while (fed < tape.length && g.inputLogMasks) {
    if (++steps > tape.length * 4 + 20000) throw new Error('playHonest stuck');
    const sc = g.scene;
    if (sc === 'intro') { g.step(); continue; }
    if (sc === 'clear' || sc === 'victory') { g.input.pressed.start = true; g.step(); continue; }
    if (sc !== 'play') { g.step(); continue; }
    const m = tape[fed++];
    for (let b = 0; b < 8; b++) {
      const v = ((m >> b) & 1) === 1;
      if (v && !down[BTNS[b]]) pressed[BTNS[b]] = true;
      down[BTNS[b]] = v;
    }
    g.step();
  }
  return { masks: tape.subarray(0, fed), score: g.score, frames: fed, died: !g.inputLogMasks, sealed: g.arena?.sealedRun ?? null };
}

// tolerant replay for ATTACK tapes (bitflipped / foreign-engine): the oracle
// driver would throw ReplayStuckError (-> REPLAY MISMATCH) if the tape kills
// the fighter early; locally we just stop and report what happened.
export function replayTolerant(game, masks) {
  const down = game.input.down;
  const pressed = game.input.pressed;
  let i = 0, steps = 0, stuck = false;
  while (i < masks.length) {
    if (++steps > masks.length * 4 + 20000) { stuck = true; break; }
    const sc = game.scene;
    if (sc === 'intro') { game.step(); continue; }
    if (sc === 'clear' || sc === 'victory') { game.input.pressed.start = true; game.step(); continue; }
    if (sc !== 'play') { game.step(); continue; }
    const m = masks[i++];
    for (let b = 0; b < 8; b++) {
      const v = ((m >> b) & 1) === 1;
      if (v && !down[BTNS[b]]) pressed[BTNS[b]] = true;
      down[BTNS[b]] = v;
    }
    game.step();
  }
  return { score: game.score, consumed: i, stuck, scene: game.scene };
}
