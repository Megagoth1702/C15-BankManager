/**
 * Shared bank-card chrome helpers for full + lite cards.
 */
import type { DockEdge } from '../model/attachOperation';

/** Pointer gesture threshold (px) shared by bank cards, preset drag, marquee. */
export const POINTER_GESTURE_THRESHOLD_PX = 3;

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
