/**
 * Visible attach corridor rects (attachL/R/T/B) — the 20-unit strips used for
 * bank–bank dock hit-test and drag-time corridor UI. Not tape margins.
 *
 * Geometry matches BankCard `showAttachSlots` and bank debug overlay regions.
 */
import type { Bank } from '../types/bank';
import {
  BANK_LAYOUT,
  bankInnerBodyHeight,
  effectiveFacingWidth,
} from './geometry';

export type AttachCorridorId = 'L' | 'R' | 'T' | 'B';

export interface AttachCorridorRect {
  id: AttachCorridorId;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AttachCorridors = Record<AttachCorridorId, AttachCorridorRect>;

/** Axis-aligned positive intersection area of two rects (0 if only touching). */
export function rectOverlapArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const overlapW =
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapH =
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (overlapW <= 0 || overlapH <= 0) return 0;
  return overlapW * overlapH;
}

/** Center of a corridor rect (for dock tie-break distance). */
export function rectCenter(r: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number } {
  return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 };
}

/**
 * Four attach corridors for a bank at display origin `(originX, originY)`.
 *
 * - attachL: west of chrome, VA × innerH
 * - attachR: east of facing span, VA × innerH
 * - attachT: above chrome top, facingW × VA
 * - attachB: below chrome bottom, facingW × VA
 */
export function attachCorridorsForBank(
  bank: Bank,
  originX: number,
  originY: number,
): AttachCorridors {
  const tape = BANK_LAYOUT.tapeSize;
  const va = BANK_LAYOUT.visibleAttachArea;
  const facingW = effectiveFacingWidth(bank);
  const innerH = bankInnerBodyHeight(bank);
  const chromeTop = originY + tape;
  const chromeBottom = chromeTop + innerH;

  return {
    L: {
      id: 'L',
      x: originX - va,
      y: chromeTop,
      width: va,
      height: innerH,
    },
    R: {
      id: 'R',
      x: originX + facingW,
      y: chromeTop,
      width: va,
      height: innerH,
    },
    T: {
      id: 'T',
      x: originX,
      y: chromeTop - va,
      width: facingW,
      height: va,
    },
    B: {
      id: 'B',
      x: originX,
      y: chromeBottom,
      width: facingW,
      height: va,
    },
  };
}

/** Session cache entry for dock hit-test (reuse corridors while origin is stable). */
export type AttachCorridorCacheEntry = {
  originX: number;
  originY: number;
  corridors: AttachCorridors;
};

export type AttachCorridorCache = Map<string, AttachCorridorCacheEntry>;

/**
 * Return attach corridors for `(bank, origin)`, reusing a session cache when the
 * display origin is unchanged. Callers clear the map at drag end.
 */
export function attachCorridorsForBankCached(
  cache: AttachCorridorCache | undefined,
  bank: Bank,
  originX: number,
  originY: number,
): AttachCorridors {
  if (!cache) return attachCorridorsForBank(bank, originX, originY);
  const prev = cache.get(bank.uuid);
  if (prev && prev.originX === originX && prev.originY === originY) {
    return prev.corridors;
  }
  const corridors = attachCorridorsForBank(bank, originX, originY);
  cache.set(bank.uuid, { originX, originY, corridors });
  return corridors;
}
