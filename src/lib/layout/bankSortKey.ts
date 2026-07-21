import type { Bank } from '../types/bank';

const IMPORT_DATE_ATTR = 'Date of Import File';

/** Milliseconds since epoch; `Number.MAX_SAFE_INTEGER` when no date is available. */
export function bankCreationSortKey(bank: Bank): number {
  const importDate = bank.attributes[IMPORT_DATE_ATTR];
  if (importDate) {
    const parsed = Date.parse(importDate);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (bank.bankSerializeDate) {
    const parsed = Date.parse(bank.bankSerializeDate);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (bank.lastChangedTimestamp > 0) {
    return bank.lastChangedTimestamp * 1000;
  }

  return Number.MAX_SAFE_INTEGER;
}

export function compareBanksByCreationDate(a: Bank, b: Bank): number {
  const keyDiff = bankCreationSortKey(a) - bankCreationSortKey(b);
  if (keyDiff !== 0) return keyDiff;
  return a.name.localeCompare(b.name);
}