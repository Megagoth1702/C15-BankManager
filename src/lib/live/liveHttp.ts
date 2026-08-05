/**
 * HTTP helpers for playground body endpoints (import/export).
 * Prefer same-origin Vite proxy (`useDevProxy`) to avoid CORS.
 */

import type { LiveSettings } from './liveSettings';
import { buildHttpBase } from './LiveC15Client';

export async function downloadBanksBackup(settings: LiveSettings): Promise<ArrayBuffer> {
  const base = buildHttpBase(settings);
  const res = await fetch(`${base}/presets/download-banks`, {
    method: 'GET',
  });
  if (!res.ok) {
    throw new Error(`download-banks failed: HTTP ${res.status}`);
  }
  return res.arrayBuffer();
}

/**
 * POST single bank XML (same fields NonMaps uses).
 * Content-Type: application/x-www-form-urlencoded body.
 */
export async function importBankHttp(
  settings: LiveSettings,
  opts: { xml: string; x: number | string; y: number | string; fileName: string },
): Promise<void> {
  const base = buildHttpBase(settings);
  const body = new URLSearchParams();
  body.set('xml', opts.xml);
  body.set('x', String(opts.x));
  body.set('y', String(opts.y));
  body.set('fileName', opts.fileName);
  body.set('isOracle', '0');

  const res = await fetch(`${base}/banks/import-bank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`import-bank failed: HTTP ${res.status}`);
  }
}

/** Full library replace — destructive on device (HWUI splash + loading lock). */
export async function importAllBanksHttp(
  settings: LiveSettings,
  backupBytes: ArrayBuffer | Blob,
): Promise<string> {
  const base = buildHttpBase(settings);
  const res = await fetch(`${base}/presets/import-all-banks`, {
    method: 'POST',
    // NonMaps uses application/binary for the gzip body.
    headers: { 'Content-Type': 'application/binary' },
    body: backupBytes,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`import-all-banks failed: HTTP ${res.status} ${text}`);
  }
  // Empty body = success; non-empty is a firmware error string (busy / invalid / version).
  return text;
}
