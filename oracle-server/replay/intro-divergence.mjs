// ============================================================================
// M2-0 EVIDENCE — the GIL v1 recording window includes the INTRO title card,
// whose length depends on the START button — and START IS NOT IN THE MASK.
// Two runs with the SAME seed and the SAME mask stream but different intro
// lengths MUST diverge: the server cannot recover the live intro length from
// a v1 log. This is a replay-semantics finding (fix: record play-scene-only
// frames, or carry the intro length in the header), not a float issue.
// Run: node oracle-server/replay/intro-divergence.mjs
// ============================================================================
import { loadBundle, bootGame, startDescent, replayMasks } from './replay.mjs';
import { buildTape, tapeToMasks, FRAMES } from './fixtures.mjs';

const eng = await loadBundle(process.env.REPLAY_VER ?? 'v9fe01156');
const masks = tapeToMasks(buildTape(FRAMES), FRAMES);

// run A: intro force-skipped (what replayMasks/debugSim do)
const a = replayMasks((() => { const g = bootGame(eng); startDescent(g, 2, 'PIT-52'); return g; })(), masks);

// run B: the natural intro (150 frames) eats the first 150 mask entries —
// sim starts 150 frames late, so gameplay input lands on different frames
const gB = bootGame(eng);
startDescent(gB, 2, 'PIT-52');
{
  const down = gB.input.down, pressed = gB.input.pressed;
  const BTNS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'jump', 'special'];
  const hashes = [];
  for (let f = 0; f < masks.length; f++) {
    const m = masks[f];
    for (let i = 0; i < 8; i++) {
      const v = ((m >> i) & 1) === 1;
      if (v && !down[BTNS[i]]) pressed[BTNS[i]] = true;
      down[BTNS[i]] = v;
    }
    gB.step(); // no force-skip: 'intro' scene runs its own 150 frames
    if ((f + 1) % 60 === 0) hashes.push(gB.simHash());
  }
  var b = { hashes, score: gB.score };
}
const divergeAt = b.hashes.findIndex((h, i) => h !== a.hashes[i]);
console.log(`same seed, same masks: force-skip vs natural-150f-intro`);
console.log(`  run A hashes[0..2]=${a.hashes.slice(0, 3).join(',')} score=${a.score}`);
console.log(`  run B hashes[0..2]=${b.hashes.slice(0, 3).join(',')} score=${b.score}`);
console.log(divergeAt >= 0
  ? `  DIVERGENCE at hash idx ${divergeAt} (frame ${(divergeAt + 1) * 60}) — intro length MUST be pinned for M2 replay`
  : '  no divergence (unexpected!)');
process.exit(divergeAt >= 0 ? 0 : 1);
