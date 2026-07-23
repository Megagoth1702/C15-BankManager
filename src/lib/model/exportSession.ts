/**
 * Browser export of session backups and single-bank XML files.
 */
import { get } from 'svelte/store';
import { log } from '../debug/sessionLog';
import { downloadBytes, downloadTextFiles } from '../io/download';
import { buildBankXmlFilename, sanitizeBackupFilename } from '../io/filename';
import { compressString } from '../xml/gzip';
import {
  formatSerializeDate,
  serializePresetManagerXml,
  serializeSingleBankXml,
  validateBanksForC15Export,
} from '../xml/serialize';
import { bankMeta, getBanksSnapshot } from './bankState';
import { getPrimarySelectedUuid, setStoreError } from './documentCommit';
import { clearSessionDirty } from './sessionDirty';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Default `.nlbackup` filename matching C15 export naming. */
export function buildDefaultExportFilename(date = new Date()): string {
  const stamp = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${pad2(date.getHours())}-${pad2(date.getMinutes())}`;
  return `${stamp}-nonlinear-c15-banks.nlbackup`;
}

/** Menu label for selected-bank backup export. */
export function exportSelectedBanksLabel(count: number): string {
  return count === 1
    ? 'Export 1 bank as backup'
    : `Export ${count} banks as backup`;
}

/** Menu label for selected-bank single-XML export (one file per bank). */
export function exportSelectedBanksAsXmlLabel(count: number): string {
  return count === 1
    ? 'Export 1 bank as XML'
    : `Export ${count} banks as single XML files`;
}

export interface ExportBackupOptions {
  filename?: string;
  /**
   * When set, only these bank UUIDs are exported (global store order).
   * Omit for a full-session backup.
   */
  bankUuids?: readonly string[];
}

export interface ExportBanksAsXmlOptions {
  /**
   * When set, only these bank UUIDs are exported (global store order).
   * Omit to use current selection.
   */
  bankUuids?: readonly string[];
  /** Stagger between multi-file downloads (ms). Default 150. */
  downloadDelayMs?: number;
}

/** Full-session export (same as `exportBackup()` with no bank filter). */
export function exportAllAsBackup(options: { filename?: string } = {}): boolean {
  return exportBackup(options);
}

/** Export currently selected banks only (`bankMeta.selectedBankUuids`). */
export function exportSelectedBanks(options: { filename?: string } = {}): boolean {
  return exportBackup({
    ...options,
    bankUuids: get(bankMeta).selectedBankUuids,
  });
}

/**
 * Export each selected bank as its own C15 single-bank `.xml` file
 * (one bank per file; filenames from bank names). Does not clear session dirty.
 */
export function exportSelectedBanksAsXml(
  options: ExportBanksAsXmlOptions = {},
): boolean | Promise<boolean> {
  return exportBanksAsXml({
    ...options,
    bankUuids: options.bankUuids ?? get(bankMeta).selectedBankUuids,
  });
}

/**
 * Serialize each bank to a standalone `<bank version="16">` XML and download
 * one file per bank. Never packs multiple banks into one XML.
 * Does not clear session dirty.
 */
export function exportBanksAsXml(
  options: ExportBanksAsXmlOptions = {},
): boolean | Promise<boolean> {
  const allBanks = getBanksSnapshot();
  const uuids = options.bankUuids ?? get(bankMeta).selectedBankUuids;
  const uuidFilter = new Set(uuids);
  const list = allBanks.filter((bank) => uuidFilter.has(bank.uuid));

  if (list.length === 0) {
    setStoreError('No selected banks to export as XML.');
    return false;
  }

  // Attachment mismatch (parent XOR direction) still useful; missing parent is
  // expected when exporting a single bank that was attached in the session.
  const warnings = validateBanksForC15Export(list).filter(
    (w) => !w.includes('references a missing parent bank'),
  );
  if (warnings.length > 0) {
    const proceed = window.confirm(
      `Export warnings:\n\n${warnings.join('\n')}\n\nContinue export anyway?`,
    );
    if (!proceed) return false;
  }

  if (list.length >= 10) {
    const proceed = window.confirm(
      `Download ${list.length} separate XML files (one per bank)?`,
    );
    if (!proceed) return false;
  }

  const serializeDate = formatSerializeDate();
  const usedNames = new Set<string>();
  const files: { text: string; filename: string }[] = [];

  try {
    for (const bank of list) {
      const filename = buildBankXmlFilename(bank.name, usedNames);
      const text = serializeSingleBankXml(bank, {
        serializeDate,
        attributeOverrides: {
          'Date of Export File': serializeDate,
          'Name of Export File': filename,
        },
      });
      files.push({ text, filename });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStoreError(message);
    log('export', 'exportBanksAsXml serialize failed', message, 'error');
    return false;
  }

  const finishOk = (): boolean => {
    bankMeta.update((m) => ({ ...m, error: null }));
    log('export', 'exportBanksAsXml ok', {
      bankCount: files.length,
      filenames: files.map((f) => f.filename),
      warnings,
    });
    return true;
  };

  if (files.length === 1) {
    try {
      void downloadTextFiles(files, { delayMs: 0 });
      return finishOk();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStoreError(message);
      log('export', 'exportBanksAsXml download failed', message, 'error');
      return false;
    }
  }

  return downloadTextFiles(files, {
    delayMs: options.downloadDelayMs ?? 150,
  })
    .then(() => finishOk())
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setStoreError(message);
      log('export', 'exportBanksAsXml download failed', message, 'error');
      return false;
    });
}

/**
 * Serialize banks to gzip `.nlbackup` and trigger a browser download.
 * Full export (no `bankUuids`, or filter covers every bank) clears session dirty;
 * partial export does not.
 */
export function exportBackup(options: ExportBackupOptions = {}): boolean {
  const allBanks = getBanksSnapshot();
  const isSubset = options.bankUuids !== undefined;
  const uuidFilter = isSubset ? new Set(options.bankUuids) : null;
  const list = uuidFilter
    ? allBanks.filter((bank) => uuidFilter.has(bank.uuid))
    : allBanks;

  if (list.length === 0) {
    setStoreError(isSubset ? 'No selected banks to export.' : 'No banks to export.');
    return false;
  }

  const isFullExport = list.length === allBanks.length;

  const warnings = validateBanksForC15Export(list);
  if (warnings.length > 0) {
    const proceed = window.confirm(
      `Export warnings:\n\n${warnings.join('\n')}\n\nContinue export anyway?`,
    );
    if (!proceed) return false;
  }

  const suggested = buildDefaultExportFilename();
  let rawFilename = options.filename;
  if (!rawFilename) {
    const chosen = window.prompt('Save backup as:', suggested);
    if (chosen === null) return false;
    rawFilename = chosen;
  }

  const meta = get(bankMeta);
  const primarySelected = getPrimarySelectedUuid();
  const selectedInExport =
    primarySelected && list.some((b) => b.uuid === primarySelected)
      ? primarySelected
      : list[0]!.uuid;

  try {
    const filename = sanitizeBackupFilename(rawFilename);
    const serializeDate = formatSerializeDate();
    const xml = serializePresetManagerXml({
      banks: list,
      serializeDate,
      selectedBankUuid: selectedInExport,
      selectedMidiBankUuid: meta.selectedMidiBankUuid,
    });
    const bytes = compressString(xml);

    downloadBytes(bytes, filename);
    if (isFullExport) {
      clearSessionDirty();
    }
    bankMeta.update((m) => ({ ...m, error: null }));
    log('export', 'exportBackup ok', {
      filename,
      bankCount: list.length,
      fullExport: isFullExport,
      byteLength: bytes.length,
      warnings,
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStoreError(message);
    log('export', 'exportBackup failed', message, 'error');
    return false;
  }
}
