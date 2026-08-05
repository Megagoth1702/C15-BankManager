/**
 * Build the Local Live pack zip for GitHub Releases.
 *
 * Usage: npm run pack:local
 *
 * Output: release-artifacts/C15-BankManager-local.zip
 * (plus an unpacked folder for smoke-testing)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ARTIFACTS = path.join(ROOT, 'release-artifacts');
const STAGE = path.join(ARTIFACTS, 'C15-BankManager-local');
const ZIP_NAME = 'C15-BankManager-local.zip';
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
    name: 'C15 Bank Manager',
    channel: 'local-pack',
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(appDir, 'version.json'), JSON.stringify(payload, null, 2) + '\n');
  return version;
}

function assertLocalBase(indexHtml) {
  // Pages build embeds /C15-BankManager/ — local pack must use relative assets.
  if (indexHtml.includes('/C15-BankManager/')) {
    throw new Error(
      'dist/index.html still references a Pages base path — VITE_BASE=./ build failed',
    );
  }
  if (!indexHtml.includes('./assets/') && !indexHtml.includes('assets/')) {
    throw new Error('dist/index.html missing assets references');
  }
}

/**
 * Recursively collect files for fflate. Paths use forward slashes (ZIP standard).
 * @returns {Record<string, Uint8Array>}
 */
function collectZipEntries(dir, prefix) {
  /** @type {Record<string, Uint8Array>} */
  const entries = {};
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      Object.assign(entries, collectZipEntries(full, rel));
    } else if (ent.isFile()) {
      entries[rel] = new Uint8Array(fs.readFileSync(full));
    }
  }
  return entries;
}

/** True ZIP local-file header is "PK\x03\x04" (or empty-archive "PK\x05\x06"). */
function assertZipMagic(zipPath) {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const buf = Buffer.alloc(4);
    const n = fs.readSync(fd, buf, 0, 4, 0);
    if (n < 2 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      throw new Error(
        `archive is not a ZIP (magic ${buf.subarray(0, n).toString('hex') || 'empty'}) — ` +
          'Windows Explorer and most tools need a real ZIP, not tar renamed to .zip',
      );
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Write a standard ZIP (PK header) via fflate.
 *
 * Do NOT use GNU tar -a -cf file.zip — on Linux CI that writes a *tar* archive
 * with a .zip name. BSD tar (Windows/macOS) can make real ZIPs; we use fflate
 * so pack output is identical on every OS.
 */
function zipStage(stageDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const base = path.basename(stageDir);
  // Keep top-level folder inside the zip: C15-BankManager-local/...
  const files = collectZipEntries(stageDir, base);
  if (Object.keys(files).length === 0) {
    throw new Error(`nothing to zip under ${stageDir}`);
  }
  const zipped = zipSync(files, { level: 6 });
  fs.writeFileSync(zipPath, zipped);
  assertZipMagic(zipPath);
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
  log('Upload the zip to a GitHub Release as asset name exactly: C15-BankManager-local.zip');
  log('See .ObsidianBrain/Ops/LOCAL_PACK.md for the Releases checklist.');
}

main();
