import type { Bank } from '../types/bank';

export interface DeletePresetsResult {
  ok: boolean;
  deleted: string[];
  banks?: Bank[];
  error?: string;
}

/**
 * Remove presets from a bank (C15: `Bank::deletePreset` — order + preset list updated).
 */
export function deletePresetsFromBank(
  banks: Bank[],
  bankUuid: string,
  presetUuids: readonly string[],
): DeletePresetsResult {
  const unique = [...new Set(presetUuids)];
  if (unique.length === 0) {
    return { ok: false, deleted: [], error: 'No presets selected.' };
  }

  const bank = banks.find((b) => b.uuid === bankUuid);
  if (!bank) {
    return { ok: false, deleted: [], error: 'Bank not found.' };
  }

  const needles = new Set(unique.map((u) => u.toLowerCase()));
  const toDelete: string[] = [];
  for (const uuid of unique) {
    const found = bank.presets.some((p) => p.uuid.toLowerCase() === uuid.toLowerCase());
    if (!found) {
      return { ok: false, deleted: [], error: `Preset not found in bank: ${uuid}` };
    }
    toDelete.push(uuid);
  }

  const nextOrder = bank.presetOrder.filter((u) => !needles.has(u.toLowerCase()));
  const nextPresets = bank.presets.filter((p) => !needles.has(p.uuid.toLowerCase()));
  let nextSelected = bank.selectedPreset;
  if (needles.has(bank.selectedPreset.toLowerCase())) {
    nextSelected = nextOrder[0] ?? '';
  }

  const now = Math.floor(Date.now() / 1000);
  const updated = banks.map((b) => {
    if (b.uuid !== bankUuid) return b;
    return {
      ...b,
      presetOrder: nextOrder,
      presets: nextPresets,
      selectedPreset: nextSelected,
      lastChangedTimestamp: now,
    };
  });

  return { ok: true, deleted: toDelete, banks: updated };
}