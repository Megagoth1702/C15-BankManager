/**
 * Whether the current runtime can open a LAN WebSocket to the C15.
 * GitHub Pages is HTTPS → browsers block `ws://` (mixed content).
 * Local Vite (`http://localhost:…`) and future desktop shells are fine.
 */
export function canUseLiveSockets(): boolean {
  if (typeof location === 'undefined') return false;
  const protocol = location.protocol;
  return protocol === 'http:' || protocol === 'file:';
}

export function liveSocketsBlockedReason(): string | null {
  if (canUseLiveSockets()) return null;
  if (typeof location !== 'undefined' && location.protocol === 'https:') {
    return 'Live mode needs a local or desktop build. Browsers block insecure WebSockets (ws://) from HTTPS pages such as GitHub Pages.';
  }
  return 'Live WebSocket is not available in this environment.';
}
