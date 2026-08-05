/**
 * PID file + kill stale Local Live pack servers so closing/restarting
 * does not leave orphan node processes holding ports.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_ROOT = path.resolve(__dirname, '..');
const PID_FILE = path.join(PACK_ROOT, 'launcher.pid');

export function getPidFilePath() {
  return PID_FILE;
}

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    // Signal 0: test existence (throws if not found / no permission)
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // Windows: EPERM can mean process exists but we can't signal it the same way
    if (e && e.code === 'EPERM') return true;
    return false;
  }
}

function forceKillPid(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (pid === process.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* ignore */
      }
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Kill any previous pack instance recorded in launcher.pid */
export function killStalePackProcess(log = () => {}) {
  try {
    if (!fs.existsSync(PID_FILE)) return;
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    if (!Number.isFinite(pid) || pid === process.pid) {
      fs.unlinkSync(PID_FILE);
      return;
    }
    if (isPidAlive(pid)) {
      log(`Stopping previous instance (pid ${pid})…`);
      forceKillPid(pid);
      // Brief wait for port release
      spawnSync(process.platform === 'win32' ? 'ping' : 'sleep',
        process.platform === 'win32' ? ['127.0.0.1', '-n', '2'] : ['0.4'],
        { stdio: 'ignore', windowsHide: true },
      );
    }
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
  } catch (e) {
    log(`Stale PID cleanup: ${e.message || e}`);
  }
}

/**
 * Best-effort: free default OPM port if something still holds it
 * (Windows: netstat + taskkill; Unix: fuser/lsof optional).
 */
export function freeDefaultPort(port, log = () => {}) {
  if (!Number.isFinite(port) || port <= 0) return;
  try {
    if (process.platform === 'win32') {
      const r = spawnSync(
        'cmd',
        ['/c', `netstat -ano | findstr :${port}`],
        { encoding: 'utf8', windowsHide: true },
      );
      const out = r.stdout || '';
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number.parseInt(parts[parts.length - 1], 10);
        if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
      }
      for (const pid of pids) {
        log(`Freeing port ${port} (pid ${pid})…`);
        forceKillPid(pid);
      }
    } else {
      // fuser is common on Linux; ignore if missing
      spawnSync('fuser', ['-k', `${port}/tcp`], {
        stdio: 'ignore',
      });
    }
  } catch {
    /* ignore */
  }
}

export function writePidFile() {
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

export function removePidFile() {
  try {
    if (!fs.existsSync(PID_FILE)) return;
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    if (raw === String(process.pid)) fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}
