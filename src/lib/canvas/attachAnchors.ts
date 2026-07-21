import { bankOuterHeight, effectiveFacingWidth } from './geometry';
import type { AttachDirection, Bank } from '../types/bank';

/** C15 coordinate of attach handle on a bank's outer edge (line anchor). */
export function attachHandleAnchorC15(
  bank: Bank,
  direction: AttachDirection,
  originX = bank.x,
  originY = bank.y,
): { x: number; y: number } {
  const w = effectiveFacingWidth(bank);
  const h = bankOuterHeight(bank);

  switch (direction) {
    case 'left':
      return { x: originX, y: originY + h / 2 };
    case 'right':
      return { x: originX + w, y: originY + h / 2 };
    case 'top':
      return { x: originX + w / 2, y: originY };
    case 'bottom':
      return { x: originX + w / 2, y: originY + h };
  }
}