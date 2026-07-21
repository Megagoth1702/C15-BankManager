import { attachHandleAnchorC15 } from './attachAnchors';
import { attachCorridorsForBank } from './attachCorridors';
import {
  BANK_LAYOUT,
  bankInnerBodyHeight,
  bankOuterHeight,
  bankOuterWidth,
  effectiveFacingWidth,
} from './geometry';
import type { AttachDirection, Bank } from '../types/bank';

export type BankDebugRegionKind = 'rect' | 'point';

/** Side of the bank where the label is parked (exclusive column/row lanes). */
export type BankDebugLabelLane = 'n' | 's' | 'e' | 'w';

/** Named bank geometry region for debug overlays (C15 units, absolute). */
export interface BankDebugRegion {
  id: string;
  /** Short stable name shown on the callout. */
  name: string;
  kind: BankDebugRegionKind;
  /** Absolute C15 position (rect top-left, or point center). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Stroke / label color (CSS). */
  color: string;
  /** Which outer lane holds this region's label. */
  labelLane: BankDebugLabelLane;
  /**
   * Order within the lane (0 = closest to bank for N/S, topmost for E/W).
   * Layout uses this for stable stacking; does not place relative to region midpoints.
   */
  labelOrder: number;
}

export interface BankDebugCallout {
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
  textAnchor: 'start' | 'middle' | 'end';
  dominantBaseline: 'auto' | 'middle' | 'hanging';
}

const COLORS = {
  outer: '#a3e635', // lime
  placement: '#fbbf24', // amber
  chrome: '#22d3ee', // cyan
  header: '#38bdf8', // sky
  presetBody: '#67e8f9', // light cyan
  tape: '#c084fc', // violet
  attach: '#e879f9', // fuchsia
  handle: '#fb923c', // orange
} as const;

/** Vertical pitch between stacked labels (C15 units) — room for ~8–10px mono text + gap. */
export const BANK_DEBUG_LABEL_LINE = 22;

/** Gap from bank bbox edge to nearest label (C15 units). */
export const BANK_DEBUG_LABEL_MARGIN = 36;

function rectLabel(name: string, w: number, h: number): string {
  const rw = Math.round(w * 10) / 10;
  const rh = Math.round(h * 10) / 10;
  return `${name} ${rw}×${rh}`;
}

function pointLabel(name: string, x: number, y: number): string {
  const rx = Math.round(x * 10) / 10;
  const ry = Math.round(y * 10) / 10;
  return `${name} @ (${rx}, ${ry})`;
}

/**
 * All logical bank regions used by layout / attach math, in C15 units at display origin.
 * Matches BankCard corridors + geometry.ts helpers (not idealized NonMaps-only boxes).
 *
 * Labels are assigned to exclusive N/E/S/W lanes so callout layout can stack without overlap.
 */
export function bankDebugRegions(
  bank: Bank,
  originX: number,
  originY: number,
): BankDebugRegion[] {
  const tape = BANK_LAYOUT.tapeSize;
  const headerH = BANK_LAYOUT.headerHeight;
  const outerW = bankOuterWidth();
  const outerH = bankOuterHeight(bank);
  const facingW = effectiveFacingWidth(bank);
  const innerH = bankInnerBodyHeight(bank);
  const eastResidual = Math.max(0, outerW - facingW);
  const regions: BankDebugRegion[] = [];

  // --- West lane (top → bottom): outer envelope + left attach/handle ---
  regions.push({
    id: 'outer',
    name: rectLabel('outer', outerW, outerH),
    kind: 'rect',
    x: originX,
    y: originY,
    width: outerW,
    height: outerH,
    color: COLORS.outer,
    labelLane: 'w',
    labelOrder: 0,
  });
  const corridors = attachCorridorsForBank(bank, originX, originY);
  regions.push({
    id: 'attachL',
    name: rectLabel('attachL', corridors.L.width, corridors.L.height),
    kind: 'rect',
    x: corridors.L.x,
    y: corridors.L.y,
    width: corridors.L.width,
    height: corridors.L.height,
    color: COLORS.attach,
    labelLane: 'w',
    labelOrder: 1,
  });

  // --- East lane (top → bottom): placement through right attach/handle ---
  regions.push({
    id: 'placement',
    name: rectLabel('placement', facingW, outerH),
    kind: 'rect',
    x: originX,
    y: originY,
    width: facingW,
    height: outerH,
    color: COLORS.placement,
    labelLane: 'e',
    labelOrder: 0,
  });
  regions.push({
    id: 'chrome',
    name: rectLabel('chrome', facingW, innerH),
    kind: 'rect',
    x: originX,
    y: originY + tape,
    width: facingW,
    height: innerH,
    color: COLORS.chrome,
    labelLane: 'e',
    labelOrder: 1,
  });
  regions.push({
    id: 'header',
    name: rectLabel('header', facingW, headerH),
    kind: 'rect',
    x: originX,
    y: originY + tape,
    width: facingW,
    height: headerH,
    color: COLORS.header,
    labelLane: 'e',
    labelOrder: 2,
  });
  const bodyH = Math.max(0, innerH - headerH);
  regions.push({
    id: 'presetBody',
    name: rectLabel('presetBody', facingW, bodyH),
    kind: 'rect',
    x: originX,
    y: originY + tape + headerH,
    width: facingW,
    height: bodyH,
    color: COLORS.presetBody,
    labelLane: 'e',
    labelOrder: 3,
  });
  if (eastResidual > 0) {
    regions.push({
      id: 'tapeE',
      name: rectLabel('tapeE', eastResidual, outerH),
      kind: 'rect',
      x: originX + facingW,
      y: originY,
      width: eastResidual,
      height: outerH,
      color: COLORS.tape,
      labelLane: 'e',
      labelOrder: 4,
    });
  }
  regions.push({
    id: 'attachR',
    name: rectLabel('attachR', corridors.R.width, corridors.R.height),
    kind: 'rect',
    x: corridors.R.x,
    y: corridors.R.y,
    width: corridors.R.width,
    height: corridors.R.height,
    color: COLORS.attach,
    labelLane: 'e',
    labelOrder: 5,
  });

  // --- North lane (closest to bank → farther out) ---
  regions.push({
    id: 'tapeN',
    name: rectLabel('tapeN', facingW, tape),
    kind: 'rect',
    x: originX,
    y: originY,
    width: facingW,
    height: tape,
    color: COLORS.tape,
    labelLane: 'n',
    labelOrder: 0,
  });
  regions.push({
    id: 'attachT',
    name: rectLabel('attachT', corridors.T.width, corridors.T.height),
    kind: 'rect',
    x: corridors.T.x,
    y: corridors.T.y,
    width: corridors.T.width,
    height: corridors.T.height,
    color: COLORS.attach,
    labelLane: 'n',
    labelOrder: 1,
  });

  // --- South lane ---
  regions.push({
    id: 'tapeS',
    name: rectLabel('tapeS', facingW, tape),
    kind: 'rect',
    x: originX,
    y: originY + tape + innerH,
    width: facingW,
    height: tape,
    color: COLORS.tape,
    labelLane: 's',
    labelOrder: 0,
  });
  regions.push({
    id: 'attachB',
    name: rectLabel('attachB', corridors.B.width, corridors.B.height),
    kind: 'rect',
    x: corridors.B.x,
    y: corridors.B.y,
    width: corridors.B.width,
    height: corridors.B.height,
    color: COLORS.attach,
    labelLane: 's',
    labelOrder: 1,
  });

  // Handles — own slots on each side (after rects so they sit farther out / lower)
  const handleDirs: {
    dir: AttachDirection;
    id: string;
    lane: BankDebugLabelLane;
    order: number;
  }[] = [
    { dir: 'left', id: 'handleL', lane: 'w', order: 2 },
    { dir: 'right', id: 'handleR', lane: 'e', order: 6 },
    { dir: 'top', id: 'handleT', lane: 'n', order: 2 },
    { dir: 'bottom', id: 'handleB', lane: 's', order: 2 },
  ];

  for (const h of handleDirs) {
    const p = attachHandleAnchorC15(bank, h.dir, originX, originY);
    regions.push({
      id: h.id,
      name: pointLabel(h.id, p.x, p.y),
      kind: 'point',
      x: p.x,
      y: p.y,
      width: 0,
      height: 0,
      color: COLORS.handle,
      labelLane: h.lane,
      labelOrder: h.order,
    });
  }

  return regions;
}

function regionAnchor(region: BankDebugRegion): { x: number; y: number } {
  if (region.kind === 'point') {
    return { x: region.x, y: region.y };
  }
  const { x, y, width: w, height: h, labelLane } = region;
  switch (labelLane) {
    case 'n':
      return { x: x + w / 2, y: y };
    case 's':
      return { x: x + w / 2, y: y + h };
    case 'e':
      return { x: x + w, y: y + h / 2 };
    case 'w':
      return { x: x, y: y + h / 2 };
  }
}

function regionsBBox(regions: BankDebugRegion[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of regions) {
    if (r.kind === 'point') {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x);
      maxY = Math.max(maxY, r.y);
    } else {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Place every label in exclusive N/E/S/W lanes outside the bank bbox so
 * no two labels share the same position (clean stacked readability).
 */
export function layoutBankDebugCallouts(
  regions: BankDebugRegion[],
  lineHeight = BANK_DEBUG_LABEL_LINE,
  margin = BANK_DEBUG_LABEL_MARGIN,
): Map<string, BankDebugCallout> {
  const out = new Map<string, BankDebugCallout>();
  if (regions.length === 0) return out;

  const bbox = regionsBBox(regions);
  const midX = (bbox.minX + bbox.maxX) / 2;
  const midY = (bbox.minY + bbox.maxY) / 2;

  const byLane: Record<BankDebugLabelLane, BankDebugRegion[]> = {
    n: [],
    s: [],
    e: [],
    w: [],
  };
  for (const r of regions) {
    byLane[r.labelLane].push(r);
  }
  for (const lane of Object.keys(byLane) as BankDebugLabelLane[]) {
    byLane[lane].sort((a, b) => a.labelOrder - b.labelOrder);
  }

  // North: order 0 closest to bank (just above), higher order farther up
  byLane.n.forEach((r, i) => {
    const anchor = regionAnchor(r);
    out.set(r.id, {
      anchorX: anchor.x,
      anchorY: anchor.y,
      labelX: midX,
      labelY: bbox.minY - margin - i * lineHeight,
      textAnchor: 'middle',
      dominantBaseline: 'auto',
    });
  });

  // South: order 0 closest (just below), higher order farther down
  byLane.s.forEach((r, i) => {
    const anchor = regionAnchor(r);
    out.set(r.id, {
      anchorX: anchor.x,
      anchorY: anchor.y,
      labelX: midX,
      labelY: bbox.maxY + margin + i * lineHeight,
      textAnchor: 'middle',
      dominantBaseline: 'hanging',
    });
  });

  // East: top → bottom, column to the right of bbox
  byLane.e.forEach((r, i) => {
    const anchor = regionAnchor(r);
    const count = byLane.e.length;
    // Center the stack on the bank height when few labels; else start at top
    const stackH = (count - 1) * lineHeight;
    const startY = midY - stackH / 2;
    out.set(r.id, {
      anchorX: anchor.x,
      anchorY: anchor.y,
      labelX: bbox.maxX + margin,
      labelY: startY + i * lineHeight,
      textAnchor: 'start',
      dominantBaseline: 'middle',
    });
  });

  // West: top → bottom, column to the left of bbox
  byLane.w.forEach((r, i) => {
    const anchor = regionAnchor(r);
    const count = byLane.w.length;
    const stackH = (count - 1) * lineHeight;
    const startY = midY - stackH / 2;
    out.set(r.id, {
      anchorX: anchor.x,
      anchorY: anchor.y,
      labelX: bbox.minX - margin,
      labelY: startY + i * lineHeight,
      textAnchor: 'end',
      dominantBaseline: 'middle',
    });
  });

  return out;
}

/**
 * @deprecated Prefer {@link layoutBankDebugCallouts} for non-overlapping labels.
 * Kept for any single-region callers; uses the multi-region layout with one item.
 */
export function bankDebugCallout(
  region: BankDebugRegion,
  stackGap = BANK_DEBUG_LABEL_LINE,
  leader = BANK_DEBUG_LABEL_MARGIN,
): BankDebugCallout {
  const map = layoutBankDebugCallouts([region], stackGap, leader);
  return (
    map.get(region.id) ?? {
      anchorX: region.x,
      anchorY: region.y,
      labelX: region.x,
      labelY: region.y,
      textAnchor: 'middle',
      dominantBaseline: 'middle',
    }
  );
}
