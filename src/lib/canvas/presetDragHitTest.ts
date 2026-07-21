import { BANK_LAYOUT, bankChromeRectAt, C15_SCALE } from './geometry';
import type { ViewportTransform } from './hitTest';
import type { DisplayPositionMap } from './displayPosition';
import { getDisplayPosition } from './displayPosition';
import type { Bank } from '../types/bank';

export interface PresetDropTarget {
  bankUuid: string;
  /** Insert index in target `preset-order` (0 = before first, length = append). */
  insertIndex: number;
}

/** Client coords → C15 point (same as hitTest.clientToC15). */
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

function pointInRect(
  x: number,
  y: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    x >= rect.x &&
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height
  );
}

/**
 * Insert slot from Y in bank-inner coordinates (origin = inner body top-left).
 */
export function insertIndexFromInnerY(localY: number, bank: Bank): number {
  const header = BANK_LAYOUT.headerHeight;
  const rowH = BANK_LAYOUT.presetRowHeight;
  const count = bank.presetOrder.length;

  if (localY < header + rowH * 0.5) return 0;

  if (count === 0) return 0;

  const listY = localY - header;
  const slot = Math.floor(listY / rowH);
  const within = listY - slot * rowH;
  const idx = within < rowH / 2 ? slot : slot + 1;
  return Math.max(0, Math.min(idx, count));
}

/** Y offset in C15 units for insert line (inner body coords, top of gap). */
export function insertLineInnerY(insertIndex: number, bank: Bank): number {
  const header = BANK_LAYOUT.headerHeight;
  const rowH = BANK_LAYOUT.presetRowHeight;
  const count = bank.presetOrder.length;
  if (count === 0) return header;
  if (insertIndex <= 0) return header;
  if (insertIndex >= count) return header + count * rowH;
  return header + insertIndex * rowH;
}

export function findPresetDropTarget(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  viewport: ViewportTransform,
  banks: Bank[],
  displayByUuid: DisplayPositionMap,
): PresetDropTarget | null {
  const c15 = clientToC15(clientX, clientY, canvasRect, viewport);

  for (let i = banks.length - 1; i >= 0; i--) {
    const bank = banks[i]!;

    const display = getDisplayPosition(bank, displayByUuid);
    const chrome = bankChromeRectAt(display.x, display.y, bank);
    if (!pointInRect(c15.x, c15.y, chrome)) continue;

    const innerX = c15.x - chrome.x;
    const innerY = c15.y - chrome.y;
    const innerW = chrome.width;

    if (innerX < 0 || innerX > innerW) continue;

    const insertIndex = insertIndexFromInnerY(innerY, bank);
    return { bankUuid: bank.uuid, insertIndex };
  }

  return null;
}