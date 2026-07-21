import { get } from 'svelte/store';
import {
  logPositionChanges,
  logPositionSnapshot,
} from '../debug/positionLog';
import {
  buildSingleBankViewportCheck,
  logSingleBankViewportCheck,
} from '../debug/singleBankImportLog';
import { log } from '../debug/sessionLog';
import { downloadBytes } from '../io/download';
import { sanitizeBackupFilename } from '../io/filename';
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
  runMassImportPipeline,
  type MassImportOptions,
  type MassImportResult,
} from './massImport';
import type { AttachDirection, Bank, PresetManagerDoc } from '../types/bank';
import { canAttachBank } from './attachRules';
import { deletePresetsFromBank } from './presetDelete';
import {
  applyPresetColorBatch,
  applyPresetComment,
  applyPresetRename,
} from './presetEdit';
import {
  copyPresetsBetweenBanks,
  duplicatePresetsInBank,
  movePresetsBetweenBanks,
  reorderPresetsInBank,
} from './presetMove';
import {
  resolveAttachFromDockEdge,
  resolveAttachFromHandle,
  type DockEdge,
} from './attachOperation';
import { compressString } from '../xml/gzip';
import { parseFileBytes } from '../xml/parse';
import {
  formatSerializeDate,
  serializePresetManagerXml,
  validateBanksForC15Export,
} from '../xml/serialize';
import {
  appSettings,
  bankMeta,
  banks,
  clearUserPositioned,
  getBanksSnapshot,
  userPositionedUuids,
  type ImportMode,
  type InteractionSurface,
} from './bankState';
import { saveSidebarSettings, type SidebarTab } from '../ui/sidebarSettings';
import {
  mapDetachedKeepingDisplay,
  resolveDisplayPositions,
} from '../canvas/displayPosition';
import { horizontalAttachStep } from '../canvas/geometry';
import {
  getCanvasScreenSize,
  getCreateBankPositionAtPointer,
  positionBanksAtViewportCenter,
} from '../canvas/pointerPosition';
import { viewport } from '../canvas/viewport.svelte';
import {
  createEmptyBank,
  nextDefaultBankName,
  snapToGrid,
} from './bankFactory';
import { mergeBankLists, type MergeBankListsOptions } from './importMerge';
import {
  collectClusterDescendantUuids,
  computeRealignedBanks,
  computeRecommendedPosition,
  countAttachedBanks,
  healAttachedPositionsOnImport,
} from './positioning';
import { clearSessionDirty, markSessionDirty } from './sessionDirty';
import {
  beginUndoGroup,
  captureBankContent,
  clearHistory,
  endUndoGroup,
  isUndoGroupOpen,
  recordBankStructureFromLists,
  recordLayoutAround,
  recordPresetContentChange,
  undo as undoHistory,
  redo as redoHistory,
} from './undoHistory';

export type { ImportMode, InteractionSurface } from './bankState';
export {
  canUndo,
  canRedo,
  beginUndoGroup,
  endUndoGroup,
  cancelUndoGroup,
  clearHistory,
  isUndoGroupOpen,
} from './undoHistory';

export function undo(): boolean {
  return undoHistory();
}

export function redo(): boolean {
  return redoHistory();
}

export function setSidebarTab(tab: SidebarTab): void {
  const width = get(appSettings).sidebarWidthPx;
  appSettings.update((s) => ({ ...s, sidebarTab: tab }));
  saveSidebarSettings({ widthPx: width, tab });
}
export {
  appSettings,
  bankMeta,
  banks,
  userPositionedUuids,
} from './bankState';
export { sessionDirty } from './sessionDirty';

export { countAttachedBanks } from './positioning';

export function getBankByUuid(uuid: string): Bank | undefined {
  return getBanksSnapshot().find((bank) => bank.uuid === uuid);
}

export function getPrimarySelectedUuid(): string | null {
  const uuids = get(bankMeta).selectedBankUuids;
  return uuids.length > 0 ? uuids[uuids.length - 1]! : null;
}

export function getSelectedBank(): Bank | undefined {
  const uuid = getPrimarySelectedUuid();
  if (!uuid) return undefined;
  return getBankByUuid(uuid);
}

export function isBankSelected(uuid: string): boolean {
  return get(bankMeta).selectedBankUuids.includes(uuid);
}

export type SelectMode = 'replace' | 'toggle' | 'add';

function commitBanks(list: Bank[]): void {
  banks.set(list);
  markSessionDirty();
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

export function selectBanks(
  uuids: readonly string[],
  mode: 'replace' | 'add' = 'replace',
): void {
  bankMeta.update((m) => {
    const next =
      mode === 'add'
        ? [...new Set([...m.selectedBankUuids, ...uuids])]
        : [...uuids];
    const primary = next[next.length - 1] ?? null;
    const base = mode === 'replace' ? clearPresetSelectionFields(m) : m;
    return {
      ...base,
      selectedBankUuids: next,
      deleteFocus: next.length > 0 ? 'bank' : null,
      renamingBankUuid:
        base.renamingBankUuid && primary && base.renamingBankUuid !== primary
          ? null
          : base.renamingBankUuid,
    };
  });
  log('store', 'selectBanks', { count: uuids.length, mode });
}

function clearPresetSelectionFields<
  T extends {
    selectedPresetUuids: string[];
    presetSelectionBankUuid: string | null;
    presetSelectionAnchorUuid: string | null;
    presetSelectionBaseUuids: string[];
  },
>(m: T): T {
  return {
    ...m,
    selectedPresetUuids: [],
    presetSelectionBankUuid: null,
    presetSelectionAnchorUuid: null,
    presetSelectionBaseUuids: [],
  };
}

function presetRangeInOrder(
  order: readonly string[],
  anchorUuid: string,
  clickedUuid: string,
): string[] {
  const i1 = order.indexOf(anchorUuid);
  const i2 = order.indexOf(clickedUuid);
  if (i1 === -1 || i2 === -1) return [clickedUuid];
  const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
  return order.slice(lo, hi + 1);
}

function uniquePresetUuids(uuids: readonly string[]): string[] {
  return [...new Set(uuids)];
}

function syncBankSelectedPreset(bankUuid: string, presetUuid: string): void {
  banks.update((list) =>
    list.map((b) =>
      b.uuid === bankUuid ? { ...b, selectedPreset: presetUuid } : b,
    ),
  );
}

export function selectPreset(
  bankUuid: string,
  presetUuid: string,
  options: { ctrl?: boolean; shift?: boolean; surface?: InteractionSurface } = {},
): void {
  const list = getBanksSnapshot();
  const bank = list.find((b) => b.uuid === bankUuid);
  if (!bank) return;

  const surface = options.surface ?? 'canvas';
  setSidebarTab('presets');

  const order = bank.presetOrder;
  const meta = get(bankMeta);
  const renaming = meta.renamingPreset;
  if (
    renaming &&
    (renaming.bankUuid !== bankUuid ||
      renaming.presetUuid.toLowerCase() !== presetUuid.toLowerCase())
  ) {
    cancelRenamePreset();
  }
  const sameBank = meta.presetSelectionBankUuid === bankUuid;

  if (options.shift && sameBank) {
    const anchor =
      meta.presetSelectionAnchorUuid ??
      meta.selectedPresetUuids[meta.selectedPresetUuids.length - 1];
    if (anchor) {
      const range = presetRangeInOrder(order, anchor, presetUuid);
      const base =
        meta.presetSelectionBaseUuids.length > 0
          ? meta.presetSelectionBaseUuids
          : [anchor];
      const selected = uniquePresetUuids([...base, ...range]);
      bankMeta.update((m) => ({
        ...m,
        presetSelectionBankUuid: bankUuid,
        selectedPresetUuids: selected,
        deleteFocus: 'preset',
        selectionSurface: surface,
      }));
      syncBankSelectedPreset(bankUuid, presetUuid);
      log('store', 'selectPresetRange', { bankUuid, count: selected.length });
      return;
    }
  }

  if (options.ctrl && sameBank) {
    const next = meta.selectedPresetUuids.includes(presetUuid)
      ? meta.selectedPresetUuids.filter((u) => u !== presetUuid)
      : [...meta.selectedPresetUuids, presetUuid];
    const frozen = uniquePresetUuids(next);
    bankMeta.update((m) => ({
      ...m,
      presetSelectionBankUuid: bankUuid,
      selectedPresetUuids: frozen,
      presetSelectionAnchorUuid: presetUuid,
      presetSelectionBaseUuids: frozen,
      deleteFocus: 'preset',
      selectionSurface: surface,
    }));
    if (frozen.length > 0) {
      syncBankSelectedPreset(bankUuid, presetUuid);
    }
    log('store', 'selectPresetToggle', { bankUuid, presetUuid });
    return;
  }

  bankMeta.update((m) => ({
    ...m,
    presetSelectionBankUuid: bankUuid,
    selectedPresetUuids: [presetUuid],
    presetSelectionAnchorUuid: presetUuid,
    presetSelectionBaseUuids: [presetUuid],
    deleteFocus: 'preset',
    selectionSurface: surface,
  }));
  syncBankSelectedPreset(bankUuid, presetUuid);
  log('store', 'selectPreset', { bankUuid, presetUuid });
}

/** Select multiple presets in one bank (e.g. when starting a drag). */
export function selectPresetsBatch(
  bankUuid: string,
  presetUuids: readonly string[],
  surface: InteractionSurface = 'canvas',
): void {
  const frozen = uniquePresetUuids(presetUuids);
  if (frozen.length === 0) return;
  const primary = frozen[frozen.length - 1]!;
  const meta = get(bankMeta);
  const renaming = meta.renamingPreset;
  if (
    renaming &&
    (renaming.bankUuid !== bankUuid ||
      !frozen.some((u) => u.toLowerCase() === renaming.presetUuid.toLowerCase()))
  ) {
    cancelRenamePreset();
  }
  setSidebarTab('presets');
  bankMeta.update((m) => ({
    ...m,
    presetSelectionBankUuid: bankUuid,
    selectedPresetUuids: frozen,
    presetSelectionAnchorUuid: primary,
    presetSelectionBaseUuids: frozen,
    deleteFocus: 'preset',
    selectionSurface: surface,
  }));
  syncBankSelectedPreset(bankUuid, primary);
  log('store', 'selectPresetsBatch', { bankUuid, count: frozen.length });
}

export function deleteSelectedPresets(): boolean {
  const meta = get(bankMeta);
  const bankUuid = meta.presetSelectionBankUuid;
  const uuids = meta.selectedPresetUuids;
  if (!bankUuid || uuids.length === 0) return false;

  const list = getBanksSnapshot();
  const bank = list.find((b) => b.uuid === bankUuid);
  if (!bank) return false;

  const names = uuids
    .map((uuid) => bank.presets.find((p) => p.uuid.toLowerCase() === uuid.toLowerCase())?.name)
    .filter(Boolean);
  const message =
    uuids.length === 1
      ? `Delete preset "${names[0] ?? 'selected'}"? You can undo with the Undo button.`
      : `Delete ${uuids.length} selected presets? You can undo with the Undo button.`;
  if (!window.confirm(message)) return false;

  const before = captureBankContent(list, [bankUuid], true);
  const result = deletePresetsFromBank(list, bankUuid, uuids);
  if (!result.ok || !result.banks) {
    log('store', 'deleteSelectedPresets failed', { error: result.error });
    return false;
  }

  const after = captureBankContent(result.banks, [bankUuid], true);
  commitBanks(result.banks);
  recordPresetContentChange(
    uuids.length === 1 ? 'Delete preset' : 'Delete presets',
    before,
    after,
  );
  bankMeta.update((m) => ({
    ...clearPresetSelectionFields(m),
    deleteFocus: m.selectedBankUuids.length > 0 ? 'bank' : null,
  }));
  log('store', 'deleteSelectedPresets', { bankUuid, count: result.deleted.length });
  return true;
}

/** Duplicate selected presets in place (new UUIDs; C15 copyPresetBelow). */
export function duplicateSelectedPresets(): boolean {
  const meta = get(bankMeta);
  const bankUuid = meta.presetSelectionBankUuid;
  const uuids = meta.selectedPresetUuids;
  if (!bankUuid || uuids.length === 0) return false;

  const list = getBanksSnapshot();
  const before = captureBankContent(list, [bankUuid], true);
  const result = duplicatePresetsInBank(list, bankUuid, uuids);
  if (!result.ok || !result.banks) {
    log('store', 'duplicateSelectedPresets failed', { error: result.error });
    return false;
  }

  const after = captureBankContent(result.banks, [bankUuid], true);
  commitBanks(result.banks);
  recordPresetContentChange('Duplicate presets', before, after);
  bankMeta.update((m) => ({
    ...m,
    presetSelectionBankUuid: bankUuid,
    selectedPresetUuids: result.moved,
    presetSelectionAnchorUuid: result.moved[result.moved.length - 1] ?? null,
    presetSelectionBaseUuids: result.moved,
  }));
  log('store', 'duplicateSelectedPresets', { bankUuid, count: result.moved.length });
  return true;
}

export function selectBank(
  uuid: string | null,
  mode: SelectMode = 'replace',
  surface: InteractionSurface = 'canvas',
): void {
  const meta = get(bankMeta);
  if (uuid !== null) {
    setSidebarTab('banks');
    if (meta.renamingBankUuid && meta.renamingBankUuid !== uuid) {
      cancelRenameBank();
    }
    if (meta.renamingPreset) {
      cancelRenamePreset();
    }
  } else if (meta.renamingBankUuid || meta.renamingPreset) {
    cancelRenameBank();
    cancelRenamePreset();
  }

  bankMeta.update((m) => {
    if (uuid === null) {
      return clearPresetSelectionFields({
        ...m,
        selectedBankUuids: [],
        renamingBankUuid: null,
        deleteFocus: null,
      });
    }

    let next: string[];
    if (mode === 'replace') {
      next = [uuid];
    } else if (mode === 'toggle') {
      next = m.selectedBankUuids.includes(uuid)
        ? m.selectedBankUuids.filter((u) => u !== uuid)
        : [...m.selectedBankUuids, uuid];
    } else {
      next = m.selectedBankUuids.includes(uuid)
        ? m.selectedBankUuids
        : [...m.selectedBankUuids, uuid];
    }

    const primary = next[next.length - 1] ?? null;
    const cleared =
      mode === 'replace'
        ? clearPresetSelectionFields(m)
        : m;
    return {
      ...cleared,
      selectedBankUuids: next,
      deleteFocus: uuid !== null && next.length > 0 ? 'bank' : null,
      selectionSurface: surface,
      renamingBankUuid:
        cleared.renamingBankUuid && primary && cleared.renamingBankUuid !== primary
          ? null
          : cleared.renamingBankUuid,
    };
  });
  log('store', 'selectBank', { uuid, mode, surface });
}

/** Sidebar tree click — Ctrl toggles; Shift range in tree order; plain click replaces. */
export function selectBankRange(
  uuid: string,
  orderedUuids: string[],
  options: { shift?: boolean; ctrl?: boolean },
): void {
  if (options.ctrl) {
    selectBank(uuid, 'toggle', 'sidebar');
    return;
  }
  if (options.shift) {
    const current = get(bankMeta).selectedBankUuids;
    const anchor = current[current.length - 1];
    if (!anchor) {
      selectBank(uuid, 'replace', 'sidebar');
      return;
    }
    const i1 = orderedUuids.indexOf(anchor);
    const i2 = orderedUuids.indexOf(uuid);
    if (i1 === -1 || i2 === -1) {
      selectBank(uuid, 'replace', 'sidebar');
      return;
    }
    const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
    setSidebarTab('banks');
    bankMeta.update((m) => ({
      ...clearPresetSelectionFields(m),
      selectedBankUuids: orderedUuids.slice(lo, hi + 1),
      renamingBankUuid: null,
      deleteFocus: 'bank',
      selectionSurface: 'sidebar',
    }));
    log('store', 'selectBankRange', { uuid, lo, hi });
    return;
  }
  selectBank(uuid, 'replace', 'sidebar');
}

type PresetDropAction = 'copy' | 'move' | 'reorder';

function applyPresetDropResult(
  list: Bank[],
  result: ReturnType<typeof movePresetsBetweenBanks>,
  affectedBankUuids: readonly string[],
  includePresets: boolean,
  targetBankUuid: string,
  insertIndex: number | undefined,
  action: PresetDropAction,
  historyLabel: string,
): boolean {
  if (!result.ok || !result.banks) {
    log('store', `${action}Presets failed`, { error: result.error });
    return false;
  }

  const before = captureBankContent(list, affectedBankUuids, includePresets);
  const after = captureBankContent(result.banks, affectedBankUuids, includePresets);
  commitBanks(result.banks);
  recordPresetContentChange(historyLabel, before, after);
  bankMeta.update((m) => ({
    ...m,
    presetSelectionBankUuid: targetBankUuid,
    selectedPresetUuids: result.moved,
  }));
  log('store', `${action}Presets`, {
    count: result.moved.length,
    target: targetBankUuid,
    insertIndex: insertIndex ?? 'append',
  });
  return true;
}

/** Copy presets into another bank (new UUIDs; source unchanged — C15 default). */
export function copyPresetsToBank(
  presetUuids: readonly string[],
  sourceBankUuid: string,
  targetBankUuid: string,
  insertIndex?: number,
): boolean {
  const list = getBanksSnapshot();
  return applyPresetDropResult(
    list,
    copyPresetsBetweenBanks(list, presetUuids, sourceBankUuid, targetBankUuid, insertIndex),
    [targetBankUuid],
    true,
    targetBankUuid,
    insertIndex,
    'copy',
    'Copy presets',
  );
}

/** Move presets to another bank (UUIDs preserved; removed from source). */
export function movePresetsToBank(
  presetUuids: readonly string[],
  sourceBankUuid: string,
  targetBankUuid: string,
  insertIndex?: number,
): boolean {
  const list = getBanksSnapshot();
  return applyPresetDropResult(
    list,
    movePresetsBetweenBanks(list, presetUuids, sourceBankUuid, targetBankUuid, insertIndex),
    [sourceBankUuid, targetBankUuid],
    true,
    targetBankUuid,
    insertIndex,
    'move',
    'Move presets',
  );
}

/** Reorder presets within one bank (same-bank drag-drop). */
export function reorderPresetsInBankStore(
  presetUuids: readonly string[],
  bankUuid: string,
  insertIndex: number,
): boolean {
  const list = getBanksSnapshot();
  return applyPresetDropResult(
    list,
    reorderPresetsInBank(list, bankUuid, presetUuids, insertIndex),
    [bankUuid],
    false,
    bankUuid,
    insertIndex,
    'reorder',
    'Reorder presets',
  );
}

function defaultNewBankPosition(
  list: Bank[],
  selectedUuid: string | null,
): { x: number; y: number } {
  if (selectedUuid) {
    const selected = list.find((bank) => bank.uuid === selectedUuid);
    if (selected) {
      return {
        x: snapToGrid(selected.x + horizontalAttachStep()),
        y: snapToGrid(selected.y),
      };
    }
  }

  if (list.length > 0) {
    let maxX = -Infinity;
    let sumY = 0;
    for (const bank of list) {
      maxX = Math.max(maxX, bank.x);
      sumY += bank.y;
    }
    return {
      x: snapToGrid(maxX + horizontalAttachStep()),
      y: snapToGrid(sumY / list.length),
    };
  }

  return { x: 0, y: 0 };
}

/** Create an empty bank on the canvas and select it. */
export function createBank(
  options: { name?: string; x?: number; y?: number; atPointer?: boolean } = {},
): Bank {
  const list = getBanksSnapshot();
  const meta = get(bankMeta);
  const position =
    options.x !== undefined && options.y !== undefined
      ? { x: snapToGrid(options.x), y: snapToGrid(options.y) }
      : options.atPointer
        ? getCreateBankPositionAtPointer(viewport) ??
          defaultNewBankPosition(list, getPrimarySelectedUuid())
        : defaultNewBankPosition(list, getPrimarySelectedUuid());

  const name = options.name?.trim() || nextDefaultBankName(list);
  const bank = createEmptyBank(name, position.x, position.y);

  const next = [...list, bank];
  commitBanks(next);
  recordBankStructureFromLists('Create bank', list, next);
  bankMeta.update((m) => ({
    ...clearPresetSelectionFields(m),
    selectedBankUuids: [bank.uuid],
    deleteFocus: 'bank',
    renamingBankUuid: null,
    error: null,
  }));

  log('store', 'createBank', { name: bank.name, uuid: bank.uuid, x: bank.x, y: bank.y });
  return bank;
}

export function renameBank(uuid: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) {
    setStoreError('Bank name cannot be empty.');
    return false;
  }

  const list = getBanksSnapshot();
  if (!list.some((bank) => bank.uuid === uuid)) return false;

  const before = captureBankContent(list, [uuid], false);
  const next = list.map((bank) =>
    bank.uuid === uuid
      ? { ...bank, name: trimmed, lastChangedTimestamp: Math.floor(Date.now() / 1000) }
      : bank,
  );
  const after = captureBankContent(next, [uuid], false);
  commitBanks(next);
  recordPresetContentChange('Rename bank', before, after);

  bankMeta.update((m) => ({ ...m, renamingBankUuid: null, renameSurface: null, error: null }));
  log('store', 'renameBank', { uuid, name: trimmed });
  return true;
}

export function startRenameBank(uuid: string, surface: InteractionSurface): void {
  setSidebarTab('banks');
  bankMeta.update((m) => ({
    ...m,
    selectedBankUuids: [uuid],
    deleteFocus: 'bank',
    renamingBankUuid: uuid,
    renameSurface: surface,
    selectionSurface: surface,
    renamingPreset: null,
    error: null,
  }));
  log('store', 'startRenameBank', { uuid, surface });
}

export function cancelRenameBank(): void {
  bankMeta.update((m) => ({ ...m, renamingBankUuid: null, renameSurface: null }));
}

export function startRenamePreset(
  bankUuid: string,
  presetUuid: string,
  surface: InteractionSurface,
): void {
  setSidebarTab('presets');
  bankMeta.update((m) => ({
    ...m,
    presetSelectionBankUuid: bankUuid,
    selectedPresetUuids: [presetUuid],
    deleteFocus: 'preset',
    renamingPreset: { bankUuid, presetUuid },
    renameSurface: surface,
    selectionSurface: surface,
    renamingBankUuid: null,
  }));
}

export function cancelRenamePreset(): void {
  bankMeta.update((m) => ({ ...m, renamingPreset: null, renameSurface: null }));
}

export function renamePreset(bankUuid: string, presetUuid: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) {
    setStoreError('Preset name cannot be empty.');
    return false;
  }

  const list = getBanksSnapshot();
  const before = captureBankContent(list, [bankUuid], true);
  const updated = applyPresetRename(list, bankUuid, presetUuid, trimmed);
  if (!updated) return false;

  const after = captureBankContent(updated, [bankUuid], true);
  commitBanks(updated);
  recordPresetContentChange('Rename preset', before, after);
  bankMeta.update((m) => ({ ...m, renamingPreset: null, renameSurface: null, error: null }));
  log('store', 'renamePreset', { bankUuid, presetUuid, name: trimmed });
  return true;
}

export function setPresetColor(
  bankUuid: string,
  presetUuids: readonly string[],
  color: import('../xml/presetAttributes').PresetColorName,
): boolean {
  const list = getBanksSnapshot();
  const before = captureBankContent(list, [bankUuid], true);
  const updated = applyPresetColorBatch(list, bankUuid, presetUuids, color);
  if (!updated) return false;
  const after = captureBankContent(updated, [bankUuid], true);
  commitBanks(updated);
  recordPresetContentChange('Change preset color', before, after);
  log('store', 'setPresetColor', { bankUuid, count: presetUuids.length, color });
  return true;
}

export function setPresetComment(
  bankUuid: string,
  presetUuid: string,
  comment: string,
): boolean {
  const list = getBanksSnapshot();
  const before = captureBankContent(list, [bankUuid], true);
  const updated = applyPresetComment(list, bankUuid, presetUuid, comment);
  if (!updated) return false;
  const after = captureBankContent(updated, [bankUuid], true);
  commitBanks(updated);
  recordPresetContentChange('Change preset comment', before, after);
  log('store', 'setPresetComment', { bankUuid, presetUuid });
  return true;
}

export function clearError(): void {
  bankMeta.update((m) => ({ ...m, error: null }));
}

function setStoreError(message: string): void {
  bankMeta.update((m) => ({ ...m, error: message }));
  log('store', 'error', message, 'warn');
}

function sortBanksForBatchAttach(uuids: string[], list: Bank[]): string[] {
  const byUuid = new Map(list.map((bank) => [bank.uuid, bank]));
  return [...uuids].sort((a, b) => {
    const ba = byUuid.get(a);
    const bb = byUuid.get(b);
    if (!ba || !bb) return 0;
    if (ba.x !== bb.x) return ba.x - bb.x;
    return ba.y - bb.y;
  });
}

/**
 * Attach `child` to `parent` on the given face; snaps child to recommended position.
 */
export function attachBank(
  childUuid: string,
  parentUuid: string,
  attachDirection: AttachDirection,
  options: { preservePosition?: boolean } = {},
): boolean {
  const list = getBanksSnapshot();
  const check = canAttachBank(childUuid, parentUuid, attachDirection, list);
  if (!check.ok) {
    setStoreError(check.reason);
    return false;
  }

  const parent = list.find((b) => b.uuid === parentUuid)!;
  const child = list.find((b) => b.uuid === childUuid)!;
  const raw = options.preservePosition
    ? { x: child.x, y: child.y }
    : computeRecommendedPosition(parent, child, attachDirection);
  const pos = { x: snapToGrid(raw.x), y: snapToGrid(raw.y) };

  const apply = (): void => {
    const current = getBanksSnapshot();
    commitBanks(
      current.map((b) =>
        b.uuid === childUuid
          ? {
              ...b,
              attachedToUuid: parentUuid,
              attachDirection,
              x: pos.x,
              y: pos.y,
            }
          : b,
      ),
    );
  };

  if (isUndoGroupOpen()) {
    apply();
  } else {
    recordLayoutAround('Attach bank', [childUuid], apply);
  }

  clearError();
  log('store', 'attachBank', {
    child: child.name,
    parent: parent.name,
    attachDirection,
    x: pos.x,
    y: pos.y,
  });
  return true;
}

/** C15 `dock-banks` edge drop (proximity dock or tape drop). */
export function dockBankAtEdge(
  draggedUuid: string,
  droppedOntoUuid: string,
  dockEdge: DockEdge,
): boolean {
  const resolved = resolveAttachFromDockEdge(dockEdge, droppedOntoUuid, draggedUuid);
  // Align child to parent: horizontal → shared top Y; vertical → shared left X.
  return attachBank(resolved.childUuid, resolved.parentUuid, resolved.attachDirection);
}

/** Attach multiple selected banks to `target` using the same handle semantics. */
export function attachBanksBatch(
  sourceUuids: string[],
  targetUuid: string,
  handle: AttachDirection,
): number {
  const list = getBanksSnapshot();
  const sorted = sortBanksForBatchAttach(
    sourceUuids.filter((u) => u !== targetUuid),
    list,
  );
  if (sorted.length === 0) return 0;

  const childUuids = sorted.map((sourceUuid) => {
    const resolved = resolveAttachFromHandle(handle, sourceUuid, targetUuid);
    return resolved.childUuid;
  });
  const startedGroup = !isUndoGroupOpen();
  if (startedGroup) {
    beginUndoGroup('Attach banks', childUuids);
  }

  let count = 0;
  for (const sourceUuid of sorted) {
    const resolved = resolveAttachFromHandle(handle, sourceUuid, targetUuid);
    if (attachBank(resolved.childUuid, resolved.parentUuid, resolved.attachDirection)) {
      count++;
    }
  }

  if (startedGroup) {
    endUndoGroup();
  }
  return count;
}

/** User-initiated detach (sidebar / future context menu). */
export function detachBank(uuid: string): boolean {
  const list = getBanksSnapshot();
  const bank = list.find((b) => b.uuid === uuid);
  if (!bank?.attachedToUuid) {
    setStoreError('Bank is not attached to a parent.');
    return false;
  }

  const formerParentUuid = bank.attachedToUuid;
  const formerParent = list.find((b) => b.uuid === formerParentUuid);

  const apply = (): void => {
    const current = getBanksSnapshot();
    commitBanks(
      mapDetachedKeepingDisplay(current, (b) => b.uuid === uuid),
    );
  };

  if (isUndoGroupOpen()) {
    apply();
  } else {
    recordLayoutAround('Detach bank', [uuid], apply);
  }

  clearError();
  log('store', 'detachBank', {
    uuid,
    name: bank.name,
    formerParentUuid,
    formerParentName: formerParent?.name ?? null,
  });
  return true;
}

/**
 * Clear parent link — mirrors NonMaps `undockBank()` when dragging an attached bank.
 * History is recorded by the open canvas drag group (or one-shot if called alone).
 * Bakes display origin into stored x/y so the card does not jump off its on-screen spot.
 */
export function detachBankFromParent(uuid: string): boolean {
  const list = getBanksSnapshot();
  const bank = list.find((b) => b.uuid === uuid);
  if (!bank?.attachedToUuid) return false;

  const formerParentUuid = bank.attachedToUuid;
  const formerParent = list.find((b) => b.uuid === formerParentUuid);

  const apply = (): void => {
    const current = getBanksSnapshot();
    commitBanks(
      mapDetachedKeepingDisplay(current, (b) => b.uuid === uuid),
    );
  };

  if (isUndoGroupOpen()) {
    apply();
  } else {
    recordLayoutAround('Detach bank', [uuid], apply);
  }

  log('store', 'detachOnDrag', {
    uuid,
    name: bank.name,
    formerParentUuid,
    formerParentName: formerParent?.name ?? null,
  });
  return true;
}

/**
 * Delete / Backspace — deletes whichever target was last explicitly selected.
 */
export function handleDeleteKeyPress(): boolean {
  const meta = get(bankMeta);
  if (meta.deleteFocus === 'preset' && meta.selectedPresetUuids.length > 0) {
    return deleteSelectedPresets();
  }
  if (meta.deleteFocus === 'bank' && meta.selectedBankUuids.length > 0) {
    return deleteSelectedBanks();
  }
  return false;
}

/**
 * Remove a bank; direct children are detached but keep their canvas positions.
 */
export function deleteSelectedBanks(): boolean {
  const uuids = get(bankMeta).selectedBankUuids;
  if (uuids.length === 0) return false;
  if (uuids.length === 1) return deleteBank(uuids[0]!);

  const list = getBanksSnapshot();
  const names = uuids
    .map((uuid) => list.find((b) => b.uuid === uuid)?.name)
    .filter(Boolean);
  const message = `Delete ${uuids.length} selected banks (${names.join(', ')})? You can undo with the Undo button.`;
  if (!window.confirm(message)) return false;

  // Bake display origins for orphans before parent uuids leave the list.
  const detached = mapDetachedKeepingDisplay(
    list,
    (b) => Boolean(b.attachedToUuid && uuids.includes(b.attachedToUuid)),
  );
  const updated = detached.filter((b) => !uuids.includes(b.uuid));
  commitBanks(updated);
  recordBankStructureFromLists('Delete banks', list, updated);
  bankMeta.update((m) => ({
    ...clearPresetSelectionFields(m),
    selectedBankUuids: [],
    renamingBankUuid: null,
    deleteFocus: null,
    error: null,
  }));
  log('store', 'deleteSelectedBanks', { count: uuids.length });
  return true;
}

export function deleteBank(uuid: string): boolean {
  const list = getBanksSnapshot();
  const bank = list.find((b) => b.uuid === uuid);
  if (!bank) return false;

  const message = `Delete "${bank.name}"? You can undo with the Undo button.`;
  if (!window.confirm(message)) return false;

  const childCount = list.filter((b) => b.attachedToUuid === uuid).length;
  // Bake on-screen origin into stored x/y for children before removing the parent
  // (attached placement ignores stored coords; plain detach would jump them).
  const detached = mapDetachedKeepingDisplay(
    list,
    (b) => b.attachedToUuid === uuid,
  );
  const updated = detached.filter((b) => b.uuid !== uuid);

  commitBanks(updated);
  recordBankStructureFromLists('Delete bank', list, updated);

  bankMeta.update((m) => {
    const nextBanks = m.selectedBankUuids.filter((u) => u !== uuid);
    const presetCleared =
      m.presetSelectionBankUuid === uuid
        ? clearPresetSelectionFields(m)
        : m;
    return {
      ...presetCleared,
      selectedBankUuids: nextBanks,
      deleteFocus:
        nextBanks.length > 0
          ? 'bank'
          : presetCleared.selectedPresetUuids.length > 0
            ? 'preset'
            : null,
      renamingBankUuid: m.renamingBankUuid === uuid ? null : m.renamingBankUuid,
      error: null,
    };
  });

  log('store', 'deleteBank', {
    name: bank.name,
    uuid,
    detachedChildren: childCount,
  });
  return true;
}

/**
 * Move a bank and its attachment subtree (children always follow).
 * Target (x, y) is the primary’s on-screen origin after the drag.
 * Δ is taken from the primary’s current **display** position (not stored XML).
 * Optional `moveUuids` overrides the default primary+descendants set.
 * `userDrag` undocks the primary if it still has a parent.
 */
export function moveBankTo(
  uuid: string,
  x: number,
  y: number,
  options: { userDrag?: boolean; moveUuids?: Iterable<string> } = {},
): void {
  let list = getBanksSnapshot();
  let bank = list.find((b) => b.uuid === uuid);
  if (!bank) return;

  if (options.userDrag && bank.attachedToUuid) {
    detachBankFromParent(uuid);
    list = getBanksSnapshot();
    bank = list.find((b) => b.uuid === uuid);
    if (!bank) return;
  }

  const snappedX = snapToGrid(x);
  const snappedY = snapToGrid(y);

  const moveSet = options.moveUuids
    ? new Set(options.moveUuids)
    : new Set<string>([uuid, ...collectClusterDescendantUuids(uuid, list)]);

  const apply = (): void => {
    const current = getBanksSnapshot();
    const currentBank = current.find((b) => b.uuid === uuid);
    if (!currentBank) return;

    const display = resolveDisplayPositions(current);
    const primaryDisp = display.get(uuid) ?? {
      x: currentBank.x,
      y: currentBank.y,
    };
    const curDx = snappedX - primaryDisp.x;
    const curDy = snappedY - primaryDisp.y;
    if (curDx === 0 && curDy === 0) return;

    commitBanks(
      current.map((b) => {
        if (!moveSet.has(b.uuid)) return b;
        const pos = display.get(b.uuid) ?? { x: b.x, y: b.y };
        return {
          ...b,
          x: snapToGrid(pos.x + curDx),
          y: snapToGrid(pos.y + curDy),
        };
      }),
    );
  };

  if (isUndoGroupOpen()) {
    apply();
  } else {
    recordLayoutAround('Move bank', [...moveSet], apply);
  }
}

/** Set one bank's stored origin (no cluster move) — for layout/calibration tests. */
export function setBankOrigin(uuid: string, x: number, y: number): boolean {
  const list = getBanksSnapshot();
  const bank = list.find((b) => b.uuid === uuid);
  if (!bank) return false;

  const snappedX = snapToGrid(x);
  const snappedY = snapToGrid(y);
  if (bank.x === snappedX && bank.y === snappedY) return true;

  recordLayoutAround('Set bank origin', [uuid], () => {
    const current = getBanksSnapshot();
    commitBanks(
      current.map((b) =>
        b.uuid === uuid ? { ...b, x: snappedX, y: snappedY } : b,
      ),
    );
  });
  log('store', 'setBankOrigin', { name: bank.name, x: snappedX, y: snappedY });
  return true;
}

export function setShowSynthZone(enabled: boolean): void {
  appSettings.update((s) => ({ ...s, showSynthZone: enabled }));
  log('store', 'setShowSynthZone', { enabled });
}

export function setShowDebugShapes(enabled: boolean): void {
  appSettings.update((s) => ({ ...s, showDebugShapes: enabled }));
  log('store', 'setShowDebugShapes', { enabled });
}

/** Snap all attached banks to recommended positions; clears user-positioned flags for them. */
export function realignAttachedBanks(): number {
  const before = getBanksSnapshot();
  logPositionSnapshot('realign', 'positions before realign', before);

  const attachedUuids = new Set(
    before.filter((b) => b.attachedToUuid && b.attachDirection).map((b) => b.uuid),
  );

  const realigned = computeRealignedBanks(before);
  let movedCount = 0;

  for (const bank of realigned) {
    const prev = before.find((b) => b.uuid === bank.uuid);
    if (prev && (prev.x !== bank.x || prev.y !== bank.y)) movedCount++;
  }

  commitBanks(realigned);
  // Bulk layout rewrite — older position deltas no longer apply cleanly.
  clearHistory();

  userPositionedUuids.update((set) => {
    const next = new Set(set);
    for (const uuid of attachedUuids) {
      next.delete(uuid);
    }
    return next;
  });

  logPositionChanges('realign', 'positions changed by realign', before, realigned);
  log('store', 'realignAttachedBanks summary', { movedCount });
  return movedCount;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Default `.nlbackup` filename matching C15 export naming. */
export function buildDefaultExportFilename(date = new Date()): string {
  const stamp = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${pad2(date.getHours())}-${pad2(date.getMinutes())}`;
  return `${stamp}-nonlinear-c15-banks.nlbackup`;
}

/** Serialize current banks to gzip `.nlbackup` and trigger a browser download. */
export function exportBackup(options: { filename?: string } = {}): boolean {
  const list = getBanksSnapshot();
  if (list.length === 0) {
    setStoreError('No banks to export.');
    return false;
  }

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

  try {
    const filename = sanitizeBackupFilename(rawFilename);
    const serializeDate = formatSerializeDate();
    const xml = serializePresetManagerXml({
      banks: list,
      serializeDate,
      selectedBankUuid: getPrimarySelectedUuid() ?? list[0]!.uuid,
      selectedMidiBankUuid: meta.selectedMidiBankUuid,
    });
    const bytes = compressString(xml);

    downloadBytes(bytes, filename);
    clearSessionDirty();
    bankMeta.update((m) => ({ ...m, error: null }));
    log('export', 'exportBackup ok', {
      filename,
      bankCount: list.length,
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
      log('import', '========== SINGLE-BANK VIEWPORT CHECK BEGIN ==========');

      const baseline = buildSingleBankViewportCheck(
        doc.banks,
        viewport,
        'xml-original',
        file.name,
        canvas,
      );
      if (baseline) logSingleBankViewportCheck(baseline);

      const positioned = positionBanksAtViewportCenter(doc.banks, viewport);
      logPositionSnapshot('import', 'single-bank at viewport center (pre-heal)', positioned);

      const placed = buildSingleBankViewportCheck(
        positioned,
        viewport,
        'after-viewport-placement',
        file.name,
        canvas,
      );
      if (placed) logSingleBankViewportCheck(placed);

      const beforeUuids = new Set(getBanksSnapshot().map((bank) => bank.uuid));
      mergeBanks(positioned, doc, { preserveIncomingPositions: true });

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
        centered: finalCheck?.centered ?? placed?.centered ?? false,
        file: file.name,
        bank: doc.banks[0]?.name ?? '(unknown)',
      });
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