import { bankOuterHeight, bankOuterWidth, C15_SCALE } from './geometry';
import type { Bank } from '../types/bank';
import type { DisplayPositionMap } from './displayPosition';
import { getDisplayPosition } from './displayPosition';

export interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** C15 rect → screen pixels inside the canvas element. */
export function worldRectToScreenRect(
  rect: WorldRect,
  viewport: ViewportState,
): WorldRect {
  const scale = C15_SCALE * viewport.zoom;
  return {
    x: viewport.panX + rect.x * scale,
    y: viewport.panY + rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

/** True when any part of the rect intersects the canvas viewport. */
export function isRectVisibleInCanvas(
  rect: WorldRect,
  viewport: ViewportState,
  canvasWidth: number,
  canvasHeight: number,
  marginPx = 0,
): boolean {
  if (canvasWidth <= 0 || canvasHeight <= 0) return true;

  const screen = worldRectToScreenRect(rect, viewport);
  const left = -marginPx;
  const top = -marginPx;
  const right = canvasWidth + marginPx;
  const bottom = canvasHeight + marginPx;

  return (
    screen.x + screen.width > left &&
    screen.x < right &&
    screen.y + screen.height > top &&
    screen.y < bottom
  );
}

/**
 * Batch visibility — one scale factor, inline screen AABB per bank (no per-bank object alloc).
 */
export function visibleBankUuidsInCanvas(
  banks: readonly Bank[],
  displayByUuid: DisplayPositionMap,
  viewport: ViewportState,
  canvasWidth: number,
  canvasHeight: number,
  alwaysInclude: ReadonlySet<string> = new Set(),
  marginPx = 0,
): Set<string> {
  const visible = new Set<string>(alwaysInclude);
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    for (const bank of banks) visible.add(bank.uuid);
    return visible;
  }

  const scale = C15_SCALE * viewport.zoom;
  const { panX, panY } = viewport;
  const left = -marginPx;
  const top = -marginPx;
  const right = canvasWidth + marginPx;
  const bottom = canvasHeight + marginPx;

  for (const bank of banks) {
    if (alwaysInclude.has(bank.uuid)) continue;

    const display = getDisplayPosition(bank, displayByUuid);
    const screenX = panX + display.x * scale;
    const screenY = panY + display.y * scale;
    const screenW = bankOuterWidth() * scale;
    const screenH = bankOuterHeight(bank) * scale;

    if (
      screenX + screenW > left &&
      screenX < right &&
      screenY + screenH > top &&
      screenY < bottom
    ) {
      visible.add(bank.uuid);
    }
  }

  return visible;
}