/**
 * Pure helpers for canvas preset drag commit / context-menu selection.
 */
import {
  planPresetDropCommit,
  resolvePresetUuidsForAction,
  type PresetDropCommitAction,
  type PresetSelectionMeta,
} from '../model/presetSelection';
import { uuidEquals } from '../uuid/uuidKey';

export type { PresetDropCommitAction };

/**
 * Resolve UUIDs for a context-menu action. Returns whether the caller should
 * also call selectPreset (clicked outside multi-selection).
 */
export function resolvePresetContextMenuSelection(
  bankUuid: string,
  presetUuid: string,
  meta: PresetSelectionMeta,
): { presetUuids: string[]; shouldSelectClicked: boolean } {
  const presetUuids = resolvePresetUuidsForAction(bankUuid, presetUuid, meta);
  const alone =
    presetUuids.length === 1 && uuidEquals(presetUuids[0]!, presetUuid);
  const alreadyOnly =
    meta.presetSelectionBankUuid === bankUuid &&
    meta.selectedPresetUuids.length === 1 &&
    uuidEquals(meta.selectedPresetUuids[0] ?? '', presetUuid);
  return {
    presetUuids,
    shouldSelectClicked: alone && !alreadyOnly,
  };
}

export function resolvePresetDropAction(
  sourceBankUuid: string,
  targetBankUuid: string,
  ctrlOrMeta: boolean,
): PresetDropCommitAction {
  return planPresetDropCommit(sourceBankUuid, targetBankUuid, { ctrlOrMeta });
}
