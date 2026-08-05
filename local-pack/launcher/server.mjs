/**
 * Minimal static server for the Local Live pack.
 * Binds 127.0.0.1 only. Serves ../app (or APP_DIR).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APP_DIR = process.env.C15BM_APP_DIR
  ? path.resolve(process.env.C15BM_APP_DIR)
  : path.join(ROOT, 'app');

const HOST = '127.0.0.1';
const DEFAULT_PORT = Number(process.env.C15BM_PORT || 17815);
const MAX_PORT_TRIES = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function readVersion() {
  try {
    const p = path.join(APP_DIR, 'version.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { version: '0.0.0' };
  }
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0] || '/');
  const rel = decoded === '/' ? '/index.html' : decoded;
  const full = path.normalize(path.join(root, rel));
  if (!full.startsWith(root)) return null;
  return full;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function createHandler() {
  return (req, res) => {
    const url = req.url || '/';

    if (url === '/__opm/meta' || url.startsWith('/__opm/meta?')) {
      const v = readVersion();
      send(
        res,
        200,
        JSON.stringify({
          version: v.version ?? '0.0.0',
          builtAt: v.builtAt ?? null,
          mode: 'local-pack',
        }),
        {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      );
      return;
    }

    let filePath = safeJoin(APP_DIR, url);
    if (!filePath) {
      send(res, 403, 'Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      // SPA-style fallback only for navigation (no extension)
      const ext = path.extname(filePath);
      if (!ext) {
        const index = path.join(APP_DIR, 'index.html');
        if (fs.existsSync(index)) {
          filePath = index;
        } else {
          send(res, 404, 'Not found');
          return;
        }
      } else {
        send(res, 404, 'Not found');
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const noCache =
      ext === '.html' || path.basename(filePath) === 'version.json';
    try {
      const data = fs.readFileSync(filePath);
      send(res, 200, data, {
        'Content-Type': type,
        'Cache-Control': noCache ? 'no-store' : 'public, max-age=86400',
      });
    } catch {
      send(res, 500, 'Read error');
    }
  };
}

function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createHandler());
    server.once('error', reject);
    server.listen(port, HOST, () => resolve({ server, port }));
  });
}

export async function startServer() {
  if (!fs.existsSync(APP_DIR)) {
    throw new Error(`App folder not found: ${APP_DIR}`);
  }

  let lastErr;
  for (let i = 0; i < MAX_PORT_TRIES; i++) {
    const port = DEFAULT_PORT + i;
    try {
      const { server, port: bound } = await tryListen(port);
      const url = `http://${HOST}:${bound}/`;
      return { server, port: bound, url };
    } catch (e) {
      lastErr = e;
      if (e && e.code !== 'EADDRINUSE') throw e;
    }
  }
  throw lastErr || new Error('No free port');
}

// CLI: node server.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startServer();
  console.log(`Serving ${APP_DIR}`);
  console.log(url);
}
