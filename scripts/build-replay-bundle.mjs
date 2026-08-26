// ============================================================================
// M2 — build the PINNED replay engine bundle for a client build <VER>
// (SPEC-m2 §6). esbuild (platform=node, format=esm) of the M2-0 spike entry:
// Game + buildArt + GIL codec + rng/hashSeed -> oracle-server/replay-bundles/
// engine-<VER>.mjs. The oracle server replays sign-score logs against the
// bundle matching the log's `build` header; bundles are committed per release
// (pipeline: after vault-door emits the VER, run this and commit the file).
//
// Usage:
//   node scripts/build-replay-bundle.mjs <VER>          # e.g. vc053ce23
//   node scripts/build-replay-bundle.mjs --from-dist    # VER = entry-chunk hash of dist/
// Sandbox: ESBUILD_BINARY_PATH=/tmp/esbin/esbuild (see oracle-server README).
// ============================================================================
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'oracle-server/replay-bundles');
const ENTRY = path.join(ROOT, 'oracle-server/replay/.tmp-bundle-entry.ts');

function verFromDist() {
  const html = readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8');
  const m = /assets\/(index-[^"]+\.js)/.exec(html);
  if (!m) throw new Error('cannot locate entry chunk in dist/index.html — run vite build first');
  const chunk = readFileSync(path.join(ROOT, 'dist/assets', m[1]));
  return 'v' + createHash('sha256').update(chunk).digest('hex').slice(0, 8);
}

const arg = process.argv[2];
const VER = arg === '--from-dist' ? verFromDist() : arg;
if (!VER || !/^[\w.-]+$/.test(VER)) {
  console.error('usage: node scripts/build-replay-bundle.mjs <VER|--from-dist>');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  ENTRY,
  "// M2 replay bundle entry (SPEC-m2 §6) — generated, never committed\n" +
    "export { Game } from '../../src/game/engine';\n" +
    "export { buildArt } from '../../src/game/sprites';\n" +
    "export { decodeInputLog, decodeInputLogB64, encodeInputLog, encodeInputLogB64, maskFromDown, INPUT_LOG_CAP } from '../../src/game/arena/inputLog';\n" +
    "export { hashSeed, makeRng, makeRngFromLabel } from '../../src/game/rng';\n",
);

const out = path.join(OUT_DIR, `engine-${VER}.mjs`);
try {
  execFileSync(
    'npx',
    [
      'esbuild',
      ENTRY,
      '--bundle',
      '--format=esm',
      '--platform=node',
      '--define:import.meta.env={"DEV":false,"PROD":true,"VITE_QA_ORACLE":""}',
      `--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
      `--outfile=${out}`,
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
} finally {
  rmSync(ENTRY, { force: true });
}
console.log(`replay bundle written: ${path.relative(ROOT, out)}`);
