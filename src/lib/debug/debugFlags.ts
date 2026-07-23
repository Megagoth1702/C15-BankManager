/**
 * Single switch for in-app debug tooling (session log panel, drag/render perf,
 * verbose position/import probes).
 *
 * - Always on in Vite DEV.
 * - In production builds: set localStorage `c15-debug=1` then reload.
 */
export function isAppDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return globalThis.localStorage?.getItem('c15-debug') === '1';
  } catch {
    return false;
  }
}
