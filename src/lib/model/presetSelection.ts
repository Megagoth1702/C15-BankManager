/**
 * Pure preset multi-select helpers shared by canvas cards, context menus, and drag.
 */
import { uuidEquals, uniqueUuids } from '../uuid/uuidKey';

export type PresetSelectionMeta = {
  presetSelectionBankUuid: string | null;
  selectedPresetUuids: readonly string[];
};

/**
 * If `clickedUuid` is already in the multi-selection for `bankUuid`, return that
 * full set (for drag / context menu acting on selection). Otherwise return only
 * the clicked preset.
 */
export function resolvePresetUuidsForAction(
  bankUuid: string,
  clickedUuid: string,
  meta: PresetSelectionMeta,
): string[] {
  const sameBank = meta.presetSelectionBankUuid === bankUuid;
  const clickedInSelection =
    sameBank &&
    meta.selectedPresetUuids.some((u) => uuidEquals(u, clickedUuid));

  if (clickedInSelection && meta.selectedPresetUuids.length > 0) {
    return [...meta.selectedPresetUuids];
  }
  return [clickedUuid];
}

/**
 * Preset drag drop action from modifiers + same/cross bank.
 * - same bank → reorder
 * - cross bank + ctrl/meta → move
 * - cross bank default → copy
 */
export type PresetDropCommitAction = 'reorder' | 'move' | 'copy';

export function planPresetDropCommit(
  sourceBankUuid: string,
  targetBankUuid: string,
  modifiers: { ctrlOrMeta: boolean },
): PresetDropCommitAction {
  if (sourceBankUuid === targetBankUuid) return 'reorder';
  return modifiers.ctrlOrMeta ? 'move' : 'copy';
}

export function uniquePresetUuids(uuids: readonly string[]): string[] {
  return uniqueUuids(uuids);
}

export function presetRangeInOrder(
  order: readonly string[],
  anchorUuid: string,
  clickedUuid: string,
): string[] {
  const i1 = order.findIndex((u) => uuidEquals(u, anchorUuid));
  const i2 = order.findIndex((u) => uuidEquals(u, clickedUuid));
  if (i1 === -1 || i2 === -1) return [clickedUuid];
  const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
  return order.slice(lo, hi + 1);
}
