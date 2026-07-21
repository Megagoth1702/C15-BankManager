import {
  BANK_LAYOUT,
  bankOuterWidth,
  C15_SCALE,
  computeWorldBounds,
  emptyBankOuterHeight,
} from './geometry';
import { clientToC15, type ViewportTransform } from './hitTest';
import { snapToGrid } from '../model/bankFactory';
import type { Bank } from '../types/bank';

let canvasElement: HTMLElement | null = null;
let hasPointer = false;
let lastClientX = 0;
let lastClientY = 0;

export function registerCanvasElement(element: HTMLElement | null): void {
  canvasElement = element;
}

export function getCanvasScreenSize(): { width: number; height: number } | null {
  if (!canvasElement) return null;
  const rect = canvasElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { width: rect.width, height: rect.height };
}

export function updatePointerPosition(clientX: number, clientY: number): void {
  lastClientX = clientX;
  lastClientY = clientY;
  hasPointer = true;
}

/** Top-left origin for a new empty bank centered on the last known pointer position. */
export function getCreateBankPositionAtPointer(
  viewport: ViewportTransform,
): { x: number; y: number } | null {
  if (!hasPointer || !canvasElement) return null;

  const rect = canvasElement.getBoundingClientRect();
  const c15 = clientToC15(lastClientX, lastClientY, rect, viewport);
  const width = bankOuterWidth() - BANK_LAYOUT.visibleAttachArea;
  const height = emptyBankOuterHeight();

  return {
    x: snapToGrid(c15.x - width / 2),
    y: snapToGrid(c15.y - height / 2),
  };
}

/** C15 point at the center of the visible canvas area. */
export function getViewportCenterC15(
  viewport: ViewportTransform,
): { x: number; y: number } | null {
  if (!canvasElement) return null;

  const rect = canvasElement.getBoundingClientRect();
  return clientToC15(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
    rect,
    viewport,
  );
}

/** Move a bank group so its bounding-box center sits on the viewport center. */
export function positionBanksAtViewportCenter(
  banks: Bank[],
  viewport: ViewportTransform,
): Bank[] {
  const center = getViewportCenterC15(viewport);
  if (!center || banks.length === 0) return banks;

  const bounds = computeWorldBounds(banks);
  if (!bounds) return banks;

  const cx = (bounds.minX + bounds.maxX) / 2 / C15_SCALE;
  const cy = (bounds.minY + bounds.maxY) / 2 / C15_SCALE;
  const dx = snapToGrid(center.x - cx);
  const dy = snapToGrid(center.y - cy);

  return banks.map((bank) => ({
    ...bank,
    x: snapToGrid(bank.x + dx),
    y: snapToGrid(bank.y + dy),
  }));
}