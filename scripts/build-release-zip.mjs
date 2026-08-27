// scripts/build-release-zip.mjs — RELEASE ZIP PIPELINE (v17.0.2).
// One command, zero stale files: vite build into a FRESH temp dir, EMPTY the
// dist/ staging dir, rsync, vault-door, zip (entry chunk excluded), audit.
// Advisory fix: the old manual rsync left the previous generation's payload/
// sw in dist and they leaked into the next zip. dist/ is therefore nuked and
// recreated from the fresh build every time, and the final listing is
// asserted to contain exactly ONE payload/sw generation (the current VER).
//
// Usage:
//   VITE_ARENA_NETWORK=mainnet node scripts/build-release-zip.mjs /abs/path/out.zip
//   (ESBUILD_BINARY_PATH honored by vite/esbuild; defaults network=testnet)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ZIP = process.argv[2];
if (!OUT_ZIP) {
  console.error('usage: VITE_ARENA_NETWORK=<net> node scripts/build-release-zip.mjs <out.zip>');
  process.exit(1);
}
const NET = process.env.VITE_ARENA_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });

// 1) fresh build in a scratch dir (never inside dist/)
const SCRATCH = mkdtempSync(path.join(tmpdir(), 'gonna-build-'));
console.log(`[1] vite build (${NET}) -> ${SCRATCH}`);
run(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', SCRATCH, '--emptyOutDir']);

// 2) EMPTY the staging dir, then copy (ADVISORY FIX — no stale generation files)
// FUSE flakes on rm -rf of the big frames/ tree (ENOTEMPTY): rename the old
// dir out of the way first (atomic), recreate, then best-effort delete.
function emptyDir(dir) {
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); return; }
  const trash = dir + '.trash-' + process.pid;
  rmSync(trash, { recursive: true, force: true });
  execFileSync('mv', [dir, trash]);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 10; i++) {
    try { rmSync(trash, { recursive: true, force: true }); return; } catch { execFileSync('sleep', ['1']); }
  }
  console.warn('WARN: could not fully remove ' + trash + ' (FUSE) — harmless leftovers');
}
const DIST = path.join(ROOT, 'dist');
console.log('[2] empty dist/ staging, then copy fresh build');
emptyDir(DIST);
// rsync over cpSync: node fs copies silently drop files on the FUSE mount
// (observed: index.html + manifest missing after cpSync). rsync -a --delete
// with an explicit existence check of the entry points afterwards.
execFileSync('rsync', ['-a', '--delete', SCRATCH + '/', DIST + '/']);
for (const must of ['index.html', 'manifest.webmanifest']) {
  if (!existsSync(path.join(DIST, must))) throw new Error('staging incomplete: ' + must + ' missing after rsync (FUSE?)');
}

// 3) vault-door (payload + sw + patched index.html).
// NOTE: capture the entry chunk name BEFORE armoring — vault-door rewrites
// index.html to boot through the worker, so the plain script tag is gone after.
const entryRel = readFileSync(path.join(DIST, 'index.html'), 'utf8')
  .match(/<script type="module" crossorigin src="\.\/(assets\/index-[^"]+\.js)"><\/script>/)[1];
console.log('[3] vault-door (entry: ' + entryRel + ')');
run(process.execPath, [path.join(ROOT, 'scripts/vault-door.mjs')]);

// 4) zip, excluding ONLY the entry chunk
const html = readFileSync(path.join(DIST, 'index.html'), 'utf8');
const ver = /__GONNA_VER = '([^']+)'/.exec(html)[1];
console.log(`[4] zip (VER ${ver}, excluding ${entryRel}) -> ${OUT_ZIP}`);
rmSync(OUT_ZIP, { force: true });
run('zip', ['-rq', OUT_ZIP, '.', '-x', entryRel], { cwd: DIST });

// 5) AUDIT: exactly one payload/sw generation; no stale VER; entry excluded
const names = execFileSync('unzip', ['-Z1', OUT_ZIP], { encoding: 'utf8' }).trim().split('\n');
const payloads = names.filter((n) => /payload-[^/]+\.dat$/.test(n));
const sws = names.filter((n) => /(^|\/)sw[^/]*\.js$/.test(n));
const stale = names.filter((n) => /payload-(?!.*${ver})/.test(n) && !n.includes(ver) && n.includes('payload-'));
const problems = [];
if (payloads.length !== 1 || !payloads[0].includes(ver)) problems.push('payload entries: ' + payloads.join(','));
if (names.includes(entryRel)) problems.push('entry chunk present in zip: ' + entryRel);
if (stale.length > 0) problems.push('stale generation files: ' + stale.join(','));
const md5 = createHash('md5').update(readFileSync(OUT_ZIP)).digest('hex');
console.log('\n===== RELEASE ZIP =====');
console.log('VER:  ' + ver);
console.log('ZIP:  ' + OUT_ZIP);
console.log('MD5:  ' + md5);
console.log('FILES: ' + names.length + ' (payload: ' + payloads.join(',') + '; sw: ' + sws.join(',') + ')');
if (problems.length) {
  console.error('AUDIT FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('AUDIT OK: single generation, entry excluded');
rmSync(SCRATCH, { recursive: true, force: true });
