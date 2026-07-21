/** Below this viewport zoom, banks render as simplified boxes (no preset rows). */
export const BANK_LOD_FULL_ZOOM = 0.5;

export type BankLodMode = 'lite' | 'full';
export type BankCardVariant = 'lite' | 'full';

export function bankLodMode(viewportZoom: number): BankLodMode {
  return viewportZoom < BANK_LOD_FULL_ZOOM ? 'lite' : 'full';
}

/** Which card component to mount, or null when off-screen (viewport-culled). */
export function bankCardVariant(
  viewportZoom: number,
  bankUuid: string,
  visibleUuids: ReadonlySet<string>,
): BankCardVariant | null {
  if (visibleUuids.size > 0 && !visibleUuids.has(bankUuid)) return null;
  return viewportZoom < BANK_LOD_FULL_ZOOM ? 'lite' : 'full';
}