import type { Bank, Preset } from '../types/bank';
import {
  getPresetAttributes,
  patchPresetMetadata,
  type PresetColorName,
} from '../xml/presetAttributes';

function refreshPresetFields(preset: Preset): Preset {
  const meta = getPresetAttributes(preset.rawXml);
  return {
    ...preset,
    name: preset.rawXml.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim() ?? preset.name,
    comment: meta.comment,
    deviceName: meta.deviceName,
    color: meta.color,
    storeTime: meta.storeTime,
  };
}

function updatePresetInBank(
  banks: Bank[],
  bankUuid: string,
  presetUuid: string,
  updater: (preset: Preset) => Preset,
): Bank[] | null {
  const bank = banks.find((b) => b.uuid === bankUuid);
  if (!bank) return null;

  let found = false;
  const presets = bank.presets.map((preset) => {
    if (preset.uuid.toLowerCase() !== presetUuid.toLowerCase()) return preset;
    found = true;
    return updater(preset);
  });

  if (!found) return null;

  return banks.map((b) =>
    b.uuid === bankUuid
      ? {
          ...b,
          presets,
          lastChangedTimestamp: Math.floor(Date.now() / 1000),
        }
      : b,
  );
}

export function applyPresetRename(
  banks: Bank[],
  bankUuid: string,
  presetUuid: string,
  name: string,
): Bank[] | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  return updatePresetInBank(banks, bankUuid, presetUuid, (preset) => {
    const rawXml = patchPresetMetadata(preset.rawXml, { name: trimmed });
    return refreshPresetFields({ ...preset, rawXml });
  });
}

export function applyPresetColor(
  banks: Bank[],
  bankUuid: string,
  presetUuid: string,
  color: PresetColorName,
): Bank[] | null {
  return updatePresetInBank(banks, bankUuid, presetUuid, (preset) => {
    const rawXml = patchPresetMetadata(preset.rawXml, { color });
    return refreshPresetFields({ ...preset, rawXml });
  });
}

export function applyPresetComment(
  banks: Bank[],
  bankUuid: string,
  presetUuid: string,
  comment: string,
): Bank[] | null {
  return updatePresetInBank(banks, bankUuid, presetUuid, (preset) => {
    const rawXml = patchPresetMetadata(preset.rawXml, { comment });
    return refreshPresetFields({ ...preset, rawXml });
  });
}

export function applyPresetColorBatch(
  banks: Bank[],
  bankUuid: string,
  presetUuids: readonly string[],
  color: PresetColorName,
): Bank[] | null {
  let next = banks;
  for (const uuid of presetUuids) {
    const updated = applyPresetColor(next, bankUuid, uuid, color);
    if (!updated) return null;
    next = updated;
  }
  return next;
}