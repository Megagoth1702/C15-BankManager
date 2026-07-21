export const EDGE_SCROLL = {
  zoneDepthPx: 56,
  maxSpeedPx: 14,
} as const;

export interface EdgeScrollIntensities {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface EdgeScrollResult {
  dx: number;
  dy: number;
  intensities: EdgeScrollIntensities;
}

/** insetPx: distance from canvas edge inward; negative = pointer past edge (still scroll). */
function intensityNearEdge(insetPx: number, zoneDepthPx: number): number {
  if (insetPx < 0) return 1;
  if (insetPx >= zoneDepthPx) return 0;
  return 1 - insetPx / zoneDepthPx;
}

/**
 * Scroll delta from pointer position relative to a canvas bounding rect.
 * Intensity ramps from 0 at the outer edge of the zone to 1 at the screen edge.
 */
export function computeEdgeScrollDelta(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  zoneDepthPx = EDGE_SCROLL.zoneDepthPx,
  maxSpeedPx = EDGE_SCROLL.maxSpeedPx,
): EdgeScrollResult {
  const localX = clientX - canvasRect.left;
  const localY = clientY - canvasRect.top;

  const left = intensityNearEdge(localX, zoneDepthPx);
  const right = intensityNearEdge(canvasRect.width - localX, zoneDepthPx);
  const top = intensityNearEdge(localY, zoneDepthPx);
  const bottom = intensityNearEdge(canvasRect.height - localY, zoneDepthPx);

  return {
    dx: (left - right) * maxSpeedPx,
    dy: (top - bottom) * maxSpeedPx,
    intensities: { left, right, top, bottom },
  };
}

export function hasEdgeScrollActivity(intensities: EdgeScrollIntensities): boolean {
  return (
    intensities.left > 0 ||
    intensities.right > 0 ||
    intensities.top > 0 ||
    intensities.bottom > 0
  );
}