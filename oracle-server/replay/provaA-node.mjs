// ============================================================================
// M2-0 PROVA A — Node <-> Node determinism + driver equivalence.
//   A1: same GIL log replayed twice (fresh Game each) -> identical hashes/score
//   A2: raw mask driver == engine's own debugSim(tape) on the same inputs
//   A3: different seed -> different hashes (the seed really drives the sim)
//   A4: god-mode deep run (waves/boss/drone paths) is deterministic too
// Run: node oracle-server/replay/provaA-node.mjs
// ============================================================================
import { loadBundle, bootGame, startDescent, replayMasks, replayGIL, masksToTape, makeGIL } from './replay.mjs';
import { buildTape, tapeToMasks, FRAMES, CASES } from './fixtures.mjs';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  PASS', label); } else { fail++; console.log('  FAIL', label); } };

const eng = await loadBundle(process.env.REPLAY_VER ?? 'v9fe01156');
console.log('engine bundled + booted headless (Node ' + process.version + ', V8 ' + process.versions.v8 + ')');

for (const c of CASES) {
  console.log(`\n== stage ${c.stageIdx} seed ${c.seedLabel} ==`);
  const tape = buildTape(FRAMES);
  const masks = tapeToMasks(tape, FRAMES);
  const gil = await makeGIL({ seedLabel: c.seedLabel, masks, engine: eng });

  // A1: replay the same GIL twice via the raw mask driver
  const r1 = await replayGIL(gil, { stageIdx: c.stageIdx, engine: eng });
  const r2 = await replayGIL(gil, { stageIdx: c.stageIdx, engine: eng });
  ok(JSON.stringify(r1.hashes) === JSON.stringify(r2.hashes), `A1 Node<->Node: ${r1.hashes.length} hashes identical (score ${r1.score}, wave ${r1.wave}, kos ${r1.kos})`);
  ok(r1.score === r2.score && r1.score > 0, `A1 score identical: ${r1.score}`);
  ok(r1.headerFrames === FRAMES && r1.frames === FRAMES, `A1 GIL roundtrip frames: ${r1.frames}`);

  // A2: raw driver == debugSim(tape from the same masks)
  const game = bootGame(eng);
  startDescent(game, c.stageIdx, c.seedLabel);
  const viaSim = game.debugSim({ frames: FRAMES, tape: masksToTape(masks), god: false });
  ok(JSON.stringify(viaSim.hashes) === JSON.stringify(r1.hashes) && viaSim.score === r1.score, 'A2 raw mask driver == debugSim(tape)');

  // A3: another seed must diverge
  const other = await replayGIL(await makeGIL({ seedLabel: c.seedLabel + '-X', masks, engine: eng }), { stageIdx: c.stageIdx, engine: eng });
  ok(JSON.stringify(other.hashes) !== JSON.stringify(r1.hashes), 'A3 different seed => different hashes');

  // A4: god mode — deep sim (waves 3+, carriers, boss, drones), still exact
  const g1 = await replayGIL(gil, { stageIdx: c.stageIdx, god: true, engine: eng });
  const g2 = await replayGIL(gil, { stageIdx: c.stageIdx, god: true, engine: eng });
  ok(JSON.stringify(g1.hashes) === JSON.stringify(g2.hashes) && g1.score === g2.score, `A4 god deep-run deterministic (score ${g1.score}, wave ${g1.wave}, kos ${g1.kos})`);
}

console.log(`\nPROVA A: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
