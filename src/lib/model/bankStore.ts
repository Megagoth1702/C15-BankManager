/**
 * Public façade for document + selection + import/export commands.
 * Implementation lives in focused modules; this file re-exports and owns
 * bank create/delete/attach/move/preset content mutations.
 */
import { get } from 'svelte/store';
import {
  logPositionChanges,
  logPositionSnapshot,
} from '../debug/positionLog';
import { log } from '../debug/sessionLog';
import { horizontalAttachStep } from '../canvas/geometry';
import {
  mapDetachedKeepingDisplay,
  resolveDisplayPositions,
} from '../canvas/displayPosition';
import {
  getCreateBankPositionAtPointer,
} from '../canvas/pointerPosition';
import { viewport } from '../canvas/viewport.svelte';
import type { AttachDirection, Bank } from '../types/bank';
import type { PresetColorName } from '../xml/presetAttributes';
import { canAttachBank } from './attachRules';
import {
  resolveAttachFromDockEdge,
  resolveAttachFromHandle,
  type DockEdge,
} from './attachOperation';
import {
  createEmptyBank,
  nextDefaultBankName,
  snapToGrid,
} from './bankFactory';
import {
  bankMeta,
  getBanksSnapshot,
  userPositionedUuids,
} from './bankState';
import {
  clearError,
  clearPresetSelectionFields,
  commitBanks,
  getBankByUuid,
  getPrimarySelectedUuid,
  getSelectedBank,
  isBankSelected,
  setStoreError,
} from './documentCommit';
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
  attachmentCrossesMoveSet,
  collectClusterDescendantUuids,
  computeRealignedBanks,
  computeRecommendedPosition,
  countAttachedBanks,
} from './positioning';
import {
  beginUndoGroup,
  captureBankContent,
  clearHistory,
  endUndoGroup,
  expandOpenUndoGroupUuids,
  isUndoGroupOpen,
  recordBankStructureFromLists,
  recordLayoutAround,
  recordPresetContentChange,
  undo as undoHistory,
  redo as redoHistory,
} from './undoHistory';
import { findByUuid } from '../uuid/uuidKey';

export type { ImportMode, InteractionSurface } from './bankState';
export type { SelectMode } from './selectionCommands';
export type {
  ExportBackupOptions,
  ExportBanksAsXmlOptions,
} from './exportSession';

export {
  canUndo,
  canRedo,
  beginUndoGroup,
  endUndoGroup,
  expandOpenUndoGroupUuids,
  cancelUndoGroup,
  clearHistory,
  isUndoGroupOpen,
} from './undoHistory';

export {
  appSettings,
  bankMeta,
  banks,
  userPositionedUuids,
} from './bankState';
export { sessionDirty } from './sessionDirty';
export { countAttachedBanks } from './positioning';

export {
  clearError,
  getBankByUuid,
  getPrimarySelectedUuid,
  getSelectedBank,
  isBankSelected,
} from './documentCommit';

export {
  setSidebarTab,
  setShowSynthZone,
  setShowDebugShapes,
  setBankDetailMinZoom,
} from './settingsCommands';

export {
  selectBanks,
  selectBank,
  selectBankRange,
  selectPreset,
  selectPresetsBatch,
  startRenameBank,
  cancelRenameBank,
  startRenamePreset,
  cancelRenamePreset,
} from './selectionCommands';

export {
  buildDefaultExportFilename,
  exportSelectedBanksLabel,
  exportSelectedBanksAsXmlLabel,
  exportAllAsBackup,
  exportSelectedBanks,
  exportSelectedBanksAsXml,
  exportBanksAsXml,
  exportBackup,
} from './exportSession';

export {
  importFile,
  importFolderFilesLegacy,
  executeMassImport,
  importFolderFiles,
} from './importSession';

export function undo(): boolean {
  return undoHistory();
}

export function redo(): boolean {
  return redoHistory();
}

export function deleteSelectedPresets(): boolean {
  const meta = get(bankMeta);
  const bankUuid = meta.presetSelectionBankUuid;
  const uuids = meta.selectedPresetUuids;
  if (!bankUuid || uuids.length === 0) return false;

  const list = getBanksSnapshot();
  const bank = findByUuid(list, bankUuid);
  if (!bank) return false;

  const names = uuids
    .map((uuid) => findByUuid(bank.presets, uuid)?.name)
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
    const selected = findByUuid(list, selectedUuid);
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
  color: PresetColorName,
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

  const parent = findByUuid(list, parentUuid)!;
  const child = findByUuid(list, childUuid)!;
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

/**
 * Canonical detach: clear parent links for matching banks and bake display
 * origins into stored x/y so cards do not jump. Prefer calling inside an open
 * undo group during drag; otherwise records a one-shot layout entry.
 */
export function detachBanksKeepingDisplay(
  shouldDetach: (bank: Bank) => boolean,
  options: {
    label?: string;
    /** History scope when no undo group is open (defaults to detaching banks). */
    historyUuids?: readonly string[];
  } = {},
): number {
  const list = getBanksSnapshot();
  const toDetach = list.filter(
    (b) => Boolean(b.attachedToUuid) && shouldDetach(b),
  );
  if (toDetach.length === 0) return 0;

  const historyUuids =
    options.historyUuids ?? toDetach.map((b) => b.uuid);
  const label = options.label ?? 'Detach bank';

  const apply = (): void => {
    const current = getBanksSnapshot();
    commitBanks(
      mapDetachedKeepingDisplay(
        current,
        (b) => Boolean(b.attachedToUuid) && shouldDetach(b),
      ),
    );
  };

  if (isUndoGroupOpen()) {
    apply();
  } else {
    recordLayoutAround(label, [...historyUuids], apply);
  }

  log('store', 'detachBanksKeepingDisplay', {
    count: toDetach.length,
    uuids: toDetach.map((b) => b.uuid),
    formerParents: toDetach.map((b) => b.attachedToUuid),
    label,
  });
  return toDetach.length;
}

/** User-initiated detach (sidebar / future context menu). */
export function detachBank(uuid: string): boolean {
  const list = getBanksSnapshot();
  const bank = findByUuid(list, uuid);
  if (!bank?.attachedToUuid) {
    setStoreError('Bank is not attached to a parent.');
    return false;
  }

  const formerParentUuid = bank.attachedToUuid;
  const formerParent = findByUuid(list, formerParentUuid);
  const n = detachBanksKeepingDisplay((b) => b.uuid === uuid, {
    label: 'Detach bank',
    historyUuids: [uuid],
  });
  if (n === 0) return false;

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
 * At bank-drag grab: sever every attachment edge that crosses the move-set
 * boundary (exactly one endpoint in the set).
 */
export function detachBanksCrossingMoveSet(moveUuids: Iterable<string>): number {
  const moveSet = new Set(moveUuids);
  return detachBanksKeepingDisplay(
    (b) => attachmentCrossesMoveSet(b, moveSet),
    {
      label: 'Detach for move',
      historyUuids: [...moveSet],
    },
  );
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
    .map((uuid) => findByUuid(list, uuid)?.name)
    .filter(Boolean);
  const message = `Delete ${uuids.length} selected banks (${names.join(', ')})? You can undo with the Undo button.`;
  if (!window.confirm(message)) return false;

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
  const bank = findByUuid(list, uuid);
  if (!bank) return false;

  const message = `Delete "${bank.name}"? You can undo with the Undo button.`;
  if (!window.confirm(message)) return false;

  const childCount = list.filter((b) => b.attachedToUuid === uuid).length;
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
 * Move a bank and its move set (default: primary + attachment descendants).
 * Target (x, y) is the primary’s on-screen origin after the drag.
 * Δ is taken from the primary’s current **display** position (not stored XML).
 * Optional `moveUuids` overrides the default set.
 *
 * Undock is **not** performed here — canvas grab must call
 * `detachBanksCrossingMoveSet` (boundary cut) before moving.
 */
export function moveBankTo(
  uuid: string,
  x: number,
  y: number,
  options: { moveUuids?: Iterable<string> } = {},
): void {
  const list = getBanksSnapshot();
  const bank = findByUuid(list, uuid);
  if (!bank) return;

  const snappedX = snapToGrid(x);
  const snappedY = snapToGrid(y);

  const moveSet = options.moveUuids
    ? new Set(options.moveUuids)
    : new Set<string>([uuid, ...collectClusterDescendantUuids(uuid, list)]);

  const apply = (): void => {
    const current = getBanksSnapshot();
    const currentBank = findByUuid(current, uuid);
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
  const bank = findByUuid(list, uuid);
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
    const prev = findByUuid(before, bank.uuid);
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
