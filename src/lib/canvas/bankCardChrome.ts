/**
 * Shared bank-card chrome helpers for full + lite cards.
 */
import { BANK_LAYOUT, C15_SCALE } from './geometry';
import type { DockEdge } from '../model/attachOperation';

/** Pointer gesture threshold (px) shared by bank cards, preset drag, marquee. */
export const POINTER_GESTURE_THRESHOLD_PX = 3;

/**
 * Bank body outline thickness in **screen** CSS pixels (integer ≥ 1).
 * Whole pixels avoid the common half-disappearing side under canvas zoom AA.
 */
export function bankBodyBorderScreenPx(viewportZoom: number): number {
  const zoom = Number.isFinite(viewportZoom) && viewportZoom > 0 ? viewportZoom : 1;
  const designScreen = BANK_LAYOUT.bodyBorderWidth * C15_SCALE * zoom;
  return Math.max(1, Math.round(designScreen));
}

/**
 * Bank body outline thickness in **world** (pre-zoom) CSS pixels.
 * Equals `bankBodyBorderScreenPx / zoom` so after `scale(zoom)` the stroke is
 * an integer number of screen pixels (never thinner than 1).
 */
export function bankBodyBorderWorldPx(viewportZoom: number): number {
  const zoom = Number.isFinite(viewportZoom) && viewportZoom > 0 ? viewportZoom : 1;
  return bankBodyBorderScreenPx(zoom) / zoom;
}

/**
 * Outset box-shadow used as the bank outline (not CSS `border`).
 * Drawn outside the box so it is not clipped by an inner `overflow: hidden`.
 */
export function bankBodyOutlineShadow(
  borderWorldPx: number,
  borderColor: string,
  extraShadow = 'none',
): string {
  const outline = `0 0 0 ${borderWorldPx}px ${borderColor}`;
  if (!extraShadow || extraShadow === 'none') return outline;
  return `${outline}, ${extraShadow}`;
}

/**
 * Absolute-position style for the cyan dock-edge highlight bar.
 * Matches BankCard / BankCardLite layout (flush chrome from origin).
 */
export function dockEdgeHighlightBarStyle(
  edge: DockEdge,
  metrics: {
    placementW: number;
    chromeTopPx: number;
    innerH: number;
    dockHighlightPx: number;
  },
): string {
  const { placementW, chromeTopPx, innerH, dockHighlightPx } = metrics;
  switch (edge) {
    case 'west':
      return `left:0;top:${chromeTopPx}px;width:${dockHighlightPx}px;height:${innerH}px`;
    case 'east':
      return `left:${placementW - dockHighlightPx}px;top:${chromeTopPx}px;width:${dockHighlightPx}px;height:${innerH}px`;
    case 'north':
      return `left:0;top:0;width:${placementW}px;height:${dockHighlightPx}px`;
    case 'south':
      return `left:0;top:${chromeTopPx + innerH}px;width:${placementW}px;height:${dockHighlightPx}px`;
  }
}
