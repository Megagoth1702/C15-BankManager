/**
 * HTTP helpers for playground body endpoints (import/export).
 * Prefer same-origin Vite proxy (`useDevProxy`) to avoid CORS.
 */

import type { LiveSettings } from './liveSettings';
import { buildHttpBase } from './LiveC15Client';

/**
 * Full library backup from the device (gzip `.nlbackup`).
 * Firmware shows HWUI splash while building — treat as a cold operation.
 * Same endpoint NonMaps uses for "Save all Banks as Backup File".
 */
export async function downloadBanksBackup(settings: LiveSettings): Promise<ArrayBuffer> {
  const base = buildHttpBase(settings);
  const res = await fetch(`${base}/presets/download-banks`, {
    method: 'GET',
  });
  if (!res.ok) {
    throw new Error(
      `download-banks failed: HTTP ${res.status}. ` +
        `If this is a CORS/network error, use the Local Live pack or enable the dev proxy.`,
    );
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 32) {
    throw new Error('download-banks returned an empty or tiny response');
  }
  return buf;
}

/**
 * Full single-bank XML from the device (includes parameter trees).
 * `GET /banks/download-bank/?uuid=…`
 */
export async function downloadBankXml(
  settings: LiveSettings,
  bankUuid: string,
): Promise<string> {
  const base = buildHttpBase(settings);
  const url = `${base}/banks/download-bank/?uuid=${encodeURIComponent(bankUuid)}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(
      `download-bank failed: HTTP ${res.status} (uuid ${bankUuid}). ` +
        `If this is a CORS/network error, use the Local Live pack or enable the dev proxy.`,
    );
  }
  const text = await res.text();
  if (!text.includes('<bank')) {
    throw new Error(`download-bank returned non-bank XML for ${bankUuid}`);
  }
  return text;
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
