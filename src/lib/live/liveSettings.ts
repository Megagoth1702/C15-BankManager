import { get, writable } from 'svelte/store';

const HOST_KEY = 'c15-live-host';
const PORT_KEY = 'c15-live-port';
const USE_PROXY_KEY = 'c15-live-use-proxy';

/** Unit Wi‑Fi / OTA default from Nonlinear Labs tooling. */
export const DEFAULT_C15_HOST = '192.168.8.2';
export const DEFAULT_C15_PORT = 8080;

function readStored(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(key);
    return v != null && v.trim() !== '' ? v.trim() : fallback;
  } catch {
    return fallback;
  }
}

function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1' || v === 'true';
  } catch {
    return fallback;
  }
}

export interface LiveSettings {
  host: string;
  port: number;
  /**
   * When true, use same-origin Vite proxy paths (`/c15-api/…`) so HTTP import/export
   * avoids CORS. WebSocket also goes through the proxy. Target host is still
   * configured in vite via C15_HOST (restart dev server after change).
   */
  useDevProxy: boolean;
}

function loadSettings(): LiveSettings {
  const portRaw = readStored(PORT_KEY, String(DEFAULT_C15_PORT));
  const port = Number.parseInt(portRaw, 10);
  return {
    host: readStored(HOST_KEY, DEFAULT_C15_HOST),
    port: Number.isFinite(port) && port > 0 && port < 65536 ? port : DEFAULT_C15_PORT,
    // Default off so the host field targets the unit directly over WS.
    // Enable for HTTP import/download when CORS blocks direct fetch (Vite /c15-api).
    useDevProxy: readStoredBool(USE_PROXY_KEY, false),
  };
}

export const liveSettings = writable<LiveSettings>(loadSettings());

export function setLiveHost(host: string): void {
  const trimmed = host.trim() || DEFAULT_C15_HOST;
  liveSettings.update((s) => ({ ...s, host: trimmed }));
  try {
    localStorage.setItem(HOST_KEY, trimmed);
  } catch {
    /* ignore */
  }
}

export function setLivePort(port: number): void {
  const p =
    Number.isFinite(port) && port > 0 && port < 65536 ? Math.floor(port) : DEFAULT_C15_PORT;
  liveSettings.update((s) => ({ ...s, port: p }));
  try {
    localStorage.setItem(PORT_KEY, String(p));
  } catch {
    /* ignore */
  }
}

export function setUseDevProxy(use: boolean): void {
  liveSettings.update((s) => ({ ...s, useDevProxy: use }));
  try {
    localStorage.setItem(USE_PROXY_KEY, use ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function getLiveSettingsSnapshot(): LiveSettings {
  return get(liveSettings);
}
