import {
  bankOuterHeight,
  bankOuterWidth,
  emptyBankOuterHeight,
} from '../canvas/geometry';
import type { Bank } from '../types/bank';
import { createEmptyBank } from '../model/bankFactory';
import { snapToGrid } from '../model/bankFactory';

/**
 * Calibration banks from BORDERS.nlbackup (C15 stored coordinates).
 * Left/right use inner+outer pairs; synth edges use outer facing edges.
 */
export const BORDER_MARKERS = {
  top: { name: 'TOP BORDER', x: -150, y: -1020 },
  bottom: { name: 'BOTTOM BORDER', x: -90, y: 885 },
  leftOuter: { name: 'LEFT BORDER OUTER', x: -1560, y: -45 },
  leftInner: { name: 'LEFT BORDER INNER', x: -1320, y: 105 },
  rightInner: { name: 'RIGHT BORDER inner', x: 1005, y: 165 },
  rightOuter: { name: 'RIGHT BORDER OUTER', x: 1245, y: 75 },
} as const;

const BANK_W = bankOuterWidth();
const EMPTY_H = emptyBankOuterHeight();

/** Interior rectangle where synth GUI parameters live — no preset banks allowed. */
const SYNTH_NO_GO_RECT: Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}> = (() => {
  const left = BORDER_MARKERS.leftOuter.x + BANK_W;
  const top = BORDER_MARKERS.top.y + EMPTY_H;
  const right = BORDER_MARKERS.rightOuter.x;
  const bottom = BORDER_MARKERS.bottom.y;
  return Object.freeze({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
})();

/** Interior rectangle where synth GUI parameters live — no preset banks allowed. */
export function getSynthNoGoRect(): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return SYNTH_NO_GO_RECT;
}

/** Placement constants for wide-grid mass import layout. */
export const LAYOUT_BANDS = {
  /** West edge of the placement grid. */
  gridOriginX: -6400,
  /** North edge — aligned with synth no-go top. */
  gridOriginY: -645,
  /** East edge — chains may extend to here before wrapping. */
  gridMaxX: 12800,
  /** Number of horizontal columns for folder cluster placement. */
  gridColumns: 6,
  /** Gap from synth no-go rect edge (C15 units). */
  synthMargin: 30,
  /** Gap between folder clusters on the same grid row. */
  clusterGap: 180,
  /** Gap between grid rows of folder clusters. */
  rowGap: 240,
  /** Vertical gap between wrapped rows within one folder chain. */
  chainRowGap: 120,
  /** @deprecated Perimeter layout — kept for log compatibility. */
  leftColumnX: -6400,
  folderGap: 240,
} as const;

export interface GridBounds {
  originX: number;
  originY: number;
  maxX: number;
}

export function getGridBounds(): GridBounds {
  return {
    originX: LAYOUT_BANDS.gridOriginX,
    originY: snapToGrid(getSynthNoGoRect().y),
    maxX: LAYOUT_BANDS.gridMaxX,
  };
}

/** West/east shelf edges just outside the synth no-go (banks pack against these). */
export function getNoGoShelfEdges(): {
  westEdge: number;
  eastEdge: number;
  originY: number;
  farWestX: number;
  maxX: number;
} {
  const noGo = getSynthNoGoRect();
  const margin = LAYOUT_BANDS.synthMargin;
  return {
    westEdge: snapToGrid(noGo.x - margin),
    eastEdge: snapToGrid(noGo.x + noGo.width + margin),
    originY: snapToGrid(noGo.y),
    farWestX: LAYOUT_BANDS.gridOriginX,
    maxX: LAYOUT_BANDS.gridMaxX,
  };
}

/** @deprecated Perimeter layout — kept for layout report compatibility. */
export interface PerimeterAnchors {
  left: { originX: number; startY: number; maxChainX: number };
  right: { originX: number; startY: number };
  bottom: { originX: number; startY: number; maxChainX: number };
}

/** @deprecated Perimeter layout — kept for layout report compatibility. */
export function getPerimeterAnchors(): PerimeterAnchors {
  const noGo = getSynthNoGoRect();
  const margin = LAYOUT_BANDS.synthMargin;
  return {
    left: {
      originX: LAYOUT_BANDS.gridOriginX,
      startY: snapToGrid(noGo.y),
      maxChainX: snapToGrid(noGo.x - margin),
    },
    right: {
      originX: snapToGrid(noGo.x + noGo.width + margin),
      startY: snapToGrid(noGo.y),
    },
    bottom: {
      originX: snapToGrid(noGo.x),
      startY: snapToGrid(noGo.y + noGo.height + margin),
      maxChainX: snapToGrid(noGo.x + noGo.width),
    },
  };
}

export interface C15Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClusterBbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export function bankToC15Rect(bank: Bank): C15Rect {
  return {
    x: bank.x,
    y: bank.y,
    width: BANK_W,
    height: bankOuterHeight(bank),
  };
}

export function bboxFromBanks(banks: readonly Bank[]): ClusterBbox | null {
  if (banks.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const bank of banks) {
    const rect = bankToC15Rect(bank);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function rectsOverlap(a: C15Rect, b: C15Rect, margin = 0): boolean {
  return !(
    a.x + a.width + margin <= b.x ||
    b.x + b.width + margin <= a.x ||
    a.y + a.height + margin <= b.y ||
    b.y + b.height + margin <= a.y
  );
}

export function rectOverlapsNoGo(rect: C15Rect, margin = 15): boolean {
  return rectsOverlap(rect, getSynthNoGoRect(), margin);
}

export function rectExceedsMaxX(rect: C15Rect, maxX: number, margin = 15): boolean {
  return rect.x + rect.width + margin > maxX;
}

/** Ghost border banks for optional canvas overlay (not added to exportable session). */
export function getBorderMarkerBanks(): Bank[] {
  return Object.values(BORDER_MARKERS).map((marker) =>
    createEmptyBank(marker.name, marker.x, marker.y),
  );
}