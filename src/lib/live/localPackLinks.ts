/**
 * Where users get the Local Live pack (HTTP origin → C15 WebSocket works).
 * Keep URLs in one place for tooltips, README, and docs.
 */

export const PUBLIC_REPO = 'Megagoth1702/C15-OfflinePresetManager';

export const RELEASES_LATEST_URL =
  'https://github.com/Megagoth1702/C15-OfflinePresetManager/releases/latest';

export const RELEASES_API_LATEST =
  'https://api.github.com/repos/Megagoth1702/C15-OfflinePresetManager/releases/latest';

/** GitHub Release asset name produced by `npm run pack:local`. */
export const LOCAL_PACK_ASSET_NAME = 'C15-OPM-local.zip';

export const LOCAL_PACK_BLOCKED_REASON =
  'Live mode cannot run on this HTTPS website (browser security blocks the C15 connection). ' +
  'Download the Local Live pack from GitHub Releases, unzip, and double-click Start. ' +
  'Offline editing still works here. ' +
  RELEASES_LATEST_URL;
