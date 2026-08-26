// ============================================================================
// M2-0 shared fixtures — the SAME tape/masks/cases drive Prova A (Node) and
// Prova B (browser), so both engines see bit-identical input streams.
// ============================================================================

export const BTN_BIT = { up: 1, down: 2, left: 4, right: 8, punch: 16, kick: 32, jump: 64, special: 128 };

// scripted brawl tape (same rhythm as test-v15-descent), LEVELS ONLY — the
// GIL log records per-frame button levels, so the fixture is built as down
// intervals; rising edges regenerate `pressed` identically on every engine.
export function buildTape(frames) {
  const tape = [];
  const tap = (f, btn, hold = 2) => { tape.push({ f, down: { [btn]: true } }); tape.push({ f: f + hold, down: { [btn]: false } }); };
  for (let f = 0; f < frames; f += 90) {
    tape.push({ f, down: { right: true } });
    tape.push({ f: f + 30, down: { right: false } });
    tap(f + 34, 'punch');
    tap(f + 42, 'punch');
    tap(f + 50, 'kick');
    tape.push({ f: f + 60, down: { right: true } });
    if ((f / 90) % 4 === 2) tap(f + 12, 'jump', 20); // hop street piles
    if ((f / 90) % 7 === 3) tap(f + 20, 'special');
  }
  return tape.sort((a, b) => a.f - b.f);
}

// level tape -> per-frame masks (exactly what the GIL recorder would snapshot)
export function tapeToMasks(tape, frames) {
  const masks = new Uint8Array(frames);
  const level = {};
  let ti = 0;
  for (let f = 0; f < frames; f++) {
    while (ti < tape.length && tape[ti].f <= f) {
      const ev = tape[ti++];
      for (const k of Object.keys(ev.down)) level[k] = ev.down[k];
    }
    let m = 0;
    for (const k of Object.keys(level)) if (level[k]) m |= BTN_BIT[k];
    masks[f] = m;
  }
  return masks;
}

export const FRAMES = 3600; // 60s at 60Hz
export const FRAMES_DEEP = 10800; // 3min god run: waves 3+, carriers, boss
export const CASES = [
  { stageIdx: 2, seedLabel: 'PIT-52' },
  { stageIdx: 4, seedLabel: 'PIT-53' },
  { stageIdx: 0, seedLabel: 'PIT-54' },
  { stageIdx: 6, seedLabel: 'M2SPIKE-DEEP' },
];
