/**
 * After portable (or system) Node is available:
 * 1) kill any previous pack server (PID / port)
 * 2) optional auto-update from GitHub Releases
 * 3) start local static server
 * 4) open default browser
 * 5) exit cleanly when the console is closed or Ctrl+C is pressed
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { checkAndApplyUpdate } from './update.mjs';
import { startServer } from './server.mjs';
import {
  freeDefaultPort,
  killStalePackProcess,
  removePidFile,
  writePidFile,
} from './processLifecycle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = Number(process.env.C15BM_PORT || 17815);

/** @type {import('node:http').Server | null} */
let httpServer = null;
let shuttingDown = false;

function log(line) {
  const msg = `[bootstrap] ${line}`;
  console.log(msg);
  try {
    fs.appendFileSync(
      path.join(PACK_ROOT, 'launcher.log'),
      `${new Date().toISOString()} ${msg}\n`,
    );
  } catch {
    /* ignore */
  }
}

function openBrowser(url) {
  const plat = process.platform;
  // Do not detach the pack process from the console — only launch the browser.
  if (plat === 'win32') {
    // `start` is a shell builtin; keep child short-lived and not detached from our tree.
    spawn(`start "" "${url}"`, {
      shell: true,
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  if (plat === 'darwin') {
    spawn('open', [url], { detached: false, stdio: 'ignore' });
    return;
  }
  spawn('xdg-open', [url], { detached: false, stdio: 'ignore' });
}

function waitForEnter() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve();
      return;
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('  Press Enter to close…', () => {
      rl.close();
      resolve();
    });
  });
}

function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Shutting down (${reason})…`);
  console.log('');
  console.log(`  Stopping (${reason})…`);

  const finish = () => {
    removePidFile();
    process.exit(code);
  };

  if (httpServer) {
    try {
      httpServer.close(() => finish());
    } catch {
      finish();
      return;
    }
    // Hard exit if close hangs (open keep-alive sockets)
    setTimeout(finish, 1500).unref();
  } else {
    finish();
  }
}

function installSignalHandlers() {
  const onSignal = (sig) => () => shutdown(sig, 0);
  process.on('SIGINT', onSignal('SIGINT'));
  process.on('SIGTERM', onSignal('SIGTERM'));
  process.on('SIGHUP', onSignal('SIGHUP'));
  // Windows: console window closed / Ctrl+Break
  process.on('SIGBREAK', onSignal('SIGBREAK'));

  process.on('beforeExit', () => {
    removePidFile();
  });

  // Keep stdin referenced so this stays a console process (helps window-close → kill).
  if (process.stdin.isTTY) {
    process.stdin.resume();
    process.stdin.on('end', () => shutdown('stdin-end', 0));
  }
}

async function main() {
  installSignalHandlers();

  console.log('');
  console.log('  C15 Bank Manager - Local Live pack');
  console.log('  -------------------------------------------');
  console.log('');

  killStalePackProcess(log);
  freeDefaultPort(DEFAULT_PORT, log);
  writePidFile();

  const skipUpdate = process.env.C15BM_SKIP_UPDATE === '1';
  if (!skipUpdate) {
    log('Checking for updates…');
    try {
      const result = await checkAndApplyUpdate();
      if (result.updated) {
        log(`Applied update → ${result.remoteVersion}`);
        console.log(`  Updated to v${result.remoteVersion}`);
      } else if (result.detail === 'up-to-date') {
        console.log(`  Version v${result.localVersion} (up to date)`);
      } else {
        console.log(`  Version v${result.localVersion}`);
      }
    } catch (e) {
      log(`Update error (continuing): ${e.message || e}`);
    }
  } else {
    log('Update check skipped (C15BM_SKIP_UPDATE=1)');
  }

  console.log('  Starting local server…');
  const { url, port, server } = await startServer();
  httpServer = server;
  log(`Listening ${url} (port ${port})`);
  console.log(`  Open: ${url}`);
  console.log('  Leave this window open while you use the app.');
  console.log('  Close this window or press Ctrl+C to stop the server.');
  console.log('');

  openBrowser(url);

  // Stay alive until signal / window close.
  await new Promise(() => {});
}

main().catch(async (e) => {
  console.error('');
  console.error('  Failed to start:', e.message || e);
  console.error('  See launcher.log for details.');
  console.error('');
  try {
    fs.appendFileSync(
      path.join(PACK_ROOT, 'launcher.log'),
      `${new Date().toISOString()} [bootstrap] FATAL ${e.stack || e}\n`,
    );
  } catch {
    /* ignore */
  }
  removePidFile();
  if (process.stdin.isTTY) {
    await waitForEnter();
  }
  process.exit(1);
});
