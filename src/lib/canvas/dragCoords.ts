import { C15_SCALE } from './geometry';

/** Convert screen-pixel delta to C15 coordinate delta (accounts for canvas zoom). */
export function screenDeltaToC15(
  dxScreen: number,
  dyScreen: number,
  viewportZoom: number,
): { dx: number; dy: number } {
  const inv = 1 / (viewportZoom * C15_SCALE);
  return { dx: dxScreen * inv, dy: dyScreen * inv };
}