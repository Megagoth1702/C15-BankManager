/**
 * Bank document-order helpers for sidebar sort and ID renumber.
 * Bank ID (#N) is 1-based index in the document `banks[]` array.
 */
import type { Bank } from '../types/bank';
import { BANK_ATTR } from './bankAttributes';

/** Flat sidebar sorts that produce a total order (not attachment tree). */
export type BankSidebarSortKey =
  | 'name'
  | 'lastChanged'
  | 'importDate'
  | 'exportDate'
  | 'id';
export type SortDirection = 'asc' | 'desc';

/** Parse C15 bank meta ISO (`Date of Import/Export File`) to ms, or null if missing/invalid. */
export function parseBankMetaDateMs(bank: Bank, attrKey: string): number | null {
  const raw = bank.attributes[attrKey];
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareNameThenIndex(
  a: Bank,
  b: Bank,
  dir: number,
  indexByUuid: ReadonlyMap<string, number>,
): number {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  if (byName !== 0) return dir * byName;
  return dir * ((indexByUuid.get(a.uuid) ?? 0) - (indexByUuid.get(b.uuid) ?? 0));
}

/**
 * Compare optional timestamps. Missing values always sort last (both directions).
 * Present values use `dir` (asc = older first, desc = newer first).
 */
function compareOptionalDateMs(
  aMs: number | null,
  bMs: number | null,
  dir: number,
  a: Bank,
  b: Bank,
  indexByUuid: ReadonlyMap<string, number>,
): number {
  if (aMs === null && bMs === null) return compareNameThenIndex(a, b, dir, indexByUuid);
  if (aMs === null) return 1;
  if (bMs === null) return -1;
  if (aMs !== bMs) return dir * (aMs - bMs);
  return compareNameThenIndex(a, b, dir, indexByUuid);
}

/**
 * Sort a copy of `banks` the same way as the Banks sidebar flat list.
 * Stable on ties via original document index, then UUID.
 *
 * - `lastChanged` uses `<last-changed-timestamp>` (content edits).
 * - `importDate` / `exportDate` use bank attributes only (not last-changed fallback).
 */
export function sortBanksList(
  banks: readonly Bank[],
  sortBy: BankSidebarSortKey,
  direction: SortDirection,
): Bank[] {
  const indexByUuid = new Map(banks.map((bank, index) => [bank.uuid, index]));
  const list = [...banks];
  const dir = direction === 'asc' ? 1 : -1;

  list.sort((a, b) => {
    if (sortBy === 'name') {
      return compareNameThenIndex(a, b, dir, indexByUuid);
    }

    if (sortBy === 'id') {
      const byIndex =
        (indexByUuid.get(a.uuid) ?? 0) - (indexByUuid.get(b.uuid) ?? 0);
      if (byIndex !== 0) return dir * byIndex;
      return dir * a.uuid.localeCompare(b.uuid);
    }

    if (sortBy === 'importDate') {
      return compareOptionalDateMs(
        parseBankMetaDateMs(a, BANK_ATTR.dateOfImportFile),
        parseBankMetaDateMs(b, BANK_ATTR.dateOfImportFile),
        dir,
        a,
        b,
        indexByUuid,
      );
    }

    if (sortBy === 'exportDate') {
      return compareOptionalDateMs(
        parseBankMetaDateMs(a, BANK_ATTR.dateOfExportFile),
        parseBankMetaDateMs(b, BANK_ATTR.dateOfExportFile),
        dir,
        a,
        b,
        indexByUuid,
      );
    }

    // lastChanged — Unix seconds; 0 treated as oldest
    const ta = a.lastChangedTimestamp || 0;
    const tb = b.lastChangedTimestamp || 0;
    if (ta !== tb) return dir * (ta - tb);
    return compareNameThenIndex(a, b, dir, indexByUuid);
  });

  return list;
}

function ordersEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((u, i) => u === b[i]);
}

/**
 * Reorder `banks` to match `orderedUuids` (must be a full permutation of bank UUIDs).
 * Returns the same array reference when order is already identical; `null` if the
 * UUID list is incomplete or contains unknown IDs.
 */
export function reorderBanksByUuidOrder(
  banks: readonly Bank[],
  orderedUuids: readonly string[],
): Bank[] | null {
  if (orderedUuids.length !== banks.length) return null;

  const byUuid = new Map(banks.map((bank) => [bank.uuid, bank]));
  if (byUuid.size !== banks.length) return null;

  const next: Bank[] = [];
  for (const uuid of orderedUuids) {
    const bank = byUuid.get(uuid);
    if (!bank) return null;
    next.push(bank);
    byUuid.delete(uuid);
  }
  if (byUuid.size !== 0) return null;

  const currentOrder = banks.map((b) => b.uuid);
  if (ordersEqual(currentOrder, orderedUuids)) {
    return banks as Bank[];
  }
  return next;
}

/** True when `orderedUuids` already matches document order. */
export function bankOrderMatches(
  banks: readonly Bank[],
  orderedUuids: readonly string[],
): boolean {
  if (orderedUuids.length !== banks.length) return false;
  return banks.every((bank, i) => bank.uuid === orderedUuids[i]);
}
