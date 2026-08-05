import { BANK_LAYOUT } from '../canvas/geometry';
import type { AttachDirection, Bank } from '../types/bank';

/** C15 firmware only persists `left` and `top` (see Bank::toAttachDirection). */
export function attachDirectionForC15(direction: AttachDirection | null): string {
  if (!direction) return '';
  switch (direction) {
    case 'left':
    case 'right':
      return 'left';
    case 'top':
    case 'bottom':
      return 'top';
    default:
      return '';
  }
}

export function snapCoordForC15(value: number): number {
  const grid = BANK_LAYOUT.snapGrid;
  return Math.round(value / grid) * grid;
}

/** Format `<x>` / `<y>` like device backups (integers when on-grid, else trimmed decimals). */
export function formatCoordForC15Xml(value: number): string {
  const snapped = snapCoordForC15(value);
  const rounded = Math.round(snapped);
  if (Math.abs(snapped - rounded) < 1e-6) {
    return String(rounded);
  }
  return snapped
    .toFixed(6)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

/** Device stores Unix seconds in `<last-changed-timestamp>`. */
export function formatLastChangedTimestamp(value: number): string {
  const seconds =
    value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  return String(Math.max(0, seconds));
}

export function serializeAttachmentFields(bank: Bank): {
  attachedToUuid: string;
  attachDirection: string;
} {
  const attachedToUuid = bank.attachedToUuid ?? '';
  let attachDirection = attachDirectionForC15(bank.attachDirection);

  if (attachedToUuid && !attachDirection) {
    attachDirection = 'left';
  }
  if (!attachedToUuid) {
    attachDirection = '';
  }

  return { attachedToUuid, attachDirection };
}

/**
 * For a partial export set: clear attach links whose parent is not in the set.
 * Intention of "export these banks" is free-standing banks in the file — not a
 * warning dialog. Does not mutate the input; session should keep real links.
 */
export function detachOrphanAttachmentsForExport(banks: readonly Bank[]): Bank[] {
  const inSet = new Set(banks.map((b) => b.uuid.toLowerCase()));
  return banks.map((bank) => {
    const parent = bank.attachedToUuid;
    if (!parent) {
      // Direction without parent is inconsistent — clear for the file only.
      if (bank.attachDirection) {
        return { ...bank, attachDirection: null };
      }
      return bank;
    }
    if (inSet.has(parent.toLowerCase())) {
      return bank;
    }
    return { ...bank, attachedToUuid: null, attachDirection: null };
  });
}

export function validateBanksForC15Export(banks: Bank[]): string[] {
  const byUuid = new Map(banks.map((bank) => [bank.uuid.toLowerCase(), bank]));
  const warnings: string[] = [];

  for (const bank of banks) {
    const hasParent = Boolean(bank.attachedToUuid);
    const hasDir = Boolean(bank.attachDirection);

    if (hasParent !== hasDir) {
      warnings.push(
        `"${bank.name}" has attachment metadata mismatch (parent ${hasParent ? 'set' : 'missing'}, direction ${hasDir ? 'set' : 'missing'}).`,
      );
    }

    if (hasParent && bank.attachedToUuid && !byUuid.has(bank.attachedToUuid.toLowerCase())) {
      // Callers should run detachOrphanAttachmentsForExport first for subset
      // exports; this remains for truly corrupt full-session data.
      warnings.push(`"${bank.name}" references a missing parent bank.`);
    }
  }

  return warnings;
}