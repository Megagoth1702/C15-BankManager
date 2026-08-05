/**
 * Whether the current runtime can open a LAN WebSocket to the C15.
 * GitHub Pages is HTTPS → browsers block `ws://` (mixed content).
 * Local Live pack / Vite (`http://localhost:…`) are fine.
 */
import { LOCAL_PACK_BLOCKED_REASON } from './localPackLinks';

export function canUseLiveSockets(): boolean {
  if (typeof location === 'undefined') return false;
  const protocol = location.protocol;
  return protocol === 'http:' || protocol === 'file:';
}

export function liveSocketsBlockedReason(): string | null {
  if (canUseLiveSockets()) return null;
  if (typeof location !== 'undefined' && location.protocol === 'https:') {
    return LOCAL_PACK_BLOCKED_REASON;
  }
  return 'Live WebSocket is not available in this environment.';
}
