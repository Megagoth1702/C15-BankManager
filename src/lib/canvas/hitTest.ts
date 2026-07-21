import type { DisplayPositionMap } from './displayPosition';
import { getDisplayPosition } from './displayPosition';
import { bankChromeRectAt, C15_SCALE } from './geometry';
import type { Bank } from '../types/bank';

export interface ViewportTransform {
  panX: number;
  panY: number;
  zoom: number;
}

/** Convert screen/client coordinates to C15 bank space. */
export function clientToC15(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  viewport: ViewportTransform,
): { x: number; y: number } {
  const worldX = (clientX - canvasRect.left - viewport.panX) / viewport.zoom;
  const worldY = (clientY - canvasRect.top - viewport.panY) / viewport.zoom;
  return { x: worldX / C15_SCALE, y: worldY / C15_SCALE };
}

/** Topmost bank whose outer rect contains the point (later list items on top). */
export function findBankAtC15Point(
  banks: Bank[],
  c15X: number,
  c15Y: number,
  excludeUuid?: string,
  displayByUuid?: DisplayPositionMap,
): Bank | undefined {
  for (let i = banks.length - 1; i >= 0; i--) {
    const bank = banks[i]!;
    if (excludeUuid && bank.uuid === excludeUuid) continue;

    const origin = displayByUuid
      ? getDisplayPosition(bank, displayByUuid)
      : { x: bank.x, y: bank.y };
    const chrome = bankChromeRectAt(origin.x, origin.y, bank);
    if (
      c15X >= chrome.x &&
      c15X < chrome.x + chrome.width &&
      c15Y >= chrome.y &&
      c15Y < chrome.y + chrome.height
    ) {
      return bank;
    }
  }
  return undefined;
}