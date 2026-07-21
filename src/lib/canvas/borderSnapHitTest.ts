import { getSynthBorderEdges } from '../layout/noGoZones';
import { snapToGrid } from '../model/bankFactory';
import type { Bank } from '../types/bank';
import {
  snapOriginForEastBorder,
  snapOriginForWestBorder,
} from './borderFacingEdge';
import {
  BANK_LAYOUT,
  bankOuterHeight,
  effectiveFacingWidth,
  DOCK_DETECTION,
} from './geometry';

export type SynthBorderEdge = 'west' | 'east' | 'north' | 'south';
export type BorderSnapRole = 'outer' | 'inner';

export interface BorderSnapHit {
  edge: SynthBorderEdge;
  role: BorderSnapRole;
  snappedX: number;
  snappedY: number;
  gap: number;
}

interface BankRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const THRESHOLD = DOCK_DETECTION.proximityThreshold;
const MIN_ALIGN = DOCK_DETECTION.minAlignOverlap;
const VA = BANK_LAYOUT.visibleAttachArea;

function overlap1D(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function alignBand(rect: BankRect): BankRect {
  const ratio = DOCK_DETECTION.alignBandRatio;
  const w = rect.width * ratio;
  const h = rect.height * ratio;
  return {
    x: rect.x + (rect.width - w) * 0.5,
    y: rect.y + (rect.height - h) * 0.5,
    width: w,
    height: h,
  };
}

interface EdgeCandidate {
  edge: SynthBorderEdge;
  role: BorderSnapRole;
  gap: number;
  snappedX: number;
  snappedY: number;
}

function westCandidates(
  rect: BankRect,
  borders: ReturnType<typeof getSynthBorderEdges>,
  bank: Bank,
): EdgeCandidate[] {
  const span = effectiveFacingWidth(bank);
  const gapOuter = borders.left - (rect.x + span);
  const gapInner = borders.left - (rect.x + VA);
  const out: EdgeCandidate[] = [];
  if (Math.abs(gapOuter) <= THRESHOLD) {
    out.push({
      edge: 'west',
      role: 'outer',
      gap: gapOuter,
      snappedX: snapToGrid(snapOriginForWestBorder(borders.left, 'outer', bank)),
      snappedY: snapToGrid(rect.y),
    });
  }
  if (Math.abs(gapInner) <= THRESHOLD) {
    out.push({
      edge: 'west',
      role: 'inner',
      gap: gapInner,
      snappedX: snapToGrid(snapOriginForWestBorder(borders.left, 'inner', bank)),
      snappedY: snapToGrid(rect.y),
    });
  }
  return out;
}

function eastCandidates(
  rect: BankRect,
  borders: ReturnType<typeof getSynthBorderEdges>,
  bank: Bank,
): EdgeCandidate[] {
  const span = effectiveFacingWidth(bank);
  const gapOuter = rect.x - borders.right;
  const gapInner = borders.right - (rect.x + span);
  const out: EdgeCandidate[] = [];
  if (Math.abs(gapOuter) <= THRESHOLD) {
    out.push({
      edge: 'east',
      role: 'outer',
      gap: gapOuter,
      snappedX: snapToGrid(snapOriginForEastBorder(borders.right, 'outer', bank)),
      snappedY: snapToGrid(rect.y),
    });
  }
  if (Math.abs(gapInner) <= THRESHOLD) {
    out.push({
      edge: 'east',
      role: 'inner',
      gap: gapInner,
      snappedX: snapToGrid(snapOriginForEastBorder(borders.right, 'inner', bank)),
      snappedY: snapToGrid(rect.y),
    });
  }
  return out;
}

function northCandidates(
  rect: BankRect,
  borders: ReturnType<typeof getSynthBorderEdges>,
  bank: Bank,
): EdgeCandidate[] {
  const H = bankOuterHeight(bank);
  const gapBottom = borders.top - (rect.y + rect.height);
  const gapTop = rect.y - borders.top;
  const out: EdgeCandidate[] = [];
  if (Math.abs(gapBottom) <= THRESHOLD) {
    out.push({
      edge: 'north',
      role: 'outer',
      gap: gapBottom,
      snappedX: snapToGrid(rect.x),
      snappedY: snapToGrid(borders.top - H),
    });
  }
  if (Math.abs(gapTop) <= THRESHOLD) {
    out.push({
      edge: 'north',
      role: 'outer',
      gap: gapTop,
      snappedX: snapToGrid(rect.x),
      snappedY: snapToGrid(borders.top),
    });
  }
  return out;
}

function southCandidates(
  rect: BankRect,
  borders: ReturnType<typeof getSynthBorderEdges>,
  bank: Bank,
): EdgeCandidate[] {
  const H = bankOuterHeight(bank);
  const gapTop = rect.y - borders.bottom;
  const gapBottom = borders.bottom - (rect.y + rect.height);
  const out: EdgeCandidate[] = [];
  if (Math.abs(gapTop) <= THRESHOLD) {
    out.push({
      edge: 'south',
      role: 'outer',
      gap: gapTop,
      snappedX: snapToGrid(rect.x),
      snappedY: snapToGrid(borders.bottom),
    });
  }
  if (Math.abs(gapBottom) <= THRESHOLD) {
    out.push({
      edge: 'south',
      role: 'outer',
      gap: gapBottom,
      snappedX: snapToGrid(rect.x),
      snappedY: snapToGrid(borders.bottom - H),
    });
  }
  return out;
}

function perpendicularOverlap(
  edge: SynthBorderEdge,
  band: BankRect,
  borders: ReturnType<typeof getSynthBorderEdges>,
): number {
  if (edge === 'west' || edge === 'east') {
    return overlap1D(band.y, band.y + band.height, borders.top, borders.bottom);
  }
  return overlap1D(band.x, band.x + band.width, borders.left, borders.right);
}

/**
 * Snap to C15 synth border using facing-edge rules from BORDERS calibration.
 * Inner banks offset by visibleAttachArea (20) on the synth-facing side.
 */
export function findBorderSnapForDraggedBank(
  bank: Bank,
  dragX: number,
  dragY: number,
): BorderSnapHit | null {
  const borders = getSynthBorderEdges();
  const span = effectiveFacingWidth(bank);
  const rect: BankRect = { x: dragX, y: dragY, width: span, height: bankOuterHeight(bank) };
  const band = alignBand(rect);

  const raw = [
    ...westCandidates(rect, borders, bank),
    ...eastCandidates(rect, borders, bank),
    ...northCandidates(rect, borders, bank),
    ...southCandidates(rect, borders, bank),
  ];

  let best: BorderSnapHit | null = null;
  for (const c of raw) {
    const alignOverlap = perpendicularOverlap(c.edge, band, borders);
    if (alignOverlap < MIN_ALIGN) continue;
    if (!best || Math.abs(c.gap) < Math.abs(best.gap)) {
      best = {
        edge: c.edge,
        role: c.role,
        snappedX: c.snappedX,
        snappedY: c.snappedY,
        gap: c.gap,
      };
    }
  }
  return best;
}