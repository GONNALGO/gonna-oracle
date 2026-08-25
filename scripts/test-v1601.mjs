// GONNA FIGHT v16.0.1 — Il Principe's two screenshot fixes:
//   FIX-1  OFFICIAL Algorand logo: drawAlgoLogo no longer hand-draws a blocky
//          A — the mono official mark (public/brand/algorand-mono-32.png) is
//          lazy-loaded, tinted per context color ('source-in', cached) and
//          drawn pixel-crisp into the same boxes at all 3 call sites.
//   FIX-2  FULL NFT picker: the CREATE CARD wizard shelf paginates (10 cells
//          a page, clamped, PAGE n/m + prev/next hot zones), and the flat
//          GREEN SQUARE fallback is dead — missing/failed portraits become
//          the base GONNA fighter deterministically TINTED by assetId;
//          portraits still in flight get an honest pulsing placeholder.
//          The gate CHOOSE YOUR FIGHTER list gets a touch pager (keyboard
//          always scrolled; thumbs could not pass the first window).
//   [0] source guards · [1] paging math (0/1/10/11/70) · [2] deterministic
//       tint · [3] logo wiring in the real gateui bundle
// Run: node scripts/test-v1601.mjs   (from /mnt/agents/output/app)
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
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
console.log('\n[0] SOURCE: logo swap, shelf paging, tinted fallback, gate pager');
{
  const gu = readFileSync(join(ROOT, 'src/game/gateui.ts'), 'utf8');
  const au = readFileSync(join(ROOT, 'src/game/arena/arenaUI.ts'), 'utf8');
  const sk = readFileSync(join(ROOT, 'src/game/skins.ts'), 'utf8');

  // FIX-1 logo
  ok(gu.includes("'brand/algorand-mono-32.png'"), 'gateui references the official mono logo PNG');
  ok(gu.includes("x.globalCompositeOperation = 'source-in'"), 'tint via offscreen canvas source-in');
  ok(gu.includes('algoLogoTints'), 'per-color tint cache exists');
  ok(gu.includes('ctx.imageSmoothingEnabled = false; // pixel-crisp'), 'logo drawn pixel-crisp');
  ok(gu.includes('if (!algoLogoDead) return; // grace frames'), 'grace frames while the PNG loads (no crash)');
  ok((gu.match(/drawAlgoLogo\(ctx,/g) || []).length === 3, 'all 3 call sites still use drawAlgoLogo (same API)');
  ok(gu.includes('ALGO_ROWS'), 'legacy blocky A kept ONLY as load-failure stand-in');

  // FIX-2 arena shelf
  ok(au.includes("'fpage:prev'") && au.includes("'fpage:next'"), 'shelf pager hot zones fpage:prev/next');
  ok(au.includes("drawText(c, 'PAGE ' + (this.fighterPage + 1) + '/' + pages"), 'PAGE n/m indicator drawn');
  ok(au.includes('this.fighterPage = shelfPageClamp(this.fighterPage, opts.length);'), 'page clamped against the live shelf every draw');
  ok(au.includes('this.fighterPage = 0; // v16.0.1: fresh shelf -> back to page 1'), 'page resets when the shelf is rebuilt (open)');
  ok(!au.includes("o.owned ? info.accent : '#1a1e28'"), 'the flat green accent square is GONE from the shelf');
  ok(au.includes('tintedFighterPortrait(base, pick.assetId)'), 'owned fallback = base GONNA tinted by assetId');
  ok(au.includes('// load FAILED: tinted stand-in below (never the old flat accent square)'), 'failed portrait load -> tinted fallback, documented');
  ok(au.includes('honest LOADING placeholder'), 'honest placeholder while portrait PNGs are in flight');
  ok(au.indexOf("'fpage:prev'") < au.indexOf("id.startsWith('fighter:')"), 'fpage ids handled BEFORE the fighter: prefix (no NaN parse)');

  // skins helpers
  ok(sk.includes('export const SHELF_PAGE = 10;'), 'SHELF_PAGE = 10 (5x2 grid)');
  ok(sk.includes('export function shelfPages') && sk.includes('export function shelfPageClamp'), 'paging helpers exported');
  ok(sk.includes('export function nftHue'), 'deterministic nftHue exported');
  ok(sk.includes('export function tintedFighterPortrait'), 'tintedFighterPortrait exported');
  ok(sk.includes('portraitFailedSet.add(skin)'), 'portrait 404 tracked as FAILED (not forever-loading)');

  // gate pager
  ok(gu.includes("'list:up'") && gu.includes("'list:down'"), 'gate athlete list touch pager hot zones');
  ok(gu.includes('this.rowCur = clamp(this.rowCur + d, 0, n - 1);'), 'gate pager clamped (no wrap), cursor follows');
}

// ================= [1] PAGING MATH (behavioral, real skins.ts) ==============
console.log('\n[1] BEHAVIOR: shelf paging math — 0/1/10/11/70 items, clamp, next/prev, reset');
const SKINS_BUNDLE = join(ROOT, '.tmp-v1601-skins.mjs');
execFileSync('npx', ['esbuild', 'src/game/skins.ts', '--bundle', '--format=esm', '--platform=node', `--outfile=${SKINS_BUNDLE}`], { cwd: ROOT, stdio: 'pipe' });
const S = await import(SKINS_BUNDLE);
{
  ok(S.SHELF_PAGE === 10, 'SHELF_PAGE is 10');
  ok(S.shelfPages(0) === 1, '0 items -> 1 page (empty shelf still renders)');
  ok(S.shelfPages(1) === 1, '1 item -> 1 page');
  ok(S.shelfPages(10) === 1, '10 items -> exactly 1 page');
  ok(S.shelfPages(11) === 2, '11 items -> 2 pages (the whale overflow)');
  ok(S.shelfPages(70) === 7, '70 items -> 7 pages');
  // clamp
  ok(S.shelfPageClamp(0, 11) === 0, 'clamp: page 0 of 2 stays');
  ok(S.shelfPageClamp(1, 11) === 1, 'clamp: page 1 of 2 stays');
  ok(S.shelfPageClamp(-3, 70) === 0, 'clamp: negative -> first page');
  ok(S.shelfPageClamp(99, 70) === 6, 'clamp: past the end -> last page (6 of 7)');
  // next/prev semantics = clamp(page +/- 1) — CLAMPED, no wrap
  const next = (p, n) => S.shelfPageClamp(p + 1, n);
  const prev = (p, n) => S.shelfPageClamp(p - 1, n);
  ok(next(0, 11) === 1 && next(1, 11) === 1, 'next: advances then STOPS at last page (no wrap)');
  ok(prev(1, 11) === 0 && prev(0, 11) === 0, 'prev: retreats then STOPS at first page (no wrap)');
  ok(next(5, 70) === 6 && next(6, 70) === 6 && prev(6, 70) === 5, '70-item whale: full walk to page 7 and back');
  // reset on shelf change: a stale deep page against a small new shelf -> 0/last
  ok(S.shelfPageClamp(6, 5) === 0, 'shelf shrank 70 -> 5 items: stale page 6 resets to 0');
  ok(S.shelfPageClamp(NaN, 70) === 0, 'NaN page (corrupt state) resets to 0');
}

// ================= [2] DETERMINISTIC TINT ===================================
console.log('\n[2] BEHAVIOR: nftHue deterministic, in range, spreading');
{
  ok(S.nftHue(7007) === S.nftHue(7007), 'same assetId -> same hue (7007)');
  ok(S.nftHue(3193890311) === S.nftHue(3193890311), 'same assetId -> same hue (big mainnet id)');
  let inRange = true;
  for (let i = 1; i <= 500; i++) {
    const h = S.nftHue(i);
    if (!(h >= 0 && h < 360 && Number.isInteger(h))) inRange = false;
  }
  ok(inRange, 'hue always an integer in [0,360) for ids 1..500');
  const hues = new Set();
  for (let i = 1; i <= 70; i++) hues.add(S.nftHue(i));
  ok(hues.size >= 40, '70 whale NFTs spread over >= 40 distinct hues (got ' + hues.size + ')');
  ok(S.nftHue(7007) !== S.nftHue(7042), 'fixture ids 7007 vs 7042 tint differently');
  ok(S.tintedFighterPortrait({}, 7007) === null, 'node/CI (no DOM canvas): tint helper returns null, caller falls back untinted — never crashes');
}

// ================= [3] LOGO IN THE REAL BUNDLE ==============================
console.log('\n[3] BUNDLE: official logo wired into the real gateui graph');
const ENTRY = join(ROOT, '.tmp-v1601-entry.ts');
const OUT = join(ROOT, '.tmp-v1601-bundle.mjs');
writeFileSync(ENTRY, "import { drawAlgoLogo } from './src/game/gateui';\nconsole.log(typeof drawAlgoLogo);\n");
execFileSync('npx', ['esbuild', ENTRY, '--bundle', '--format=esm', '--platform=node',
  '--define:import.meta.env.DEV=false', '--define:import.meta.env.PROD=true',
  `--outfile=${OUT}`], { cwd: ROOT, stdio: 'pipe' });
{
  const b = readFileSync(OUT, 'utf8');
  ok(b.includes('brand/algorand-mono-32.png'), 'entry bundle references brand/algorand-mono-32.png (relative path, base ./ + PWA safe)');
  ok(b.includes('source-in'), 'entry bundle carries the source-in tint');
  ok(b.includes('algoLogoTints'), 'entry bundle carries the tint cache');
}
rmSync(ENTRY, { force: true });
rmSync(OUT, { force: true });
rmSync(SKINS_BUNDLE, { force: true });

console.log('\n=================================================');
console.log('RESULT: ' + passed + '/' + total + ' passed');
if (fails.length > 0) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(fails.length === 0 ? 0 : 1);
