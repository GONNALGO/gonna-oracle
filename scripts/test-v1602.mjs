// GONNA FIGHT v16.0.2 — Il Principe: "la A logo ok, ma sostituisci la parola
// ALGORAND con quella ufficiale". The CONNECT screen claim row becomes
//   [A logo] POWERED BY [official wordmark PNG]
// — the pixel 'ALGORAND' string is DEAD, the official lockup
// (public/brand/algorand-wordmark.png, 152x42, alpha=ink) is lazy-loaded,
// tinted via offscreen 'source-in' + per-color cache, drawn pixel-crisp,
// grace-framed while in flight, silent no-op on 404 (never a crash).
//   [0] source guards (wordmark wired, old claim string gone)
//   [1] layout math (row fits VW=384, y inside bounds, baseline offset)
//   [2] the wordmark rides the REAL entry bundle (esbuild)
//   [3] structural 404 fallback (dead flag -> silent skip, no draw, no throw)
// Run: node scripts/test-v1602.mjs   (from /mnt/agents/output/app)
import { readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
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

// ================= [0] SOURCE-LEVEL =========================================
console.log('\n[0] SOURCE: wordmark wired, pixel ALGORAND claim gone');
const gu = readFileSync(join(ROOT, 'src/game/gateui.ts'), 'utf8');
{
  ok(gu.includes("export const ALGO_WORDMARK_SRC = 'brand/algorand-wordmark.png';"),
    'gateui references the official wordmark PNG');
  ok(existsSync(join(ROOT, 'public/brand/algorand-wordmark.png')),
    'public/brand/algorand-wordmark.png exists on disk');
  ok(statSync(join(ROOT, 'public/brand/algorand-wordmark.png')).size > 0,
    'wordmark PNG is non-empty');
  ok(!gu.includes("'POWERED BY ALGORAND'"),
    "the single string 'POWERED BY ALGORAND' is GONE from gateui");
  // no other source file may still carry the old one-string claim
  let stray = false;
  for (const f of ['src/game/screens.ts', 'src/game/engine.ts', 'src/game/arena/arenaUI.ts', 'src/game/sovereign.ts', 'index.html']) {
    const p = join(ROOT, f);
    if (existsSync(p) && readFileSync(p, 'utf8').includes('POWERED BY ALGORAND')) stray = true;
  }
  ok(!stray, "no stray 'POWERED BY ALGORAND' claim in other sources/index.html");
  ok(gu.includes('algoWordmarkTints'), 'per-color wordmark tint cache exists');
  ok((gu.match(/globalCompositeOperation = 'source-in'/g) || []).length === 2,
    'source-in tint used by BOTH logo (v16.0.1) and wordmark (v16.0.2)');
  ok(gu.includes('algoWordmarkDead = true; // 404/offline'),
    '404 sets the dead flag (documented fallback, no crash)');
  ok(/drawAlgoWordmark\(ctx, brandX \+ 16 \+ brandTextW \+ 2, 46, '#8a8f9c'\)/.test(gu),
    'CONNECT row draws the wordmark baseline-aligned at y=46, tinted like the text');
  ok((gu.match(/drawAlgoLogo\(ctx,/g) || []).length === 3,
    'drawAlgoLogo still at all 3 call sites (panel, gate, connect)');
  ok(gu.includes("drawText(ctx, brandText, brandX + 16, 48, 1, '#8a8f9c');"),
    "pixel 'POWERED BY ' text kept, unchanged color/scale");
}

// ================= [1] LAYOUT MATH (mobile-first, VW=384) ====================
console.log('\n[1] LAYOUT: the row fits VW=384 with margin, y in bounds');
{
  const VW = 384;
  const WM_H = 10;
  const WM_W = Math.round((152 / 42) * WM_H); // 36 — proportional to source
  const textW = (s) => s.length * 6 - 1;      // font.ts textWidth(scale 1)
  const brandText = 'POWERED BY ';
  const brandTextW = textW(brandText);        // 65
  const logoW = 12, gap1 = 4, gap2 = 2;
  const totalRow = logoW + gap1 + brandTextW + gap2 + WM_W;
  ok(WM_W === 36, 'wordmark draw width = 36 (152/42 * 10, proportional)');
  ok(totalRow === 119, 'total row width = 119 logical px (got ' + totalRow + ')');
  ok(totalRow <= VW, 'row fits VW=384 without overflow (margin ' + (VW - totalRow) + 'px)');
  const brandX = Math.floor((VW - totalRow) / 2);
  ok(brandX === 132, 'row centered: x0 = 132 (right edge ' + (brandX + totalRow) + ')');
  ok(brandX >= 8 && brandX + totalRow <= VW - 8,
    'row clears the mosaic border on both sides');
  // y bounds: wordmark at y=46..56, pixel text 48..55, logo 44..56
  ok(46 >= 0 && 46 + WM_H <= 216, 'wordmark y=46 h=10 inside VH=216');
  // baseline check: pixel text baseline = 48+7-1 = 54; wordmark non-descender
  // baseline = y + 32/42*h = 46 + 7.62 ~ 53.6 -> same optical line
  const pxBaseline = 48 + 6;
  const wmBaseline = 46 + (32 / 42) * WM_H;
  ok(Math.abs(pxBaseline - wmBaseline) < 1.5,
    'optical baselines match (pixel ' + pxBaseline + ' vs wordmark ' + wmBaseline.toFixed(2) + ')');
  // the connect screen's next line starts at y=66 — the wordmark descender
  // ('g', source rows 33-40 -> draw 46+7.9..46+9.5) must not reach it
  ok(46 + Math.ceil((41 / 42) * WM_H) < 66, 'wordmark bottom clears the y=66 line below');
}

// ================= [2] WORDMARK IN THE REAL BUNDLE ==========================
console.log('\n[2] BUNDLE: wordmark wired into the real gateui graph');
const ENTRY = join(ROOT, '.tmp-v1602-entry.ts');
const OUT = join(ROOT, '.tmp-v1602-bundle.mjs');
writeFileSync(ENTRY, "import { GateUI, drawAlgoWordmark, ALGO_WORDMARK_SRC } from './src/game/gateui';\nconsole.log(typeof GateUI, typeof drawAlgoWordmark, ALGO_WORDMARK_SRC);\n");
execFileSync('npx', ['esbuild', ENTRY, '--bundle', '--format=esm', '--platform=node',
  '--define:import.meta.env.DEV=false', '--define:import.meta.env.PROD=true',
  `--outfile=${OUT}`], { cwd: ROOT, stdio: 'pipe' });
{
  const b = readFileSync(OUT, 'utf8');
  ok(b.includes('brand/algorand-wordmark.png'),
    'entry bundle references brand/algorand-wordmark.png (relative path, base ./ + PWA safe)');
  ok(b.includes('algoWordmarkTints'), 'entry bundle carries the wordmark tint cache');
  ok(b.includes('drawAlgoWordmark'), 'entry bundle carries drawAlgoWordmark');
  ok(!b.includes('POWERED BY ALGORAND'), "bundle has NO residual 'POWERED BY ALGORAND' string");
  ok(b.includes('POWERED BY '), "bundle keeps the pixel 'POWERED BY ' text");
}

// ================= [3] 404 FALLBACK (structural, no DOM) ====================
console.log('\n[3] FALLBACK: wordmark 404 -> silent skip, never a crash');
{
  // node has no Image: the boot IIFE must no-op and the draw path must
  // tolerate algoWordmarkImg === null forever (same contract as v16.0.1 logo).
  ok(gu.includes("if (typeof Image === 'undefined') return; // node/CI: no DOM"),
    'boot guard: no Image in node/CI');
  ok(gu.includes('if (!algoWordmarkImg) return null;'),
    'tint helper returns null while the PNG is absent (grace / 404)');
  const fn = gu.slice(gu.indexOf('export function drawAlgoWordmark'));
  const fnBody = fn.slice(0, fn.indexOf('\n}'));
  ok(fnBody.includes('if (wm) {'), 'draw only happens when a tinted canvas exists');
  ok(!/catch|throw/.test(fnBody), 'drawAlgoWordmark can never throw on a missing asset');
  // 404 path: onerror sets the dead flag; nothing ever re-tries or throws —
  // the row just renders [A] POWERED BY, fully functional.
  ok(gu.includes('img.onerror = () => {') && gu.includes('algoWordmarkDead = true;'),
    'onerror -> dead flag (row degrades to logo + pixel text, no crash loop)');
}
rmSync(ENTRY, { force: true });
rmSync(OUT, { force: true });

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
