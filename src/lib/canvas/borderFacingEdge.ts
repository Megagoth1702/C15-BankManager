import type { Bank } from '../types/bank';
import { BANK_LAYOUT, bankOuterWidth, effectiveFacingWidth } from './geometry';

const VA = BANK_LAYOUT.visibleAttachArea;
const W = bankOuterWidth();

/**
 * C15 synth-facing edge for a bank origin (from BORDERS + WidthCalib calibration).
 * Outer banks: effective flush edge. Inner banks: inset by visibleAttachArea (20) on facing side.
 */
export function westFacingX(
  originX: number,
  role: 'outer' | 'inner',
  bank?: Bank,
): number {
  const span = bank ? effectiveFacingWidth(bank) : W;
  return role === 'outer' ? originX + span : originX + VA;
}

export function eastFacingX(
  originX: number,
  role: 'outer' | 'inner',
  bank?: Bank,
): number {
  const span = bank ? effectiveFacingWidth(bank) : W;
  return role === 'outer' ? originX : originX + span - VA;
}

/** Snap origin so the west-facing edge lands on the synth left border. */
export function snapOriginForWestBorder(
  synthLeft: number,
  role: 'outer' | 'inner',
  bank?: Bank,
): number {
  const span = bank ? effectiveFacingWidth(bank) : W;
  return role === 'outer' ? synthLeft - span : synthLeft - VA;
}

/** Snap origin so the east-facing edge lands on the synth right border. */
export function snapOriginForEastBorder(
  synthRight: number,
  role: 'outer' | 'inner',
  bank?: Bank,
): number {
  const span = bank ? effectiveFacingWidth(bank) : W;
  return role === 'outer' ? synthRight : synthRight - span;
}

/** Inner body (rounded rect) edges — what users often read as "the card". */
export function visualBodyEdges(originX: number): { left: number; right: number } {
  const tape = BANK_LAYOUT.tapeSize;
  return {
    left: originX + tape,
    right: originX + tape + BANK_LAYOUT.innerWidth,
  };
}