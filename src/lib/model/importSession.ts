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
import { isFolderParentBank } from '../layout/smartLayout';
import type { Bank, PresetManagerDoc } from '../types/bank';
import { parseFileBytes } from '../xml/parse';
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
import { selectBank } from './selectionCommands';
import { clearSessionDirty, markSessionDirty } from './sessionDirty';
import { setShowSynthZone } from './settingsCommands';
import { clearHistory } from './undoHistory';

/**
 * After mass import: select the folder-root bank and pan to its header.
 * Keeps the user's current zoom (no fit-to-content).
 * Multiple roots → top-left-most folder parent (layout pack order).
 */
function focusMassImportResult(importedBanks: Bank[]): void {
  if (importedBanks.length === 0) return;

  const roots = importedBanks.filter(isFolderParentBank);
  const pickFrom = roots.length > 0 ? roots : importedBanks;
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
    isFolderParent: isFolderParentBank(primary),
    rootCount: roots.length,
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
    const selected = m.selectedBankUuids.filter((uuid) =>
      merged.some((b) => b.uuid === uuid),
    );
    return {
      ...m,
      selectedBankUuids: selected,
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

  try {
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

      const positioned = positionBanksAtViewportCenter(doc.banks, viewport);
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

      const beforeUuids = new Set(getBanksSnapshot().map((bank) => bank.uuid));
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
  } catch (err) {
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
        applyDocument(doc);
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

  try {
    if (options.canvasMode === 'replace') {
      banks.set([]);
      clearUserPositioned();
      bankMeta.update((m) => ({
        ...m,
        selectedBankUuids: [],
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
    if (result.succeeded > 0 && importedBanks.length > 0) {
      focusMassImportResult(importedBanks);
    }

    log('import', 'massImport finished', {
      bankCount: finalBanks.length,
      succeeded: result.succeeded,
      failed: result.failed,
    });

    return result;
  } catch (err) {
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
