/**
 * Browser export of session backups and single-bank XML files.
 *
 * Offline sessions with full parameter trees serialize locally.
 * Live / post-Live shell sessions fetch full sound data from the C15
 * (`/presets/download-banks` or `/banks/download-bank`) before writing files.
 */
import { get } from 'svelte/store';
import { log } from '../debug/sessionLog';
import { downloadBytes, downloadTextFiles } from '../io/download';
import { buildBankXmlFilename, sanitizeBackupFilename } from '../io/filename';
import {
  beginLiveImportJob,
  endLiveImportJob,
  getLiveImportBusy,
  updateLiveImportJob,
} from '../live/liveImportJob';
import { downloadBankXml, downloadBanksBackup } from '../live/liveHttp';
import { hydrateBanksWithSoundData } from '../live/hydrateSoundData';
import {
  bankHasFullSoundData,
  banksMissingFullSoundData,
  isLiveReadyForImport,
} from '../live/liveDeviceImport';
import { getLiveSettingsSnapshot } from '../live/liveSettings';
import type { Bank } from '../types/bank';
import { alertAppDialog, confirmAppDialog, promptAppDialog } from '../ui/appDialog';
import { compressString } from '../xml/gzip';
import { parseFileBytes, parseSingleBankXml } from '../xml/parse';
import {
  detachOrphanAttachmentsForExport,
  formatSerializeDate,
  serializePresetManagerXml,
  serializeSingleBankXml,
  validateBanksForC15Export,
} from '../xml/serialize';
import {
  BROWSER_EXPORT_FILE_LABEL,
  stampExportAttributes,
} from './bankAttributes';
import { bankMeta, banks, getBanksSnapshot } from './bankState';
import { getPrimarySelectedUuid, setStoreError } from './documentCommit';
import { clearSessionDirty, markSessionDirty } from './sessionDirty';

/** User-facing error when session is shell-only and device is not available. */
export const SHELL_EXPORT_OFFLINE_MESSAGE =
  'This session only has preset names/metadata (no sound parameters) — typical after Live mode without a full device download.\n\n' +
  'Reconnect to the C15 and export again (full sound data is fetched from the device), or import a real offline .nlbackup / .xml first.';

/**
 * Persist export **attribute** stamps only. Never replace whole banks from the
 * file-export copy (that copy may have orphan attachments detached).
 */
function persistExportStampsInSession(
  stampedByUuid: Map<string, Bank>,
  options: { markDirty: boolean },
): void {
  const next = getBanksSnapshot().map((bank) => {
    const stamped = stampedByUuid.get(bank.uuid);
    if (!stamped) return bank;
    return { ...bank, attributes: { ...stamped.attributes } };
  });
  banks.set(next);
  if (options.markDirty) {
    markSessionDirty();
  }
}

/**
 * File-only prep: drop attach edges to parents outside the export set, then
 * validate. Subset export intentionally free-stands those banks — no warning.
 */
function banksPreparedForExportFile(list: readonly Bank[]): {
  forFile: Bank[];
  warnings: string[];
} {
  const forFile = detachOrphanAttachmentsForExport(list);
  const detached = list.filter((b, i) => {
    const next = forFile[i]!;
    return (
      (b.attachedToUuid ?? null) !== (next.attachedToUuid ?? null) ||
      (b.attachDirection ?? null) !== (next.attachDirection ?? null)
    );
  });
  if (detached.length > 0) {
    log('export', 'detached orphan attachments for file', {
      count: detached.length,
      names: detached.map((b) => b.name),
    });
  }
  return { forFile, warnings: validateBanksForC15Export(forFile) };
}

/** Apply hydrated banks into the store (layout preserved inside hydrate helper). */
function commitHydratedBanks(nextBanks: Bank[]): void {
  banks.set(nextBanks);
}

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

/** True when every bank in the list has full parameter data (or is empty). */
export function banksHaveFullSoundData(list: readonly Bank[]): boolean {
  return banksMissingFullSoundData(list).length === 0;
}

/**
 * Ensure `list` has full sound data. When Live and shells are present, fetch
 * from the device and hydrate the session. Returns banks ready to serialize
 * (same UUIDs as `list`, possibly with filled rawXml), or null on failure.
 */
async function ensureFullSoundForExport(
  list: readonly Bank[],
  options: { mode: 'backup' | 'xml'; purpose: string },
): Promise<Bank[] | null> {
  if (banksHaveFullSoundData(list)) {
    return [...list];
  }

  const missing = banksMissingFullSoundData(list);
  const live = isLiveReadyForImport();

  if (!live) {
    setStoreError(SHELL_EXPORT_OFFLINE_MESSAGE);
    log(
      'export',
      'blocked thin shell export (offline)',
      {
        purpose: options.purpose,
        missingBanks: missing.map((b) => b.name),
        missingCount: missing.length,
      },
      'error',
    );
    await alertAppDialog({
      title: 'Cannot export sound data',
      message: SHELL_EXPORT_OFFLINE_MESSAGE,
      confirmLabel: 'OK',
    });
    return null;
  }

  if (getLiveImportBusy()) {
    const msg =
      'C15 is busy with another transfer. Wait until it finishes, then export again.';
    setStoreError(msg);
    log('export', 'blocked — live job busy', msg, 'warn');
    return null;
  }

  const settings = getLiveSettingsSnapshot();
  const sessionSnap = getBanksSnapshot();
  const listUuidSet = new Set(list.map((b) => b.uuid.toLowerCase()));
  const isFullSessionList =
    list.length === sessionSnap.length &&
    sessionSnap.every((b) => listUuidSet.has(b.uuid.toLowerCase()));

  beginLiveImportJob({
    phase: 'sending',
    label: 'Fetching full backup from C15…',
    detail:
      'The synthesizer may freeze briefly (splash) while building the backup. Please wait.',
    total: list.length,
  });

  try {
    // Full session or large subset: one device full backup is best.
    // Small subset for XML: per-bank download avoids parsing a huge library.
    const usePerBank =
      options.mode === 'xml' && list.length <= 12 && !isFullSessionList;

    if (usePerBank) {
      updateLiveImportJob({
        label: 'Downloading banks from C15…',
        detail: `0 / ${list.length}`,
        current: 0,
        total: list.length,
      });
      const fullByUuid = new Map<string, Bank>();
      for (let i = 0; i < list.length; i++) {
        const bank = list[i]!;
        updateLiveImportJob({
          current: i + 1,
          detail: `${i + 1} / ${list.length} — ${bank.name}`,
        });
        if (bankHasFullSoundData(bank)) {
          fullByUuid.set(bank.uuid.toLowerCase(), bank);
          continue;
        }
        const xml = await downloadBankXml(settings, bank.uuid);
        const parsed = parseSingleBankXml(xml);
        if (!bankHasFullSoundData(parsed)) {
          throw new Error(
            `Device bank "${bank.name}" still has no parameter data after download-bank`,
          );
        }
        fullByUuid.set(bank.uuid.toLowerCase(), parsed);
      }

      const sourceBanks = list.map(
        (b) => fullByUuid.get(b.uuid.toLowerCase()) ?? b,
      );
      const hydrated = hydrateBanksWithSoundData(getBanksSnapshot(), sourceBanks);
      commitHydratedBanks(hydrated.banks);
      log('export', 'hydrated from per-bank download', {
        hydratedPresetCount: hydrated.hydratedPresetCount,
        stillMissing: hydrated.banksStillMissing,
      });

      const ready = list.map((b) => {
        const fromSession = hydrated.banks.find(
          (h) => h.uuid.toLowerCase() === b.uuid.toLowerCase(),
        );
        return fromSession ?? b;
      });
      if (!banksHaveFullSoundData(ready)) {
        throw new Error(
          `Still missing sound data after device download: ${hydrated.banksStillMissing.join(', ')}`,
        );
      }
      endLiveImportJob({ label: 'Device banks ready' });
      return ready;
    }

    updateLiveImportJob({
      label: 'Fetching full backup from C15…',
      detail: 'Downloading .nlbackup from the synthesizer…',
      phase: 'sending',
    });

    const buffer = await downloadBanksBackup(settings);
    const bytes = new Uint8Array(buffer);
    updateLiveImportJob({
      label: 'Reading device backup…',
      detail: `${Math.round(bytes.byteLength / 1024)} KB received — parsing…`,
      phase: 'waiting-sync',
    });

    const doc = parseFileBytes(bytes, 'device-download.nlbackup');
    if (!banksHaveFullSoundData(doc.banks)) {
      const thin = banksMissingFullSoundData(doc.banks).length;
      throw new Error(
        `Device backup still lacks parameter trees (${thin} thin bank(s)). Firmware or proxy may have returned a bad body.`,
      );
    }

    const hydrated = hydrateBanksWithSoundData(getBanksSnapshot(), doc.banks);
    commitHydratedBanks(hydrated.banks);
    log('export', 'hydrated from download-banks', {
      deviceBanks: doc.banks.length,
      hydratedPresetCount: hydrated.hydratedPresetCount,
      stillMissing: hydrated.banksStillMissing,
      byteLength: bytes.byteLength,
    });

    // Prefer device bodies for the export list (UUID match); keep session order.
    const deviceByUuid = new Map(
      doc.banks.map((b) => [b.uuid.toLowerCase(), b] as const),
    );
    const sessionByUuid = new Map(
      hydrated.banks.map((b) => [b.uuid.toLowerCase(), b] as const),
    );

    const ready: Bank[] = [];
    for (const b of list) {
      const key = b.uuid.toLowerCase();
      const fromSession = sessionByUuid.get(key);
      const fromDevice = deviceByUuid.get(key);
      // Use hydrated session bank (layout from session + sound from device).
      const pick = fromSession ?? fromDevice;
      if (!pick || !bankHasFullSoundData(pick)) {
        // Device-only bank not in list shouldn't happen for full export.
        if (fromDevice && bankHasFullSoundData(fromDevice)) {
          ready.push(fromDevice);
          continue;
        }
        throw new Error(
          `No full sound data for bank "${b.name}" (${b.uuid}) after device download`,
        );
      }
      ready.push(pick);
    }

    endLiveImportJob({ label: 'Full backup ready' });
    return ready;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    endLiveImportJob({ error: message, label: 'Export download failed' });
    setStoreError(message);
    log('export', 'device full-sound fetch failed', message, 'error');
    return null;
  }
}

/** Full-session export (same as `exportBackup()` with no bank filter). */
export function exportAllAsBackup(options: { filename?: string } = {}): Promise<boolean> {
  return exportBackup(options);
}

/** Export currently selected banks only (`bankMeta.selectedBankUuids`). */
export function exportSelectedBanks(options: { filename?: string } = {}): Promise<boolean> {
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
): Promise<boolean> {
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
export async function exportBanksAsXml(
  options: ExportBanksAsXmlOptions = {},
): Promise<boolean> {
  const allBanks = getBanksSnapshot();
  const uuids = options.bankUuids ?? get(bankMeta).selectedBankUuids;
  const uuidFilter = new Set(uuids);
  const list = allBanks.filter((bank) => uuidFilter.has(bank.uuid));

  if (list.length === 0) {
    setStoreError('No selected banks to export as XML.');
    return false;
  }

  if (!banksHaveFullSoundData(list) && !isLiveReadyForImport()) {
    setStoreError(SHELL_EXPORT_OFFLINE_MESSAGE);
    log(
      'export',
      'blocked thin shell XML export (offline)',
      { missingCount: banksMissingFullSoundData(list).length },
      'error',
    );
    await alertAppDialog({
      title: 'Cannot export sound data',
      message: SHELL_EXPORT_OFFLINE_MESSAGE,
      confirmLabel: 'OK',
    });
    return false;
  }

  if (list.length >= 10) {
    const proceed = await confirmAppDialog({
      title: 'Download many files',
      message: `Download ${list.length} separate XML files (one per bank)?\n\nYour browser may ask permission for multiple downloads.`,
      confirmLabel: 'Download',
    });
    if (!proceed) return false;
  }

  const ready = await ensureFullSoundForExport(list, {
    mode: 'xml',
    purpose: 'exportBanksAsXml',
  });
  if (!ready) return false;

  // Orphan parents outside the selection are cleared in the file only (no warn).
  const { forFile, warnings } = banksPreparedForExportFile(ready);
  if (warnings.length > 0) {
    const proceed = await confirmAppDialog({
      title: 'Export warnings',
      message: `${warnings.join('\n')}\n\nContinue export anyway?`,
      confirmLabel: 'Export anyway',
      danger: true,
    });
    if (!proceed) return false;
  }

  const serializeDate = formatSerializeDate();
  const usedNames = new Set<string>();
  const files: { text: string; filename: string }[] = [];
  const stampedByUuid = new Map<string, Bank>();

  try {
    for (const bank of forFile) {
      const filename = buildBankXmlFilename(bank.name, usedNames);
      // Offline tool records the download name; C15 WebUI uses "(via Browser)".
      const exportName = filename || BROWSER_EXPORT_FILE_LABEL;
      const stamped = stampExportAttributes(bank, exportName, serializeDate);
      stampedByUuid.set(bank.uuid, stamped);
      const text = serializeSingleBankXml(stamped, { serializeDate });
      files.push({ text, filename });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStoreError(message);
    log('export', 'exportBanksAsXml serialize failed', message, 'error');
    return false;
  }

  const finishOk = (): boolean => {
    persistExportStampsInSession(stampedByUuid, { markDirty: true });
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
 *
 * When the session only has Live shells, fetches full sound data from the C15
 * first (while Live) or blocks with a clear error (offline shells).
 */
export async function exportBackup(options: ExportBackupOptions = {}): Promise<boolean> {
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
  const needsDevice = !banksHaveFullSoundData(list);

  // Fail fast offline when only Live shells are present (before filename prompt).
  if (needsDevice && !isLiveReadyForImport()) {
    setStoreError(SHELL_EXPORT_OFFLINE_MESSAGE);
    log(
      'export',
      'blocked thin shell export (offline)',
      {
        purpose: isFullExport ? 'exportAllAsBackup' : 'exportSelectedBanks',
        missingCount: banksMissingFullSoundData(list).length,
      },
      'error',
    );
    await alertAppDialog({
      title: 'Cannot export sound data',
      message: SHELL_EXPORT_OFFLINE_MESSAGE,
      confirmLabel: 'OK',
    });
    return false;
  }

  if (needsDevice && isLiveReadyForImport()) {
    const proceed = await confirmAppDialog({
      title: 'Fetch full backup from C15?',
      message:
        'This session only has preset metadata from Live mode (no sound parameters).\n\n' +
        'Export will download the full library from the synthesizer. The C15 may freeze briefly (splash screen). Continue?',
      confirmLabel: 'Download from C15',
    });
    if (!proceed) return false;
  }

  const suggested = buildDefaultExportFilename();
  let rawFilename = options.filename;
  if (!rawFilename) {
    const chosen = await promptAppDialog({
      title: 'Save backup',
      message: needsDevice
        ? 'File name for the .nlbackup download (full sound data from C15):'
        : 'File name for the .nlbackup download:',
      defaultValue: suggested,
      confirmLabel: 'Download',
    });
    if (chosen === null) return false;
    rawFilename = chosen;
  }

  const ready = await ensureFullSoundForExport(list, {
    mode: 'backup',
    purpose: isFullExport ? 'exportAllAsBackup' : 'exportSelectedBanks',
  });
  if (!ready) return false;

  // Subset export: parents outside the selection are free-stood in the file only.
  const { forFile, warnings } = banksPreparedForExportFile(ready);
  if (warnings.length > 0) {
    const proceed = await confirmAppDialog({
      title: 'Export warnings',
      message: `${warnings.join('\n')}\n\nContinue export anyway?`,
      confirmLabel: 'Export anyway',
      danger: true,
    });
    if (!proceed) return false;
  }

  const meta = get(bankMeta);
  const primarySelected = getPrimarySelectedUuid();
  const selectedInExport =
    primarySelected && forFile.some((b) => b.uuid === primarySelected)
      ? primarySelected
      : forFile[0]!.uuid;

  try {
    const filename = sanitizeBackupFilename(rawFilename);
    const serializeDate = formatSerializeDate();
    // C15 browser export stamps "(via Browser)"; also keep the chosen download name.
    const exportLabel = filename || BROWSER_EXPORT_FILE_LABEL;
    const stampedList = forFile.map((bank) =>
      stampExportAttributes(bank, exportLabel, serializeDate),
    );
    const stampedByUuid = new Map(stampedList.map((bank) => [bank.uuid, bank]));
    const xml = serializePresetManagerXml({
      banks: stampedList,
      serializeDate,
      selectedBankUuid: selectedInExport,
      selectedMidiBankUuid: meta.selectedMidiBankUuid,
    });
    const outBytes = compressString(xml);

    downloadBytes(outBytes, filename);
    persistExportStampsInSession(stampedByUuid, { markDirty: !isFullExport });
    if (isFullExport) {
      clearSessionDirty();
    }
    bankMeta.update((m) => ({ ...m, error: null }));
    log('export', 'exportBackup ok', {
      filename,
      bankCount: forFile.length,
      fullExport: isFullExport,
      byteLength: outBytes.length,
      fetchedFromDevice: needsDevice,
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
