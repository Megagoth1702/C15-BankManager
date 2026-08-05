/**
 * Build the Local Live pack zip for GitHub Releases.
 *
 * Usage: npm run pack:local
 *
 * Output: release-artifacts/C15-OPM-local.zip
 * (plus an unpacked folder for smoke-testing)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ARTIFACTS = path.join(ROOT, 'release-artifacts');
const STAGE = path.join(ARTIFACTS, 'C15-OPM-local');
const ZIP_NAME = 'C15-OPM-local.zip';
const LOCAL_PACK_SRC = path.join(ROOT, 'local-pack');

function log(msg) {
  console.log(`[pack:local] ${msg}`);
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (
      ent.name === 'runtime' ||
      ent.name === 'launcher.log' ||
      ent.name === 'launcher.pid' ||
      ent.name === '.update-tmp' ||
      ent.name === 'app.bak' ||
      ent.name === 'launcher.bak'
    ) {
      continue;
    }
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function run(cmd, args, env = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} failed with status ${r.status}`);
  }
}

function writeVersionJson(appDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version || '0.0.0';
  const payload = {
    version,
    name: 'C15 Offline Preset Manager',
    channel: 'local-pack',
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(appDir, 'version.json'), JSON.stringify(payload, null, 2) + '\n');
  return version;
}

function assertLocalBase(indexHtml) {
  // Pages build embeds /C15-OfflinePresetManager/ — local must not
  if (indexHtml.includes('/C15-OfflinePresetManager/')) {
    throw new Error(
      'dist/index.html still references /C15-OfflinePresetManager/ — VITE_BASE=./ build failed',
    );
  }
  if (!indexHtml.includes('./assets/') && !indexHtml.includes('assets/')) {
    throw new Error('dist/index.html missing assets references');
  }
}

function zipStage(stageDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  // tar can create zip on Windows 10+ / macOS / Linux
  const parent = path.dirname(stageDir);
  const base = path.basename(stageDir);
  const r = spawnSync(
    'tar',
    ['-a', '-cf', zipPath, '-C', parent, base],
    { encoding: 'utf8', windowsHide: true },
  );
  if (r.status !== 0) {
    // Fallback: PowerShell Compress-Archive
    if (process.platform === 'win32') {
      const ps = `Compress-Archive -Path '${stageDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
      const r2 = spawnSync(
        'powershell',
        ['-NoProfile', '-Command', ps],
        { encoding: 'utf8', windowsHide: true },
      );
      if (r2.status !== 0) {
        throw new Error(`zip failed: ${r.stderr || r2.stderr || r.status}`);
      }
      return;
    }
    throw new Error(`tar zip failed: ${r.stderr || r.status}`);
  }
}

function main() {
  log('Building local app (VITE_BASE=./)…');
  run('npm', ['run', 'build'], { VITE_BASE: './' });

  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('dist/index.html missing after build');
  }
  const indexHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  assertLocalBase(indexHtml);

  log('Staging pack folder…');
  ensureDir(ARTIFACTS);
  rmrf(STAGE);
  ensureDir(STAGE);

  // Launchers + README from local-pack/
  copyDir(LOCAL_PACK_SRC, STAGE);

  // App web build
  const appDir = path.join(STAGE, 'app');
  copyDir(DIST, appDir);
  const version = writeVersionJson(appDir);

  // Placeholder so users see runtime is created on first run
  const runtimePlaceholder = path.join(STAGE, 'runtime');
  ensureDir(runtimePlaceholder);
  fs.writeFileSync(
    path.join(runtimePlaceholder, 'README.txt'),
    'Portable Node.js is downloaded here on first Start (official nodejs.org build).\n',
  );

  const zipPath = path.join(ARTIFACTS, ZIP_NAME);
  log(`Zipping ${ZIP_NAME}…`);
  zipStage(STAGE, zipPath);

  const buf = fs.readFileSync(zipPath);
  const sha = createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(
    path.join(ARTIFACTS, `${ZIP_NAME}.sha256`),
    `${sha}  ${ZIP_NAME}\n`,
  );

  log('Done.');
  log(`  Version:  ${version}`);
  log(`  Folder:   ${STAGE}`);
  log(`  Zip:      ${zipPath}`);
  log(`  SHA256:   ${sha}`);
  log('');
  log('Upload the zip to a GitHub Release as asset name exactly: C15-OPM-local.zip');
  log('See .ObsidianBrain/Ops/LOCAL_PACK.md for the Releases checklist.');
}

main();
