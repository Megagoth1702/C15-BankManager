/**
 * Import file / folder / mass-import orchestration into the bank store.
 */
import { get } from 'svelte/store';
import {
  logPositionChanges,
  logPositionSnapshot,
} from '../debug/positionLog';
import { isAppDebugEnabled } from '../debug/debugFlags';
import {
  buildSingleBankViewportCheck,
  logSingleBankViewportCheck,
} from '../debug/singleBankImportLog';
import { log } from '../debug/sessionLog';
import {
  folderLabelFromImportable,
  toImportableFiles,
  type ImportableFile,
} from '../io/folderPicker';
import {
  buildLayoutImportReport,
  logLayoutImportReport,
} from '../layout/layoutImportReport';
import {
  getCanvasScreenSize,
  positionBanksAtViewportCenter,
} from '../canvas/pointerPosition';
import { focusBank, viewport } from '../canvas/viewport.svelte';
import type { Bank, PresetManagerDoc } from '../types/bank';
import { parseFileBytes } from '../xml/parse';
import { stampBanksForImport } from './bankAttributes';
import {
  bankMeta,
  banks,
  clearUserPositioned,
  getBanksSnapshot,
} from './bankState';
import { mergeBankLists, type MergeBankListsOptions } from './importMerge';
import {
  runMassImportPipeline,
  type MassImportOptions,
  type MassImportResult,
} from './massImport';
import {
  countAttachedBanks,
  healAttachedPositionsOnImport,
} from './positioning';
import {
  autoSendImportToDevice,
  beginLiveImportPrepare,
  cancelLiveImportPrepare,
  confirmLiveLibraryReplace,
  isLiveReadyForImport,
} from '../live/liveDeviceImport';
import { selectBank } from './selectionCommands';
import { clearSessionDirty, markSessionDirty } from './sessionDirty';
import { setShowSynthZone } from './settingsCommands';
import { clearHistory } from './undoHistory';

/**
 * Option B: after a local import succeeds while Live, push banks to the C15
 * and keep bankMeta.loading true until the device job finishes (cold UI).
 *
 * A preparing freeze should already be active (beginLiveImportPrepare) so the
 * job is not skipped — getLiveImportBusy alone used to abort the send entirely.
 */
async function maybeLiveAutoSend(
  importedBanks: Bank[],
  canvasMode: 'merge' | 'replace',
): Promise<void> {
  if (importedBanks.length === 0) {
    cancelLiveImportPrepare();
    return;
  }
  if (!isLiveReadyForImport()) {
    cancelLiveImportPrepare();
    return;
  }

  const result = await autoSendImportToDevice(importedBanks, canvasMode);
  if (!result) {
    // Nothing to send / not live — autoSend ends the job itself.
    return;
  }

  if (!result.ok && result.errors.length > 0) {
    bankMeta.update((m) => ({
      ...m,
      error: `Local import ok; C15 send failed: ${result.errors.slice(0, 2).join('; ')}`,
    }));
  } else if (result.ok && result.sent > 0) {
    log('import', 'live auto-send ok', {
      mode: result.mode,
      sent: result.sent,
    });
  }
}

/**
 * After mass import: select the top-left-most free bank among the import and pan to it.
 * Keeps the user's current zoom (no fit-to-content).
 */
function focusMassImportResult(importedBanks: Bank[]): void {
  if (importedBanks.length === 0) return;

  const freeRoots = importedBanks.filter((b) => !b.attachedToUuid);
  const pickFrom = freeRoots.length > 0 ? freeRoots : importedBanks;
  const primary = [...pickFrom].sort((a, b) => a.y - b.y || a.x - b.x)[0];
  if (!primary) return;

  selectBank(primary.uuid, 'replace', 'canvas');

  const size = getCanvasScreenSize();
  if (size && size.width > 0 && size.height > 0) {
    // Full session list so attached display positions resolve correctly.
    const allBanks = get(banks);
    focusBank(primary, size.width, size.height, allBanks);
    log('import', 'centerImportedRoot', {
      uuid: primary.uuid,
      name: primary.name,
      count: importedBanks.length,
      zoom: viewport.zoom,
      panX: viewport.panX,
      panY: viewport.panY,
      canvas: size,
    });
  }

  log('import', 'selectImportRoot', {
    uuid: primary.uuid,
    name: primary.name,
    rootCount: freeRoots.length,
  });
}

function applyImportHealing(bankList: Bank[]): Bank[] {
  logPositionSnapshot('import', 'positions before heal (raw from XML)', bankList);

  const { banks: healed, healedCount } = healAttachedPositionsOnImport(bankList);

  log('store', 'importHeal summary', {
    healedCount,
    attachedCount: countAttachedBanks(bankList),
  });

  if (healedCount > 0) {
    logPositionChanges('import', 'positions changed by import heal', bankList, healed);
  }

  logPositionSnapshot('import', 'positions after heal (in store)', healed);
  return healed;
}

function mergeBanks(
  incoming: Bank[],
  doc?: PresetManagerDoc,
  mergeOptions?: MergeBankListsOptions,
): void {
  const current = getBanksSnapshot();
  const hadBanks = current.length > 0;
  const merged = applyImportHealing(mergeBankLists(current, incoming, mergeOptions));
  banks.set(merged);
  clearHistory();

  bankMeta.update((m) => {
    const stillExists = (uuid: string) => merged.some((b) => b.uuid === uuid);
    const selected = m.selectedBankUuids.filter(stillExists);
    const base = (m.bankSelectionBaseUuids ?? []).filter(stillExists);
    const anchor =
      m.bankSelectionAnchorUuid && stillExists(m.bankSelectionAnchorUuid)
        ? m.bankSelectionAnchorUuid
        : (selected[selected.length - 1] ?? null);
    return {
      ...m,
      selectedBankUuids: selected,
      bankSelectionBaseUuids: base,
      bankSelectionAnchorUuid: selected.length > 0 ? anchor : null,
      serializeDate: doc?.serializeDate || m.serializeDate,
      selectedMidiBankUuid: doc?.selectedMidiBankUuid || m.selectedMidiBankUuid,
      lastImportMode: 'merge',
    };
  });

  if (hadBanks) {
    markSessionDirty();
  } else {
    clearSessionDirty();
  }

  log('store', 'mergeBanks', { bankCount: merged.length, incoming: incoming.length });
}

function applyDocument(doc: PresetManagerDoc): void {
  mergeBanks(doc.banks, doc);
}

export async function importFile(file: File): Promise<void> {
  bankMeta.update((m) => ({
    ...m,
    loading: true,
    error: null,
    lastImportFilename: file.name,
  }));
  log('import', 'importFile started', { name: file.name, size: file.size });

  let importedForLive: Bank[] = [];
  const livePrepare = isLiveReadyForImport();
  if (livePrepare) {
    beginLiveImportPrepare('Preparing Live bank send…');
  }

  try {
    const beforeUuids = new Set(getBanksSnapshot().map((bank) => bank.uuid));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = parseFileBytes(bytes, file.name);
    log('import', 'parse complete', { source: doc.source, bankCount: doc.banks.length });
    logPositionSnapshot('import', 'positions from parser (pre-heal)', doc.banks);

    if (doc.source === 'single-bank') {
      const canvas = getCanvasScreenSize();
      const debug = isAppDebugEnabled();
      if (debug) {
        log('import', '========== SINGLE-BANK VIEWPORT CHECK BEGIN ==========');
        const baseline = buildSingleBankViewportCheck(
          doc.banks,
          viewport,
          'xml-original',
          file.name,
          canvas,
        );
        if (baseline) logSingleBankViewportCheck(baseline);
      }

      // C15 stamps import file/date and clears export attrs on single-bank import.
      const stamped = stampBanksForImport(doc.banks, file.name);
      const positioned = positionBanksAtViewportCenter(stamped, viewport);
      logPositionSnapshot('import', 'single-bank at viewport center (pre-heal)', positioned);

      if (debug) {
        const placed = buildSingleBankViewportCheck(
          positioned,
          viewport,
          'after-viewport-placement',
          file.name,
          canvas,
        );
        if (placed) logSingleBankViewportCheck(placed);
      }

      mergeBanks(positioned, doc, { preserveIncomingPositions: true });

      if (debug) {
        const stored = getBanksSnapshot().filter((bank) => !beforeUuids.has(bank.uuid));
        const finalCheck = buildSingleBankViewportCheck(
          stored.length > 0 ? stored : positioned,
          viewport,
          'after-store',
          file.name,
          canvas,
        );
        if (finalCheck) logSingleBankViewportCheck(finalCheck);
        log('import', '========== SINGLE-BANK VIEWPORT CHECK END ==========', {
          centered: finalCheck?.centered ?? false,
          file: file.name,
          bank: doc.banks[0]?.name ?? '(unknown)',
        });
      }
    } else {
      applyDocument(doc);
    }

    // Banks newly present after merge (UUID remint may change file ids).
    importedForLive = getBanksSnapshot().filter((b) => !beforeUuids.has(b.uuid));
    // Full backup into empty session: every bank is "imported".
    if (importedForLive.length === 0 && doc.banks.length > 0 && beforeUuids.size === 0) {
      importedForLive = getBanksSnapshot();
    }

    // Keep loading spinner through device send (Option B).
    await maybeLiveAutoSend(importedForLive, 'merge');
  } catch (err) {
    if (livePrepare) cancelLiveImportPrepare();
    const message = err instanceof Error ? err.message : String(err);
    bankMeta.update((m) => ({ ...m, error: message }));
    log('import', 'importFile failed', message, 'error');
  } finally {
    const count = getBanksSnapshot().length;
    bankMeta.update((m) => ({ ...m, loading: false }));
    log('import', 'importFile finished', { bankCount: count, loading: false });
  }
}

/** Legacy sequential folder import (small folders only). */
export async function importFolderFilesLegacy(files: ImportableFile[]): Promise<void> {
  if (files.length === 0) {
    bankMeta.update((m) => ({ ...m, error: 'No .xml or .nlbackup files found in folder' }));
    log('import', 'folder import — no files', null, 'warn');
    return;
  }

  bankMeta.update((m) => ({ ...m, loading: true, error: null }));
  log('import', 'importFolder legacy started', { fileCount: files.length });

  const errors: string[] = [];
  let succeeded = 0;

  try {
    for (const entry of files) {
      try {
        const bytes = new Uint8Array(await entry.file.arrayBuffer());
        const doc = parseFileBytes(bytes, entry.file.name);
        if (doc.source === 'single-bank') {
          mergeBanks(stampBanksForImport(doc.banks, entry.file.name), doc, {
            preserveIncomingPositions: true,
          });
        } else {
          applyDocument(doc);
        }
        succeeded++;
        log('import', 'folder file ok', { name: entry.file.name, bankCount: doc.banks.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${entry.file.name}: ${message}`);
        log('import', 'folder file failed', message, 'error');
      }
    }

    const folderName = folderLabelFromImportable(files);
    bankMeta.update((m) => ({
      ...m,
      lastImportFilename: `${folderName} (${succeeded}/${files.length} files)`,
      lastImportMode: 'folder',
      error:
        succeeded === 0
          ? errors.join('; ')
          : errors.length > 0
            ? `Imported ${succeeded} of ${files.length} files. Failed: ${errors.join('; ')}`
            : null,
    }));

    log('import', 'importFolder legacy finished', {
      bankCount: getBanksSnapshot().length,
      succeeded,
      failed: errors.length,
    });
  } finally {
    bankMeta.update((m) => ({ ...m, loading: false }));
  }
}

export async function executeMassImport(
  files: ImportableFile[],
  options: MassImportOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<MassImportResult> {
  bankMeta.update((m) => ({ ...m, loading: true, error: null }));
  log('import', 'massImport started', {
    fileCount: files.length,
    canvasMode: options.canvasMode,
    sortBy: options.sortBy,
  });

  // Freeze Live push + document apply BEFORE clearing/replacing the canvas so
  // we never push select/layout RPCs or poison device snapshots mid-import.
  const livePrepare = isLiveReadyForImport();
  if (livePrepare) {
    beginLiveImportPrepare(
      options.canvasMode === 'replace'
        ? 'Preparing Live library replace…'
        : 'Preparing Live bank send…',
    );
  }

  try {
    // Live + replace: confirm before any local mutation. Cancel aborts everything.
    if (livePrepare && options.canvasMode === 'replace') {
      const proceed = await confirmLiveLibraryReplace();
      if (!proceed) {
        cancelLiveImportPrepare();
        log('import', 'massImport cancelled — Live replace declined');
        bankMeta.update((m) => ({ ...m, loading: false, error: null }));
        return {
          bankCount: 0,
          succeeded: 0,
          failed: 0,
          errors: [],
          cancelled: true,
        };
      }
    }

    if (options.canvasMode === 'replace') {
      banks.set([]);
      clearUserPositioned();
      bankMeta.update((m) => ({
        ...m,
        selectedBankUuids: [],
        bankSelectionAnchorUuid: null,
        bankSelectionBaseUuids: [],
        selectedPresetUuids: [],
        presetSelectionBankUuid: null,
      }));
    }

    const existing = options.canvasMode === 'replace' ? [] : getBanksSnapshot();
    const { banks: finalBanks, result, layoutMeta } = await runMassImportPipeline(
      files,
      options,
      existing,
      onProgress,
    );

    banks.set(finalBanks);
    clearHistory();
    markSessionDirty();
    setShowSynthZone(options.showSynthZone);

    const importedUuids = new Set(layoutMeta.keys());
    const importedBanks = finalBanks.filter((b) => importedUuids.has(b.uuid));
    const report = buildLayoutImportReport(
      importedBanks,
      layoutMeta,
      options.sortBy,
    );
    logLayoutImportReport(report);

    const folderName = folderLabelFromImportable(files);
    bankMeta.update((m) => ({
      ...m,
      lastImportFilename: `${folderName} (${result.succeeded}/${files.length} files)`,
      lastImportMode: options.canvasMode === 'replace' ? 'replace' : 'merge',
      error:
        result.succeeded === 0
          ? result.errors.join('; ')
          : result.errors.length > 0
            ? `Imported ${result.succeeded} of ${files.length} files. Failed: ${result.errors.join('; ')}`
            : null,
    }));

    // Frame new content + select folder root (e.g. "(root)" for flat multi-file).
    // Runs after banks are in the store so selection/reveal targets valid uuids.
    // While Live prepare is active, selectBank will not push to the device.
    if (result.succeeded > 0 && importedBanks.length > 0) {
      focusMassImportResult(importedBanks);
    }

    log('import', 'massImport finished', {
      bankCount: finalBanks.length,
      succeeded: result.succeeded,
      failed: result.failed,
    });

    // Option B: Live auto-send (keeps loading true until device job ends).
    if (result.succeeded > 0) {
      const toSend =
        options.canvasMode === 'replace' ? finalBanks : importedBanks;
      await maybeLiveAutoSend(
        toSend,
        options.canvasMode === 'replace' ? 'replace' : 'merge',
      );
    } else if (livePrepare) {
      cancelLiveImportPrepare();
    }

    return result;
  } catch (err) {
    if (livePrepare) cancelLiveImportPrepare();
    const message = err instanceof Error ? err.message : String(err);
    bankMeta.update((m) => ({ ...m, error: message }));
    log('import', 'massImport failed', message, 'error');
    throw err;
  } finally {
    bankMeta.update((m) => ({ ...m, loading: false }));
  }
}

/** @deprecated Use executeMassImport or importFolderFilesLegacy */
export async function importFolderFiles(files: File[]): Promise<void> {
  await importFolderFilesLegacy(toImportableFiles(files));
}
