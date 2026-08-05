/**
 * Check GitHub Releases and apply app/launcher updates for the Local Live pack.
 * Fail-open: any error returns without throwing to the caller (logged).
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_ROOT = path.resolve(__dirname, '..');

const REPO = 'Megagoth1702/C15-BankManager';
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const ASSET_NAME = 'C15-BankManager-local.zip';
const USER_AGENT = 'C15-BankManager-LocalPack';

function log(line) {
  const msg = `[update] ${line}`;
  console.log(msg);
  try {
    fs.appendFileSync(path.join(PACK_ROOT, 'launcher.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* ignore */
  }
}

function readLocalVersion() {
  try {
    const p = path.join(PACK_ROOT, 'app', 'version.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return String(j.version || '0.0.0').replace(/^v/i, '');
  } catch {
    return '0.0.0';
  }
}

/** Compare semver-ish a vs b. Returns 1 if a>b, -1 if a<b, 0 if equal/unknown. */
export function compareSemver(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function httpsGetBuffer(url, { timeoutMs = 15000, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/octet-stream, application/json',
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          maxRedirects > 0
        ) {
          res.resume();
          httpsGetBuffer(res.headers.location, {
            timeoutMs,
            maxRedirects: maxRedirects - 1,
          }).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout ${url}`));
    });
    req.on('error', reject);
  });
}

function httpsGetJson(url, timeoutMs = 8000) {
  return httpsGetBuffer(url, { timeoutMs }).then((buf) => JSON.parse(buf.toString('utf8')));
}

function allowedDownloadUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return (
      host === 'github.com' ||
      host.endsWith('.github.com') ||
      host === 'objects.githubusercontent.com' ||
      host.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // Windows 10+ and macOS/Linux ship tar that can extract zip
  const r = spawnSync('tar', ['-xf', zipPath, '-C', destDir], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(`tar extract failed: ${r.stderr || r.stdout || r.status}`);
  }
}

/**
 * Zip layout from pack-local: either
 *   C15-BankManager-local/app/ ...
 * or flat app/ at root of extract.
 */
function findPackPayload(extractRoot) {
  const direct = path.join(extractRoot, 'app');
  if (fs.existsSync(direct)) {
    return extractRoot;
  }
  const entries = fs.readdirSync(extractRoot, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const cand = path.join(extractRoot, e.name);
    if (fs.existsSync(path.join(cand, 'app'))) return cand;
  }
  return null;
}

function swapTree(livePath, incomingPath, bakPath) {
  if (fs.existsSync(bakPath)) rmrf(bakPath);
  if (fs.existsSync(livePath)) {
    fs.renameSync(livePath, bakPath);
  }
  try {
    fs.renameSync(incomingPath, livePath);
    if (fs.existsSync(bakPath)) rmrf(bakPath);
  } catch (e) {
    if (fs.existsSync(bakPath) && !fs.existsSync(livePath)) {
      fs.renameSync(bakPath, livePath);
    }
    throw e;
  }
}

/**
 * @returns {{ updated: boolean, localVersion: string, remoteVersion?: string, detail: string }}
 */
export async function checkAndApplyUpdate() {
  const localVersion = readLocalVersion();
  log(`Local version ${localVersion}`);

  let release;
  try {
    release = await httpsGetJson(API_LATEST, 8000);
  } catch (e) {
    log(`Release check skipped: ${e.message || e}`);
    return { updated: false, localVersion, detail: 'check-failed' };
  }

  const remoteVersion = String(release.tag_name || release.name || '')
    .replace(/^v/i, '')
    .trim();
  if (!remoteVersion) {
    log('No tag on latest release');
    return { updated: false, localVersion, detail: 'no-tag' };
  }

  if (compareSemver(remoteVersion, localVersion) <= 0) {
    log(`Up to date (remote ${remoteVersion})`);
    return { updated: false, localVersion, remoteVersion, detail: 'up-to-date' };
  }

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((a) => a.name === ASSET_NAME);
  if (!asset?.browser_download_url) {
    log(`No asset named ${ASSET_NAME} on release ${remoteVersion}`);
    return { updated: false, localVersion, remoteVersion, detail: 'no-asset' };
  }

  if (!allowedDownloadUrl(asset.browser_download_url)) {
    log('Blocked download URL host');
    return { updated: false, localVersion, remoteVersion, detail: 'bad-url' };
  }

  log(`Downloading ${ASSET_NAME} (${remoteVersion})…`);
  const tmpRoot = path.join(PACK_ROOT, '.update-tmp');
  rmrf(tmpRoot);
  fs.mkdirSync(tmpRoot, { recursive: true });
  const zipPath = path.join(tmpRoot, ASSET_NAME);

  try {
    const buf = await httpsGetBuffer(asset.browser_download_url, {
      timeoutMs: 120000,
    });
    fs.writeFileSync(zipPath, buf);
    log(`Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

    const extractDir = path.join(tmpRoot, 'extract');
    extractZip(zipPath, extractDir);
    const payload = findPackPayload(extractDir);
    if (!payload) {
      throw new Error('Update zip missing app/ folder');
    }

    const newApp = path.join(payload, 'app');
    const newLauncher = path.join(payload, 'launcher');
    if (!fs.existsSync(newApp)) throw new Error('Update missing app/');

    // Stage copies then swap (incoming must not be under .update-tmp after rename across volumes — copy)
    const stage = path.join(tmpRoot, 'stage');
    fs.mkdirSync(stage, { recursive: true });
    copyDir(newApp, path.join(stage, 'app'));
    if (fs.existsSync(newLauncher)) {
      copyDir(newLauncher, path.join(stage, 'launcher'));
    }
    for (const name of [
      'Start-Windows.bat',
      'Start-macOS.command',
      'Start-Linux.sh',
      'README-LOCAL.txt',
    ]) {
      const src = path.join(payload, name);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(stage, name));
      }
    }

    swapTree(
      path.join(PACK_ROOT, 'app'),
      path.join(stage, 'app'),
      path.join(PACK_ROOT, 'app.bak'),
    );

    if (fs.existsSync(path.join(stage, 'launcher'))) {
      // Keep runtime-manifest if new one missing; swap launcher carefully
      swapTree(
        path.join(PACK_ROOT, 'launcher'),
        path.join(stage, 'launcher'),
        path.join(PACK_ROOT, 'launcher.bak'),
      );
    }

    for (const name of [
      'Start-Windows.bat',
      'Start-macOS.command',
      'Start-Linux.sh',
      'README-LOCAL.txt',
    ]) {
      const src = path.join(stage, name);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(PACK_ROOT, name));
      }
    }

    // Never touch runtime/
    rmrf(tmpRoot);
    log(`Updated to ${remoteVersion}`);
    return {
      updated: true,
      localVersion: remoteVersion,
      remoteVersion,
      detail: 'updated',
    };
  } catch (e) {
    log(`Update failed: ${e.message || e}`);
    try {
      rmrf(tmpRoot);
    } catch {
      /* ignore */
    }
    return {
      updated: false,
      localVersion,
      remoteVersion,
      detail: 'apply-failed',
    };
  }
}

/** Hash helper for tests / ensure-node */
export function sha256File(filePath) {
  const h = createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}
