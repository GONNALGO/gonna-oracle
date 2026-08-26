// sync-oracle-repo.mjs — push the current oracle-server (incl. EVERY
// replay-bundles/engine-<VER>.mjs) to the public gonna-oracle repo.
// IDEMPOTENT: no changes -> no commit, no push. Run after ANY new VER is
// shipped, BEFORE pointing users at it — otherwise the oracle answers
// 400 BUILD UNKNOWN to every real sign-score (v16.1.1 incident).
//
// Usage:
//   GITHUB_TOKEN=… node scripts/sync-oracle-repo.mjs [--dry-run]
// Auth: GIT_ASKPASS helper or GITHUB_TOKEN env (never in the URL you log).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = 'https://github.com/GONNALGO/gonna-oracle.git';
const SRC = new URL('../oracle-server/', import.meta.url).pathname;
const DRY = process.argv.includes('--dry-run');
// Sync set: CODE + BUILD inputs only. The export repo OWNS its ops files
// (render.yaml without rootDir + starter/disk, DEPLOY-RENDER.md with the
// live URL, README pointer, .env.example, .gitignore) — syncing the
// monorepo copies would clobber them (dry-run lesson).
const INCLUDE = [
  'Dockerfile', '.dockerignore', 'package.json', 'package-lock.json',
  'tsconfig.json', 'tsconfig.typecheck.json', 'vitest.config.ts',
  'src', 'replay', 'replay-bundles', 'scripts', 'test',
];
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

if (!process.env.GITHUB_TOKEN && !process.env.GIT_ASKPASS) {
  console.error('FATAL: set GITHUB_TOKEN (or GIT_ASKPASS) — never inline it in the remote URL');
  process.exit(2);
}

// 1) fresh clone (sandbox /tmp can be wiped anytime — never reuse a clone)
const work = mkdtempSync(join(tmpdir(), 'oracle-sync-'));
const askpass = join(work, 'askpass.sh');
run('sh', ['-c', `printf '#!/bin/sh\\ncase "$1" in\\n*sername*) echo x-access-token;;\\n*) echo "$GITHUB_TOKEN";;\\nesac\\n' > ${askpass} && chmod 0700 ${askpass}`]);
const gitEnv = { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0' };
run('git', ['clone', '--quiet', REPO, work + '/repo'], { env: gitEnv });
const dst = work + '/repo';

// 2) rsync the include set (delete stale files we own, e.g. old bundles are KEPT)
for (const item of INCLUDE) {
  const src = join(SRC, item);
  try {
    statSync(src);
  } catch {
    console.log(`  skip (missing): ${item}`);
    continue;
  }
  run('rsync', ['-a', '--exclude=node_modules', '--exclude=dist', '--exclude=.env', '--exclude=.env.*', '--exclude=!.env.example', '--exclude=*.db*', '--exclude=.tmp-*', src, dst + '/' + (statSync(src).isDirectory() ? '' : '')], {});
}
// rsync copies dirs as dst/<name>/... only when trailing slash is right; normalize:
// (dirs land inside dst already as dst/src, dst/replay-bundles, ...)
// export-specific package.json fixup: Render native runtime must not pick the
// newest node from '>=20' (engines pin lives only in the export repo)
try {
  const pj = JSON.parse(readFileSync(join(dst, 'package.json'), 'utf8'));
  pj.engines = { node: '22.x' };
  run('sh', ['-c', `cat > ${join(dst, 'package.json')} <<'JSONEOF'\n${JSON.stringify(pj, null, 2)}\nJSONEOF`]);
} catch { /* package.json not in sync set */ }

// 3) SECRET SCAN over the whole export. PRECISE, not heuristic: 3-word
// windows from every mnemonic in the deploy secrets file (a generic
// "12 lowercase words" regex false-positives on code comments — dry-run
// lesson) + API-token shapes + private-key headers. The secrets file is
// read locally only, never printed.
const secretsPath = process.env.SECRETS_JSON ?? '/mnt/agents/output/app/contracts/quantum-arena/deploy/testnet.secrets.json';
const windows = [];
try {
  const sec = JSON.parse(readFileSync(secretsPath, 'utf8'));
  const walk = (o) => {
    for (const v of Object.values(o ?? {})) {
      if (typeof v === 'string' && v.trim().split(/\s+/).length >= 12) {
        const w = v.trim().split(/\s+/);
        for (let i = 0; i + 3 <= w.length; i += 10) windows.push(w.slice(i, i + 3).join(' '));
      } else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(sec);
} catch {
  console.log(`  warn: secrets file not readable (${secretsPath}) — scanning token patterns only`);
}
let scan = '';
for (const w of windows) {
  scan += run('sh', ['-c', `grep -rIlF ${JSON.stringify(w)} ${dst} --exclude-dir=.git | head -3 || true`]);
}
scan += run('sh', ['-c', `grep -rInE "ghp_[A-Za-z0-9]{30,}|rnd_[A-Za-z0-9]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY" ${dst} --exclude-dir=.git | head -5 || true`]);
if (scan.trim()) {
  console.error(`FATAL: secret scan hit in the export (${windows.length} mnemonic windows + token patterns) — refusing to push:\n` + scan);
  process.exit(2);
}
console.log(`  secret scan clean (${windows.length} mnemonic windows + token patterns)`);

// 4) commit + push only if changed
run('git', ['-C', dst, 'add', '-A']);
const status = run('git', ['-C', dst, 'status', '--porcelain']);
if (!status.trim()) {
  console.log('oracle repo already in sync — nothing to push');
  process.exit(0);
}
console.log('changed files:\n' + status.trim());
const bundles = readdirSync(join(SRC, 'replay-bundles')).filter((f) => f.startsWith('engine-'));
console.log('replay bundles in sync set: ' + bundles.join(', '));
if (DRY) {
  console.log('--dry-run: not committing/pushing');
  process.exit(0);
}
run('git', ['-C', dst, '-c', 'user.email=qa@gonna.bond', '-c', 'user.name=GONNA QA', 'commit', '-qm', `sync oracle-server from monorepo (${new Date().toISOString().slice(0, 10)}, bundles: ${bundles.join(' ')})`]);
run('git', ['-C', dst, 'push', '--quiet', REPO, 'HEAD:main'], { env: gitEnv, timeout: 240000 });
console.log('PUSHED to gonna-oracle main. Now redeploy Render (POST /v1/services/<id>/deploys) if src/ or bundles changed.');
