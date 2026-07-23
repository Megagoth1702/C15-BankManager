import { getSynthNoGoRect } from '../layout/noGoZones';
import {
  getDisplayPosition,
  resolveDisplayPositions,
} from './displayPosition';
import {
  BANK_LAYOUT,
  bankToWorldRectAt,
  C15_SCALE,
  computeWorldBoundsAt,
  effectiveFacingWidth,
} from './geometry';
import type { Bank } from '../types/bank';

export const viewport = $state({
  panX: 0,
  panY: 0,
  zoom: 1,
});

/** Canvas zoom limits — shared by wheel zoom and the prefs-bar slider. */
export const VIEWPORT_ZOOM = {
  min: 0.04,
  max: 4,
  step: 0.01,
  default: 1,
} as const;

const MIN_ZOOM = VIEWPORT_ZOOM.min;
const MAX_ZOOM = VIEWPORT_ZOOM.max;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return VIEWPORT_ZOOM.default;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function formatCanvasZoomPercent(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)}%`;
}

/** Pan so a world-space point sits in the canvas center (keeps current zoom). */
function centerViewportOnWorld(
  worldX: number,
  worldY: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (canvasWidth <= 0 || canvasHeight <= 0) return;
  viewport.panX = canvasWidth / 2 - worldX * viewport.zoom;
  viewport.panY = canvasHeight / 2 - worldY * viewport.zoom;
}

export function setPan(x: number, y: number): void {
  viewport.panX = x;
  viewport.panY = y;
}

export function panBy(dx: number, dy: number): void {
  viewport.panX += dx;
  viewport.panY += dy;
}

export function zoomAt(screenX: number, screenY: number, factor: number): void {
  const newZoom = clampZoom(viewport.zoom * factor);
  if (newZoom === viewport.zoom) return;
  const worldX = (screenX - viewport.panX) / viewport.zoom;
  const worldY = (screenY - viewport.panY) / viewport.zoom;

  viewport.panX = screenX - worldX * newZoom;
  viewport.panY = screenY - worldY * newZoom;
  viewport.zoom = newZoom;
}

/**
 * Set absolute canvas zoom, keeping the world point under `screenX/Y` fixed.
 * Coordinates are canvas-local (origin top-left of the canvas element), same as `zoomAt`.
 * Defaults to canvas center when size is known; otherwise only updates zoom.
 */
export function setZoom(
  zoom: number,
  screenX?: number,
  screenY?: number,
  canvasWidth?: number,
  canvasHeight?: number,
): void {
  const newZoom = clampZoom(zoom);
  const w = canvasWidth ?? 0;
  const h = canvasHeight ?? 0;
  const sx = screenX ?? (w > 0 ? w / 2 : null);
  const sy = screenY ?? (h > 0 ? h / 2 : null);

  if (sx == null || sy == null || viewport.zoom === 0) {
    viewport.zoom = newZoom;
    return;
  }
  if (newZoom === viewport.zoom) return;

  const worldX = (sx - viewport.panX) / viewport.zoom;
  const worldY = (sy - viewport.panY) / viewport.zoom;
  viewport.panX = sx - worldX * newZoom;
  viewport.panY = sy - worldY * newZoom;
  viewport.zoom = newZoom;
}

export function fitBanksToView(
  banks: Bank[],
  canvasWidth: number,
  canvasHeight: number,
  padding = 48,
): void {
  const displayByUuid = resolveDisplayPositions(banks);
  const bounds = computeWorldBoundsAt(banks, (bank) => {
    const display = displayByUuid.get(bank.uuid);
    return display ?? { x: bank.x, y: bank.y };
  });
  if (!bounds || canvasWidth <= 0 || canvasHeight <= 0) return;

  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsHeight = bounds.maxY - bounds.minY;

  if (boundsWidth <= 0 || boundsHeight <= 0) {
    viewport.zoom = 1;
    viewport.panX = canvasWidth / 2;
    viewport.panY = canvasHeight / 2;
    return;
  }

  const zoomX = (canvasWidth - padding * 2) / boundsWidth;
  const zoomY = (canvasHeight - padding * 2) / boundsHeight;
  viewport.zoom = clampZoom(Math.min(zoomX, zoomY));

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  centerViewportOnWorld(centerX, centerY, canvasWidth, canvasHeight);
}

/**
 * Center the viewport on a bank's on-screen position (display coords for attached banks).
 * Pass `allBanks` when available so attachment layout is resolved correctly.
 */
export function focusBank(
  bank: Bank,
  canvasWidth: number,
  canvasHeight: number,
  allBanks?: readonly Bank[],
): void {
  const bankList = allBanks ?? [bank];
  const displayByUuid = resolveDisplayPositions([...bankList]);
  const origin = getDisplayPosition(bank, displayByUuid);
  const rect = bankToWorldRectAt(bank, origin.x, origin.y);
  centerViewportOnWorld(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
    canvasWidth,
    canvasHeight,
  );
}

/**
 * Center the viewport on a specific preset row inside its bank.
 * Falls back to the bank center when the preset is not found.
 */
export function focusPreset(
  bank: Bank,
  presetUuid: string,
  allBanks: readonly Bank[],
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (canvasWidth <= 0 || canvasHeight <= 0) return;

  const displayByUuid = resolveDisplayPositions([...allBanks]);
  const origin = getDisplayPosition(bank, displayByUuid);
  const needle = presetUuid.toLowerCase();
  const index = bank.presetOrder.findIndex((u) => u.toLowerCase() === needle);

  if (index < 0) {
    focusBank(bank, canvasWidth, canvasHeight, allBanks);
    return;
  }

  const centerXC15 = origin.x + effectiveFacingWidth(bank) / 2;
  const centerYC15 =
    origin.y +
    BANK_LAYOUT.tapeSize +
    BANK_LAYOUT.headerHeight +
    index * BANK_LAYOUT.presetRowHeight +
    BANK_LAYOUT.presetRowHeight / 2;

  centerViewportOnWorld(
    centerXC15 * C15_SCALE,
    centerYC15 * C15_SCALE,
    canvasWidth,
    canvasHeight,
  );
}

/** Center the viewport on the synth parameter zone (red no-go box). */
export function focusSynthZone(canvasWidth: number, canvasHeight: number): void {
  if (canvasWidth <= 0 || canvasHeight <= 0) return;

  const noGo = getSynthNoGoRect();
  const centerX = (noGo.x + noGo.width / 2) * C15_SCALE;
  const centerY = (noGo.y + noGo.height / 2) * C15_SCALE;
  centerViewportOnWorld(centerX, centerY, canvasWidth, canvasHeight);
}