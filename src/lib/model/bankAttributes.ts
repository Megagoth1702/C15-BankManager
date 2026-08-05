import type { Bank } from '../types/bank';

/** C15 bank attribute keys used in NonMaps Bank Info / export. */
export const BANK_ATTR = {
  comment: 'Comment',
  nameOfImportFile: 'Name of Import File',
  dateOfImportFile: 'Date of Import File',
  nameOfExportFile: 'Name of Export File',
  dateOfExportFile: 'Date of Export File',
} as const;

/** Browser download export name used by C15 WebUI (`BankActions`). */
export const BROWSER_EXPORT_FILE_LABEL = '(via Browser)';

/**
 * C15 Bank::calcStateString values (computed, not stored in XML).
 * @see `_ref/nl-firmware/.../presets/Bank.cpp`
 */
export type BankSaveState =
  | 'Unchanged since Import'
  | 'Saved by Export'
  | 'Not Saved By Export';

export function getBankComment(bank: Bank): string {
  return bank.attributes[BANK_ATTR.comment] ?? '';
}

export function getBankAttribute(bank: Bank, key: string): string {
  return bank.attributes[key] ?? '';
}

/** ISO-8601 UTC without fractional seconds (`YYYY-MM-DDTHH:mm:ssZ`). */
export function formatBankMetaIso(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Unix seconds → ISO string matching C15 `TimeTools::getIsoTime` (UTC, no ms). */
export function isoFromUnixSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return formatBankMetaIso(new Date(Math.floor(seconds) * 1000));
}

/**
 * Mirror of C15 `Bank::calcStateString`:
 * compares last-change (with 5s tolerance) to import/export date attributes.
 */
export function calcBankStateString(bank: Bank): BankSaveState {
  const timestampWithTolerance = (bank.lastChangedTimestamp || 0) - 5;
  const lastModTimeIso = isoFromUnixSeconds(timestampWithTolerance) || '-1';
  const lastExportTimeIso = getBankAttribute(bank, BANK_ATTR.dateOfExportFile) || '-1';
  const lastImportTime = getBankAttribute(bank, BANK_ATTR.dateOfImportFile) || '-1';

  if (lastImportTime !== '-1' && lastModTimeIso <= lastImportTime) {
    return 'Unchanged since Import';
  }
  if (lastModTimeIso.localeCompare(lastExportTimeIso) < 0 || lastModTimeIso === lastExportTimeIso) {
    return 'Saved by Export';
  }
  return 'Not Saved By Export';
}

/**
 * Stamp import metadata like C15 `PresetManagerUseCases::importBankFromStream`.
 * Clears export attributes when `clearExport` is true (device default).
 */
export function stampImportAttributes(
  bank: Bank,
  fileName: string,
  dateIso: string = formatBankMetaIso(),
  options: { clearExport?: boolean } = {},
): Bank {
  const clearExport = options.clearExport !== false;
  const nextAttrs = { ...bank.attributes };
  nextAttrs[BANK_ATTR.nameOfImportFile] = fileName;
  nextAttrs[BANK_ATTR.dateOfImportFile] = dateIso;
  if (clearExport) {
    delete nextAttrs[BANK_ATTR.nameOfExportFile];
    delete nextAttrs[BANK_ATTR.dateOfExportFile];
  }
  return { ...bank, attributes: nextAttrs };
}

/** Stamp export metadata (written into export file and session). */
export function stampExportAttributes(
  bank: Bank,
  fileName: string,
  dateIso: string = formatBankMetaIso(),
): Bank {
  return {
    ...bank,
    attributes: {
      ...bank.attributes,
      [BANK_ATTR.nameOfExportFile]: fileName,
      [BANK_ATTR.dateOfExportFile]: dateIso,
    },
  };
}

export function stampBanksForImport(
  bankList: readonly Bank[],
  fileName: string,
  dateIso: string = formatBankMetaIso(),
  options: { clearExport?: boolean } = {},
): Bank[] {
  return bankList.map((bank) => stampImportAttributes(bank, fileName, dateIso, options));
}

/**
 * Return a new bank list with one bank's attribute set (or removed when value is empty).
 */
export function applyBankAttribute(
  banks: readonly Bank[],
  bankUuid: string,
  key: string,
  value: string,
): Bank[] | null {
  const idx = banks.findIndex((b) => b.uuid === bankUuid);
  if (idx < 0) return null;

  const bank = banks[idx]!;
  const trimmed = value.trim();
  const nextAttrs = { ...bank.attributes };
  if (trimmed) {
    nextAttrs[key] = trimmed;
  } else {
    delete nextAttrs[key];
  }

  if ((bank.attributes[key] ?? '') === (nextAttrs[key] ?? '')) {
    return [...banks];
  }

  const next = banks.slice();
  next[idx] = {
    ...bank,
    attributes: nextAttrs,
    lastChangedTimestamp: Math.floor(Date.now() / 1000),
  };
  return next;
}

export function applyBankComment(
  banks: readonly Bank[],
  bankUuid: string,
  comment: string,
): Bank[] | null {
  return applyBankAttribute(banks, bankUuid, BANK_ATTR.comment, comment);
}

export interface BankInfoSummary {
  name: string;
  comment: string;
  presetCount: number;
  state: BankSaveState;
  lastChange: string;
  importFile: string;
  importDate: string;
  exportFile: string;
  exportDate: string;
}

export function bankInfoSummary(bank: Bank): BankInfoSummary {
  return {
    name: bank.name,
    comment: getBankComment(bank),
    presetCount: bank.presetOrder.length,
    state: calcBankStateString(bank),
    lastChange: isoFromUnixSeconds(bank.lastChangedTimestamp),
    importFile: getBankAttribute(bank, BANK_ATTR.nameOfImportFile),
    importDate: getBankAttribute(bank, BANK_ATTR.dateOfImportFile),
    exportFile: getBankAttribute(bank, BANK_ATTR.nameOfExportFile),
    exportDate: getBankAttribute(bank, BANK_ATTR.dateOfExportFile),
  };
}
