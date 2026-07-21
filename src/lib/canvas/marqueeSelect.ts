import type { DisplayPositionMap } from './displayPosition';
import { bankRectAtDisplay, getDisplayPosition } from './displayPosition';
import { clientToC15, type ViewportTransform } from './hitTest';
import type { Bank } from '../types/bank';

export interface C15Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function c15RectFromClientCorners(
  clientX1: number,
  clientY1: number,
  clientX2: number,
  clientY2: number,
  canvasRect: DOMRect,
  viewport: ViewportTransform,
): C15Rect {
  const a = clientToC15(clientX1, clientY1, canvasRect, viewport);
  const b = clientToC15(clientX2, clientY2, canvasRect, viewport);
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x, b.x);
  const y2 = Math.max(a.y, b.y);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function rectsIntersect(a: C15Rect, b: C15Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Banks whose outer display rect intersects the marquee (banks only, not preset rows). */
export function bankUuidsInC15Rect(
  banks: Bank[],
  rect: C15Rect,
  displayByUuid: DisplayPositionMap,
): string[] {
  const hits: string[] = [];
  for (const bank of banks) {
    const display = getDisplayPosition(bank, displayByUuid);
    const bankRect = bankRectAtDisplay(bank, display);
    if (rectsIntersect(rect, bankRect)) {
      hits.push(bank.uuid);
    }
  }
  return hits;
}

export function screenRectFromClientCorners(
  clientX1: number,
  clientY1: number,
  clientX2: number,
  clientY2: number,
  canvasRect: DOMRect,
): { left: number; top: number; width: number; height: number } {
  const x1 = clientX1 - canvasRect.left;
  const y1 = clientY1 - canvasRect.top;
  const x2 = clientX2 - canvasRect.left;
  const y2 = clientY2 - canvasRect.top;
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  return {
    left,
    top,
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}
